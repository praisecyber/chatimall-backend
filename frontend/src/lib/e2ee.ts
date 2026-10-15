import { api } from '@/lib/http';
import { secureGetItem, secureSetItem } from '@/lib/secure';

const KEY_PAIR_STORAGE_KEY = 'chatimall_e2ee_keypair';

type KeyPairRecord = {
    privateKeyJwk: JsonWebKey;
    publicKeyJwk: JsonWebKey;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const importEcdhKey = async (keyData: JsonWebKey): Promise<CryptoKey> => {
    const usages: KeyUsage[] = keyData.d ? ['deriveKey'] : [];
    return crypto.subtle.importKey('jwk', keyData, { name: 'ECDH', namedCurve: 'P-256' }, true, usages);
};

const keyId = async (publicKey: JsonWebKey): Promise<string> => {
    if (publicKey.kty !== 'EC' || publicKey.crv !== 'P-256' || !publicKey.x || !publicKey.y) {
        throw new Error('Invalid encryption public key.');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${publicKey.crv}:${publicKey.x}:${publicKey.y}`));
    return bytesToBase64(new Uint8Array(digest));
};

const peerKeyStorageId = (userId: string): string => `chatimall.peer-key.${userId}`;

export async function getPeerKeyStatus(userId: string, publicKey: JsonWebKey): Promise<{ fingerprint: string; trusted: boolean }> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${publicKey.crv}:${publicKey.x}:${publicKey.y}`));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const pinned = await secureGetItem(peerKeyStorageId(userId));
    return { fingerprint: hex.match(/.{1,4}/g)?.join(' ') ?? hex, trusted: pinned === await keyId(publicKey) };
}

export async function trustPeerKey(userId: string, publicKey: JsonWebKey): Promise<void> {
    await secureSetItem(peerKeyStorageId(userId), await keyId(publicKey));
}

export async function ensureDeviceKeyPair(): Promise<CryptoKeyPair> {
    const raw = await secureGetItem(KEY_PAIR_STORAGE_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as KeyPairRecord;
            return {
                privateKey: await importEcdhKey(parsed.privateKeyJwk),
                publicKey: await importEcdhKey(parsed.publicKeyJwk),
            };
        } catch {
            throw new Error('The device encryption key is unavailable.');
        }
    }

    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const record: KeyPairRecord = {
        privateKeyJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
        publicKeyJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    };
    await secureSetItem(KEY_PAIR_STORAGE_KEY, JSON.stringify(record));
    return pair;
}

export async function exportPublicKey(): Promise<JsonWebKey> {
    const { publicKey } = await ensureDeviceKeyPair();
    return crypto.subtle.exportKey('jwk', publicKey);
}

export async function publishPublicKey(): Promise<JsonWebKey | null> {
    if (!window.crypto || !window.crypto.subtle) return null;
    const publicKey = await exportPublicKey();
    const res = await api<{ public_key: JsonWebKey | null }>('/api/me', { method: 'PATCH', body: { public_key: publicKey } });
    return res.public_key ?? publicKey;
}

export async function encryptTextForPeer(
    plainText: string,
    peerPublicKey: JsonWebKey | null,
    peerUserId?: string,
    contextId?: string
): Promise<{ encrypted: true; body: string }> {
    if (!peerPublicKey) throw new Error('This contact has not published an encryption key yet.');
    if (!peerUserId) throw new Error('A contact account is required to encrypt this message.');
    return encryptTextForRecipients(plainText, [{ userId: peerUserId, publicKey: peerPublicKey }], contextId);
}

export async function encryptTextForRecipients(
    plainText: string,
    recipients: Array<{ userId: string; publicKey: JsonWebKey | null }>,
    contextId?: string
): Promise<{ encrypted: true; body: string }> {
    if (!plainText.trim()) throw new Error('Message cannot be empty.');
    if (!contextId) throw new Error('A conversation context is required to encrypt this message.');
    if (!recipients.length || recipients.some((recipient) => !recipient.publicKey)) {
        throw new Error('Every group member must publish an encryption key before the group can send encrypted messages.');
    }

    const { publicKey } = await ensureDeviceKeyPair();
    const senderPublicKey = await crypto.subtle.exportKey('jwk', publicKey);
    for (const recipient of recipients) {
        const fingerprint = await keyId(recipient.publicKey!);
        const pinned = await secureGetItem(peerKeyStorageId(recipient.userId));
        if (pinned !== fingerprint) {
            throw new Error(pinned
                ? 'A group member encryption key changed. Compare and verify every safety code before sending.'
                : 'Compare and verify every group member safety code before sending.');
        }
    }

    const contentKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const contentKey = await crypto.subtle.importKey('raw', contentKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const contentIv = crypto.getRandomValues(new Uint8Array(12));
    const context = new TextEncoder().encode(contextId);
    const cipherBytes = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: contentIv, additionalData: context },
        contentKey,
        new TextEncoder().encode(plainText)
    );
    const targets = [...recipients.map((recipient) => recipient.publicKey!), senderPublicKey];
    const boxes = await Promise.all(targets.map(async (recipientJwk) => {
        const recipientKey = await importEcdhKey(recipientJwk);
        const ephemeralPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
        const derivedKey = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: recipientKey },
            ephemeralPair.privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
        const wrapIv = crypto.getRandomValues(new Uint8Array(12));
        const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, derivedKey, contentKeyBytes);
        return {
            kid: await keyId(recipientJwk),
            eph: await crypto.subtle.exportKey('jwk', ephemeralPair.publicKey),
            wrapIv: bytesToBase64(wrapIv),
            wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
        };
    }));
    return {
        encrypted: true,
        body: JSON.stringify({ v: 3, alg: 'ECDH-AES-GCM', contextId, iv: bytesToBase64(contentIv), ct: bytesToBase64(new Uint8Array(cipherBytes)), boxes }),
    };
}

export async function encryptMediaForPeer(
    plainBytes: ArrayBuffer,
    mimeType: string,
    peerPublicKey: JsonWebKey | null,
    peerUserId: string | undefined,
    contextId: string
): Promise<{ bytes: ArrayBuffer; mediaKey: string }> {
    if (!peerPublicKey || !peerUserId) throw new Error('This contact has not published an encryption key yet.');
    return encryptMediaForRecipients(plainBytes, mimeType, [{ userId: peerUserId, publicKey: peerPublicKey }], contextId);
}

export async function encryptMediaForRecipients(
    plainBytes: ArrayBuffer,
    mimeType: string,
    recipients: Array<{ userId: string; publicKey: JsonWebKey | null }>,
    contextId: string
): Promise<{ bytes: ArrayBuffer; mediaKey: string }> {
    if (!recipients.length || recipients.some((recipient) => !recipient.publicKey)) {
        throw new Error('Every group member must publish an encryption key before sending encrypted attachments.');
    }
    for (const recipient of recipients) {
        const fingerprint = await keyId(recipient.publicKey!);
        if (await secureGetItem(peerKeyStorageId(recipient.userId)) !== fingerprint) {
            throw new Error('Compare and verify every group member safety code before sending.');
        }
    }
    const { publicKey } = await ensureDeviceKeyPair();
    const senderPublicKey = await crypto.subtle.exportKey('jwk', publicKey);
    const contentKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const contentKey = await crypto.subtle.importKey('raw', contentKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(contextId) },
        contentKey,
        plainBytes
    );
    const boxes = await Promise.all([...recipients.map((recipient) => recipient.publicKey!), senderPublicKey].map(async (recipientJwk) => {
        const recipientKey = await importEcdhKey(recipientJwk);
        const ephemeralPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
        const wrappingKey = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: recipientKey },
            ephemeralPair.privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
        const wrapIv = crypto.getRandomValues(new Uint8Array(12));
        const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, wrappingKey, contentKeyBytes);
        return {
            kid: await keyId(recipientJwk),
            eph: await crypto.subtle.exportKey('jwk', ephemeralPair.publicKey),
            wrapIv: bytesToBase64(wrapIv),
            wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
        };
    }));
    return {
        bytes,
        mediaKey: JSON.stringify({
            v: 3,
            alg: 'ECDH-AES-GCM',
            purpose: 'media',
            contextId,
            mimeType: mimeType.slice(0, 120) || 'application/octet-stream',
            iv: bytesToBase64(iv),
            boxes,
        }),
    };
}

export async function decryptMediaUrl(mediaUrl: string, mediaKey: string, expectedContextId: string): Promise<string> {
    const payload = JSON.parse(mediaKey) as {
        v?: number;
        alg?: string;
        purpose?: string;
        contextId?: string;
        mimeType?: string;
        iv?: string;
        boxes?: Array<{ kid: string; eph: JsonWebKey; wrapIv: string; wrappedKey: string }>;
    };
    if (payload.v !== 3 || payload.alg !== 'ECDH-AES-GCM' || payload.purpose !== 'media'
        || payload.contextId !== expectedContextId || !payload.iv || !payload.boxes) {
        throw new Error('Invalid encrypted attachment.');
    }
    const { privateKey, publicKey } = await ensureDeviceKeyPair();
    const ownKeyId = await keyId(await crypto.subtle.exportKey('jwk', publicKey));
    const box = payload.boxes.find((candidate) => candidate.kid === ownKeyId);
    if (!box) throw new Error('This attachment was not encrypted for this device.');
    const wrappingPublicKey = await importEcdhKey(box.eph);
    const wrappingKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: wrappingPublicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    const wrapIv = base64ToBytes(box.wrapIv);
    const wrappedKey = base64ToBytes(box.wrappedKey);
    const contentKeyBytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: wrapIv.buffer as ArrayBuffer },
        wrappingKey,
        wrappedKey.buffer as ArrayBuffer
    );
    const contentKey = await crypto.subtle.importKey('raw', contentKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const response = await fetch(mediaUrl);
    if (!response.ok) throw new Error('Could not download encrypted attachment.');
    const encryptedBytes = await response.arrayBuffer();
    const plainBytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(payload.iv).buffer as ArrayBuffer, additionalData: new TextEncoder().encode(expectedContextId) },
        contentKey,
        encryptedBytes
    );
    return URL.createObjectURL(new Blob([plainBytes], { type: payload.mimeType || 'application/octet-stream' }));
}

export async function decryptMessageBody(cipherText: string, expectedContextId?: string): Promise<string> {
    if (!cipherText.trim()) return cipherText;
    try {
        const payload = JSON.parse(cipherText) as {
            v?: number;
            alg?: string;
            eph?: JsonWebKey;
            iv?: string;
            ct?: string;
            contextId?: string;
            boxes?: Array<{ kid: string; eph: JsonWebKey; iv?: string; ct?: string; wrapIv?: string; wrappedKey?: string }>;
        };
        if (!payload || payload.alg !== 'ECDH-AES-GCM') {
            return 'Unable to decrypt this message.';
        }

        const { privateKey, publicKey } = await ensureDeviceKeyPair();
        if (payload.v === 3 && (!expectedContextId || payload.contextId !== expectedContextId)) {
            return 'Unable to decrypt this message.';
        }
        let box: { eph: JsonWebKey; iv: string; ct: string } | undefined;
        if (payload.v === 3 && payload.boxes && payload.iv && payload.ct) {
            const ownKeyId = await keyId(await crypto.subtle.exportKey('jwk', publicKey));
            const wrappedBox = payload.boxes.find((candidate) => candidate.kid === ownKeyId);
            if (!wrappedBox?.wrapIv || !wrappedBox.wrappedKey) return 'Unable to decrypt this message.';
            const recipientKey = await importEcdhKey(wrappedBox.eph);
            const wrappingKey = await crypto.subtle.deriveKey(
                { name: 'ECDH', public: recipientKey },
                privateKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );
            const wrapIv = base64ToBytes(wrappedBox.wrapIv);
            const wrappedKey = base64ToBytes(wrappedBox.wrappedKey);
            const rawContentKey = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: wrapIv.buffer as ArrayBuffer },
                wrappingKey,
                wrappedKey.buffer as ArrayBuffer
            );
            const contentKey = await crypto.subtle.importKey('raw', rawContentKey, { name: 'AES-GCM' }, false, ['decrypt']);
            const contentIv = base64ToBytes(payload.iv);
            const encryptedBody = base64ToBytes(payload.ct);
            const plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: contentIv.buffer as ArrayBuffer, additionalData: new TextEncoder().encode(payload.contextId) },
                contentKey,
                encryptedBody.buffer as ArrayBuffer
            );
            return new TextDecoder().decode(plain);
        }
        if (payload.v === 2 && payload.boxes) {
            const ownKeyId = await keyId(await crypto.subtle.exportKey('jwk', publicKey));
            const legacyBox = payload.boxes.find((candidate) => candidate.kid === ownKeyId);
            if (legacyBox?.iv && legacyBox.ct) box = { eph: legacyBox.eph, iv: legacyBox.iv, ct: legacyBox.ct };
        } else if (payload.eph && payload.iv && payload.ct) {
            box = { eph: payload.eph, iv: payload.iv, ct: payload.ct };
        }
        if (!box) return 'Unable to decrypt this message.';

        const recipientKey = await importEcdhKey(box.eph);
        const derivedKey = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: recipientKey },
            privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
        const ivBytes = base64ToBytes(box.iv);
        const ivBuffer = ivBytes.buffer.slice(
            ivBytes.byteOffset,
            ivBytes.byteOffset + ivBytes.byteLength
        ) as ArrayBuffer;
        const ctBytes = base64ToBytes(box.ct);
        const ctBuffer = ctBytes.buffer.slice(
            ctBytes.byteOffset,
            ctBytes.byteOffset + ctBytes.byteLength
        ) as ArrayBuffer;

        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBuffer },
            derivedKey,
            ctBuffer
        );
        return new TextDecoder().decode(plain);
    } catch {
        return 'Unable to decrypt this message.';
    }
}
