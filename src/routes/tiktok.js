import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { TikTokConnection, TikTokOAuthState } from '../models.js';
import { wrap } from '../util.js';

const router = Router();
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const API_BASE = 'https://open.tiktokapis.com/v2/';
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUIRED_SCOPES = ['user.info.basic', 'video.list'];

function configured() {
  return Boolean(
    config.tiktokClientKey &&
    config.tiktokClientSecret &&
    config.tiktokRedirectUri &&
    config.tiktokTokenEncryptionKey
  );
}

function hashState(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

function encryptToken(value) {
  const key = Buffer.from(config.tiktokTokenEncryptionKey, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptToken(value) {
  const [ivPart, tagPart, encryptedPart] = value.split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Stored TikTok token is malformed.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.tiktokTokenEncryptionKey, 'base64'),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function tokenRequest(values) {
  const body = new URLSearchParams({
    client_key: config.tiktokClientKey,
    client_secret: config.tiktokClientSecret,
    ...values,
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error || !payload.access_token) {
    const error = new Error(payload?.error_description || 'TikTok authorization failed.');
    error.status = 502;
    throw error;
  }
  return payload;
}

async function storeTokens(connection, tokens) {
  connection.openId = tokens.open_id || connection.openId;
  connection.accessToken = encryptToken(tokens.access_token);
  connection.refreshToken = encryptToken(tokens.refresh_token);
  connection.accessTokenExpiresAt = new Date(Date.now() + Number(tokens.expires_in) * 1000);
  connection.refreshTokenExpiresAt = new Date(Date.now() + Number(tokens.refresh_expires_in) * 1000);
  connection.scopes = String(tokens.scope || '').split(',').filter(Boolean);
  connection.updatedAt = new Date();
  await connection.save();
}

async function getAccessToken(connection) {
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return decryptToken(connection.accessToken);
  }
  if (connection.refreshTokenExpiresAt.getTime() <= Date.now()) {
    const error = new Error('TikTok authorization expired. Reconnect your TikTok account.');
    error.status = 401;
    throw error;
  }
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: decryptToken(connection.refreshToken),
  });
  await storeTokens(connection, tokens);
  return decryptToken(connection.accessToken);
}

async function tiktokApi(connection, path, options = {}) {
  const token = await getAccessToken(connection);
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error?.code && payload.error.code !== 'ok') {
    const error = new Error(payload?.error?.message || 'TikTok API request failed.');
    error.status = 502;
    throw error;
  }
  return payload?.data ?? {};
}

function connectionStatus(connection) {
  return {
    enabled: configured(),
    connected: Boolean(connection),
    display_name: connection?.displayName || '',
    avatar_url: connection?.avatarUrl || '',
    scopes: connection?.scopes || [],
    can_list_videos: Boolean(connection?.scopes?.includes('video.list')),
  };
}

function callbackPage(res, status, message) {
  const frontend = config.tiktokFrontendUrl;
  const title = status === 'connected' ? 'TikTok connected' : 'TikTok connection not completed';
  res.status(status === 'connected' ? 200 : 400).type('html').send(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;max-width:36rem;margin:12vh auto;padding:1rem;color:#17211b"><h1>${title}</h1><p>${message}</p><p><a href="${frontend}">Return to Chatimall</a></p></body></html>`
  );
}

/**
 * @openapi
 * /api/tiktok/callback:
 *   get:
 *     summary: Handle TikTok Login Kit authorization callback
 *     tags: [TikTok]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *       - in: query
 *         name: state
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: error
 *         schema: { type: string }
 *     responses:
 *       200: { description: Authorization completed }
 *       400: { description: Authorization was denied or could not be verified }
 */
router.get(
  '/callback',
  wrap(async (req, res) => {
    if (!configured()) return callbackPage(res, 'error', 'TikTok linking is not configured on this server.');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const stateRow = state
      ? await TikTokOAuthState.findOneAndDelete({ stateHash: hashState(state), expiresAt: { $gt: new Date() } })
      : null;
    if (!stateRow) return callbackPage(res, 'error', 'This TikTok connection request expired or could not be verified. Start again from Chatimall.');
    if (req.query.error) return callbackPage(res, 'error', 'TikTok authorization was cancelled or denied.');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || code.length > 4096) return callbackPage(res, 'error', 'TikTok did not return a valid authorization code.');

    const tokens = await tokenRequest({
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.tiktokRedirectUri,
    });
    if (!tokens.open_id || !tokens.refresh_token || !Number(tokens.expires_in) || !Number(tokens.refresh_expires_in)) {
      return callbackPage(res, 'error', 'TikTok returned an incomplete authorization response.');
    }
    const existingOwner = await TikTokConnection.exists({ openId: tokens.open_id, user: { $ne: stateRow.user } });
    if (existingOwner) return callbackPage(res, 'error', 'That TikTok account is already linked to another Chatimall account.');

    const connection = await TikTokConnection.findOneAndUpdate(
      { user: stateRow.user },
      {
        $setOnInsert: { user: stateRow.user, connectedAt: new Date() },
        $set: {
          openId: tokens.open_id,
          accessToken: encryptToken(tokens.access_token),
          refreshToken: encryptToken(tokens.refresh_token),
          accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + Number(tokens.refresh_expires_in) * 1000),
          scopes: String(tokens.scope || '').split(',').map((scope) => scope.trim()).filter(Boolean),
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    try {
      const profile = await tiktokApi(connection, 'user/info/?fields=open_id,display_name,avatar_url');
      if (profile.user) {
        connection.displayName = String(profile.user.display_name || '').slice(0, 100);
        connection.avatarUrl = String(profile.user.avatar_url || '').slice(0, 2048);
        await connection.save();
      }
    } catch (error) {
      console.warn('[tiktok] Linked account, but profile lookup failed:', error.message);
    }
    return callbackPage(res, 'connected', 'Your TikTok account has been linked to Chatimall.');
  })
);

router.use(requireAuth);

/**
 * @openapi
 * /api/tiktok/status:
 *   get:
 *     summary: Get the signed-in user's TikTok connection status
 *     tags: [TikTok]
 *     responses:
 *       200: { description: Connection status without credentials }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get(
  '/status',
  wrap(async (req, res) => {
    const connection = await TikTokConnection.findOne({ user: req.userId }).select('displayName avatarUrl scopes').lean();
    res.json(connectionStatus(connection));
  })
);

/**
 * @openapi
 * /api/tiktok/authorize:
 *   post:
 *     summary: Begin linking a TikTok account to the signed-in Chatimall account
 *     tags: [TikTok]
 *     responses:
 *       200: { description: TikTok authorization URL }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       503: { description: TikTok integration is not configured }
 */
router.post(
  '/authorize',
  wrap(async (req, res) => {
    if (!configured()) return res.status(503).json({ error: 'TIKTOK_NOT_CONFIGURED' });
    const state = crypto.randomBytes(32).toString('hex');
    await TikTokOAuthState.create({
      stateHash: hashState(state),
      user: req.userId,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
    const authorize = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authorize.search = new URLSearchParams({
      client_key: config.tiktokClientKey,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(','),
      redirect_uri: config.tiktokRedirectUri,
      state,
    }).toString();
    res.json({ authorization_url: authorize.toString() });
  })
);

/**
 * @openapi
 * /api/tiktok/videos:
 *   get:
 *     summary: List the signed-in user's TikTok videos when video.list is authorized
 *     tags: [TikTok]
 *     responses:
 *       200: { description: TikTok video metadata }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: TikTok video.list scope was not granted }
 */
router.get(
  '/videos',
  wrap(async (req, res) => {
    const connection = await TikTokConnection.findOne({ user: req.userId });
    if (!connection) return res.status(404).json({ error: 'TIKTOK_NOT_LINKED' });
    if (!connection.scopes.includes('video.list')) return res.status(403).json({ error: 'TIKTOK_SCOPE_REQUIRED' });
    const data = await tiktokApi(connection, 'video/list/?fields=id,title,video_description,duration,cover_image_url,share_url,embed_link', {
      method: 'POST',
      body: JSON.stringify({ max_count: 20 }),
    });
    res.json({ videos: data.videos || [], cursor: data.cursor ?? null, has_more: Boolean(data.has_more) });
  })
);

/**
 * @openapi
 * /api/tiktok/connection:
 *   delete:
 *     summary: Revoke TikTok access and unlink it from the signed-in Chatimall account
 *     tags: [TikTok]
 *     responses:
 *       200: { description: TikTok account disconnected }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.delete(
  '/connection',
  wrap(async (req, res) => {
    const connection = await TikTokConnection.findOne({ user: req.userId });
    if (!connection) return res.json({ ok: true });
    const token = await getAccessToken(connection);
    const response = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key: config.tiktokClientKey,
        client_secret: config.tiktokClientSecret,
        token,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      return res.status(502).json({ error: 'TIKTOK_REVOKE_FAILED', message: 'Could not revoke TikTok access. Please try again.' });
    }
    await connection.deleteOne();
    res.json({ ok: true });
  })
);

export default router;
