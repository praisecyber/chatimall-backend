import { useCallback, useEffect, useState } from 'react';
import { Search, MoreVertical, Pin, CheckCheck, Volume2, Edit, X, Loader2 } from 'lucide-react';
import type { Chat } from '@/types';
import { fetchChats, startDirectChat } from '@/lib/api';
import { normalizePhone } from '@/lib/format';
import { connectSocket } from '@/lib/socket';
import { APP_NAME } from '@/brand';
import BrandMark from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';

interface ChatListProps {
  onOpenChat: (chat: Chat) => void;
}

export default function ChatList({ onOpenChat }: ChatListProps) {
  const { userId } = useAuth();
  const [chatList, setChatList] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setChatList(await fetchChats());
    } catch (err) {
      console.error('Could not load chats', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    if (!userId) return;
    // refresh the list whenever a message arrives, something is read, or the connection comes back
    const socket = connectSocket();
    const refresh = () => void load();
    socket.on('message:new', refresh);
    socket.on('chat:read', refresh);
    socket.on('connect', refresh);
    const poll = setInterval(refresh, 30_000); // keeps "online" dots fresh
    return () => {
      clearInterval(poll);
      socket.off('message:new', refresh);
      socket.off('chat:read', refresh);
      socket.off('connect', refresh);
    };
  }, [userId, load]);

  const filtered = chatList.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  const pinned = filtered.filter((c) => c.pinned);
  const unpinned = filtered.filter((c) => !c.pinned);

  const startChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setStartError(null);
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      setStartError('Enter the number with country code, e.g. +15551234567');
      return;
    }
    setStarting(true);
    try {
      const cid = await startDirectChat(normalized);
      const fresh = await fetchChats();
      setChatList(fresh);
      const target = fresh.find((c) => c.id === cid);
      setShowNewChatModal(false);
      setPhoneInput('');
      if (target) onOpenChat(target);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Could not start the chat');
    }
    setStarting(false);
  };

  return (
    <div className="flex flex-col h-full relative select-none bg-paper">
      {/* Header */}
      <div className="bg-paper px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <BrandMark size={34} />
            <h1 className="text-[26px] leading-none font-extrabold text-ink tracking-tight">{APP_NAME}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewChatModal(true)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 text-brand-700 transition-all"
              title="New Chat"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-paper-mist text-ink-mute transition-colors">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
          <input
            type="text"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl bg-paper-mist text-sm text-ink placeholder-ink-faint outline-none border border-transparent focus:bg-white focus:border-brand-600/30 transition-colors"
          />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {pinned.length > 0 && (
          <>
            <div className="px-4 py-2 text-[11px] text-ink-faint font-semibold uppercase tracking-wider">
              Pinned
            </div>
            {pinned.map((chat) => (
              <ChatRow key={chat.id} chat={chat} onClick={() => onOpenChat(chat)} />
            ))}
          </>
        )}

        {unpinned.length > 0 && (
          <>
            {pinned.length > 0 && (
              <div className="px-4 py-2 text-[11px] text-ink-faint font-semibold uppercase tracking-wider">
                All Chats
              </div>
            )}
            {unpinned.map((chat) => (
              <ChatRow key={chat.id} chat={chat} onClick={() => onOpenChat(chat)} />
            ))}
          </>
        )}

        {loading && (
          <div className="flex items-center justify-center h-48 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16 text-ink-faint text-center px-10">
            <BrandMark size={56} className="mb-4 opacity-90" />
            <p className="text-sm leading-relaxed">
              {chatList.length === 0
                ? 'No chats yet. Tap the pencil button and enter a friend\'s phone number to start one.'
                : 'No chats found'}
            </p>
          </div>
        )}
      </div>

      {/* Floating action button */}
      <button
        onClick={() => setShowNewChatModal(true)}
        className="absolute bottom-20 right-4 w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lift hover:scale-105 active:scale-95 transition-transform"
        title="Start New Chat"
      >
        <Edit className="w-6 h-6 text-white" />
      </button>

      {/* New Chat Contacts Modal */}
      {showNewChatModal && (
        <div className="absolute inset-0 z-40 bg-ink/45 backdrop-blur-md flex flex-col justify-end">
          <div className="bg-paper border-t border-paper-line rounded-t-3xl p-5 max-h-[85%] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-paper-line">
              <h3 className="font-bold text-base text-ink">New Conversation</h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-1 rounded-full hover:bg-brand-50 text-ink-mute"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={startChat} className="py-4 space-y-3">
              <p className="text-xs text-ink-mute">
                Enter the phone number of someone who already has {APP_NAME}.
              </p>
              <input
                autoFocus
                type="tel"
                inputMode="tel"
                placeholder="+1 555 123 4567"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-paper-mist border border-paper-line focus:border-brand-600/30 outline-none text-ink placeholder-ink-faint text-sm"
              />
              {startError && <p className="text-xs text-rose-600">{startError}</p>}
              <button
                type="submit"
                disabled={starting}
                className="w-full py-3 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {starting && <Loader2 className="w-4 h-4 animate-spin" />} Start chat
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatRow({ chat, onClick }: { chat: Chat; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative w-full flex items-center gap-3.5 px-4 py-3 hover:bg-brand-50 active:bg-brand-100 transition-colors text-left after:content-[''] after:absolute after:left-[76px] after:right-0 after:bottom-0 after:h-px after:bg-paper-line"
    >
      <div className="relative flex-shrink-0">
        <img
          src={chat.avatar}
          alt={chat.name}
          className="w-[52px] h-[52px] rounded-full object-cover"
        />
        {chat.online && (
          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-brand-500 border-2 border-white"></div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[15px] truncate text-ink ${chat.unread > 0 ? 'font-extrabold' : 'font-semibold'}`}>{chat.name}</span>
            {chat.isGroup && (
              <span className="text-xs text-ink-faint flex-shrink-0">({chat.members})</span>
            )}
            {chat.muted && <Volume2 className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />}
          </div>
          <span className={`text-[11px] flex-shrink-0 ml-2 tabular-nums ${chat.unread > 0 ? 'text-brand-700 font-bold' : 'text-ink-mute'}`}>{chat.time}</span>
        </div>

        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 min-w-0">
            {chat.typing ? (
              <span className="text-xs text-brand-600 italic truncate animate-pulse">typing...</span>
            ) : (
              <span className={`text-[13px] truncate ${chat.unread > 0 ? 'text-ink font-semibold' : 'text-ink-mute'}`}>{chat.lastMessage}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            {chat.pinned && <Pin className="w-3.5 h-3.5 text-ink-faint" />}
            {chat.unread > 0 ? (
              <div className="min-w-[18px] h-4.5 px-1.5 rounded-full bg-brand-600 flex items-center justify-center shadow-sm">
                <span className="text-[10px] font-bold text-white">{chat.unread}</span>
              </div>
            ) : (
              <CheckCheck className="w-3.5 h-3.5 text-brand-600" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
