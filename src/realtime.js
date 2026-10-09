let io = null;
export const setIo = (instance) => {
  io = instance;
};
export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToUsers = (ids, event, payload) => ids.forEach((id) => emitToUser(String(id), event, payload));
export const isOnline = (userId) => (io?.sockets.adapter.rooms.get(`user:${userId}`)?.size ?? 0) > 0;
export const emitToRoom = (room, event, payload) => io?.to(room).emit(event, payload);
