import mongoose from 'mongoose';
import { Router } from 'express';
import { Conversation, Message, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { emitToUser, emitToUsers } from '../realtime.js';
import { notifyUser } from '../push.js';
import { isOwnFileUrl, previewOf, publicEncryptionKeyId, wrap } from '../util.js';
import { serialize } from './_shared.js';

const router = Router();
router.use(requireAuth);

// A proposal needs a full day's notice: the vote stays open for 24 hours no matter how
// early everyone finishes voting, then Anonymous Mode turns on for a further 24 hours if yes won.
const ANON_VOTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ANON_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

const validId = (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) return true;
  res.status(404).json({ error: 'NOT_FOUND' });
  return false;
};

/** If a vote's 24-hour window has passed, decide it (or clear it) before anyone reads the group. */
async function settleAnonymousVote(g) {
  const vote = g.anonymous?.vote;
  if (!vote?.startedAt || Date.now() - vote.startedAt.getTime() < ANON_VOTE_WINDOW_MS) return g;
  if (vote.yes.length > vote.no.length) {
    g.anonymous.active = true;
    g.anonymous.expiresAt = new Date(Date.now() + ANON_DEFAULT_DURATION_MS);
  }
  g.anonymous.vote = { startedBy: undefined, startedAt: undefined, yes: [], no: [] };
  await g.save();
  return g;
}

/** Loads a Group the caller belongs to, or answers 404 and returns null. */
async function loadGroup(req, res) {
  if (!validId(req, res)) return null;
  const g = await Conversation.findOne({ _id: req.params.id, isGroup: true, members: req.userId });
  if (!g) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return null;
  }
  return settleAnonymousVote(g);
}

function groupJson(g, myId) {
  // an anonymous window that has quietly expired still reads as active until something touches it
  const active = g.anonymous?.active && (!g.anonymous.expiresAt || g.anonymous.expiresAt > new Date());
  return {
    id: String(g._id),
    name: g.name,
    avatar_url: g.avatarUrl ?? null,
    owner_id: String(g.owner),
    is_owner: String(g.owner) === myId,
    is_admin: (g.admins ?? []).some((a) => String(a) === myId),
    member_count: g.members.length,
    is_gist_room: Boolean(g.channel),
    channel_id: g.channel ? String(g.channel) : null,
    last_message_at: new Date(g.lastMessageAt).toISOString(),
    last_message_preview: g.lastMessagePreview,
    anonymous: {
      active,
      expires_at: active && g.anonymous.expiresAt ? g.anonymous.expiresAt.toISOString() : null,
      vote: g.anonymous?.vote?.startedAt
        ? {
          started_by: String(g.anonymous.vote.startedBy),
          started_at: g.anonymous.vote.startedAt.toISOString(),
          yes: g.anonymous.vote.yes.length,
          no: g.anonymous.vote.no.length,
          total_members: g.members.length,
          closes_at: new Date(g.anonymous.vote.startedAt.getTime() + ANON_VOTE_WINDOW_MS).toISOString(),
          my_vote: g.anonymous.vote.yes.some((u) => String(u) === myId)
            ? 'yes'
            : g.anonymous.vote.no.some((u) => String(u) === myId)
              ? 'no'
              : null,
          open: Date.now() - g.anonymous.vote.startedAt.getTime() < ANON_VOTE_WINDOW_MS,
        }
        : null,
    },
  };
}

/** My groups (not Gist Rooms — those live under Channels). */
router.get(
  '/',
  wrap(async (req, res) => {
    const docs = await Conversation.find({ isGroup: true, members: req.userId, channel: null }).sort({ lastMessageAt: -1 });
    const settled = await Promise.all(docs.map((g) => settleAnonymousVote(g)));
    res.json(settled.map((g) => groupJson(g, req.userId)));
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'Group name must be 2–60 characters.' });
    }
    const memberIds = Array.isArray(req.body?.member_ids) ? req.body.member_ids.filter(mongoose.isValidObjectId) : [];
    const members = [...new Set([req.userId, ...memberIds])];
    const group = await Conversation.create({
      isGroup: true,
      name,
      owner: req.userId,
      admins: [req.userId],
      members,
    });
    res.status(201).json(groupJson(group, req.userId));
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    res.json(groupJson(g, req.userId));
  })
);

router.get(
  '/:id/encryption-keys',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    const users = await User.find({ _id: { $in: g.members } }).select('name publicKey').lean();
    res.json(users.map((user) => ({ user_id: String(user._id), name: user.name, public_key: user.publicKey ?? null })));
  })
);

router.post(
  '/:id/members',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    const userId = req.body?.user_id;
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'INVALID_USER' });
    if (!(await User.exists({ _id: userId }))) return res.status(404).json({ error: 'NO_USER' });
    await Conversation.updateOne({ _id: g._id }, { $addToSet: { members: userId } });
    emitToUsers([String(userId)], 'group:added', { group_id: String(g._id) });
    res.json({ ok: true });
  })
);

router.delete(
  '/:id/members/me',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    if (g.channel) return res.status(400).json({ error: 'GIST_ROOM', message: 'Leave by unfollowing the channel instead.' });
    await Conversation.updateOne(
      { _id: g._id },
      { $pull: { members: req.userId, admins: req.userId, 'anonymous.vote.yes': req.userId, 'anonymous.vote.no': req.userId } }
    );
    res.json({ ok: true });
  })
);

router.get(
  '/:id/messages',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    const rows = await Message.find({ conversation: g._id }).sort({ createdAt: -1 }).limit(300).lean();
    res.json(
      rows.reverse().map((m) => ({
        ...serialize.message(m),
        // while anonymous, hide who sent it from everyone except the sender themself
        sender_id: m.anonymous && String(m.sender) !== req.userId ? null : String(m.sender),
        anonymous: Boolean(m.anonymous),
      }))
    );
  })
);

router.post(
  '/:id/messages',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    const { type = 'text', body = '', media_url: mediaUrl = null, duration_secs: duration = null } = req.body ?? {};
    const TYPES = ['text', 'image', 'video', 'voice', 'file'];
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const encrypted = req.body?.encrypted === true;
    if (type === 'text' && !encrypted) return res.status(400).json({ error: 'ENCRYPTION_REQUIRED' });
    if (encrypted && type !== 'text') return res.status(400).json({ error: 'INVALID_ENCRYPTION' });
    const text = String(body).trim();
    if (text.length > 16000) return res.status(413).json({ error: 'MESSAGE_TOO_LONG' });
    if (type === 'text' && !text) return res.status(400).json({ error: 'EMPTY' });
    if (encrypted) {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return res.status(400).json({ error: 'INVALID_ENCRYPTED_MESSAGE' });
      }
      if (payload?.v !== 3 || payload?.alg !== 'ECDH-AES-GCM' || payload.contextId !== String(g._id)
        || typeof payload.iv !== 'string' || typeof payload.ct !== 'string'
        || !Array.isArray(payload.boxes) || payload.boxes.length !== g.members.length
        || !payload.boxes.every((box) => typeof box.kid === 'string' && box.eph && typeof box.wrapIv === 'string' && typeof box.wrappedKey === 'string')) {
        return res.status(400).json({ error: 'INVALID_ENCRYPTED_MESSAGE' });
      }
      const users = await User.find({ _id: { $in: g.members } }).select('publicKey').lean();
      const expectedKids = new Set(users.map((user) => publicEncryptionKeyId(user.publicKey)).filter(Boolean));
      const providedKids = payload.boxes.map((box) => box.kid);
      if (expectedKids.size !== g.members.length || providedKids.length !== expectedKids.size
        || new Set(providedKids).size !== providedKids.length
        || providedKids.some((kid) => !expectedKids.has(kid))) {
        return res.status(400).json({ error: 'INVALID_ENCRYPTED_RECIPIENTS' });
      }
    }
    if (type !== 'text' && !isOwnFileUrl(mediaUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });

    const anonNow = Boolean(g.anonymous?.active && (!g.anonymous.expiresAt || g.anonymous.expiresAt > new Date()));
    const now = new Date();
    const msg = await Message.create({
      conversation: g._id,
      sender: req.userId,
      type,
      body: text,
      encrypted,
      mediaUrl: type === 'text' ? null : mediaUrl,
      durationSecs: type === 'voice' ? Math.min(Math.max(Number(duration) || 0, 0), 3600) : null,
      anonymous: anonNow,
      createdAt: now,
    });
    await Conversation.updateOne(
      { _id: g._id },
      { $set: { lastMessageAt: now, lastMessagePreview: anonNow ? 'Anonymous message' : encrypted ? 'Encrypted message' : previewOf(type, text), [`lastRead.${req.userId}`]: now } }
    );

    // Two different views of the same message: the sender always sees their own id,
    // everyone else sees null while anonymous. These must NEVER be the same object sent
    // to both — that would print the real identity straight into other members' apps.
    const base = { ...serialize.message(msg), anonymous: anonNow };
    const senderView = { ...base, sender_id: req.userId };
    const othersView = anonNow ? { ...base, sender_id: null } : senderView;

    const others = g.members.map(String).filter((id) => id !== req.userId);
    emitToUser(req.userId, 'group:message', { group_id: String(g._id), message: senderView });
    for (const uid of others) emitToUser(uid, 'group:message', { group_id: String(g._id), message: othersView });

    const sender = await User.findById(req.userId).lean();
    for (const uid of others) {
      void notifyUser(uid, {
        title: anonNow ? g.name : `${g.name} · ${sender?.name || 'Someone'}`,
        body: anonNow ? 'New anonymous message' : encrypted ? 'Encrypted message' : previewOf(type, text),
        data: { type: 'group_message', group_id: String(g._id) },
        channelId: 'messages',
      });
    }
    res.status(201).json(senderView);
  })
);

router.post(
  '/:id/messages/:messageId/report',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.sendStatus(404);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    const msg = await Message.findOneAndUpdate(
      { _id: req.params.messageId, conversation: g._id },
      { $push: { reports: { user: req.userId, reason } } },
      { new: true }
    );
    if (!msg) return res.sendStatus(404);
    // the real sender is always kept, even for a message that was posted anonymously
    res.json({ ok: true });
  })
);

/* ---------- Anonymous Mode: vote to turn on, owner/admin or timer turns it off ---------- */

router.post(
  '/:id/anonymous/propose',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    if (g.anonymous?.active) return res.status(400).json({ error: 'ALREADY_ON' });
    if (g.anonymous?.vote?.startedAt && Date.now() - g.anonymous.vote.startedAt.getTime() < ANON_VOTE_WINDOW_MS) {
      return res.status(400).json({ error: 'VOTE_IN_PROGRESS' });
    }
    g.anonymous = { active: false, expiresAt: null, vote: { startedBy: req.userId, startedAt: new Date(), yes: [req.userId], no: [] } };
    await g.save();
    const others = g.members.map(String).filter((id) => id !== req.userId);
    emitToUsers(g.members.map(String), 'group:anon_vote', { group_id: String(g._id) });
    const proposer = await User.findById(req.userId).lean();
    for (const uid of others) {
      void notifyUser(uid, {
        title: g.name,
        body: `${proposer?.name || 'Someone'} wants to turn on Anonymous Mode. Vote now.`,
        data: { type: 'group_anon_vote', group_id: String(g._id) },
        channelId: 'messages',
      });
    }
    res.json(groupJson(g, req.userId));
  })
);

router.post(
  '/:id/anonymous/vote',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    const vote = g.anonymous?.vote;
    if (!vote?.startedAt) return res.status(400).json({ error: 'NO_VOTE' });
    if (Date.now() - vote.startedAt.getTime() >= ANON_VOTE_WINDOW_MS) return res.status(400).json({ error: 'VOTE_CLOSED' });
    const choice = req.body?.choice === 'yes' ? 'yes' : req.body?.choice === 'no' ? 'no' : null;
    if (!choice) return res.status(400).json({ error: 'INVALID_CHOICE' });

    vote.yes = vote.yes.filter((u) => String(u) !== req.userId);
    vote.no = vote.no.filter((u) => String(u) !== req.userId);
    vote[choice].push(req.userId);
    // the vote stays open for the full 24 hours even once everyone has voted — that day's
    // notice is the point, so members can't be rushed into an anonymous window
    await g.save();
    emitToUsers(g.members.map(String), 'group:anon_vote', { group_id: String(g._id) });
    res.json(groupJson(g, req.userId));
  })
);

router.post(
  '/:id/anonymous/off',
  wrap(async (req, res) => {
    const g = await loadGroup(req, res);
    if (!g) return;
    const canTurnOff = String(g.owner) === req.userId || (g.admins ?? []).some((a) => String(a) === req.userId);
    if (!canTurnOff) return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the group owner can turn this off early.' });
    g.anonymous.active = false;
    g.anonymous.expiresAt = null;
    await g.save();
    emitToUsers(g.members.map(String), 'group:anon_vote', { group_id: String(g._id) });
    res.json(groupJson(g, req.userId));
  })
);

export default router;
