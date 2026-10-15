export type Screen = 'chats' | 'status' | 'calls' | 'channels' | 'groups' | 'market' | 'settings';

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: number;
  online: boolean;
  pinned?: boolean;
  muted?: boolean;
  isGroup?: boolean;
  members?: number;
  typing?: boolean;
  /** real-backend fields (id === conversation id) */
  otherUserId?: string;
  otherPublicKey?: JsonWebKey | null;
  phone?: string;
}

export interface Message {
  id: string;
  text: string;
  time: string;
  sent: boolean;
  status: 'sent' | 'delivered' | 'read';
  type?: 'text' | 'image' | 'voice' | 'video' | 'file';
  audioDuration?: string;
  audioBars?: number[];
  /** real-backend fields */
  mediaUrl?: string | null;
  createdAt?: string;
  /** voice-note translation (only meaningful when type === 'voice') */
  translationStatus?: 'none' | 'pending' | 'ready' | 'failed';
}

export interface UserProfile {
  name: string;
  bio: string;
  phone: string;
  avatar: string;
}

export interface DbProfile {
  id: string;
  phone: string | null;
  name: string;
  bio: string;
  avatar_url: string | null;
  public_key?: JsonWebKey | null;
  last_seen: string;
}

export interface SettingsPreferences {
  privacy: {
    read_receipts: boolean;
    last_seen: 'Everyone' | 'Contacts' | 'Nobody';
    disappearing_timer: 'Off' | '24h' | '7d' | '90d';
  };
  security: {
    two_factor_auth: boolean;
    biometrics_lock: boolean;
  };
  notifications: {
    sound: 'Pulse Chime' | 'Aurora' | 'Celestial Bell';
    vibrate: boolean;
    preview: boolean;
  };
  appearance: {
    wallpaper: 'default' | 'light' | 'plain';
  };
  translation: {
    mode: 'off' | 'on';
    language: string;
  };
}

export interface SettingsContact {
  conversation_id: string;
  other_id: string;
  other_name: string;
  other_phone: string | null;
  other_avatar: string | null;
  last_message_at: string;
  last_message_preview: string;
}

export interface StarredMessageItem {
  starred_at: string;
  message: DbMessage;
}

export interface StorageUsage {
  total_bytes: number;
  total_files: number;
  by_type: Record<'photos' | 'videos' | 'audio' | 'files', { bytes: number; files: number }>;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'file';
  body: string;
  encrypted?: boolean;
  media_url: string | null;
  media_key?: string | null;
  duration_secs: number | null;
  created_at: string;
  /** present only when type === 'voice' */
  translation_status?: 'none' | 'pending' | 'ready' | 'failed';
}

export interface StatusItem {
  id: string;
  type: 'text' | 'image';
  body: string;
  mediaUrl: string | null;
  bg: string;
  createdAt: string;
  viewed: boolean;
  viewCount?: number;
  anonymous: boolean;
  postedBy: string | null; // null when anonymous and it isn't you
}

export interface StatusGroup {
  userId: string;
  name: string;
  avatar: string;
  phone: string | null;
  isMine: boolean;
  items: StatusItem[];
  allViewed: boolean;
}

export interface GroupStatusGroup {
  groupId: string;
  name: string;
  avatar: string;
  items: StatusItem[];
  allViewed: boolean;
}

export interface ChannelStatusGroup {
  channelId: string;
  name: string;
  avatar: string;
  items: StatusItem[];
  allViewed: boolean;
}

export interface Call {
  id: string;
  otherUserId: string;
  name: string;
  avatar: string;
  time: string;
  type: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  duration?: string;
}

export interface Channel {
  id: string;
  gistRoomId: string | null;
  name: string;
  avatar: string;
  description: string;
  subscribers: number;
  lastMessage: string;
  time: string;
  isSubscribed: boolean;
  isOwner: boolean;
}

export interface ChannelPost {
  id: string;
  channel_id: string;
  type: 'text' | 'image';
  body: string;
  media_url: string | null;
  created_at: string;
}

export interface AnonymousVote {
  started_by: string;
  started_at: string;
  yes: number;
  no: number;
  total_members: number;
  closes_at: string;
  my_vote: 'yes' | 'no' | null;
  open: boolean;
}

export interface Group {
  id: string;
  name: string;
  avatar_url: string | null;
  owner_id: string;
  is_owner: boolean;
  is_admin: boolean;
  member_count: number;
  is_gist_room: boolean;
  channel_id: string | null;
  last_message_at: string;
  last_message_preview: string;
  anonymous: {
    active: boolean;
    expires_at: string | null;
    vote: AnonymousVote | null;
  };
}

export interface GroupMessage extends DbMessage {
  anonymous: boolean;
}

export interface WatchSession {
  platform: 'tiktok' | 'youtube';
  videoId: string;
  url: string;
  queuedBy: string;
  playing: boolean;
  positionSecs: number;
  updatedAt: string;
}

export interface Listing {
  id: string;
  conversationId: string;
  sellerId: string;
  title: string;
  description: string;
  price: string;
  photoUrl: string | null;
  createdAt: string;
}
