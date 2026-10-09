import mongoose from 'mongoose';
import { Router } from 'express';
import { Conversation, Listing, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { isOwnFileUrl, wrap } from '../util.js';
import { startDirectConversation } from './_shared.js';

const router = Router();
router.use(requireAuth);

const validId = (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(404).json({ error: 'NOT_FOUND' });
  return false;
};

function listingJson(l) {
  return {
    id: String(l._id),
    conversation_id: String(l.conversation),
    seller_id: String(l.seller),
    title: l.title,
    description: l.description,
    price: l.price,
    photo_url: l.photoUrl ?? null,
    created_at: new Date(l.createdAt).toISOString(),
  };
}

// Everything for sale across every Group / Gist Room I'm a member of — powers the Marketplace tab.
router.get(
  '/',
  wrap(async (req, res) => {
    const myRoomIds = await Conversation.find({ isGroup: true, members: req.userId }).distinct('_id');
    const rows = await Listing.find({ conversation: { $in: myRoomIds } }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(rows.map(listingJson));
  })
);

// Listings posted inside one specific Group / Gist Room.
router.get(
  '/room/:id',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const inRoom = await Conversation.exists({ _id: req.params.id, isGroup: true, members: req.userId });
    if (!inRoom) return res.status(404).json({ error: 'NOT_FOUND' });
    const rows = await Listing.find({ conversation: req.params.id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(rows.map(listingJson));
  })
);

router.post(
  '/room/:id',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const room = await Conversation.findOne({ _id: req.params.id, isGroup: true, members: req.userId });
    if (!room) return res.status(404).json({ error: 'NOT_FOUND' });

    const title = String(req.body?.title ?? '').trim();
    const description = String(req.body?.description ?? '').trim().slice(0, 500);
    const price = String(req.body?.price ?? '').trim().slice(0, 40);
    const photoUrl = req.body?.photo_url ?? null;
    if (title.length < 2 || title.length > 80) {
      return res.status(400).json({ error: 'INVALID_TITLE', message: 'Give it a short title (2–80 characters).' });
    }
    if (photoUrl !== null && !isOwnFileUrl(photoUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });

    const listing = await Listing.create({
      conversation: room._id,
      seller: req.userId,
      title,
      description,
      price,
      photoUrl,
    });
    res.status(201).json(listingJson(listing));
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    await Listing.deleteOne({ _id: req.params.id, seller: req.userId });
    res.json({ ok: true });
  })
);

// The whole point: connect the buyer to the seller. We never see, hold, or move any money —
// this just opens (or reuses) a direct chat and drops in a starter message about the item.
router.post(
  '/:id/request',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const listing = await Listing.findById(req.params.id).lean();
    if (!listing) return res.status(404).json({ error: 'NOT_FOUND' });
    const sellerId = String(listing.seller);
    if (sellerId === req.userId) return res.status(400).json({ error: 'SELF', message: 'This is your own listing.' });
    if (!(await User.exists({ _id: sellerId }))) return res.status(404).json({ error: 'NO_SELLER' });

    const conv = await startDirectConversation(req.userId, sellerId);
    res.json({ conversation_id: String(conv._id), starter_message: `Hi! I'm interested in "${listing.title}" — is it still available?` });
  })
);

export default router;
