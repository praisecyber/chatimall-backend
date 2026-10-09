import mongoose from 'mongoose';
import { Router } from 'express';
import { Conversation, Message, StarredMessage, SupportTicket, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { wrap } from '../util.js';
import { serialize } from './_shared.js';

const router = Router();
router.use(requireAuth);

async function conversationRows(userId, archived) {
  const conversations = await Conversation.find({
    members: userId,
    isGroup: false,
    archivedBy: archived ? userId : { $ne: userId },
  }).sort({ lastMessageAt: -1 }).lean();
  const peerIds = conversations.map((conversation) =>
    conversation.members.find((member) => String(member) !== userId)
  ).filter(Boolean);
  const peers = await User.find({ _id: { $in: peerIds } }).select('name phone avatarUrl').lean();
  const peerById = new Map(peers.map((peer) => [String(peer._id), peer]));

  return conversations.map((conversation) => {
    const peerId = String(conversation.members.find((member) => String(member) !== userId));
    const peer = peerById.get(peerId);
    if (!peer) return null;
    return {
      conversation_id: String(conversation._id),
      other_id: peerId,
      other_name: peer.name,
      other_phone: peer.phone,
      other_avatar: peer.avatarUrl ?? null,
      last_message_at: new Date(conversation.lastMessageAt).toISOString(),
      last_message_preview: conversation.lastMessagePreview,
    };
  }).filter(Boolean);
}

router.get('/contacts', wrap(async (req, res) => {
  const rows = await conversationRows(req.userId, false);
  const archivedRows = await conversationRows(req.userId, true);
  const seen = new Set();
  res.json([...rows, ...archivedRows].filter((row) => {
    if (seen.has(row.other_id)) return false;
    seen.add(row.other_id);
    return true;
  }));
}));

router.post('/contacts/sync', wrap(async (req, res) => {
  const input = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  const normalized = [];
  const seen = new Set();

  for (const item of input.slice(0, 200)) {
    const name = String(item?.name ?? '').trim().slice(0, 40);
    const phone = String(item?.phone ?? '').trim();
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) continue;
    const key = digitsOnly;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ name, phone: digitsOnly });
  }

  if (!normalized.length) {
    return res.json({ ok: true, count: 0, contacts: [] });
  }

  const byPhone = new Map(normalized.map((contact) => [contact.phone, contact]));
  const users = await User.find({ phone: { $in: [...byPhone.keys()] }, _id: { $ne: req.userId } })
    .select('phone name avatarUrl')
    .lean();
  const conversations = await Conversation.find({ isGroup: false, members: req.userId }).select('_id members').lean();
  const conversationByUser = new Map(
    conversations.map((conversation) => [
      conversation.members.map(String).find((memberId) => memberId !== req.userId),
      String(conversation._id),
    ])
  );
  const contacts = users.map((user) => {
    const imported = byPhone.get(user.phone);
    return {
      conversation_id: conversationByUser.get(String(user._id)) ?? '',
      other_id: String(user._id),
      other_name: imported?.name || user.name,
      other_phone: user.phone,
      other_avatar: user.avatarUrl ?? null,
      last_message_at: new Date().toISOString(),
      last_message_preview: '',
    };
  });
  res.json({ ok: true, count: contacts.length, contacts });
}));

router.get('/archived', wrap(async (req, res) => {
  res.json(await conversationRows(req.userId, true));
}));

router.patch('/archive/:conversationId', wrap(async (req, res) => {
  const { conversationId } = req.params;
  const { archived } = req.body ?? {};
  if (!mongoose.isValidObjectId(conversationId) || typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'INVALID_ARCHIVE' });
  }
  const update = archived ? { $addToSet: { archivedBy: req.userId } } : { $pull: { archivedBy: req.userId } };
  const result = await Conversation.updateOne({ _id: conversationId, members: req.userId, isGroup: false }, update);
  if (!result.matchedCount) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ ok: true, archived });
}));

router.get('/starred', wrap(async (req, res) => {
  const starred = await StarredMessage.find({ user: req.userId }).sort({ createdAt: -1 }).populate('message').lean();
  res.json(starred.filter((row) => row.message).map((row) => ({
    starred_at: new Date(row.createdAt).toISOString(),
    message: serialize.message(row.message),
  })));
}));

router.post('/starred/:messageId', wrap(async (req, res) => {
  const { messageId } = req.params;
  if (!mongoose.isValidObjectId(messageId)) return res.status(400).json({ error: 'INVALID_MESSAGE' });
  const message = await Message.findById(messageId).lean();
  if (!message || !await Conversation.exists({ _id: message.conversation, members: req.userId })) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  await StarredMessage.updateOne(
    { user: req.userId, message: messageId },
    { $setOnInsert: { user: req.userId, message: messageId } },
    { upsert: true }
  );
  res.status(201).json({ ok: true });
}));

router.delete('/starred/:messageId', wrap(async (req, res) => {
  await StarredMessage.deleteOne({ user: req.userId, message: req.params.messageId });
  res.json({ ok: true });
}));

router.get('/storage', wrap(async (req, res) => {
  const groups = await mongoose.connection.db.collection('media.files').aggregate([
    { $match: { 'metadata.owner': req.userId } },
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              { case: { $regexMatch: { input: { $ifNull: ['$contentType', ''] }, regex: '^image/' } }, then: 'photos' },
              { case: { $regexMatch: { input: { $ifNull: ['$contentType', ''] }, regex: '^video/' } }, then: 'videos' },
              { case: { $regexMatch: { input: { $ifNull: ['$contentType', ''] }, regex: '^audio/' } }, then: 'audio' },
            ],
            default: 'files',
          }
        },
        bytes: { $sum: '$length' },
        files: { $sum: 1 },
      }
    },
  ]).toArray();
  const byType = { photos: { bytes: 0, files: 0 }, videos: { bytes: 0, files: 0 }, audio: { bytes: 0, files: 0 }, files: { bytes: 0, files: 0 } };
  for (const group of groups) byType[group._id] = { bytes: group.bytes, files: group.files };
  res.json({
    total_bytes: Object.values(byType).reduce((total, item) => total + item.bytes, 0),
    total_files: Object.values(byType).reduce((total, item) => total + item.files, 0),
    by_type: byType,
  });
}));

router.post('/support', wrap(async (req, res) => {
  const subject = String(req.body?.subject ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  if (!subject || subject.length > 100 || !message || message.length > 2000) {
    return res.status(400).json({ error: 'INVALID_SUPPORT_REQUEST' });
  }
  const ticket = await SupportTicket.create({ user: req.userId, subject, message });
  res.status(201).json({ id: String(ticket._id), status: ticket.status, created_at: ticket.createdAt.toISOString() });
}));

export default router;