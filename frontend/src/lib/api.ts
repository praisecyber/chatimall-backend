/* eslint-disable @typescript-eslint/no-unused-vars */
import { api, ApiError, assetUrl, storedUrl } from '@/lib/http';
import { formatChatTime, formatDuration, initialsAvatar } from '@/lib/format';
import type { Call, Channel, ChannelPost, Chat, DbMessage, SettingsContact, StarredMessageItem, StatusGroup, StatusItem, StorageUsage } from '@/types';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/* ===================== FILES ===================== */
export interface UploadResult {
  url: string;
  name: string;
  size: number;
  content_type: string;
}

export async function uploadFile(blob: Blob, fileName: string): Promise<UploadResult> {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('File is too large (50 MB max).');
  const form = new FormData();
  form.append('file', blob, fileName);
  return api<UploadResult>('/api/upload', { form });
}

/* ===================== CHATS ===================== */
interface ChatRowDb {
  conversation_id: string;
  other_id: string;
  other_name: string;
  other_phone: string | null;
  other_avatar: string | null;
  other_public_key: JsonWebKey | null;
  other_last_seen: string;
  last_message_at: string;
  last_message_preview: string;
  unread: number;
}

export async function fetchChats(): Promise<Chat[]> {
  const rows = await api<ChatRowDb[]>('/api/chats');
  return rows.map((r) => {
    const display = r.other_name || (r.other_phone ? `+${r.other_phone}` : 'Unknown');
    return {
      id: r.conversation_id,
      otherUserId: r.other_id,
      otherPublicKey: r.other_public_key ?? null,
      phone: r.other_phone ?? undefined,
      name: display,
      avatar: assetUrl(r.other_avatar) || initialsAvatar(r.other_name, r.other_phone ?? ''),
      lastMessage: r.last_message_preview || 'Say hello',
      time: r.last_message_preview ? formatChatTime(r.last_message_at) : '',
      unread: r.unread,
      online: Date.now() - new Date(r.other_last_seen).getTime() < ONLINE_WINDOW_MS,
    } satisfies Chat;
  });
}

export async function fetchSettingsContacts(): Promise<SettingsContact[]> {
  const rows = await api<SettingsContact[]>('/api/settings/contacts');
  return rows.map((row) => ({ ...row, other_avatar: assetUrl(row.other_avatar) }));
}

export async function fetchArchivedChats(): Promise<SettingsContact[]> {
  const rows = await api<SettingsContact[]>('/api/settings/archived');
  return rows.map((row) => ({ ...row, other_avatar: assetUrl(row.other_avatar) }));
}

export async function setConversationArchived(conversationId: string, archived: boolean): Promise<void> {
  await api(`/api/settings/archive/${conversationId}`, { method: 'PATCH', body: { archived } });
}

export async function fetchStarredMessages(): Promise<StarredMessageItem[]> {
  const rows = await api<StarredMessageItem[]>('/api/settings/starred');
  return rows.map((row) => ({ ...row, message: mapMessage(row.message) }));
}

export async function setMessageStarred(messageId: string, starred: boolean): Promise<void> {
  await api(`/api/settings/starred/${messageId}`, { method: starred ? 'POST' : 'DELETE', body: starred ? {} : undefined });
}

export async function fetchStorageUsage(): Promise<StorageUsage> {
  return api<StorageUsage>('/api/settings/storage');
}

export async function syncPhoneContacts(contacts: Array<{ name: string; phone: string }>): Promise<{ ok: boolean; count: number; contacts: SettingsContact[] }> {
  const result = await api<{ ok: boolean; count: number; contacts: SettingsContact[] }>('/api/settings/contacts/sync', {
    method: 'POST',
    body: { contacts },
  });
  return {
    ...result,
    contacts: result.contacts.map((contact) => ({ ...contact, other_avatar: assetUrl(contact.other_avatar) })),
  };
}

export async function createSupportRequest(subject: string, message: string): Promise<{ id: string; status: string; created_at: string }> {
  return api('/api/settings/support', { body: { subject, message } });
}

export async function startDirectChat(phone: string): Promise<string> {
  const res = await api<{ conversation_id: string }>('/api/chats/direct', { body: { phone } });
  return res.conversation_id;
}

/** Server messages carry relative file paths; make them absolute for the current host. */
export const mapMessage = (m: DbMessage): DbMessage => ({ ...m, media_url: assetUrl(m.media_url) });

export async function fetchMessages(conversationId: string): Promise<DbMessage[]> {
  const rows = await api<DbMessage[]>(`/api/chats/${conversationId}/messages`);
  return rows.map(mapMessage);
}

export async function sendText(conversationId: string, body: string, peer?: { userId?: string; publicKey?: JsonWebKey | null }): Promise<DbMessage> {
  const { encryptTextForPeer } = await import('@/lib/e2ee');
  const resolvedPeer = peer?.userId && peer.publicKey
    ? peer
    : await api<{ user_id: string; public_key: JsonWebKey | null }>(`/api/chats/${conversationId}/encryption-key`)
      .then((result) => ({ userId: result.user_id, publicKey: result.public_key }));
  const encrypted = await encryptTextForPeer(
    body,
    resolvedPeer?.publicKey ?? null,
    resolvedPeer?.userId,
    conversationId
  );
  return mapMessage(
    await api<DbMessage>(`/api/chats/${conversationId}/messages`, {
      body: { type: 'text', body: encrypted.body, encrypted: encrypted.encrypted },
    })
  );
}

export async function sendMedia(opts: {
  conversationId: string;
  userId: string;
  peer?: { userId?: string; publicKey?: JsonWebKey | null };
  blob: Blob;
  fileName: string;
  type: 'image' | 'video' | 'voice' | 'file';
  body?: string;
  durationSecs?: number;
}): Promise<DbMessage> {
  // All media — including voice notes — is end-to-end encrypted, always. Translation never
  // changes that: it is only available in conversations where the user has explicitly turned
  // encryption off for that chat elsewhere in settings. There is no per-message, automatic, or
  // silent downgrade of encryption for any reason, including someone else's translation
  // preference. A chat's encryption state is the sender's own, deliberate choice, never inferred.
  let keyInfo: { user_id: string; public_key: JsonWebKey | null } | null = null;
  if (!opts.peer?.userId || !opts.peer?.publicKey) {
    keyInfo = await api<{ user_id: string; public_key: JsonWebKey | null }>(
      `/api/chats/${opts.conversationId}/encryption-key`
    );
  }
  const resolvedPeer = opts.peer?.userId && opts.peer.publicKey
    ? opts.peer
    : { userId: keyInfo!.user_id, publicKey: keyInfo!.public_key };

  const { encryptMediaForPeer } = await import('@/lib/e2ee');
  const encrypted = await encryptMediaForPeer(
    await opts.blob.arrayBuffer(),
    opts.blob.type,
    resolvedPeer.publicKey ?? null,
    resolvedPeer.userId,
    opts.conversationId
  );
  const up = await uploadFile(new Blob([encrypted.bytes], { type: 'application/octet-stream' }), 'attachment.enc');
  return mapMessage(
    await api<DbMessage>(`/api/chats/${opts.conversationId}/messages`, {
      body: {
        type: opts.type,
        body: 'Encrypted attachment',
        encrypted: true,
        media_key: encrypted.mediaKey,
        media_url: up.url,
        duration_secs: opts.durationSecs ?? null,
      },
    })
  );
}

export async function markRead(conversationId: string, _userId?: string): Promise<void> {
  await api(`/api/chats/${conversationId}/read`, { method: 'POST', body: {} }).catch(() => { });
}

/** When the *other* person last read this conversation (drives the blue ticks). */
export async function fetchPeerReadAt(conversationId: string, _myId?: string): Promise<string | null> {
  const res = await api<{ at: string | null }>(`/api/chats/${conversationId}/read-state`);
  return res.at;
}

/* ===================== VOICE-NOTE TRANSLATION ===================== */
export interface VoiceTranslationResult {
  status: 'off' | 'pending' | 'ready' | 'failed';
  audio_url?: string | null;
  language?: string;
  reason?: string;
}

export async function fetchVoiceTranslation(conversationId: string, messageId: string): Promise<VoiceTranslationResult> {
  return api<VoiceTranslationResult>(`/api/chats/${conversationId}/messages/${messageId}/translation`);
}

/* ===================== STATUS / STORIES ===================== */
interface StatusGroupDb {
  user_id: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  is_mine: boolean;
  items: StatusItemDb[];
}

interface StatusItemDb {
  id: string;
  type: 'text' | 'image';
  body: string;
  media_url: string | null;
  bg: string;
  created_at: string;
  viewed: boolean;
  view_count?: number;
  anonymous?: boolean;
  posted_by?: string | null;
}

const mapStatusItem = (i: StatusItemDb): StatusItem => ({
  id: i.id,
  type: i.type,
  body: i.body,
  mediaUrl: assetUrl(i.media_url),
  bg: i.bg,
  createdAt: i.created_at,
  viewed: i.viewed,
  viewCount: i.view_count,
  anonymous: Boolean(i.anonymous),
  postedBy: i.posted_by ?? null,
});

export async function fetchStatusFeed(_myId?: string): Promise<StatusGroup[]> {
  const groups = await api<StatusGroupDb[]>('/api/status');
  return groups.map((g) => {
    const items = g.items.map(mapStatusItem);
    return {
      userId: g.user_id,
      name: g.is_mine ? 'My Status' : g.name || (g.phone ? `+${g.phone}` : 'Unknown'),
      avatar: assetUrl(g.avatar_url) || initialsAvatar(g.name, g.phone ?? ''),
      phone: g.phone,
      isMine: g.is_mine,
      items,
      allViewed: items.every((i) => i.viewed),
    };
  });
}

export async function postStatus(opts: {
  userId?: string;
  type: 'text' | 'image';
  body: string;
  bg?: string;
  file?: File;
}): Promise<void> {
  let mediaUrl: string | null = null;
  if (opts.file) mediaUrl = (await uploadFile(opts.file, opts.file.name)).url;
  await api('/api/status', { body: { type: opts.type, body: opts.body, bg: opts.bg ?? 'emerald', media_url: mediaUrl } });
}

export async function markStatusViewed(statusId: string): Promise<void> {
  await api(`/api/status/${statusId}/view`, { method: 'POST', body: {} }).catch(() => { });
}

export async function deleteStatus(statusId: string): Promise<void> {
  await api(`/api/status/${statusId}`, { method: 'DELETE' });
}

/* ===================== CHANNELS ===================== */
interface ChannelRowDb {
  id: string;
  gist_room_id: string | null;
  name: string;
  description: string;
  avatar_url: string | null;
  subscribers: number;
  is_subscribed: boolean;
  is_owner: boolean;
  last_post: string | null;
  last_post_at: string | null;
}

export async function fetchChannels(): Promise<Channel[]> {
  const rows = await api<ChannelRowDb[]>('/api/channels');
  return rows.map((c) => ({
    id: c.id,
    gistRoomId: c.gist_room_id,
    name: c.name,
    avatar: assetUrl(c.avatar_url) || initialsAvatar(c.name, c.id),
    description: c.description,
    subscribers: c.subscribers,
    lastMessage: c.last_post ?? 'No posts yet',
    time: c.last_post_at ? formatChatTime(c.last_post_at) : '',
    isSubscribed: c.is_subscribed,
    isOwner: c.is_owner,
  }));
}

export async function createChannel(name: string, description: string): Promise<void> {
  await api('/api/channels', { body: { name, description } });
}

export async function setFollowing(channelId: string, _userId: string, follow: boolean): Promise<void> {
  await api(`/api/channels/${channelId}/follow`, { method: follow ? 'POST' : 'DELETE', body: follow ? {} : undefined });
}

export const mapPost = (p: ChannelPost): ChannelPost => ({ ...p, media_url: assetUrl(p.media_url) });

export async function fetchChannelPosts(channelId: string): Promise<ChannelPost[]> {
  return (await api<ChannelPost[]>(`/api/channels/${channelId}/posts`)).map(mapPost);
}

export async function postToChannel(opts: {
  channelId: string;
  userId?: string;
  body: string;
  file?: File;
}): Promise<ChannelPost> {
  let mediaUrl: string | null = null;
  if (opts.file) mediaUrl = (await uploadFile(opts.file, opts.file.name)).url;
  return mapPost(
    await api<ChannelPost>(`/api/channels/${opts.channelId}/posts`, {
      body: { type: opts.file ? 'image' : 'text', body: opts.body, media_url: mediaUrl },
    })
  );
}

/* ===================== CALL HISTORY ===================== */
interface CallRowDb {
  id: string;
  other_id: string;
  other_name: string;
  other_phone: string | null;
  other_avatar: string | null;
  type: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  created_at: string;
  duration_secs: number | null;
}

export async function fetchCalls(): Promise<Call[]> {
  const rows = await api<CallRowDb[]>('/api/calls');
  return rows.map((c) => ({
    id: c.id,
    otherUserId: c.other_id,
    name: c.other_name || (c.other_phone ? `+${c.other_phone}` : 'Unknown'),
    avatar: assetUrl(c.other_avatar) || initialsAvatar(c.other_name, c.other_phone ?? ''),
    time: formatChatTime(c.created_at),
    type: c.type,
    direction: c.direction,
    duration: c.duration_secs ? formatDuration(c.duration_secs) : undefined,
  }));
}

export { ApiError, storedUrl };

/* ===================== GROUPS ===================== */
import type { Group, GroupMessage } from '@/types';

export const mapGroupMessage = (m: GroupMessage): GroupMessage => ({ ...m, media_url: assetUrl(m.media_url) });

export async function fetchGroups(): Promise<Group[]> {
  return api<Group[]>('/api/groups');
}

export async function fetchGroup(groupId: string): Promise<Group> {
  return api<Group>(`/api/groups/${groupId}`);
}

export interface GroupEncryptionMember {
  user_id: string;
  name: string;
  public_key: JsonWebKey | null;
}

export async function fetchGroupEncryptionKeys(groupId: string): Promise<GroupEncryptionMember[]> {
  return api<GroupEncryptionMember[]>(`/api/groups/${groupId}/encryption-keys`);
}

export async function createGroup(name: string, memberIds: string[] = []): Promise<Group> {
  return api<Group>('/api/groups', { body: { name, member_ids: memberIds } });
}

export async function addGroupMember(groupId: string, userId: string): Promise<void> {
  await api(`/api/groups/${groupId}/members`, { body: { user_id: userId } });
}

export async function leaveGroup(groupId: string): Promise<void> {
  await api(`/api/groups/${groupId}/members/me`, { method: 'DELETE' });
}

export async function fetchGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const rows = await api<GroupMessage[]>(`/api/groups/${groupId}/messages`);
  return rows.map(mapGroupMessage);
}

export async function sendGroupText(
  groupId: string,
  body: string,
  members: GroupEncryptionMember[],
  myUserId: string
): Promise<GroupMessage> {
  const { encryptTextForRecipients } = await import('@/lib/e2ee');
  const encrypted = await encryptTextForRecipients(body, members.filter((member) => member.user_id !== myUserId).map((member) => ({
    userId: member.user_id,
    publicKey: member.public_key,
  })), groupId);
  return mapGroupMessage(await api<GroupMessage>(`/api/groups/${groupId}/messages`, {
    body: { type: 'text', body: encrypted.body, encrypted: encrypted.encrypted },
  }));
}

export async function sendGroupMedia(opts: {
  groupId: string;
  blob: Blob;
  fileName: string;
  type: 'image' | 'video' | 'voice' | 'file';
  body?: string;
  durationSecs?: number;
}): Promise<GroupMessage> {
  const up = await uploadFile(opts.blob, opts.fileName);
  return mapGroupMessage(
    await api<GroupMessage>(`/api/groups/${opts.groupId}/messages`, {
      body: { type: opts.type, body: opts.body ?? '', media_url: up.url, duration_secs: opts.durationSecs ?? null },
    })
  );
}

export async function reportGroupMessage(groupId: string, messageId: string, reason: string): Promise<void> {
  await api(`/api/groups/${groupId}/messages/${messageId}/report`, { body: { reason } });
}

export async function proposeAnonymousMode(groupId: string): Promise<Group> {
  return api<Group>(`/api/groups/${groupId}/anonymous/propose`, { body: {} });
}

export async function voteAnonymousMode(groupId: string, choice: 'yes' | 'no'): Promise<Group> {
  return api<Group>(`/api/groups/${groupId}/anonymous/vote`, { body: { choice } });
}

export async function turnOffAnonymousMode(groupId: string): Promise<Group> {
  return api<Group>(`/api/groups/${groupId}/anonymous/off`, { body: {} });
}

/* ===================== GROUP / CHANNEL STATUS ===================== */
import type { ChannelStatusGroup, GroupStatusGroup } from '@/types';

interface OwnerStatusGroupDb {
  group_id?: string;
  channel_id?: string;
  name: string;
  avatar_url: string | null;
  items: StatusItemDb[];
}

export async function fetchGroupStatusFeed(): Promise<GroupStatusGroup[]> {
  const groups = await api<OwnerStatusGroupDb[]>('/api/status/groups');
  return groups.map((g) => {
    const items = g.items.map(mapStatusItem);
    return {
      groupId: g.group_id!,
      name: g.name,
      avatar: assetUrl(g.avatar_url) || initialsAvatar(g.name, g.group_id ?? ''),
      items,
      allViewed: items.every((i) => i.viewed),
    };
  });
}

export async function postGroupStatus(opts: {
  groupId: string;
  type: 'text' | 'image';
  body: string;
  bg?: string;
  file?: File;
  anonymous?: boolean;
}): Promise<void> {
  let mediaUrl: string | null = null;
  if (opts.file) mediaUrl = (await uploadFile(opts.file, opts.file.name)).url;
  await api(`/api/status/groups/${opts.groupId}`, {
    body: { type: opts.type, body: opts.body, bg: opts.bg ?? 'emerald', media_url: mediaUrl, anonymous: opts.anonymous ?? false },
  });
}

export async function fetchChannelStatusFeed(): Promise<ChannelStatusGroup[]> {
  const groups = await api<OwnerStatusGroupDb[]>('/api/status/channels');
  return groups.map((g) => {
    const items = g.items.map(mapStatusItem);
    return {
      channelId: g.channel_id!,
      name: g.name,
      avatar: assetUrl(g.avatar_url) || initialsAvatar(g.name, g.channel_id ?? ''),
      items,
      allViewed: items.every((i) => i.viewed),
    };
  });
}

export async function postChannelStatus(opts: {
  channelId: string;
  type: 'text' | 'image';
  body: string;
  bg?: string;
  file?: File;
  anonymous?: boolean;
}): Promise<void> {
  let mediaUrl: string | null = null;
  if (opts.file) mediaUrl = (await uploadFile(opts.file, opts.file.name)).url;
  await api(`/api/status/channels/${opts.channelId}`, {
    body: { type: opts.type, body: opts.body, bg: opts.bg ?? 'emerald', media_url: mediaUrl, anonymous: opts.anonymous ?? false },
  });
}

/* ===================== WATCH TOGETHER ===================== */
import type { Listing, WatchSession } from '@/types';

export interface WatchSessionDb {
  platform: 'tiktok' | 'youtube';
  video_id: string;
  url: string;
  queued_by: string;
  playing: boolean;
  position_secs: number;
  updated_at: string;
}
export const mapWatch = (s: WatchSessionDb): WatchSession => ({
  platform: s.platform,
  videoId: s.video_id,
  url: s.url,
  queuedBy: s.queued_by,
  playing: s.playing,
  positionSecs: s.position_secs,
  updatedAt: s.updated_at,
});

export async function fetchWatchSession(roomId: string): Promise<WatchSession | null> {
  const s = await api<WatchSessionDb | null>(`/api/watch/${roomId}`);
  return s ? mapWatch(s) : null;
}

export async function queueWatchVideo(roomId: string, url: string): Promise<WatchSession> {
  return mapWatch(await api<WatchSessionDb>(`/api/watch/${roomId}`, { body: { url } }));
}

export async function sendWatchState(roomId: string, playing: boolean, positionSecs: number): Promise<void> {
  await api(`/api/watch/${roomId}/state`, { body: { playing, position_secs: positionSecs } });
}

export async function stopWatchTogether(roomId: string): Promise<void> {
  await api(`/api/watch/${roomId}`, { method: 'DELETE' });
}

/* ===================== MARKETPLACE (buy/sell connector) ===================== */
interface ListingDb {
  id: string;
  conversation_id: string;
  seller_id: string;
  title: string;
  description: string;
  price: string;
  photo_url: string | null;
  created_at: string;
}
const mapListing = (l: ListingDb): Listing => ({
  id: l.id,
  conversationId: l.conversation_id,
  sellerId: l.seller_id,
  title: l.title,
  description: l.description,
  price: l.price,
  photoUrl: assetUrl(l.photo_url),
  createdAt: l.created_at,
});

export async function fetchMarketplace(): Promise<Listing[]> {
  return (await api<ListingDb[]>('/api/listings')).map(mapListing);
}

export async function fetchRoomListings(roomId: string): Promise<Listing[]> {
  return (await api<ListingDb[]>(`/api/listings/room/${roomId}`)).map(mapListing);
}

export async function createListing(roomId: string, opts: { title: string; description: string; price: string; file?: File }): Promise<Listing> {
  let photoUrl: string | null = null;
  if (opts.file) photoUrl = (await uploadFile(opts.file, opts.file.name)).url;
  return mapListing(
    await api<ListingDb>(`/api/listings/room/${roomId}`, {
      body: { title: opts.title, description: opts.description, price: opts.price, photo_url: photoUrl },
    })
  );
}

export async function deleteListing(listingId: string): Promise<void> {
  await api(`/api/listings/${listingId}`, { method: 'DELETE' });
}

export async function requestToBuy(listingId: string): Promise<{ conversationId: string; starterMessage: string }> {
  const res = await api<{ conversation_id: string; starter_message: string }>(`/api/listings/${listingId}/request`, { body: {} });
  return { conversationId: res.conversation_id, starterMessage: res.starter_message };
}
