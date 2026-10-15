import { useCallback, useEffect, useState } from 'react';
import { Phone, Video, Plus, ArrowDownLeft, ArrowUpRight, PhoneMissed, X, Loader2 } from 'lucide-react';
import type { Call, Chat } from '@/types';
import type { CallPeer } from '@/lib/calls';
import { fetchCalls, fetchChats } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';

interface CallsScreenProps {
  onStartCall: (peer: CallPeer, type: 'voice' | 'video') => void;
}

export default function CallsScreen({ onStartCall }: CallsScreenProps) {
  const { userId } = useAuth();
  const [callsList, setCallsList] = useState<Call[]>([]);
  const [contacts, setContacts] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      setCallsList(await fetchCalls());
    } catch (err) {
      console.error('Could not load calls', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    if (!userId) return;
    const socket = connectSocket();
    const refresh = () => void load();
    socket.on('call:log', refresh);
    return () => {
      socket.off('call:log', refresh);
    };
  }, [userId, load]);

  const openPicker = async () => {
    setShowPicker(true);
    try {
      setContacts(await fetchChats());
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col h-full relative select-none">
      <div className="bg-paper px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-extrabold text-ink tracking-tight">Calls</h1>
          <button
            onClick={() => void openPicker()}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 transition-all text-brand-700"
            title="New Call"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2 text-xs text-ink-faint font-semibold uppercase tracking-wide">Recent</div>
        {loading && (
          <div className="flex justify-center py-10 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && callsList.length === 0 && (
          <p className="text-center text-sm text-ink-faint px-8 py-10">
            No calls yet. Tap + to call one of your chats.
          </p>
        )}
        {callsList.map((call) => (
          <CallRow
            key={call.id}
            call={call}
            onCall={(type) => onStartCall({ id: call.otherUserId, name: call.name, avatar: call.avatar }, type)}
          />
        ))}
      </div>

      <button
        onClick={() => void openPicker()}
        className="absolute bottom-20 right-4 w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-600/25 hover:scale-105 active:scale-95 transition-transform"
        title="Start Call"
      >
        <Phone className="w-6 h-6 text-ink" />
      </button>

      {showPicker && (
        <div className="absolute inset-0 z-40 bg-ink/45 backdrop-blur-sm flex flex-col justify-end">
          <div className="bg-paper border-t border-paper-line rounded-t-3xl p-4 max-h-[80%] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-paper-line">
              <h3 className="font-bold text-base text-ink">Call someone from your chats</h3>
              <button onClick={() => setShowPicker(false)} className="p-1 rounded-full hover:bg-brand-50 text-ink-mute">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-paper-line my-2">
              {contacts.length === 0 && (
                <p className="text-sm text-ink-faint text-center py-8">
                  Start a chat first (Chats → pencil button), then you can call that person.
                </p>
              )}
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5 px-2 hover:bg-brand-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <img src={c.avatar} alt={c.name} className="w-10 h-10 rounded-full object-cover" />
                    <div className="font-semibold text-sm text-ink">{c.name}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(['voice', 'video'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setShowPicker(false);
                          if (c.otherUserId) onStartCall({ id: c.otherUserId, name: c.name, avatar: c.avatar }, t);
                        }}
                        className="p-2 rounded-full hover:bg-brand-600/10 text-brand-600 transition-colors"
                        title={t === 'voice' ? 'Voice call' : 'Video call'}
                      >
                        {t === 'voice' ? <Phone className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CallRow({ call, onCall }: { call: Call; onCall: (type: 'voice' | 'video') => void }) {
  const DirIcon = call.direction === 'incoming' ? ArrowDownLeft : call.direction === 'outgoing' ? ArrowUpRight : PhoneMissed;
  const dirColor =
    call.direction === 'missed' ? 'text-rose-600' : call.direction === 'incoming' ? 'text-brand-600' : 'text-sky-600';
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 transition-colors">
      <img src={call.avatar} alt={call.name} className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm truncate ${call.direction === 'missed' ? 'text-rose-600' : 'text-ink'}`}>
          {call.name}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <DirIcon className={`w-3.5 h-3.5 ${dirColor}`} />
          <span className="text-xs text-ink-mute truncate">{call.time}</span>
          {call.duration && <span className="text-[10px] text-ink-faint">· {call.duration}</span>}
        </div>
      </div>
      <button
        onClick={() => onCall(call.type)}
        className="p-2.5 rounded-full hover:bg-brand-600/10 active:scale-95 text-brand-600 transition-all flex-shrink-0"
        title={`Call back (${call.type})`}
      >
        {call.type === 'video' ? <Video className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
      </button>
    </div>
  );
}
