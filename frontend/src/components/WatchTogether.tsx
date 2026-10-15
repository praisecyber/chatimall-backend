import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Tv, X } from 'lucide-react';
import type { WatchSession } from '@/types';
import { connectSocket } from '@/lib/socket';
import { fetchWatchSession, mapWatch, queueWatchVideo, sendWatchState, stopWatchTogether } from '@/lib/api';
import type { WatchSessionDb } from '@/lib/api';

/**
 * Watch Together: one shared video per room, kept in step for everyone.
 *  - YouTube uses the official IFrame Player API (loaded on demand).
 *  - TikTok uses TikTok's official embed player, controlled with postMessage.
 * Both sit behind the same tiny controller ({ play, pause, seek, time }) so the sync logic is written once.
 */

interface Controller {
  play: () => void;
  pause: () => void;
  seek: (secs: number) => void;
  time: () => number;
  destroy: () => void;
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  destroy: () => void;
}
interface YTApi {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
    }
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytLoading: Promise<YTApi> | null = null;
function loadYouTubeApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytLoading) {
    ytLoading = new Promise<YTApi>((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        if (window.YT) resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => reject(new Error('Could not load YouTube'));
      document.head.appendChild(tag);
    });
  }
  return ytLoading;
}

/** Estimate where the shared playhead is right now, from the last snapshot the server saved. */
function livePosition(s: WatchSession): number {
  if (!s.playing) return s.positionSecs;
  return s.positionSecs + (Date.now() - new Date(s.updatedAt).getTime()) / 1000;
}

interface Props {
  roomId: string;
  onClose: () => void;
}

export default function WatchTogether({ roomId, onClose }: Props) {
  const [session, setSession] = useState<WatchSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsTap, setNeedsTap] = useState(false); // phones block sound until the first tap
  const [ready, setReady] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<Controller | null>(null);
  const sessionRef = useRef<WatchSession | null>(null);
  const remoteUntil = useRef(0); // while now < this, ignore player events — we caused them ourselves
  const lastTime = useRef(0);

  sessionRef.current = session;

  const applyingRemote = () => Date.now() < remoteUntil.current;
  const markRemote = () => {
    remoteUntil.current = Date.now() + 1200;
  };

  const broadcast = useCallback(
    (playing: boolean, position: number) => {
      void sendWatchState(roomId, playing, position).catch(() => {});
    },
    [roomId]
  );

  // ---- load what's playing, and listen for the room changing it ----
  useEffect(() => {
    let cancelled = false;
    void fetchWatchSession(roomId)
      .then((s) => !cancelled && setSession(s))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));

    const socket = connectSocket();
    const onSet = (p: { conversation_id: string; session: WatchSessionDb | null }) => {
      if (p.conversation_id !== roomId) return;
      setNeedsTap(false);
      setSession(p.session ? mapWatch(p.session) : null);
    };
    const onState = (p: { conversation_id: string; playing: boolean; position_secs: number }) => {
      if (p.conversation_id !== roomId) return;
      const c = ctrlRef.current;
      if (!c) return;
      markRemote();
      if (Math.abs(c.time() - p.position_secs) > 1.5) c.seek(p.position_secs);
      if (p.playing) c.play();
      else c.pause();
    };
    socket.on('watch:set', onSet);
    socket.on('watch:state', onState);
    return () => {
      cancelled = true;
      socket.off('watch:set', onSet);
      socket.off('watch:state', onState);
    };
  }, [roomId]);

  // ---- (re)build the player whenever the video changes ----
  const videoKey = session ? `${session.platform}:${session.videoId}` : null;
  useEffect(() => {
    ctrlRef.current?.destroy();
    ctrlRef.current = null;
    setReady(false);
    const host = hostRef.current;
    const s = sessionRef.current;
    if (!host || !s) return;
    host.innerHTML = '';
    let dead = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const onReady = (c: Controller) => {
      if (dead) return;
      ctrlRef.current = c;
      setReady(true);
      const start = livePosition(s);
      markRemote();
      if (start > 1) c.seek(start);
      // Browsers on phones refuse to start with sound until someone taps once.
      setNeedsTap(true);
    };

    if (s.platform === 'youtube') {
      const mount = document.createElement('div');
      host.appendChild(mount);
      loadYouTubeApi()
        .then((YT) => {
          if (dead) return;
          const player = new YT.Player(mount, {
            videoId: s.videoId,
            playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
            events: {
              onReady: () =>
                onReady({
                  play: () => player.playVideo(),
                  pause: () => player.pauseVideo(),
                  seek: (t) => player.seekTo(t, true),
                  time: () => player.getCurrentTime(),
                  destroy: () => player.destroy(),
                }),
              onStateChange: (e) => {
                if (applyingRemote()) return;
                // 1 = playing, 2 = paused
                if (e.data === 1) broadcast(true, player.getCurrentTime());
                else if (e.data === 2) broadcast(false, player.getCurrentTime());
              },
            },
          });
          // YouTube has no "seeked" event, so notice a sudden jump in the playhead instead.
          poll = setInterval(() => {
            const t = player.getCurrentTime?.();
            if (typeof t !== 'number') return;
            if (!applyingRemote() && Math.abs(t - lastTime.current) > 2.5) broadcast(true, t);
            lastTime.current = t;
          }, 1000);
        })
        .catch(() => setError('Could not load the YouTube player.'));
    } else {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.tiktok.com/player/v1/${s.videoId}?controls=1&progress_bar=1&play_button=1&fullscreen_button=1`;
      iframe.allow = 'fullscreen; autoplay';
      iframe.className = 'w-full h-full border-0';
      host.appendChild(iframe);
      let current = 0;
      const send = (type: string, value?: number) =>
        iframe.contentWindow?.postMessage({ 'x-tiktok-player': true, type, ...(value !== undefined ? { value } : {}) }, '*');
      const onMsg = (ev: MessageEvent) => {
        if (ev.source !== iframe.contentWindow) return;
        const d = ev.data as { 'x-tiktok-player'?: boolean; type?: string; value?: unknown } | null;
        if (!d || !d['x-tiktok-player']) return;
        if (d.type === 'onPlayerReady') {
          onReady({
            play: () => send('play'),
            pause: () => send('pause'),
            seek: (t) => send('seekTo', t),
            time: () => current,
            destroy: () => window.removeEventListener('message', onMsg),
          });
        } else if (d.type === 'onCurrentTime') {
          const v = d.value as { currentTime?: number } | number;
          current = typeof v === 'number' ? v : v?.currentTime ?? current;
        } else if (d.type === 'onStateChange' && !applyingRemote()) {
          if (d.value === 1) broadcast(true, current);
          else if (d.value === 2) broadcast(false, current);
        }
      };
      window.addEventListener('message', onMsg);
    }

    return () => {
      dead = true;
      if (poll) clearInterval(poll);
      ctrlRef.current?.destroy();
      ctrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKey, broadcast]);

  const queue = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await queueWatchVideo(roomId, url.trim()));
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that video.');
    }
    setBusy(false);
  };

  const startWithSound = () => {
    const c = ctrlRef.current;
    const s = sessionRef.current;
    if (!c || !s) return;
    setNeedsTap(false);
    markRemote();
    const pos = livePosition(s);
    if (Math.abs(c.time() - pos) > 1.5) c.seek(pos);
    if (s.playing) c.play();
  };

  const stop = async () => {
    try {
      await stopWatchTogether(roomId);
    } catch {
      setError('Could not stop it right now.');
    }
  };

  return (
    <div className="absolute inset-0 z-40 bg-paper flex flex-col">
      <div className="px-4 pt-12 pb-3 flex items-center gap-3 border-b border-paper-line flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center">
          <Tv className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="font-bold text-sm text-ink">Watch Together</div>
          <div className="text-[11px] text-ink-mute">Everyone in this room sees the same video, in step.</div>
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-paper-mist text-ink-mute" title="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="flex justify-center py-10 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {session && (
          <div className="space-y-3">
            <div
              className={`relative w-full rounded-2xl overflow-hidden bg-black mx-auto ${
                session.platform === 'tiktok' ? 'aspect-[9/16] max-h-[62vh] max-w-[360px]' : 'aspect-video'
              }`}
            >
              <div ref={hostRef} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full [&>div]:w-full [&>div]:h-full" />
              {ready && needsTap && (
                <button
                  onClick={startWithSound}
                  className="absolute inset-0 z-10 bg-black/55 flex flex-col items-center justify-center gap-2 text-white"
                >
                  <span className="w-14 h-14 rounded-full bg-brand-600 flex items-center justify-center shadow-lift">
                    <Play className="w-6 h-6 fill-white" />
                  </span>
                  <span className="text-sm font-bold">Tap to join with sound</span>
                  <span className="text-[11px] text-white/70">Your phone needs one tap before it can play sound.</span>
                </button>
              )}
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center text-white/70 pointer-events-none">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink-mute">
              <span>
                Playing from {session.platform === 'tiktok' ? 'TikTok' : 'YouTube'}. Play, pause or skip and everyone follows.
              </span>
              <button onClick={() => void stop()} className="font-bold text-rose-600 hover:text-rose-700 ml-3 flex-shrink-0">
                Stop for everyone
              </button>
            </div>
          </div>
        )}

        {!loading && !session && (
          <div className="text-center py-6 space-y-1">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center mb-2">
              <Tv className="w-7 h-7" />
            </div>
            <p className="font-bold text-ink">Nothing playing yet</p>
            <p className="text-xs text-ink-mute px-6">Paste a public TikTok or YouTube link below and the whole room starts watching it together.</p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-bold text-ink-soft">{session ? 'Change the video' : 'Pick a video'}</label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void queue()}
              placeholder="Paste a TikTok or YouTube link"
              className="flex-1 px-3.5 py-3 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 text-sm text-ink outline-none transition-colors"
            />
            <button
              onClick={() => void queue()}
              disabled={busy}
              className="px-4 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-lift"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Watch
            </button>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <p className="text-[11px] text-ink-faint">
            Only public videos work. Private or age-restricted TikToks can not be embedded, for anyone.
          </p>
        </div>
      </div>
    </div>
  );
}
