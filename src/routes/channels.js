import mongoose from 'mongoose';
import { Router } from 'express';
import { Channel, ChannelPost, Conversation, Follow } from '../models.js';
import { requireAuth } from '../auth.js';
import { emitToRoom } from '../realtime.js';
import { isOwnFileUrl, previewOf, wrap } from '../util.js';
import { serialize } from './_shared.js';

const router = Router();
router.use(requireAuth);

const validId = (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(404).json({ error: 'NOT_FOUND' });
  return false;
};

router.get(
  '/',
  wrap(async (req, res) => {
    const me = req.userId;
    const channels = await Channel.find().lean();
    const ids = channels.map((c) => c._id);
    const [counts, mine, lastPosts] = await Promise.all([
      Follow.aggregate([{ $match: { channel: { $in: ids } } }, { $group: { _id: '$channel', n: { $sum: 1 } } }]),
      Follow.find({ user: me, channel: { $in: ids } }).lean(),
      ChannelPost.aggregate([
        { $match: { channel: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$channel', type: { $first: '$type' }, body: { $first: '$body' }, at: { $first: '$createdAt' } } },
      ]),
    ]);
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    const mineSet = new Set(mine.map((f) => String(f.channel)));
    const lastBy = new Map(lastPosts.map((p) => [String(p._id), p]));

    const rows = channels.map((c) => {
      const last = lastBy.get(String(c._id));
      return {
        id: String(c._id),
        name: c.name,
        description: c.description,
        avatar_url: c.avatarUrl ?? null,
        owner_id: String(c.owner),
        gist_room_id: c.gistRoom ? String(c.gistRoom) : null,
        subscribers: countBy.get(String(c._id)) ?? 0,
        is_subscribed: mineSet.has(String(c._id)),
        is_owner: String(c.owner) === me,
        last_post: last ? previewOf(last.type, last.body) : null,
        last_post_at: last ? new Date(last.at).toISOString() : null,
        _sort: new Date(last ? last.at : c.createdAt).getTime(),
      };
    });
    rows.sort((a, b) => b._sort - a._sort);
    res.json(rows.map(({ _sort, ...r }) => r));
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim().slice(0, 300);
    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'Channel name must be 2–60 characters.' });
    }
    const channel = await Channel.create({ owner: req.userId, name, description });
    await Follow.create({ channel: channel._id, user: req.userId });
    // every channel gets its own attached discussion group, the "Gist Room"
    const gistRoom = await Conversation.create({
      isGroup: true,
      name,
      owner: req.userId,
      admins: [req.userId],
      members: [req.userId],
      channel: channel._id,
    });
    channel.gistRoom = gistRoom._id;
    await channel.save();
    res.status(201).json({ id: String(channel._id), gist_room_id: String(gistRoom._id) });
  })
);

router.post(
  '/:id/follow',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const channel = await Channel.findById(req.params.id).lean();
    if (!channel) return res.sendStatus(404);
    await Follow.updateOne(
      { channel: req.params.id, user: req.userId },
      { $setOnInsert: { channel: req.params.id, user: req.userId } },
      { upsert: true }
    );
    // following a channel also makes you a member of its Gist Room
    if (channel.gistRoom) {
      await Conversation.updateOne({ _id: channel.gistRoom }, { $addToSet: { members: req.userId } });
    }
    res.json({ ok: true, gist_room_id: channel.gistRoom ? String(channel.gistRoom) : null });
  })
);

router.delete(
  '/:id/follow',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const channel = await Channel.findById(req.params.id).lean();
    await Follow.deleteOne({ channel: req.params.id, user: req.userId });
    if (channel?.gistRoom) {
      await Conversation.updateOne({ _id: channel.gistRoom }, { $pull: { members: req.userId } });
    }
    res.json({ ok: true });
  })
);

router.get(
  '/:id/posts',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const rows = await ChannelPost.find({ channel: req.params.id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(rows.reverse().map(serialize.post));
  })
);

router.post(
  '/:id/posts',
  wrap(async (req, res) => {
    if (!validId(req, res)) return;
    const channel = await Channel.findById(req.params.id).lean();
    if (!channel) return res.sendStatus(404);
    if (String(channel.owner) !== req.userId) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the channel owner can post.' });
    }
    const { type = 'text', body = '', media_url: mediaUrl = null } = req.body ?? {};
    if (!['text', 'image'].includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const text = String(body).trim().slice(0, 4000);
    if (type === 'text' && !text) return res.status(400).json({ error: 'EMPTY' });
    if (type === 'image' && !isOwnFileUrl(mediaUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });

    const post = await ChannelPost.create({
      channel: channel._id,
      author: req.userId,
      type,
      body: text,
      mediaUrl: type === 'image' ? mediaUrl : null,
    });
    const json = serialize.post(post);
    emitToRoom(`channel:${channel._id}`, 'channel:post', json);
    res.status(201).json(json);
  })
);

export default router;
