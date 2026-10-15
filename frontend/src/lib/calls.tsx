import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { connectSocket } from '@/lib/socket';
import { assetUrl } from '@/lib/http';
import { useAuth } from '@/lib/auth';
import { initialsAvatar } from '@/lib/format';
import { startRing } from '@/lib/ringtone';

/**
 * 1-to-1 voice & video calls over WebRTC.
 *  - Ringing / history: the Chatimall server (Socket.IO) rings the other phone and stores each call in MongoDB.
 *  - Signalling (offer / answer / ICE): relayed through the same Socket.IO connection.
 *  - Media: peer-to-peer. STUN is built in; add a TURN server (see .env.example) for phones on
 *    strict mobile networks, otherwise some calls will not connect.
 */

export interface CallPeer {
  id: string;
  name: string;
  avatar: string;
}
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected';

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  peer: CallPeer | null;
  type: 'voice' | 'video';
  muted: boolean;
  cameraOff: boolean;
  startedAt: number | null;
  notice: string | null;
}

const IDLE: CallState = {
  phase: 'idle',
  callId: null,
  peer: null,
  type: 'voice',
  muted: false,
  cameraOff: false,
  startedAt: null,
  notice: null,
};

interface IncomingPayload {
  call_id: string;
  type: 'voice' | 'video';
  caller: { id: string; name: string; phone: string | null; avatar_url: string | null };
}

interface SignalPayload {
  call_id: string;
  data: { kind: 'offer' | 'answer' | 'ice'; payload: unknown };
}

interface CallContextValue {
  call: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (peer: CallPeer, type: 'voice' | 'video') => Promise<void>;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  flipCamera: () => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turn = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turn) {
    servers.push({
      urls: turn.split(',').map((u) => u.trim()),
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [call, setCallState] = useState<CallState>(IDLE);
  const callRef = useRef<CallState>(IDLE);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const remoteSet = useRef(false);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRing = useRef<(() => void) | null>(null);
  const facing = useRef<'user' | 'environment'>('user');

  const setCall = (patch: Partial<CallState>) => {
    callRef.current = { ...callRef.current, ...patch };
    setCallState(callRef.current);
  };

  const flash = (msg: string) => {
    setCall({ ...IDLE, notice: msg });
    setTimeout(() => {
      if (callRef.current.phase === 'idle' && callRef.current.notice === msg) setCall({ notice: null });
    }, 3500);
  };

  const cleanup = (notice: string | null = null) => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    if (discTimer.current) clearTimeout(discTimer.current);
    ringTimer.current = null;
    discTimer.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pendingIce.current = [];
    remoteSet.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    if (notice) flash(notice);
    else setCall({ ...IDLE });
  };

  const send = (kind: 'offer' | 'answer' | 'ice', payload: unknown) => {
    const callId = callRef.current.callId;
    if (callId) connectSocket().emit('call:signal', { call_id: callId, data: { kind, payload } });
  };

  const endCall = async (
    notice: string | null,
    status?: 'ended' | 'canceled' | 'declined' | 'missed'
  ) => {
    const c = callRef.current;
    if (c.phase === 'idle') return;
    if (c.callId && status) connectSocket().emit('call:end', { call_id: c.callId, status });
    cleanup(notice);
  };

  const makePc = (): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    pcRef.current = pc;
    const local = localRef.current;
    local?.getTracks().forEach((t) => pc.addTrack(t, local));
    pc.onicecandidate = (e) => {
      if (e.candidate) send('ice', e.candidate.toJSON());
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        if (discTimer.current) clearTimeout(discTimer.current);
        if (callRef.current.phase !== 'connected') setCall({ phase: 'connected', startedAt: Date.now() });
      } else if (st === 'failed') {
        void apiRef.current.endCall('Connection failed. Both phones may need a TURN server.', 'ended');
      } else if (st === 'disconnected') {
        if (discTimer.current) clearTimeout(discTimer.current);
        discTimer.current = setTimeout(() => void apiRef.current.endCall('Connection lost', 'ended'), 10_000);
      }
    };
    return pc;
  };

  const flushIce = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const c of pendingIce.current) await pc.addIceCandidate(c).catch(() => { });
    pendingIce.current = [];
  };

  /* ---- signalling handlers (always reached through apiRef so they are never stale) ---- */
  const onReady = async () => {
    if (callRef.current.phase !== 'outgoing' || pcRef.current) return;
    if (ringTimer.current) clearTimeout(ringTimer.current);
    setCall({ phase: 'connecting' });
    const pc = makePc();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send('offer', { type: offer.type, sdp: offer.sdp });
  };

  const onOffer = async (offer: RTCSessionDescriptionInit) => {
    const pc = pcRef.current ?? makePc();
    await pc.setRemoteDescription(offer);
    remoteSet.current = true;
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send('answer', { type: answer.type, sdp: answer.sdp });
  };

  const onAnswer = async (answer: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(answer);
    remoteSet.current = true;
    await flushIce();
  };

  const onIce = async (cand: RTCIceCandidateInit) => {
    const pc = pcRef.current;
    if (pc && remoteSet.current) await pc.addIceCandidate(cand).catch(() => { });
    else pendingIce.current.push(cand);
  };

  const apiRef = useRef({ endCall, cleanup, onReady, onOffer, onAnswer, onIce });
  apiRef.current = { endCall, cleanup, onReady, onOffer, onAnswer, onIce };

  const getMedia = (type: 'voice' | 'video') =>
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: type === 'video' ? { facingMode: facing.current } : false,
    });

  /* ---- public actions ---- */
  const startCall = async (peer: CallPeer, type: 'voice' | 'video') => {
    if (!userId || callRef.current.phase !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      flash('Calls are not supported on this device or browser.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await getMedia(type);
    } catch {
      flash(`Allow microphone${type === 'video' ? ' and camera' : ''} access to make calls.`);
      return;
    }
    localRef.current = stream;
    setLocalStream(stream);

    const ack = await new Promise<{ call_id?: string; error?: string }>((resolve) => {
      const t = setTimeout(() => resolve({ error: 'TIMEOUT' }), 10_000);
      connectSocket().emit('call:invite', { callee_id: peer.id, type }, (res: { call_id?: string; error?: string }) => {
        clearTimeout(t);
        resolve(res ?? { error: 'SERVER' });
      });
    });
    if (!ack.call_id) {
      stream.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      setLocalStream(null);
      flash(
        ack.error === 'BUSY'
          ? 'That person is on another call.'
          : ack.error === 'NOT_ALLOWED'
            ? 'You can only call people you have chatted with.'
            : 'Could not start the call. Check your connection.'
      );
      return;
    }
    setCall({ ...IDLE, phase: 'outgoing', callId: ack.call_id, peer, type, cameraOff: type === 'voice' });
    ringTimer.current = setTimeout(() => {
      if (callRef.current.phase === 'outgoing') void apiRef.current.endCall('No answer', 'missed');
    }, 45_000);
  };

  const accept = async () => {
    const c = callRef.current;
    if (c.phase !== 'incoming' || !c.callId) return;
    if (ringTimer.current) clearTimeout(ringTimer.current);
    let stream: MediaStream;
    try {
      stream = await getMedia(c.type);
    } catch {
      await endCall(null, 'declined');
      flash(`Allow microphone${c.type === 'video' ? ' and camera' : ''} access to answer calls.`);
      return;
    }
    localRef.current = stream;
    setLocalStream(stream);
    setCall({ phase: 'connecting', cameraOff: c.type === 'voice' });
    makePc(); // ready before the caller sends its offer
    connectSocket().emit('call:accept', { call_id: c.callId });
  };

  const decline = async () => {
    await endCall(null, 'declined');
  };

  const hangup = async () => {
    const ph = callRef.current.phase;
    if (ph === 'incoming') return decline();
    if (ph === 'outgoing') return endCall(null, 'canceled');
    return endCall(null, 'ended');
  };

  const toggleMute = () => {
    const muted = !callRef.current.muted;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    setCall({ muted });
  };

  const toggleCamera = () => {
    const cameraOff = !callRef.current.cameraOff;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
    setCall({ cameraOff });
  };

  const flipCamera = async () => {
    const pc = pcRef.current;
    const local = localRef.current;
    if (callRef.current.type !== 'video' || !pc || !local) return;
    const next = facing.current === 'user' ? 'environment' : 'user';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next } });
      const track = s.getVideoTracks()[0];
      const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
      await sender?.replaceTrack(track);
      local.getVideoTracks().forEach((t) => {
        t.stop();
        local.removeTrack(t);
      });
      local.addTrack(track);
      facing.current = next;
      setLocalStream(new MediaStream(local.getTracks()));
    } catch {
      /* device has only one camera */
    }
  };

  /* ---- ringing sounds ---- */
  useEffect(() => {
    stopRing.current?.();
    stopRing.current = null;
    if (call.phase === 'incoming') stopRing.current = startRing('incoming');
    else if (call.phase === 'outgoing') stopRing.current = startRing('outgoing');
    return () => {
      stopRing.current?.();
      stopRing.current = null;
    };
  }, [call.phase]);

  /* ---- realtime call events from the server ---- */
  useEffect(() => {
    if (!userId) return;
    const socket = connectSocket();

    const onIncoming = (p: IncomingPayload) => {
      if (callRef.current.phase !== 'idle') {
        socket.emit('call:end', { call_id: p.call_id, status: 'declined' }); // already on another call
        return;
      }
      const name = p.caller.name || (p.caller.phone ? `+${p.caller.phone}` : 'Unknown');
      setCall({
        ...IDLE,
        phase: 'incoming',
        callId: p.call_id,
        type: p.type,
        peer: {
          id: p.caller.id,
          name,
          avatar: assetUrl(p.caller.avatar_url) || initialsAvatar(p.caller.name ?? '', p.caller.phone ?? ''),
        },
      });
      ringTimer.current = setTimeout(() => {
        if (callRef.current.phase === 'incoming' && callRef.current.callId === p.call_id) apiRef.current.cleanup(null);
      }, 65_000);
    };

    const onAccepted = (p: { call_id: string }) => {
      if (p.call_id === callRef.current.callId) void apiRef.current.onReady();
    };

    const onSignal = (p: SignalPayload) => {
      if (p.call_id !== callRef.current.callId) return;
      const { kind, payload } = p.data;
      if (kind === 'offer') void apiRef.current.onOffer(payload as RTCSessionDescriptionInit);
      else if (kind === 'answer') void apiRef.current.onAnswer(payload as RTCSessionDescriptionInit);
      else if (kind === 'ice') void apiRef.current.onIce(payload as RTCIceCandidateInit);
    };

    const onEnded = (p: { call_id: string; status: string }) => {
      const c = callRef.current;
      if (p.call_id !== c.callId) return;
      if (c.phase === 'incoming' && (p.status === 'canceled' || p.status === 'missed')) apiRef.current.cleanup('Missed call');
      else if (c.phase === 'outgoing' && p.status === 'declined') apiRef.current.cleanup('Call declined');
      else apiRef.current.cleanup('Call ended');
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => () => apiRef.current.cleanup(null), []);

  const value = useMemo<CallContextValue>(
    () => ({ call, localStream, remoteStream, startCall, accept, decline, hangup, toggleMute, toggleCamera, flipCamera }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call, localStream, remoteStream, userId]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>');
  return ctx;
}
