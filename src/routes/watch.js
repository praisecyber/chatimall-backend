import mongoose from 'mongoose';
import { Router } from 'express';
import { Conversation, WatchSession } from '../models.js';
import { requireAuth } from '../auth.js';
import { emitToUsers } from '../realtime.js';
import { parseWatchUrl, wrap } from '../util.js';

const router = Router();
router.use(requireAuth);

const validId = (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(404).json({ error: 'NOT_FOUND' });
  return false;
};

async function loadRoom(req, res) {
  if (!validId(req, res)) return null;
  const room = await Conversation.findOne({ _id: req.params.id, isGroup: true, members: req.userId });
  if (!room) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return null;
  }
  return room;
}

function sessionJson(s) {
  return {
    platform: s.platform,
    video_id: s.videoId,
    url: s.url,
    queued_by: String(s.queuedBy),
    playing: s.playing,
    position_secs: s.positionSecs,
    updated_at: new Date(s.updatedAt).toISOString(),
  };
}

// What's currently queued in this room, if anything — lets someone who just opened the room
// catch up (they estimate the live position themselves from updated_at + playing).
router.get(
  '/:id',
  wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    const session = await WatchSession.findOne({ conversation: room._id }).lean();
    res.json(session ? sessionJson(session) : null);
  })
);

// Queue a new video for the whole room. Anyone in the room can do this — nobody's the "host".
router.post(
  '/:id',
  wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    const parsed = parseWatchUrl(req.body?.url);
    if (!parsed) {
      return res.status(400).json({
        error: 'UNSUPPORTED_LINK',
        message: 'Paste a link to a public TikTok or YouTube video.',
      });
    }
    const session = await WatchSession.findOneAndUpdate(
      { conversation: room._id },
      {
        conversation: room._id,
        platform: parsed.platform,
        videoId: parsed.videoId,
        url: req.body.url,
        queuedBy: req.userId,
        playing: true,
        positionSecs: 0,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    const json = sessionJson(session);
    emitToUsers(room.members.map(String), 'watch:set', { conversation_id: String(room._id), session: json });
    res.status(201).json(json);
  })
);

// Play / pause / seek — broadcast live, and snapshot the position so a late joiner lands close by.
router.post(
  '/:id/state',
  wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    const { playing, position_secs: position } = req.body ?? {};
    if (typeof playing !== 'boolean' || typeof position !== 'number' || position < 0) {
      return res.status(400).json({ error: 'INVALID' });
    }
    const session = await WatchSession.findOneAndUpdate(
      { conversation: room._id },
      { playing, positionSecs: position, updatedAt: new Date() },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: 'NOT_PLAYING', message: 'Nothing is queued in this room yet.' });
    const others = room.members.map(String).filter((id) => id !== req.userId);
    emitToUsers(others, 'watch:state', {
      conversation_id: String(room._id),
      playing,
      position_secs: position,
      by: req.userId,
    });
    res.json({ ok: true });
  })
);

// Stop watching together — clears the room for everyone.
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const room = await loadRoom(req, res);
    if (!room) return;
    await WatchSession.deleteOne({ conversation: room._id });
    emitToUsers(room.members.map(String), 'watch:set', { conversation_id: String(room._id), session: null });
    res.json({ ok: true });
  })
);

export default router;
