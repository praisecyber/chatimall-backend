// JSON shapes sent to the app (snake_case, ids as strings).
export const userJson = (u) => ({
  id: String(u._id),
  phone: u.phone,
  name: u.name,
  bio: u.bio,
  avatar_url: u.avatarUrl ?? null,
  public_key: u.publicKey ?? null,
  last_seen: u.lastSeen,
});

export const messageJson = (m) => ({
  id: String(m._id),
  conversation_id: String(m.conversation),
  sender_id: String(m.sender),
  type: m.type,
  body: m.body,
  encrypted: Boolean(m.encrypted),
  media_url: m.mediaUrl ?? null,
  media_key: m.mediaKey ?? null,
  duration_secs: m.durationSecs ?? null,
  created_at: new Date(m.createdAt).toISOString(),
  ...(m.type === 'voice' ? { translation_status: m.translationStatus || 'none' } : {}),
});

export const postJson = (p) => ({
  id: String(p._id),
  channel_id: String(p.channel),
  type: p.type,
  body: p.body,
  media_url: p.mediaUrl ?? null,
  created_at: new Date(p.createdAt).toISOString(),
});
