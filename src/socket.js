import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { verifyToken } from './auth.js';
import { Call, Conversation, User } from './models.js';
import { emitToUser, isOnline, setIo } from './realtime.js';
import { userJson } from './serialize.js';
import { notifyUser } from './push.js';

const RING_MS = 60_000;
const liveCalls = new Map(); // callId -> { caller, callee, answered }
const busy = new Map(); // userId -> callId
const validId = (id) => mongoose.isValidObjectId(id);

/** Finish a call, store the result and tell the other person. */
async function endCall(callId, by, status) {
  const live = liveCalls.get(callId);
  if (!live || (by !== live.caller && by !== live.callee)) return;
  const allowed =
    status === 'declined'
      ? by === live.callee && !live.answered
      : status === 'canceled' || status === 'missed'
      ? by === live.caller && !live.answered
      : status === 'ended';
  if (!allowed) return;

  liveCalls.delete(callId);
  if (busy.get(live.caller) === callId) busy.delete(live.caller);
  if (busy.get(live.callee) === callId) busy.delete(live.callee);
  await Call.updateOne({ _id: callId }, { status, endedAt: new Date() }).catch(() => {});

  const other = by === live.caller ? live.callee : live.caller;
  emitToUser(other, 'call:ended', { call_id: callId, status, by });
  emitToUser(by, 'call:log', {});
  emitToUser(other, 'call:log', {});
}

export function attachSocket(httpServer, corsOrigin) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin }, maxHttpBufferSize: 1e6 });
  setIo(io);

  io.use((socket, next) => {
    const id = verifyToken(socket.handshake.auth?.token);
    if (!id) return next(new Error('UNAUTHORIZED'));
    socket.data.userId = id;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.userId;
    socket.join(`user:${me}`);
    User.updateOne({ _id: me }, { lastSeen: new Date() }).catch(() => {});

    // ---- typing indicator ----
    const convMembers = new Map(); // cache: conversationId -> member ids
    socket.on('typing', async (data) => {
      const cid = data?.conversation_id;
      if (!validId(cid)) return;
      if (!convMembers.has(cid)) {
        const conv = await Conversation.findOne({ _id: cid, members: me }).select('members').lean();
        if (!conv) return;
        convMembers.set(cid, conv.members.map(String));
      }
      for (const uid of convMembers.get(cid)) {
        if (uid !== me) emitToUser(uid, 'typing', { conversation_id: cid, user_id: me });
      }
    });

    // ---- channel live posts ----
    socket.on('channel:join', (id) => validId(id) && socket.join(`channel:${id}`));
    socket.on('channel:leave', (id) => validId(id) && socket.leave(`channel:${id}`));

    // ---- calls: ringing + WebRTC signalling relay ----
    socket.on('call:invite', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const calleeId = data?.callee_id;
        const type = data?.type === 'video' ? 'video' : 'voice';
        if (!validId(calleeId) || calleeId === me) return reply({ error: 'INVALID' });
        const shared = await Conversation.exists({ members: { $all: [me, calleeId] } });
        if (!shared) return reply({ error: 'NOT_ALLOWED' });
        if (busy.has(calleeId) || busy.has(me)) return reply({ error: 'BUSY' });

        const call = await Call.create({ caller: me, callee: calleeId, type });
        const callId = String(call._id);
        liveCalls.set(callId, { caller: me, callee: calleeId, answered: false });
        busy.set(me, callId);
        busy.set(calleeId, callId);
        setTimeout(() => {
          const live = liveCalls.get(callId);
          if (live && !live.answered) void endCall(callId, live.caller, 'missed');
        }, RING_MS);

        const caller = await User.findById(me).lean();
        emitToUser(calleeId, 'call:incoming', { call_id: callId, type, caller: userJson(caller) });
        if (!isOnline(calleeId)) {
          void notifyUser(calleeId, {
            title: `Incoming ${type} call`,
            body: caller.name || `+${caller.phone}`,
            data: { type: 'call', call_id: callId },
            channelId: 'calls',
          });
        }
        reply({ call_id: callId });
      } catch (err) {
        console.error('call:invite failed', err);
        reply({ error: 'SERVER' });
      }
    });

    socket.on('call:accept', async (data) => {
      const live = liveCalls.get(data?.call_id);
      if (!live || me !== live.callee || live.answered) return;
      live.answered = true;
      await Call.updateOne({ _id: data.call_id }, { status: 'answered', answeredAt: new Date() }).catch(() => {});
      emitToUser(live.caller, 'call:accepted', { call_id: data.call_id });
    });

    socket.on('call:end', (data) => void endCall(data?.call_id, me, data?.status));

    socket.on('call:signal', (data) => {
      const live = liveCalls.get(data?.call_id);
      if (!live || (me !== live.caller && me !== live.callee)) return;
      emitToUser(me === live.caller ? live.callee : live.caller, 'call:signal', {
        call_id: data.call_id,
        data: data.data,
      });
    });

    socket.on('disconnect', () => {
      User.updateOne({ _id: me }, { lastSeen: new Date() }).catch(() => {});
      if (isOnline(me)) return; // still connected from another device
      const callId = busy.get(me);
      const live = callId && liveCalls.get(callId);
      if (live) void endCall(callId, me, live.answered ? 'ended' : me === live.caller ? 'canceled' : 'declined');
    });
  });

  return io;
}
