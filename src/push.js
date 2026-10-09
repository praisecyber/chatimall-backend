import fs from 'node:fs';
import { DeviceToken, User } from './models.js';

let messaging = null;
let initialised = false;

async function getMessaging() {
  if (initialised) return messaging;
  initialised = true;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const admin = (await import('firebase-admin')).default;
    const json = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(json) });
    messaging = admin.messaging();
  } catch (err) {
    console.warn('Push notifications disabled (Firebase setup failed):', err.message);
  }
  return messaging;
}

/** Fire-and-forget push to every device a user has registered. */
export async function notifyUser(userId, { title, body, data = {}, channelId = 'messages' }) {
  try {
    const m = await getMessaging();
    if (!m) return;
    const tokens = await DeviceToken.find({ user: userId }).lean();
    const user = await User.findById(userId).select('settings.notifications.preview').lean();
    const showPreview = channelId !== 'messages' || user?.settings?.notifications?.preview !== false;
    const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    await Promise.all(
      tokens.map(async (t) => {
        try {
          await m.send({
            token: t.token,
            notification: {
              title: showPreview ? title : 'New message',
              body: showPreview ? body : 'You have a new message.',
            },
            data: strData,
            android: { priority: 'high', notification: { channelId, sound: 'default' } },
          });
        } catch (err) {
          const code = String(err?.errorInfo?.code || err?.code || '');
          if (code.includes('not-registered') || code.includes('invalid-argument') || code.includes('invalid-registration')) {
            await DeviceToken.deleteOne({ _id: t._id });
          }
        }
      })
    );
  } catch (err) {
    console.warn('push failed', err.message);
  }
}
