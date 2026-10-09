import mongoose from 'mongoose';
import { Router } from 'express';
import { Conversation, Message, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { emitToUsers, isOnline } from '../realtime.js';
import { notifyUser } from '../push.js';
import { isOwnFileUrl, normalizePhone, previewOf, publicEncryptionKeyId, wrap } from '../util.js';
import { loadConversation, serialize, startDirectConversation } from './_shared.js';
import { processVoiceNote, translateForUser } from '../translate.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['text', 'image', 'video', 'voice', 'file'];

// Chat list with the other person's details and unread counts.
router.get(
  '/',
  wrap(async (req, res) => {
    const me = req.userId;
    const convs = await Conversation.find({ members: me, isGroup: false, archivedBy: { $ne: me } })
      .sort({ lastMessageAt: -1 })
      .lean();
    const otherIds = convs.map((c) => c.members.find((m) => String(m) !== me)).filter(Boolean);
    const users = await User.find({ _id: { $in: otherIds } }).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const rows = await Promise.all(
      convs.map(async (c) => {
        const otherId = String(c.members.find((m) => String(m) !== me));
        const other = byId.get(otherId);
        if (!other) return null;
        const readAt = c.lastRead?.[me] ?? new Date(0);
        const unread = await Message.countDocuments({ conversation: c._id, sender: { $ne: me }, createdAt: { $gt: readAt } });
        return {
          conversation_id: String(c._id),
          other_id: otherId,
          other_name: other.name,
          other_phone: other.phone,
          other_avatar: other.avatarUrl ?? null,
          other_public_key: other.publicKey ?? null,
          // online people are reported as "seen just now" so the app can show the green dot
          other_last_seen: other.settings?.privacy?.lastSeen === 'Nobody'
            ? new Date(0).toISOString()
            : isOnline(otherId) ? new Date().toISOString() : new Date(other.lastSeen).toISOString(),
          last_message_at: new Date(c.lastMessageAt).toISOString(),
          last_message_preview: c.lastMessagePreview,
          unread,
        };
      })
    );
    res.json(rows.filter(Boolean));
  })
);

// Start (or reuse) a 1-to-1 chat by phone number.
router.post(
  '/direct',
  wrap(async (req, res) => {
    const me = req.userId;
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'INVALID_PHONE', message: 'Enter a valid phone number with country code.' });
    const other = await User.findOne({ phone }).lean();
    if (!other) return res.status(404).json({ error: 'NO_USER', message: 'That number is not on Chatimall yet.' });
    const otherId = String(other._id);
    if (otherId === me) return res.status(400).json({ error: 'SELF', message: 'That is your own number.' });

    const conv = await startDirectConversation(me, otherId);
    res.json({ conversation_id: String(conv._id) });
  })
);

router.get(
  '/:id/encryption-key',
  wrap(async (req, res) => {
    const conv = await loadConversation(req, res);
    if (!conv) return;
    if (conv.isGroup || conv.members.length !== 2) return res.status(404).json({ error: 'NOT_FOUND' });
    const otherId = conv.members.map(String).find((id) => id !== req.userId);
    const other = await User.findById(otherId).select('publicKey').lean();
    if (!other) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({
      user_id: otherId,
      public_key: other.publicKey ?? null,
    });
  })
);

router.get(
  '/:id/messages',
  wrap(async (req, res) => {
    const conv = await loadConversation(req, res);
    if (!conv) return;
    const rows = await Message.find({ conversation: conv._id }).sort({ createdAt: -1 }).limit(300).lean();
    res.json(rows.reverse().map(serialize.message));
  })
);

router.post(
  '/:id/messages',
  wrap(async (req, res) => {
    const conv = await loadConversation(req, res);
    if (!conv) return;
    const me = req.userId;
    const { type = 'text', body = '', media_url: mediaUrl = null, duration_secs: duration = null } = req.body ?? {};

    if (!TYPES.includes(type)) return res.status(400).json({ error: 'INVALID_TYPE' });
    const encrypted = req.body?.encrypted === true;
    const mediaKey = req.body?.media_key;
    if (!encrypted) return res.status(400).json({ error: 'ENCRYPTION_REQUIRED' });
    const text = String(body).trim();
    if (text.length > 16000) return res.status(413).json({ error: 'MESSAGE_TOO_LONG' });
    if (type === 'text' && !text) return res.status(400).json({ error: 'EMPTY' });
    if (encrypted) {
      let payload;
      try {
        payload = JSON.parse(type === 'text' ? text : String(mediaKey ?? ''));
      } catch {
        return res.status(400).json({ error: 'INVALID_ENCRYPTED_MESSAGE' });
      }
      const legacyPayload = payload?.v === 2 && payload?.alg === 'ECDH-AES-GCM'
        && type === 'text' && Array.isArray(payload.boxes) && payload.boxes.length === 2;
      const currentPayload = payload?.v === 3 && payload?.alg === 'ECDH-AES-GCM'
        && payload.contextId === String(conv._id)
        && (type === 'text'
          ? typeof payload.iv === 'string' && typeof payload.ct === 'string'
          : payload.purpose === 'media' && typeof payload.iv === 'string' && typeof payload.mimeType === 'string')
        && Array.isArray(payload.boxes) && payload.boxes.length === 2
        && payload.boxes.every((box) => typeof box.kid === 'string' && box.eph && typeof box.wrapIv === 'string' && typeof box.wrappedKey === 'string');
      if (!legacyPayload && !currentPayload) {
        return res.status(400).json({ error: 'INVALID_ENCRYPTED_MESSAGE' });
      }
      const users = await User.find({ _id: { $in: conv.members } }).select('publicKey').lean();
      const expectedKids = new Set(users.map((user) => publicEncryptionKeyId(user.publicKey)).filter(Boolean));
      const providedKids = payload.boxes.map((box) => box.kid);
      if (expectedKids.size !== 2 || providedKids.length !== expectedKids.size
        || new Set(providedKids).size !== providedKids.length
        || providedKids.some((kid) => !expectedKids.has(kid))) {
        return res.status(400).json({ error: 'INVALID_ENCRYPTED_RECIPIENTS' });
      }
    }
    if (type !== 'text' && !isOwnFileUrl(mediaUrl)) return res.status(400).json({ error: 'BAD_MEDIA' });

    const now = new Date();
    const msg = await Message.create({
      conversation: conv._id,
      sender: me,
      type,
      body: text,
      encrypted,
      mediaKey: type === 'text' ? null : String(mediaKey),
      mediaUrl: type === 'text' ? null : mediaUrl,
      durationSecs: type === 'voice' ? Math.min(Math.max(Number(duration) || 0, 0), 3600) : null,
      createdAt: now,
    });
    const preview = encrypted ? 'Encrypted message' : previewOf(type, text);
    await Conversation.updateOne(
      { _id: conv._id },
      { $set: { lastMessageAt: now, lastMessagePreview: preview, [`lastRead.${me}`]: now } }
    );

    // Voice-note translation only runs on plaintext voice notes — an encrypted voice note's
    // audio bytes are opaque to the server (that's the point of encrypting it), so there's
    // nothing for Whisper to transcribe server-side.
    if (type === 'voice' && !encrypted) {
      const others0 = conv.members.map(String).filter((id) => id !== me);
      void processVoiceNote(msg._id, mediaUrl, others0);
    }

    const json = serialize.message(msg);
    const others = conv.members.map(String).filter((id) => id !== me);
    emitToUsers([me, ...others], 'message:new', json);

    const sender = await User.findById(me).lean();
    for (const uid of others) {
      if (!isOnline(uid)) {
        void notifyUser(uid, {
          title: sender?.name || `+${sender?.phone}`,
          body: preview,
          data: { type: 'message', conversation_id: String(conv._id) },
          channelId: 'messages',
        });
      }
    }
    res.status(201).json(json);
  })
);

router.post(
  '/:id/read',
  wrap(async (req, res) => {
    const conv = await loadConversation(req, res);
    if (!conv) return;
    const now = new Date();
    await Conversation.updateOne({ _id: conv._id }, { $set: { [`lastRead.${req.userId}`]: now } });
    const reader = await User.findById(req.userId).select('settings.privacy.readReceipts').lean();
    if (reader?.settings?.privacy?.readReceipts !== false) {
      emitToUsers(conv.members, 'chat:read', {
        conversation_id: String(conv._id),
        user_id: req.userId,
        at: now.toISOString(),
      });
    }
    res.json({ ok: true });
  })
);

// When did the other person last read this chat? (drives the blue ticks)
router.get(
  '/:id/read-state',
  wrap(async (req, res) => {
    const conv = await loadConversation(req, res);
    if (!conv) return;
    const otherId = conv.members.map(String).find((id) => id !== req.userId);
    const other = otherId ? await User.findById(otherId).select('settings.privacy.readReceipts').lean() : null;
    const at = otherId ? conv.lastRead?.get(otherId) : null;
    res.json({ at: other?.settings?.privacy?.readReceipts === false || !at ? null : new Date(at).toISOString() });
  })
);

// Fetch (or lazily compute) the translation of a voice note, in the caller's own
// translation-settings language. Member-gated: you can only translate messages in chats you're in.
router.get(
  '/:id/messages/:messageId/translation',
  wrap(async (req, res) => {
    const conv = await loadConversation(req, res);
    if (!conv) return;
    const { messageId } = req.params;
    if (!mongoose.isValidObjectId(messageId)) return res.status(404).json({ error: 'NOT_FOUND' });

    const msg = await Message.findOne({ _id: messageId, conversation: conv._id });
    if (!msg) return res.status(404).json({ error: 'NOT_FOUND' });
    if (msg.type !== 'voice') return res.status(400).json({ error: 'NOT_A_VOICE_NOTE' });
    if (msg.encrypted) return res.status(400).json({ error: 'ENCRYPTED_NOT_TRANSLATABLE' });

    const result = await translateForUser(msg, req.userId);
    res.json(result);
  })
);

export default router;
