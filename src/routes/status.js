import mongoose from 'mongoose';
import { Router } from 'express';
import { Channel, Conversation, Follow, Status, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { isOwnFileUrl, wrap } from '../util.js';

const router = Router();
router.use(requireAuth);

const BGS = ['emerald', 'indigo', 'rose', 'sky'];
const validId = (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(404).json({ error: 'NOT_FOUND' });
  return false;
};

/** Anonymous Status is a weekend-only feature by default: Saturday and Sunday, server local time. */
function isWeekend() {
  const day = new Date().getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function itemJson(r, myId) {
  const isMine = String(r.user) === myId;
  return {
    id: String(r._id),
    type: r.type,
    body: r.body,
    media_url: r.mediaUrl ?? null,
    bg: r.bg,
    created_at: new Date(r.createdAt).toISOString(),
    anonymous: Boolean(r.anonymous),
    // the real poster is kept for everyone server-side, but only shown to themself once anonymous
    posted_by: r.anonymous && !isMine ? null : String(r.user),
    viewed: isMine || r.views.some((v) => String(v.user) === myId),
    view_count: isMine ? r.views.length : undefined,
  };
}

/* ===================== PERSONAL STATUS (unchanged behaviour) ===================== */

// Statuses of me + everyone I have a chat with, grouped per person.
router.get(
  '/',
  wrap(async (req, res) => {
    const me = req.userId;
    const contactIds = await Conversation.find({ isGroup: false, members: me }).distinct('members');
    const ids = [...new Set([me, ...contactIds.map(String)])];
    const rows = await Status.find({ ownerType: 'user', owner: { $in: ids }, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 })
      .lean();
    const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.owner)))] } }).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const groups = new Map();
    for (const r of rows) {
      const uid = String(r.owner);
      const u = byId.get(uid);
      if (!u) continue;
      let g = groups.get(uid);
      if (!g) {
        g = { user_id: uid, name: u.name, phone: u.phone, avatar_url: u.avatarUrl ?? null, is_mine: uid === me, items: [] };
        groups.set(uid, g);
      }
      g.items.push(itemJson(r, me));
    }
    res.json([...groups.values()]);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const { type = 'text', body = '', bg = 'emerald', media_url: mediaUrl = null } = req.body ?? {};
    if (!['text', 'image'].includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const text = String(body).trim().slice(0, 300);
    if (type === 'text' && !text) return res.status(400).json({ error: 'EMPTY', message: 'Write something first.' });
    if (type === 'image' && !isOwnFileUrl(mediaUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });
    const status = await Status.create({
      ownerType: 'user',
      owner: req.userId,
      user: req.userId,
      type,
      body: text,
      bg: BGS.includes(bg) ? bg : 'emerald',
      mediaUrl: type === 'image' ? mediaUrl : null,
    });
    res.status(201).json({ id: String(status._id) });
  })
);

/* ===================== GROUP STATUS ===================== */

router.get(
  '/groups',
  wrap(async (req, res) => {
    const me = req.userId;
    const myGroups = await Conversation.find({ isGroup: true, members: me }).select('_id name avatarUrl').lean();
    const ids = myGroups.map((g) => g._id);
    const rows = await Status.find({ ownerType: 'group', owner: { $in: ids }, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 })
      .lean();
    const byId = new Map(myGroups.map((g) => [String(g._id), g]));

    const groups = new Map();
    for (const r of rows) {
      const gid = String(r.owner);
      const g = byId.get(gid);
      if (!g) continue;
      let entry = groups.get(gid);
      if (!entry) {
        entry = { group_id: gid, name: g.name, avatar_url: g.avatarUrl ?? null, items: [] };
        groups.set(gid, entry);
      }
      entry.items.push(itemJson(r, me));
    }
    res.json([...groups.values()]);
  })
);

router.post(
  '/groups/:id',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const group = await Conversation.findOne({ _id: req.params.id, isGroup: true, members: req.userId });
    if (!group) return res.status(404).json({ error: 'NOT_FOUND' });

    const { type = 'text', body = '', bg = 'emerald', media_url: mediaUrl = null, anonymous = false } = req.body ?? {};
    if (!['text', 'image'].includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const text = String(body).trim().slice(0, 300);
    if (type === 'text' && !text) return res.status(400).json({ error: 'EMPTY', message: 'Write something first.' });
    if (type === 'image' && !isOwnFileUrl(mediaUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });
    if (anonymous && !isWeekend()) {
      return res.status(400).json({
        error: 'ANON_STATUS_WEEKEND_ONLY',
        message: 'Anonymous Status is only available on weekends (Saturday and Sunday) by default.',
      });
    }

    const status = await Status.create({
      ownerType: 'group',
      owner: group._id,
      user: req.userId,
      anonymous: Boolean(anonymous),
      type,
      body: text,
      bg: BGS.includes(bg) ? bg : 'emerald',
      mediaUrl: type === 'image' ? mediaUrl : null,
    });
    res.status(201).json({ id: String(status._id) });
  })
);

/* ===================== CHANNEL STATUS ===================== */

router.get(
  '/channels',
  wrap(async (req, res) => {
    const me = req.userId;
    const followedIds = await Follow.find({ user: me }).distinct('channel');
    const channels = await Channel.find({ _id: { $in: followedIds } }).select('_id name avatarUrl').lean();
    const ids = channels.map((c) => c._id);
    const rows = await Status.find({ ownerType: 'channel', owner: { $in: ids }, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 })
      .lean();
    const byId = new Map(channels.map((c) => [String(c._id), c]));

    const groups = new Map();
    for (const r of rows) {
      const cid = String(r.owner);
      const c = byId.get(cid);
      if (!c) continue;
      let entry = groups.get(cid);
      if (!entry) {
        entry = { channel_id: cid, name: c.name, avatar_url: c.avatarUrl ?? null, items: [] };
        groups.set(cid, entry);
      }
      entry.items.push(itemJson(r, me));
    }
    res.json([...groups.values()]);
  })
);

router.post(
  '/channels/:id',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const channel = await Channel.findById(req.params.id).lean();
    if (!channel) return res.status(404).json({ error: 'NOT_FOUND' });

    const { type = 'text', body = '', bg = 'emerald', media_url: mediaUrl = null, anonymous = false } = req.body ?? {};
    if (!['text', 'image'].includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const text = String(body).trim().slice(0, 300);
    if (type === 'text' && !text) return res.status(400).json({ error: 'EMPTY', message: 'Write something first.' });
    if (type === 'image' && !isOwnFileUrl(mediaUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });

    if (anonymous) {
      // the weekend anonymous outlet is open to any subscriber, not just the owner
      if (!isWeekend()) {
        return res.status(400).json({
          error: 'ANON_STATUS_WEEKEND_ONLY',
          message: 'Anonymous Status is only available on weekends (Saturday and Sunday) by default.',
        });
      }
      if (!(await Follow.exists({ channel: channel._id, user: req.userId }))) {
        return res.status(403).json({ error: 'NOT_FOLLOWING', message: 'Follow this channel to post here.' });
      }
    } else if (String(channel.owner) !== req.userId) {
      // the normal, identified status stays true to how a Channel works: only the owner broadcasts
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the channel owner can post a normal status.' });
    }

    const status = await Status.create({
      ownerType: 'channel',
      owner: channel._id,
      user: req.userId,
      anonymous: Boolean(anonymous),
      type,
      body: text,
      bg: BGS.includes(bg) ? bg : 'emerald',
      mediaUrl: type === 'image' ? mediaUrl : null,
    });
    res.status(201).json({ id: String(status._id) });
  })
);

/* ===================== SHARED: view / delete (any category, by status id) ===================== */

router.post(
  '/:id/view',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    await Status.updateOne(
      { _id: req.params.id, user: { $ne: req.userId }, 'views.user': { $ne: req.userId } },
      { $push: { views: { user: req.userId, at: new Date() } } }
    );
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    // only the real poster can remove their own status, anonymous or not
    await Status.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  })
);

export default router;
