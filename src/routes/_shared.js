import mongoose from 'mongoose';
import { Conversation } from '../models.js';
import { messageJson, postJson, userJson } from '../serialize.js';

export const serialize = { user: userJson, message: messageJson, post: postJson };

/** Loads a conversation the caller belongs to, or answers 404 and returns null. */
export async function loadConversation(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return null;
  }
  const conv = await Conversation.findOne({ _id: id, members: req.userId });
  if (!conv) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return null;
  }
  return conv;
}

/** Finds (or creates) the 1-to-1 chat between two people, by user id. Shared so every caller
 * that needs to open a direct chat — starting a chat by phone, connecting a buyer to a seller —
 * uses the exact same "key" convention instead of risking two slightly different copies. */
export async function startDirectConversation(meId, otherId) {
  const key = [meId, otherId].sort().join('_');
  let conv = await Conversation.findOne({ key });
  if (!conv) {
    const now = new Date();
    try {
      conv = await Conversation.create({ key, members: [meId, otherId], lastRead: { [meId]: now, [otherId]: now } });
    } catch (err) {
      if (err.code !== 11000) throw err;
      conv = await Conversation.findOne({ key }); // created by a parallel request
    }
  }
  return conv;
}
