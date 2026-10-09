// Voice-note translation pipeline.
//
// Flow: Whisper-tiny (speech -> text) -> MADLAD-400 (text -> text, target language)
//       -> BibleTTS/espnet (text -> speech, where a voice exists; otherwise text-only).
//
// None of the actual ML runs in this Node process — it all lives in `translate-service/`,
// a small Python FastAPI app meant to run as its own process (locally or on its own server).
// This file just talks to it over HTTP and writes results onto the Message document.
//
// Every function here is deliberately "fire and forget safe": if the translate-service is
// down, unreachable, or errors, voice notes still send and play normally — they just don't
// get a translation. We never let a translation failure break message sending.

import mongoose from 'mongoose';
import { Message, User } from './models.js';
import { config } from './config.js';
import { emitToUsers } from './realtime.js';
import { bucket, storeGeneratedAudio } from './routes/files.js';

const SERVICE_URL = config.translateServiceUrl;

/** Reads a file we stored ourselves (GridFS, keyed by /api/files/:key) into a Buffer. */
async function readOwnFile(mediaUrl) {
  const key = String(mediaUrl || '').split('/').pop();
  if (!key || !/^[\w-]{20,}$/.test(key)) return null;
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = bucket().openDownloadStreamByName(key);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return Buffer.concat(chunks);
}

/** Calls one endpoint on the Python translate-service. Returns null on any failure — never throws. */
async function callService(path, { formFields = {}, fileField, fileBuffer, fileName, json } = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let res;
    if (fileBuffer) {
      const form = new FormData();
      for (const [k, v] of Object.entries(formFields)) form.append(k, v);
      form.append(fileField || 'file', new Blob([fileBuffer]), fileName || 'audio.webm');
      res = await fetch(`${SERVICE_URL}${path}`, { method: 'POST', body: form, signal: controller.signal });
    } else {
      res = await fetch(`${SERVICE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json || {}),
        signal: controller.signal,
      });
    }
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // service down, timed out, network hiccup — treat it as "no translation available"
  }
}

/** Every distinct target language the other members of a conversation have chosen, from their settings. */
async function recipientLanguages(memberIds) {
  const users = await User.find({ _id: { $in: memberIds } }).select('settings.translation').lean();
  const langs = new Set();
  for (const u of users) {
    const t = u.settings?.translation;
    if (t && t.mode !== 'off' && t.language) langs.add(t.language);
  }
  return [...langs];
}

/**
 * Called right after a voice note is saved. Transcribes it once, then eagerly translates
 * into every distinct language the *other* conversation members have set, so the translation
 * is usually already cached by the time anyone taps "Translate".
 * Fire-and-forget: the caller does `void processVoiceNote(...)`, never awaits it.
 */
export async function processVoiceNote(messageId, mediaUrl, otherMemberIds) {
  try {
    const targetLangs = await recipientLanguages(otherMemberIds);
    if (targetLangs.length === 0) return; // nobody listening wants a translation — skip the work

    await Message.updateOne({ _id: messageId }, { $set: { translationStatus: 'pending' } });

    const audio = await readOwnFile(mediaUrl);
    if (!audio) {
      await Message.updateOne({ _id: messageId }, { $set: { translationStatus: 'failed' } });
      return;
    }

    const transcribed = await callService('/transcribe', { fileBuffer: audio, fileName: 'voice.webm' });
    if (!transcribed?.text) {
      await Message.updateOne({ _id: messageId }, { $set: { translationStatus: 'failed' } });
      return;
    }

    const sourceLanguage = transcribed.language || null;
    const msg = await Message.findById(messageId);
    if (!msg) return;
    msg.transcript = transcribed.text;
    msg.sourceLanguage = sourceLanguage;

    for (const lang of targetLangs) {
      // eslint-disable-next-line no-await-in-loop -- translate-service has no batch endpoint
      await translateToVoice(msg, transcribed.text, sourceLanguage, lang);
    }

    msg.translationStatus = 'ready';
    await msg.save();

    const convMembers = [...otherMemberIds, String(msg.sender)];
    emitToUsers(convMembers, 'message:translation_ready', { message_id: String(messageId) });
  } catch {
    await Message.updateOne({ _id: messageId }, { $set: { translationStatus: 'failed' } }).catch(() => {});
  }
}

/**
 * Translates text into one language, then speaks it as a new voice note. By design this is
 * audio-only on the receiving end — there is never any text shown alongside it. If no voice
 * exists for the target language, there's simply no translated voice note for that language
 * (the original keeps playing as-is; see translateForUser below for exactly what that means
 * for a given recipient).
 */
async function translateToVoice(msg, text, sourceLanguage, targetLang) {
  const translated = await callService('/translate', { json: { text, source: sourceLanguage, target: targetLang } });
  if (!translated?.text) return;

  const spoken = await callService('/speak', { json: { text: translated.text, language: targetLang } });
  if (!spoken?.audio_base64) return; // no voice available for this language — no translated audio note
  try {
    const buf = Buffer.from(spoken.audio_base64, 'base64');
    const audioUrl = await storeGeneratedAudio(buf, msg.sender, { contentType: 'audio/mpeg', name: `translation-${targetLang}.mp3` });
    msg.translations.set(targetLang, { audioUrl });
  } catch {
    // storing failed — leave this language untranslated rather than half-caching it
  }
}

/**
 * Lazy per-recipient lookup, called automatically the moment a voice note from someone else
 * renders for this user — never a tap-to-translate action, and never shows any text.
 *
 * - If this user has voice translation OFF: returns status "off". The client plays the
 *   original voice note exactly as sent, in the original speaker's own language. Nothing else
 *   happens.
 * - If this user has it ON: returns a translated voice note (pure audio) once ready, which the
 *   client swaps in to *replace* playback of the original for this listener only — the sender
 *   and anyone with translation off still get/hear the original.
 */
export async function translateForUser(message, recipientUserId) {
  const user = await User.findById(recipientUserId).select('settings.translation').lean();
  const mode = user?.settings?.translation?.mode;
  if (!mode || mode === 'off') return { status: 'off' };

  const targetLang = user?.settings?.translation?.language;
  if (!targetLang) return { status: 'failed', reason: 'NO_LANGUAGE_SET' };

  const cached = message.translations?.get?.(targetLang) || message.translations?.[targetLang];
  if (cached?.audioUrl) return { status: 'ready', audio_url: cached.audioUrl, language: targetLang };

  if (!message.transcript) {
    return { status: message.translationStatus === 'pending' ? 'pending' : 'failed', language: targetLang };
  }

  const msg = await Message.findById(message._id);
  await translateToVoice(msg, msg.transcript, msg.sourceLanguage, targetLang);
  await msg.save();

  const result = msg.translations.get(targetLang);
  if (!result?.audioUrl) return { status: 'failed', language: targetLang };
  return { status: 'ready', audio_url: result.audioUrl, language: targetLang };
}
