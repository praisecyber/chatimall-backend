import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

const userSettingsSchema = new Schema(
  {
    privacy: {
      readReceipts: { type: Boolean, default: true },
      lastSeen: { type: String, enum: ['Everyone', 'Contacts', 'Nobody'], default: 'Everyone' },
      disappearingTimer: { type: String, enum: ['Off', '24h', '7d', '90d'], default: 'Off' },
    },
    security: {
      twoFactorAuth: { type: Boolean, default: false },
      biometricsLock: { type: Boolean, default: false },
      deviceLockConfigured: { type: Boolean, default: false },
    },
    notifications: {
      sound: { type: String, enum: ['Pulse Chime', 'Aurora', 'Celestial Bell'], default: 'Pulse Chime' },
      vibrate: { type: Boolean, default: true },
      preview: { type: Boolean, default: true },
    },
    appearance: {
      wallpaper: { type: String, enum: ['default', 'light', 'plain'], default: 'default' },
    },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true }, // digits only
    name: { type: String, default: '', maxlength: 40 },
    bio: { type: String, default: 'Hey there! I am using Chatimall.', maxlength: 140 },
    avatarUrl: { type: String, default: null },
    publicKey: { type: Object, default: null },
    twoFactorPinHash: { type: String, default: null, select: false },
    lastSeen: { type: Date, default: Date.now },
    addressBook: [{
      _id: false,
      name: { type: String, default: '', maxlength: 40 },
      phone: { type: String, required: true },
      importedAt: { type: Date, default: Date.now },
    }],
    settings: { type: userSettingsSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const otpSchema = new Schema({
  phone: { type: String, required: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Mongo deletes expired codes itself
otpSchema.index({ phone: 1, createdAt: -1 });

const conversationSchema = new Schema({
  key: { type: String, unique: true, sparse: true }, // direct chats: "idA_idB" (sorted)
  isGroup: { type: Boolean, default: false },
  // --- group-only fields (unused for 1-to-1 chats) ---
  name: { type: String, default: '', maxlength: 60 },
  avatarUrl: { type: String, default: null },
  owner: ref('User'),
  admins: [ref('User')],
  channel: ref('Channel'), // set when this group is a Channel's own Gist Room
  members: [ref('User')],
  archivedBy: [ref('User')],
  lastMessageAt: { type: Date, default: Date.now },
  lastMessagePreview: { type: String, default: '' },
  lastRead: { type: Map, of: Date, default: {} }, // userId -> when they last read this chat
  // --- anonymous mode ---
  anonymous: {
    active: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    vote: {
      startedBy: ref('User'),
      startedAt: Date,
      yes: [ref('User')],
      no: [ref('User')],
    },
  },
  createdAt: { type: Date, default: Date.now },
});
conversationSchema.index({ members: 1, lastMessageAt: -1 });
conversationSchema.index({ members: 1, archivedBy: 1, lastMessageAt: -1 });
conversationSchema.index({ channel: 1 }, { unique: true, sparse: true });

const messageSchema = new Schema({
  conversation: ref('Conversation', { required: true }),
  sender: ref('User', { required: true }),
  type: { type: String, enum: ['text', 'image', 'video', 'voice', 'file'], default: 'text' },
  body: { type: String, default: '', maxlength: 262144 },
  encrypted: { type: Boolean, default: false },
  mediaUrl: { type: String, default: null },
  mediaKey: { type: String, default: null, maxlength: 16000 },
  durationSecs: { type: Number, default: null },
  anonymous: { type: Boolean, default: false }, // true if sent while the group's anonymous mode was active
  reports: [{ _id: false, user: ref('User'), reason: String, at: { type: Date, default: Date.now } }],
  createdAt: { type: Date, default: Date.now },
  // --- voice-note translation (only meaningful for type: 'voice') ---
  translationStatus: { type: String, enum: ['none', 'pending', 'ready', 'failed'], default: 'none' },
  sourceLanguage: { type: String, default: null }, // detected by Whisper, e.g. 'en', 'yo', 'ha'
  transcript: { type: String, default: null, maxlength: 20000 },
  // per-recipient-language cache: lang code -> { audioUrl } — a synthesized translated voice
  // note, audio only. There is no stored text translation shown to anyone.
  translations: { type: Map, of: new Schema({ audioUrl: String }, { _id: false }), default: () => new Map() },
});
messageSchema.index({ conversation: 1, createdAt: 1 });

const statusSchema = new Schema({
  user: ref('User', { required: true }),
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  body: { type: String, default: '', maxlength: 300 },
  mediaUrl: { type: String, default: null },
  bg: { type: String, default: 'emerald' },
  views: [{ _id: false, user: ref('User'), at: { type: Date, default: Date.now } }],
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 3600 * 1000) },
});
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // stories vanish after 24h
statusSchema.index({ user: 1, createdAt: 1 });

const channelSchema = new Schema({
  owner: ref('User', { required: true }),
  name: { type: String, required: true, minlength: 2, maxlength: 60 },
  description: { type: String, default: '', maxlength: 300 },
  avatarUrl: { type: String, default: null },
  gistRoom: ref('Conversation'), // the channel's own attached group ("Gist Room")
  createdAt: { type: Date, default: Date.now },
});

const followSchema = new Schema({
  channel: ref('Channel', { required: true }),
  user: ref('User', { required: true }),
});
followSchema.index({ channel: 1, user: 1 }, { unique: true });
followSchema.index({ user: 1 });

const channelPostSchema = new Schema({
  channel: ref('Channel', { required: true }),
  author: ref('User', { required: true }),
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  body: { type: String, default: '', maxlength: 4000 },
  mediaUrl: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});
channelPostSchema.index({ channel: 1, createdAt: 1 });

const callSchema = new Schema({
  caller: ref('User', { required: true }),
  callee: ref('User', { required: true }),
  type: { type: String, enum: ['voice', 'video'], default: 'voice' },
  status: {
    type: String,
    enum: ['ringing', 'answered', 'declined', 'missed', 'canceled', 'ended'],
    default: 'ringing',
  },
  createdAt: { type: Date, default: Date.now },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
});
callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ callee: 1, createdAt: -1 });

const deviceTokenSchema = new Schema({
  user: ref('User', { required: true }),
  token: { type: String, required: true, unique: true },
  platform: { type: String, default: 'android' },
  updatedAt: { type: Date, default: Date.now },
});
deviceTokenSchema.index({ user: 1 });

const starredMessageSchema = new Schema({
  user: ref('User', { required: true }),
  message: ref('Message', { required: true }),
  createdAt: { type: Date, default: Date.now },
});
starredMessageSchema.index({ user: 1, message: 1 }, { unique: true });
starredMessageSchema.index({ user: 1, createdAt: -1 });

const supportTicketSchema = new Schema({
  user: ref('User', { required: true }),
  subject: { type: String, required: true, maxlength: 100 },
  message: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
});
supportTicketSchema.index({ user: 1, createdAt: -1 });

/* ===================== WATCH TOGETHER ===================== */
// One live "what's playing" state per Group / Gist Room. Play/pause/seek themselves travel as
// ephemeral Socket.IO events (see socket.js); this row only exists so someone who opens the room
// after playback started can catch up near the right spot, and so the room remembers the video.
const watchSessionSchema = new Schema({
  conversation: ref('Conversation', { required: true, unique: true }),
  platform: { type: String, enum: ['tiktok', 'youtube'], required: true },
  videoId: { type: String, required: true },
  url: { type: String, required: true },
  queuedBy: ref('User', { required: true }),
  playing: { type: Boolean, default: false },
  positionSecs: { type: Number, default: 0 }, // snapshot of the playhead as of updatedAt
  updatedAt: { type: Date, default: Date.now },
});

/* ===================== BUY / SELL CONNECTOR ===================== */
// Chatimall never touches money — a Listing just gets a buyer and seller talking directly.
const listingSchema = new Schema({
  conversation: ref('Conversation', { required: true }), // the Group / Gist Room it's posted in
  seller: ref('User', { required: true }),
  title: { type: String, required: true, maxlength: 80 },
  description: { type: String, default: '', maxlength: 500 },
  price: { type: String, default: '', maxlength: 40 }, // free text — "₦15,000", "$40", "swap for..."
  photoUrl: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});
listingSchema.index({ conversation: 1, createdAt: -1 });
listingSchema.index({ seller: 1, createdAt: -1 });

export const User = model('User', userSchema);
export const Otp = model('Otp', otpSchema);
export const Conversation = model('Conversation', conversationSchema);
export const Message = model('Message', messageSchema);
export const Status = model('Status', statusSchema);
export const Channel = model('Channel', channelSchema);
export const Follow = model('Follow', followSchema);
export const ChannelPost = model('ChannelPost', channelPostSchema);
export const Call = model('Call', callSchema);
export const DeviceToken = model('DeviceToken', deviceTokenSchema);
export const StarredMessage = model('StarredMessage', starredMessageSchema);
export const SupportTicket = model('SupportTicket', supportTicketSchema);
export const WatchSession = model('WatchSession', watchSessionSchema);
export const Listing = model('Listing', listingSchema);
