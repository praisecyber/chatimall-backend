import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone, RefreshCw, Shield } from 'lucide-react';
import { useCall } from '@/lib/calls';

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function CallOverlay() {
  const { call, localStream, remoteStream, accept, decline, hangup, toggleMute, toggleCamera, flipCamera } = useCall();
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream, call.phase]);
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream, call.phase, call.cameraOff]);
  useEffect(() => {
    if (call.phase !== 'connected') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call.phase]);

  if (call.phase === 'idle') {
    return call.notice ? (
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 max-w-[90%] px-4 py-2 rounded-xl bg-[#1a2332] border border-white/10 text-xs text-white shadow-xl text-center">
        {call.notice}
      </div>
    ) : null;
  }

  const peer = call.peer;
  const isVideo = call.type === 'video';
  const showRemoteVideo = isVideo && call.phase === 'connected';
  const showLocalPreview = isVideo && !call.cameraOff;
  const seconds = call.startedAt ? Math.max(0, Math.floor((now - call.startedAt) / 1000)) : 0;

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-between bg-gradient-to-b from-[#0e0c1f] via-[#16132e] to-[#0a0817] text-white overflow-hidden">
      {/* remote media (also carries the audio of voice calls) */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className={showRemoteVideo ? 'absolute inset-0 w-full h-full object-cover z-0' : 'hidden'}
      />
      {showRemoteVideo && <div className="absolute inset-0 z-0 bg-gradient-to-t from-black/70 via-transparent to-black/50" />}

      {showLocalPreview && (
        <div className="absolute top-16 right-4 z-20 w-24 h-36 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-gray-900">
          <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
        </div>
      )}

      <div className="relative z-10 pt-12 px-6 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-[11px] font-medium text-emerald-400 mb-4 border border-white/10">
          <Shield className="w-3 h-3" />
          <span>Encrypted in transit</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-1">{peer?.name}</h2>
        <p className="text-sm font-medium tracking-wide">
          {call.phase === 'incoming' && (
            <span className="text-emerald-400 animate-pulse">Incoming {isVideo ? 'video' : 'voice'} call…</span>
          )}
          {call.phase === 'outgoing' && <span className="text-gray-300 animate-pulse">Calling…</span>}
          {call.phase === 'connecting' && <span className="text-gray-300 animate-pulse">Connecting…</span>}
          {call.phase === 'connected' && (
            <span className="text-white/80 font-mono tracking-widest">{fmt(seconds)}</span>
          )}
        </p>
      </div>

      {!showRemoteVideo && (
        <div className="relative z-10 flex flex-col items-center justify-center my-auto">
          <div className="relative">
            <div className="absolute -inset-4 rounded-full bg-emerald-500/20 animate-ping opacity-75" />
            <div className="absolute -inset-8 rounded-full bg-emerald-500/10 animate-pulse" />
            <img
              src={peer?.avatar}
              alt={peer?.name}
              className="relative w-36 h-36 rounded-full object-cover border-4 border-emerald-400/40 shadow-2xl"
            />
          </div>
        </div>
      )}

      <div className="relative z-10 pb-10 px-6">
        {call.phase === 'incoming' ? (
          <div className="flex items-center justify-around bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-5 shadow-2xl">
            <button
              onClick={() => void decline()}
              className="flex flex-col items-center gap-1.5 text-xs text-gray-300"
            >
              <span className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 flex items-center justify-center shadow-lg shadow-rose-500/40 transition-all">
                <PhoneOff className="w-7 h-7 text-white" />
              </span>
              Decline
            </button>
            <button
              onClick={() => void accept()}
              className="flex flex-col items-center gap-1.5 text-xs text-gray-300"
            >
              <span className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 flex items-center justify-center shadow-lg shadow-emerald-500/40 transition-all">
                {isVideo ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
              </span>
              Accept
            </button>
          </div>
        ) : (
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-4 shadow-2xl">
            <div className="flex items-center justify-around mb-6">
              <button
                onClick={toggleMute}
                className={`p-3.5 rounded-2xl flex flex-col items-center gap-1.5 transition-all ${
                  call.muted
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {call.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                <span className="text-[10px] font-medium">{call.muted ? 'Muted' : 'Mute'}</span>
              </button>
              {isVideo && (
                <>
                  <button
                    onClick={toggleCamera}
                    className={`p-3.5 rounded-2xl flex flex-col items-center gap-1.5 transition-all ${
                      call.cameraOff
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {call.cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    <span className="text-[10px] font-medium">{call.cameraOff ? 'Cam off' : 'Camera'}</span>
                  </button>
                  <button
                    onClick={() => void flipCamera()}
                    className="p-3.5 rounded-2xl flex flex-col items-center gap-1.5 bg-white/10 text-white hover:bg-white/20 transition-all"
                  >
                    <RefreshCw className="w-5 h-5" />
                    <span className="text-[10px] font-medium">Flip</span>
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center justify-center">
              <button
                onClick={() => void hangup()}
                className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-500/40 transition-all"
                title={call.phase === 'outgoing' ? 'Cancel' : 'End call'}
              >
                <PhoneOff className="w-7 h-7" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
