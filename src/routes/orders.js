import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import { Listing, Order, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { wrap } from '../util.js';
import { config, opayConfigured } from '../config.js';
import { createCashier, queryStatus, verifyCallback } from '../opay.js';

const router = Router();

/** A pending order is only cancelable while nothing has been paid; a paid order is only releasable
 * from `paid`. Exported so the rules are testable without a database. */
export const canCancelOrder = (o) => o.status === 'pending';
export const canReleaseOrder = (o) => o.status === 'paid';

const isId = (v) => mongoose.isValidObjectId(v);

function orderJson(o, listingTitle = null) {
  return {
    id: String(o._id),
    listing_id: String(o.listing),
    listing_title: listingTitle,
    buyer_id: String(o.buyer),
    seller_id: String(o.seller),
    amount_cents: o.amountCents,
    currency: o.currency,
    status: o.status,
    reference: o.reference,
    checkout_url: o.checkoutUrl ?? null,
    note: o.note ?? '',
    created_at: new Date(o.createdAt).toISOString(),
    paid_at: o.paidAt ? new Date(o.paidAt).toISOString() : null,
    released_at: o.releasedAt ? new Date(o.releasedAt).toISOString() : null,
    payout: { status: o.payout?.status ?? 'none', note: o.payout?.note ?? null },
  };
}

/** Resolves the listing title for a batch of orders, so we don't store a denormalized copy that
 * can go stale when the seller edits the listing. */
async function withTitles(orders) {
  const ids = [...new Set(orders.map((o) => String(o.listing)))];
  const listings = await Listing.find({ _id: { $in: ids } }).select('title').lean();
  const titles = new Map(listings.map((l) => [String(l._id), l.title]));
  return orders.map((o) => orderJson(o, titles.get(String(o.listing)) ?? null));
}

// ---------------------------------------------------------------------------------------------
// OPay webhook. Registered BEFORE requireAuth so the gateway can reach it unauthenticated — the
// HMAC signature, not a bearer token, is what authenticates this request.
// ---------------------------------------------------------------------------------------------
router.post(
  '/opay/callback',
  wrap(async (req, res) => {
    const verdict = verifyCallback(req.body);
    if (!verdict.ok) return res.status(400).json({ error: 'BAD_SIGNATURE' });

    const payload = verdict.payload;
    const reference = String(payload.reference ?? '');
    const order = await Order.findOne({ reference });
    if (!order) {
      // Unknown reference: still 200 so OPay stops retrying, but log it for investigation.
      console.warn(`[orders] OPay callback for unknown reference: ${reference}`);
      return res.json({ ok: true });
    }

    // Idempotent: a repeated SUCCESS callback must not re-transition an already-paid order.
    if (String(payload.status).toUpperCase() === 'SUCCESS' && order.status === 'pending') {
      order.status = 'paid';
      order.paidAt = new Date();
      order.gatewayPayload = req.body;
      if (payload.transactionId) order.gatewayOrderNo = String(payload.transactionId);
      await order.save();
    } else {
      // Still record the last verified payload, whatever the status, without changing state.
      order.gatewayPayload = req.body;
      await order.save();
    }
    res.json({ ok: true });
  })
);

router.use(requireAuth);

// Start an escrow order for a listing: we create the order row first so the OPay `reference`
// exists before we talk to the gateway, then hand the buyer a checkout URL.
router.post(
  '/',
  wrap(async (req, res) => {
    const listingId = req.body?.listing_id;
    if (!isId(listingId)) return res.status(404).json({ error: 'NOT_FOUND' });
    const listing = await Listing.findById(listingId).lean();
    if (!listing) return res.status(404).json({ error: 'NOT_FOUND' });

    if (String(listing.seller) === req.userId) {
      return res.status(400).json({ error: 'SELF_ORDER', message: "You can't buy your own listing." });
    }
    // Amounts are never trusted from the client — the price comes from the listing, server-side.
    if (typeof listing.priceCents !== 'number' || !Number.isInteger(listing.priceCents) || listing.priceCents <= 0) {
      return res.status(400).json({
        error: 'PRICE_NOT_SET',
        message: 'This listing has no numeric price yet. Ask the seller to set one before buying.',
      });
    }
    if (!opayConfigured()) {
      return res.status(503).json({ error: 'PAYMENTS_UNAVAILABLE', message: 'Payments are not configured on this server.' });
    }
    if (await Order.exists({ listing: listing._id, buyer: req.userId, status: 'pending' })) {
      return res.status(400).json({ error: 'ORDER_PENDING', message: 'You already have a pending order for this listing.' });
    }

    const note = String(req.body?.note ?? '').trim().slice(0, 300);
    const currency = String(listing.currency || config.opayCurrency || 'USD').toUpperCase();
    const reference = `cm_${String(listing._id)}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const order = await Order.create({
      listing: listing._id,
      buyer: req.userId,
      seller: listing.seller,
      amountCents: listing.priceCents,
      currency,
      reference,
      note,
    });

    try {
      const buyer = await User.findById(req.userId).lean();
      const { cashierUrl, orderNo } = await createCashier({
        reference,
        amountCents: listing.priceCents,
        currency,
        country: config.opayCountry,
        returnUrl: config.opayReturnUrl,
        callbackUrl: config.opayCallbackUrl || undefined,
        cancelUrl: config.opayCancelUrl || undefined,
        expireMinutes: 30,
        userInfo: {
          userId: req.userId,
          userName: buyer?.name || 'Chatimall user',
          userMobile: buyer?.phone || '',
          userEmail: buyer?.email || '',
        },
        product: {
          productId: String(listing._id),
          name: listing.title,
          description: listing.description || listing.title,
          price: listing.priceCents,
          quantity: 1,
        },
      });
      order.checkoutUrl = cashierUrl;
      order.gatewayOrderNo = orderNo ? String(orderNo) : null;
      await order.save();
      res.status(201).json(orderJson(order, listing.title));
    } catch (err) {
      order.status = 'failed';
      await order.save();
      console.error(`[orders] OPay create failed for ${reference}:`, err.message);
      res.status(502).json({ error: 'GATEWAY', message: 'The payment gateway could not start this checkout. Please try again.' });
    }
  })
);

// My orders, as buyer or seller, newest first.
router.get(
  '/mine',
  wrap(async (req, res) => {
    const rows = await Order.find({ $or: [{ buyer: req.userId }, { seller: req.userId }] })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(await withTitles(rows));
  })
);

// One order — visible only to its buyer or seller (anyone else gets a 404, not a 403, so we
// don't reveal that the order exists).
router.get(
  '/:id',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const order = await Order.findOne({
      _id: req.params.id,
      $or: [{ buyer: req.userId }, { seller: req.userId }],
    }).lean();
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
    const [json] = await withTitles([order]);
    res.json(json);
  })
);

// Buyer asks us to re-check the gateway (e.g. the callback was missed). Only a pending order can
// move to paid.
router.post(
  '/:id/sync',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const order = await Order.findOne({ _id: req.params.id, buyer: req.userId });
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    if (order.status !== 'pending') {
      const [json] = await withTitles([order.toObject()]);
      return res.json(json);
    }
    if (!opayConfigured()) return res.status(503).json({ error: 'PAYMENTS_UNAVAILABLE' });

    let result;
    try {
      result = await queryStatus({ reference: order.reference, country: config.opayCountry });
    } catch (err) {
      console.error(`[orders] OPay status failed for ${order.reference}:`, err.message);
      return res.status(502).json({ error: 'GATEWAY', message: 'Could not reach the payment gateway.' });
    }

    order.gatewayPayload = result.raw ?? order.gatewayPayload;
    if (String(result.status).toUpperCase() === 'SUCCESS') {
      order.status = 'paid';
      order.paidAt = new Date();
      if (result.transactionId) order.gatewayOrderNo = String(result.transactionId);
    }
    await order.save();
    const [json] = await withTitles([order.toObject()]);
    res.json(json);
  })
);

// Buyer confirms receipt: escrow release. The platform held the money, so this records that the
// seller is owed a payout — but we cannot verify a real transfer, so `payout.status` is 'manual'
// and the note tells an operator exactly what to settle. We never claim the payout happened.
router.post(
  '/:id/confirm',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const order = await Order.findOne({ _id: req.params.id, buyer: req.userId });
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    if (!canReleaseOrder(order)) {
      return res.status(400).json({ error: 'BAD_STATE', message: 'Only a paid order can be released.' });
    }

    const now = new Date();
    order.status = 'released';
    order.releasedAt = now;
    const payoutNote = [
      `Seller payout owed: ${order.amountCents} ${order.currency} cents — settle manually to seller ${String(order.seller)}.`,
      config.opayPayoutNote,
    ]
      .filter(Boolean)
      .join(' ');
    order.payout = { status: 'manual', note: payoutNote || null, at: now };
    await order.save();
    const [json] = await withTitles([order.toObject()]);
    res.json(json);
  })
);

// Buyer abandons an unpaid order.
router.post(
  '/:id/cancel',
  wrap(async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const order = await Order.findOne({ _id: req.params.id, buyer: req.userId });
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    if (!canCancelOrder(order)) {
      return res.status(400).json({ error: 'BAD_STATE', message: 'Only a pending order can be canceled.' });
    }

    order.status = 'canceled';
    order.canceledAt = new Date();
    await order.save();
    const [json] = await withTitles([order.toObject()]);
    res.json(json);
  })
);

export default router;
