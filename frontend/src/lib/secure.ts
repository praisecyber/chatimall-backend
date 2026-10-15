import { AccessControl, NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';

const WEB_DB = 'chatimall-secure-storage';
const WEB_KEY_ID = 'master';

function openWebDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(WEB_DB, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('keys', { keyPath: 'id' });
            request.result.createObjectStore('values', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function webStorageKey(database: IDBDatabase): Promise<CryptoKey> {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
        const request = database.transaction('keys', 'readonly').objectStore('keys').get(WEB_KEY_ID);
        request.onsuccess = () => resolve(request.result?.key as CryptoKey | undefined);
        request.onerror = () => reject(request.error);
    });
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((resolve, reject) => {
        const request = database.transaction('keys', 'readwrite').objectStore('keys').put({ id: WEB_KEY_ID, key });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
    return key;
}

function requireNativeSecureStorage(): void {
    if (!Capacitor.isNativePlatform()) throw new Error('Secure device storage is available in the installed app.');
}

export async function secureSetItem(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        await NativeBiometric.setData({ key: `chatimall.${key}`, value });
        return;
    }
    const database = await openWebDatabase();
    const storageKey = await webStorageKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, storageKey, new TextEncoder().encode(value));
    await new Promise<void>((resolve, reject) => {
        const request = database.transaction('values', 'readwrite').objectStore('values').put({
            id: key,
            iv: iv.buffer,
            encrypted,
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function secureGetItem(key: string): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
        if (typeof indexedDB === 'undefined') return null;
        try {
            const database = await openWebDatabase();
            const record = await new Promise<{ iv: ArrayBuffer; encrypted: ArrayBuffer } | undefined>((resolve, reject) => {
                const request = database.transaction('values', 'readonly').objectStore('values').get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            if (!record) return null;
            const storageKey = await webStorageKey(database);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, storageKey, record.encrypted);
            return new TextDecoder().decode(decrypted);
        } catch {
            return null;
        }
    }
    try {
        const result = await NativeBiometric.getData({ key: `chatimall.${key}` });
        return result.value;
    } catch {
        return null;
    }
}

export async function secureSetProtectedItem(key: string, value: string): Promise<void> {
    requireNativeSecureStorage();
    await NativeBiometric.setData({
        key: `chatimall.${key}`,
        value,
        accessControl: AccessControl.BIOMETRY_ANY,
        title: 'Protect Chatimall key',
    });
}

export async function secureGetProtectedItem(key: string, reason: string): Promise<string | null> {
    requireNativeSecureStorage();
    try {
        const result = await NativeBiometric.getSecureData({
            key: `chatimall.${key}`,
            reason,
            title: 'Unlock Chatimall key',
        });
        return result.value;
    } catch {
        return null;
    }
}
