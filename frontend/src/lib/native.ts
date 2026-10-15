import { Contacts } from '@capacitor-community/contacts';
import { Capacitor } from '@capacitor/core';
import { BiometryType, NativeBiometric } from '@capgo/capacitor-native-biometric';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from '@/lib/http';

export const isNative = (): boolean => Capacitor.isNativePlatform();

let currentToken: string | null = null;
let currentUserId: string | null = null;
let onNotificationOpen: (data: Record<string, string>) => void = () => { };
let listenersAdded = false;

async function registerGrantedPush(): Promise<void> {
  await PushNotifications.createChannel({ id: 'messages', name: 'Messages', importance: 4 });
  await PushNotifications.createChannel({ id: 'calls', name: 'Calls', importance: 5 });
  if (!listenersAdded) {
    listenersAdded = true;
    await PushNotifications.addListener('registration', async (token) => {
      currentToken = token.value;
      if (currentUserId) {
        await api('/api/devices', { body: { token: token.value, platform: Capacitor.getPlatform() } }).catch(() => { });
      }
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      onNotificationOpen(action.notification.data ?? {});
    });
  }
  await PushNotifications.register();
}

export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (isNative()) {
    try {
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive === 'granted') {
        await registerGrantedPush();
        return 'granted';
      }
      return permission.receive === 'denied' ? 'denied' : 'default';
    } catch {
      return 'denied';
    }
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

export async function getPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (isNative()) {
    try {
      const permission = await PushNotifications.checkPermissions();
      return permission.receive === 'granted' ? 'granted' : permission.receive === 'denied' ? 'denied' : 'default';
    } catch {
      return 'unsupported';
    }
  }
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function authenticateDevice(reason = 'Unlock Chatimall'): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const availability = await NativeBiometric.isAvailable({ useFallback: true });
    if (!availability.isAvailable && !availability.deviceIsSecure) return false;
    await NativeBiometric.verifyIdentity({
      reason,
      title: 'Chatimall',
      subtitle: reason,
      useFallback: true,
      allowedBiometryTypes: [
        BiometryType.FINGERPRINT,
        BiometryType.FACE_AUTHENTICATION,
        BiometryType.IRIS_AUTHENTICATION,
        BiometryType.DEVICE_CREDENTIAL,
      ],
    });
    return true;
  } catch {
    return false;
  }
}

export async function getDeviceContacts(): Promise<Array<{ name: string; phone: string }>> {
  if (!isNative()) throw new Error('Phone contacts are available in the installed app.');
  const permission = await Contacts.requestPermissions();
  if (permission.contacts !== 'granted' && permission.contacts !== 'limited') {
    throw new Error('Allow contact access in device settings to sync your address book.');
  }
  const result = await Contacts.getContacts({ projection: { name: true, phones: true } });
  return result.contacts.flatMap((contact) => {
    const name = contact.name?.display || [contact.name?.given, contact.name?.family].filter(Boolean).join(' ');
    if (!name) return [];
    return (contact.phones ?? []).flatMap((phone) => phone.number ? [{ name, phone: phone.number }] : []);
  });
}

/** Ask for notification permission, get an FCM token and store it for the signed-in user. */
export async function registerPush(
  userId: string,
  onOpen: (data: Record<string, string>) => void
): Promise<void> {
  if (!isNative()) return;
  currentUserId = userId;
  onNotificationOpen = onOpen;
  try {
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') return;
    await registerGrantedPush();
  } catch (err) {
    console.warn('Push registration failed', err);
  }
}

/** Call on logout so the next person on this phone doesn't receive your notifications. */
export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  await api('/api/devices/remove', { body: { token: currentToken } }).catch(() => { });
  currentToken = null;
  currentUserId = null;
  onNotificationOpen = () => { };
}
