import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  Send,
  Smile,
  Paperclip,
  Mic,
  Trash2,
  Star,
  Archive,
  Play,
  Pause,
  CheckCheck,
  Check,
  Camera,
  Image as ImageIcon,
  FileText,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Chat, DbMessage, Message } from '@/types';
import { connectSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';
import { fetchMessages, fetchPeerReadAt, fetchStarredMessages, fetchVoiceTranslation, mapMessage, markRead, sendMedia, sendText, setConversationArchived, setMessageStarred } from '@/lib/api';
import { decryptMediaUrl, decryptMessageBody, getPeerKeyStatus, trustPeerKey } from '@/lib/e2ee';
import { formatClock, formatDuration } from '@/lib/format';

interface ChatConversationProps {
  chat: Chat;
  onBack: () => void;
  onStartCall: (type: 'voice' | 'video') => void;
  wallpaper?: string;
}

/** Decorative waveform derived from the message id (stable between renders). */
function barsFor(id: string): number[] {
  return Array.from({ length: 10 }, (_, i) => 6 + ((id.charCodeAt(i % id.length) * (i + 3)) % 13));
}

/**
 * Invisible — renders nothing. Runs automatically for every *received* voice note the moment
 * it's on screen, and silently reports back (via onReady) whether a translated spoken voice
 * note is available for this listener:
 *   - this listener has translation OFF  -> never calls onReady; original audio plays, as sent,
 *     in the original speaker's own language. No button, no text, nothing to see.
 *   - this listener has translation ON   -> once a translated voice note is ready, calls
 *     onReady(audioUrl) so the parent can swap playback to the translated audio for this
 *     listener only. Still no text, ever — just which audio plays.
 * Polls briefly while a translation is "pending" (freshly requested, still being generated) so
 * it catches up without the person having to re-open the chat.
 */
function useAutoVoiceTranslation(
  conversationId: string,
  messageId: string,
  sent: boolean,
  onReady: (messageId: string, audioUrl: string) => void
) {
  useEffect(() => {
    if (sent) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetchVoiceTranslation(conversationId, messageId);
        if (!active) return;
        if (res.status === 'ready' && res.audio_url) {
          onReady(messageId, res.audio_url);
          return;
        }
        if (res.status === 'pending') {
          timer = setTimeout(poll, 3000);
        }
        // status 'off' or 'failed': do nothing — original audio stands as-is.
      } catch {
        // network hiccup — original audio stands as-is, no retry storm.
      }
    };
    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messageId, sent]);
}

/** Thin wrapper so the hook above can run once per message inside a .map() — renders nothing. */
function AutoVoiceTranslation(props: {
  conversationId: string;
  messageId: string;
  sent: boolean;
  onReady: (messageId: string, audioUrl: string) => void;
}) {
  useAutoVoiceTranslation(props.conversationId, props.messageId, props.sent, props.onReady);
  return null;
}

export default function ChatConversation({
  chat,
  onBack,
  onStartCall,
  wallpaper = 'default',
}: ChatConversationProps) {
  const { userId } = useAuth();
  const [rows, setRows] = useState<DbMessage[]>([]);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [showSafetyCode, setShowSafetyCode] = useState(false);
  const [peerKeyStatus, setPeerKeyStatus] = useState<{ fingerprint: string; trusted: boolean } | null>(null);
  // messageId -> translated spoken voice note URL, for received voice notes once this
  // listener's translation (Settings > Voice Note Translation) has produced one. Never set for
  // listeners with translation off — see useAutoVoiceTranslation above.
  const [translatedAudio, setTranslatedAudio] = useState<Record<string, string>>({});
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set());
  const [updatingStarId, setUpdatingStarId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const decryptedMediaUrlsRef = useRef<Map<string, string>>(new Map());
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!chat.otherUserId || !chat.otherPublicKey || chat.isGroup) {
      setPeerKeyStatus(null);
      return;
    }
    let active = true;
    void getPeerKeyStatus(chat.otherUserId, chat.otherPublicKey)
      .then((status) => {
        if (active) setPeerKeyStatus(status);
      })
      .catch(() => {
        if (active) setPeerKeyStatus(null);
      });
    return () => {
      active = false;
    };
  }, [chat.otherUserId, chat.otherPublicKey, chat.isGroup]);


  const decodeIncomingMessage = useCallback(async (row: DbMessage): Promise<DbMessage> => {
    if (!row.encrypted) return row;
    if (row.type === 'text' && row.body) {
      return { ...row, body: await decryptMessageBody(row.body, chat.id) };
    }
    if (row.media_url && row.media_key) {
      try {
        const cachedUrl = decryptedMediaUrlsRef.current.get(row.id);
        if (cachedUrl) return { ...row, media_url: cachedUrl };
        const mediaUrl = await decryptMediaUrl(row.media_url, row.media_key, chat.id);
        decryptedMediaUrlsRef.current.set(row.id, mediaUrl);
        return { ...row, media_url: mediaUrl };
      } catch {
        return { ...row, body: 'Unable to decrypt attachment.', media_url: null };
      }
    }
    return row;
  }, [chat.id]);

  const addRow = useCallback((row: DbMessage) => {
    setRows((prev) =>
      prev.some((r) => r.id === row.id)
        ? prev
        : [...prev, row].sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
  }, []);

  // ---- load history + subscribe to realtime ----
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setRows([]);
    setPeerReadAt(null);
    setPeerTyping(false);
    setLoadingMsgs(true);
    setError(null);

    const load = async () => {
      try {
        const [msgs, readAt, starred] = await Promise.all([
          fetchMessages(chat.id),
          fetchPeerReadAt(chat.id, userId),
          fetchStarredMessages(),
        ]);
        if (cancelled) return;
        const decodedMsgs = await Promise.all(msgs.map((msg) => decodeIncomingMessage(msg)));
        setStarredIds(new Set(starred.filter((row) => row.message.conversation_id === chat.id).map((row) => row.message.id)));
        setRows((prev) => {
          // keep anything that arrived live while the request was in flight
          const ids = new Set(decodedMsgs.map((m) => m.id));
          return [...decodedMsgs, ...prev.filter((m) => !ids.has(m.id))].sort((a, b) => a.created_at.localeCompare(b.created_at));
        });
        setPeerReadAt(readAt);
        void markRead(chat.id, userId);
      } catch {
        if (!cancelled) setError('Could not load messages.');
      }
      if (!cancelled) setLoadingMsgs(false);
    };
    void load();

    const socket = connectSocket();
    const onMessage = async (raw: DbMessage) => {
      if (raw.conversation_id !== chat.id) return;
      const decoded = await decodeIncomingMessage(mapMessage(raw));
      addRow(decoded);
      if (raw.sender_id !== userId) {
        setPeerTyping(false);
        void markRead(chat.id, userId);
      }
    };
    const onRead = (r: { conversation_id: string; user_id: string; at: string }) => {
      if (r.conversation_id === chat.id && r.user_id !== userId) setPeerReadAt(r.at);
    };
    const onTyping = (t: { conversation_id: string }) => {
      if (t.conversation_id !== chat.id) return;
      setPeerTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setPeerTyping(false), 3000);
    };
    const onReconnect = () => void load(); // catch up on anything missed while offline

    socket.on('message:new', onMessage);
    socket.on('chat:read', onRead);
    socket.on('typing', onTyping);
    socket.on('connect', onReconnect);

    return () => {
      cancelled = true;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      socket.off('message:new', onMessage);
      socket.off('chat:read', onRead);
      socket.off('typing', onTyping);
      socket.off('connect', onReconnect);
    };
  }, [chat.id, userId, addRow, decodeIncomingMessage]);

  // ---- UI messages derived from DB rows ----
  const messages: Message[] = useMemo(
    () =>
      rows.map((r) => {
        const sent = r.sender_id === userId;
        const read = sent && peerReadAt !== null && new Date(r.created_at) <= new Date(peerReadAt);
        return {
          id: r.id,
          text: r.body,
          time: formatClock(r.created_at),
          sent,
          status: read ? 'read' : 'sent',
          type: r.type,
          mediaUrl: r.media_url,
          createdAt: r.created_at,
          audioDuration: r.duration_secs != null ? formatDuration(r.duration_secs) : undefined,
          audioBars: r.type === 'voice' ? barsFor(r.id) : undefined,
          translationStatus: r.translation_status,
        } satisfies Message;
      }),
    [rows, userId, peerReadAt]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, peerTyping]);

  // stop audio / mic when leaving the chat
  useEffect(() => {
    const mediaUrls = decryptedMediaUrlsRef.current;
    return () => {
      audioRef.current?.pause();
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      for (const mediaUrl of mediaUrls.values()) URL.revokeObjectURL(mediaUrl);
      mediaUrls.clear();
    };
  }, [chat.id]);

  // ---- sending ----
  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    connectSocket().emit('typing', { conversation_id: chat.id });
  };

  const sendMessage = async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');
    setShowEmojiPicker(false);
    setShowAttachmentMenu(false);
    setError(null);
    try {
      addRow(await sendText(chat.id, body, { userId: chat.otherUserId, publicKey: chat.otherPublicKey ?? null }));
    } catch (err) {
      setInput(body);
      setError(err instanceof Error ? err.message : 'Message failed to send. Check your connection and try again.');
    }
  };

  const uploadFile = async (file: File | undefined | null) => {
    if (!file || !userId) return;
    setShowAttachmentMenu(false);
    setError(null);
    setUploading(true);
    const type = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : 'file';
    try {
      addRow(
        await sendMedia({
          conversationId: chat.id,
          userId,
          blob: file,
          fileName: file.name,
          type,
          body: type === 'file' ? file.name : '',
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
    setUploading(false);
  };

  // ---- voice notes (real microphone) ----
  const startRecording = async () => {
    setShowEmojiPicker(false);
    setShowAttachmentMenu(false);
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported on this device or browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecordDuration(0);
      setIsRecording(true);
      recordTimerRef.current = setInterval(
        () => setRecordDuration(Math.floor((Date.now() - recordStartRef.current) / 1000)),
        500
      );
    } catch {
      setError('Microphone access was denied. Allow it in your browser/app settings to send voice notes.');
    }
  };

  const finishRecording = (send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    const secs = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (!send || !userId) return;
      const type = recorder.mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunksRef.current, { type });
      setUploading(true);
      try {
        addRow(
          await sendMedia({
            conversationId: chat.id,
            userId,
            blob,
            fileName: `voice.${ext}`,
            type: 'voice',
            durationSecs: secs,
          })
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send voice note.');
      }
      setUploading(false);
    };
    recorder.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setRecordDuration(0);
  };

  const toggleVoicePlayback = (msg: Message) => {
    // If translation is on for this listener and a translated voice note is ready, play that
    // instead of the original — this listener hears it spoken in their own language. Anyone
    // without translation on (or the sender) always hears the original, unaffected.
    const playUrl = translatedAudio[msg.id] || msg.mediaUrl;
    if (!playUrl) return;
    if (playingVoiceId === msg.id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(playUrl);
    audioRef.current = audio;
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => {
      setPlayingVoiceId(null);
      setError('Could not play this voice note.');
    };
    setPlayingVoiceId(msg.id);
    audio.play().catch(() => setPlayingVoiceId(null));
  };

  const toggleStar = async (messageId: string) => {
    const starred = starredIds.has(messageId);
    setUpdatingStarId(messageId);
    try {
      await setMessageStarred(messageId, !starred);
      setStarredIds((current) => {
        const next = new Set(current);
        if (starred) next.delete(messageId);
        else next.add(messageId);
        return next;
      });
    } catch {
      setError('Could not update starred message.');
    } finally {
      setUpdatingStarId(null);
    }
  };

  const archiveConversation = async () => {
    setArchiving(true);
    try {
      await setConversationArchived(chat.id, true);
      onBack();
    } catch {
      setError('Could not archive this chat.');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-paper-tint relative select-none">
      {/* Header */}
      <div className="bg-paper px-3 pt-12 pb-3 flex items-center gap-3 flex-shrink-0 shadow-md border-b border-paper-line z-20">
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-brand-50 active:scale-95 transition-all"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5 text-ink" />
        </button>

        <div className="relative">
          <img src={chat.avatar} alt={chat.name} className="w-10 h-10 rounded-full object-cover border border-paper-line" />
          {chat.online && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-brand-500 border-2 border-paper"></div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate text-ink">{chat.name}</div>
          <div className="text-[11px] text-brand-600 flex items-center gap-1">
            {peerTyping ? (
              <span className="italic animate-pulse">typing...</span>
            ) : chat.online ? (
              <span>online</span>
            ) : chat.isGroup ? (
              <span className="text-ink-mute">{chat.members} members</span>
            ) : (
              <span className="text-ink-mute">last seen recently</span>
            )}
          </div>
        </div>

        {!chat.isGroup && (
          <button
            onClick={() => setShowSafetyCode((visible) => !visible)}
            className={`p-2 rounded-full hover:bg-brand-50 transition-colors ${peerKeyStatus?.trusted ? 'text-brand-600' : 'text-amber-600'}`}
            title="Verify encryption safety code"
            aria-label="Verify encryption safety code"
          >
            <ShieldCheck className="w-5 h-5" />
          </button>
        )}

        {/* Video Call Button */}
        <button
          onClick={() => onStartCall('video')}
          className="p-2.5 rounded-full hover:bg-brand-600/10 active:scale-95 text-brand-600 transition-all"
          title="Start Video Call"
        >
          <Video className="w-5 h-5" />
        </button>

        {/* Voice Call Button */}
        <button
          onClick={() => onStartCall('voice')}
          className="p-2.5 rounded-full hover:bg-brand-600/10 active:scale-95 text-brand-600 transition-all"
          title="Start Voice Call"
        >
          <Phone className="w-5 h-5" />
        </button>

        {/* More Menu */}
        <button
          onClick={() => setShowConversationMenu((visible) => !visible)}
          className="p-2 rounded-full hover:bg-brand-50 text-ink-mute transition-colors"
          title="Conversation options"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
        {showConversationMenu && (
          <div className="absolute right-3 top-24 z-30 w-48 rounded-lg border border-paper-line bg-paper py-1 shadow-lg">
            {!chat.isGroup && (
              <button
                disabled={archiving}
                onClick={() => void archiveConversation()}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-ink hover:bg-paper-mist disabled:opacity-50"
              >
                <Archive className="h-4 w-4" /> Archive chat
              </button>
            )}
          </div>
        )}
      </div>

      {showSafetyCode && !chat.isGroup && (
        <div className="absolute left-3 right-3 top-24 z-40 rounded-xl border border-paper-line bg-paper p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Encryption safety code</h3>
              <p className="mt-1 text-xs text-ink-mute">Compare all groups with this contact over another trusted channel. Messages stay blocked until verified.</p>
            </div>
            <button onClick={() => setShowSafetyCode(false)} className="p-1 text-ink-mute" title="Close safety code">
              <X className="h-4 w-4" />
            </button>
          </div>
          {peerKeyStatus ? (
            <>
              <div className="mt-3 break-all rounded-lg bg-paper-mist p-3 font-mono text-xs leading-6 text-ink">
                {peerKeyStatus.fingerprint}
              </div>
              <div className="mt-2 text-xs font-semibold text-ink-mute">
                {peerKeyStatus.trusted ? 'Verified on this device' : 'Not verified on this device'}
              </div>
              {!peerKeyStatus.trusted && chat.otherUserId && chat.otherPublicKey && (
                <button
                  onClick={() => {
                    void trustPeerKey(chat.otherUserId!, chat.otherPublicKey!).then(() => {
                      setPeerKeyStatus((current) => current ? { ...current, trusted: true } : current);
                    }).catch(() => setError('Could not save the verified contact key.'));
                  }}
                  className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  I compared and verified this code
                </button>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs text-ink-mute">This contact has not published an encryption key.</p>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-4 py-4 space-y-2.5 wc-vine ${wallpaper === 'light' ? 'wc-vine-light' : ''}`}
      >
        <div className="text-center mb-4">
          <span className="text-[11px] font-medium text-ink-mute bg-paper/90 backdrop-blur-md px-3 py-1 rounded-full border border-paper-line">
            Text is end-to-end encrypted after key verification. Attachments and calls are not.
          </span>
        </div>

        {loadingMsgs && (
          <div className="flex justify-center py-6 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loadingMsgs && messages.length === 0 && (
          <p className="text-center text-xs text-ink-faint py-6">No messages yet. Say hello.</p>
        )}

        {messages.map((msg) => {
          const isVoice = msg.type === 'voice';
          const isPlaying = playingVoiceId === msg.id;

          return (
            <div key={msg.id} className={`flex ${msg.sent ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl shadow-sm transition-all ${msg.sent
                  ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white rounded-tr-sm'
                  : 'bg-paper text-ink border border-paper-line rounded-tl-sm'
                  }`}
              >
                {isVoice ? (
                  <div className="py-1">
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => toggleVoicePlayback(msg)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${msg.sent
                          ? 'bg-white text-brand-700 hover:scale-105 shadow-md'
                          : 'bg-brand-600 text-white hover:scale-105 shadow-md'
                          }`}
                      >
                        {isPlaying ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5 fill-current" />
                        )}
                      </button>
                      <div className="flex items-center gap-0.5 h-6">
                        {(msg.audioBars || []).map((height, idx) => (
                          <span
                            key={idx}
                            className={`w-1 rounded-full transition-all duration-300 ${msg.sent ? 'bg-white/80' : 'bg-brand-500'
                              } ${isPlaying ? 'animate-pulse' : ''}`}
                            style={{ height: `${height}px`, animationDelay: `${idx * 0.1}s` }}
                          ></span>
                        ))}
                      </div>
                      <span className="text-[11px] tabular-nums opacity-80 ml-1">{msg.audioDuration || '0:00'}</span>
                    </div>
                    {!msg.sent && (
                      <AutoVoiceTranslation
                        conversationId={chat.id}
                        messageId={msg.id}
                        sent={msg.sent}
                        onReady={(id, url) => setTranslatedAudio((prev) => ({ ...prev, [id]: url }))}
                      />
                    )}
                  </div>
                ) : msg.type === 'image' && msg.mediaUrl ? (
                  <a href={msg.mediaUrl} target="_blank" rel="noreferrer">
                    <img
                      src={msg.mediaUrl}
                      alt={msg.text || 'Photo'}
                      className="rounded-xl max-h-72 w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : msg.type === 'video' && msg.mediaUrl ? (
                  <video src={msg.mediaUrl} controls className="rounded-xl max-h-72 w-full" />
                ) : msg.type === 'file' && msg.mediaUrl ? (
                  <a
                    href={msg.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 py-1 hover:opacity-90"
                  >
                    <span className="w-9 h-9 rounded-xl bg-paper-mist flex items-center justify-center">
                      <FileText className="w-4 h-4" />
                    </span>
                    <span className="text-sm underline break-all">{msg.text || 'Document'}</span>
                  </a>
                ) : null}

                {msg.type === 'text' && (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                )}
                {(msg.type === 'image' || msg.type === 'video') && msg.text && (
                  <p className="text-sm leading-relaxed mt-1.5">{msg.text}</p>
                )}

                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[10px] opacity-60 tabular-nums">{msg.time}</span>
                  <button
                    disabled={updatingStarId === msg.id}
                    onClick={() => void toggleStar(msg.id)}
                    className={`ml-1 rounded p-0.5 disabled:opacity-50 ${starredIds.has(msg.id) ? 'text-amber-400' : 'opacity-50 hover:opacity-100'}`}
                    title={starredIds.has(msg.id) ? 'Remove star' : 'Star message'}
                  >
                    <Star className="h-3.5 w-3.5" fill={starredIds.has(msg.id) ? 'currentColor' : 'none'} />
                  </button>
                  {msg.sent &&
                    (msg.status === 'read' ? (
                      <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
                    ) : (
                      <Check className="w-3.5 h-3.5 opacity-60" />
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(error || uploading) && (
        <div
          className={`px-4 py-2 text-xs flex items-center gap-2 z-20 ${error ? 'bg-rose-500/10 text-rose-600' : 'bg-brand-600/10 text-brand-700'
            }`}
        >
          {uploading && !error && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span className="flex-1">{error ?? 'Sending...'}</span>
          {error && (
            <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Quick Emoji Reaction Bar */}
      {showEmojiPicker && (
        <div className="bg-paper border-t border-paper-line px-4 py-2 flex items-center justify-between gap-1 z-20">
          {['❤️', '😂', '🔥', '👍', '🎉', '✨', '🙏', '😭'].map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                setInput((prev) => prev + emoji);
                setShowEmojiPicker(false);
              }}
              className="text-xl p-1.5 rounded-xl hover:bg-brand-50 active:scale-125 transition-transform"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Attachment Menu Popup */}
      {showAttachmentMenu && (
        <div className="bg-paper border-t border-paper-line p-3 grid grid-cols-3 gap-2 z-20">
          <button
            onClick={() => galleryRef.current?.click()}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-paper-mist hover:bg-brand-50 text-ink text-xs font-medium"
          >
            <ImageIcon className="w-5 h-5 text-brand-600" />
            <span>Gallery</span>
          </button>
          <button
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-paper-mist hover:bg-brand-50 text-ink text-xs font-medium"
          >
            <Camera className="w-5 h-5 text-sky-600" />
            <span>Camera</span>
          </button>
          <button
            onClick={() => docRef.current?.click()}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-paper-mist hover:bg-brand-50 text-ink text-xs font-medium"
          >
            <FileText className="w-5 h-5 text-amber-600" />
            <span>Document</span>
          </button>
        </div>
      )}

      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          void uploadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void uploadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={docRef}
        type="file"
        hidden
        onChange={(e) => {
          void uploadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* A heads-up, shown before you record, not a surprise after you send: this person has
          voice translation on, so this voice note will go to them unencrypted. */}
      {/* Live Audio Recording Toolbar OR Standard Message Input */}
      {isRecording ? (
        <div className="bg-paper px-3 py-3.5 flex items-center justify-between gap-3 border-t border-paper-line z-20">
          <div className="flex items-center gap-2 text-rose-600">
            <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping"></span>
            <span className="text-xs tabular-nums font-bold tracking-wider">
              REC {formatDuration(recordDuration)}
            </span>
          </div>

          <div className="flex items-center gap-1 h-5 flex-1 justify-center max-w-[140px]">
            {[6, 14, 10, 18, 12, 16, 8, 14, 10].map((h, i) => (
              <span
                key={i}
                className="w-1 bg-rose-400 rounded-full animate-pulse"
                style={{
                  height: `${h}px`,
                  animationDelay: `${i * 0.15}s`,
                }}
              ></span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Cancel Button */}
            <button
              onClick={() => finishRecording(false)}
              className="p-2.5 rounded-full bg-paper-mist hover:bg-rose-500/10 text-ink-mute hover:text-rose-400 transition-colors"
              title="Cancel Recording"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Send Voice Note Button */}
            <button
              onClick={() => finishRecording(true)}
              className="p-2.5 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lift hover:scale-105 active:scale-95 transition-all"
              title="Send Voice Note"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-paper px-3 pt-2 pb-4 flex items-end gap-2 flex-shrink-0 border-t border-paper-line z-20">
          <button
            onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
            className={`p-2.5 rounded-full transition-colors flex-shrink-0 ${showAttachmentMenu ? 'bg-brand-600/10 text-brand-600' : 'hover:bg-brand-50 text-ink-mute'
              }`}
            title="Attach"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="flex-1 flex items-center bg-paper-mist rounded-3xl px-4 py-1 border border-paper-line focus-within:border-brand-600/30 transition-colors">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                notifyTyping();
              }}
              onKeyDown={(e) => e.key === 'Enter' && void sendMessage()}
              placeholder="Message..."
              className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint outline-none py-2"
            />
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={`p-1 rounded-full transition-colors ${showEmojiPicker ? 'text-amber-600' : 'hover:bg-brand-50 text-ink-mute'
                }`}
              title="Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>

          {input.trim() ? (
            <button
              onClick={() => void sendMessage()}
              className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95 transition-transform shadow-lift"
              title="Send Message"
            >
              <Send className="w-5 h-5 text-white" />
            </button>
          ) : (
            /* Microphone Voice Recording Button */
            <button
              onClick={() => void startRecording()}
              className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95 transition-transform shadow-lift"
              title="Record Voice Note"
            >
              <Mic className="w-5 h-5 text-white" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
