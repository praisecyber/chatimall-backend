import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, MessageCircle, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import type { Chat, Listing } from '@/types';
import {
  createListing,
  deleteListing,
  fetchChannels,
  fetchChats,
  fetchGroups,
  fetchMarketplace,
  requestToBuy,
  sendText,
} from '@/lib/api';
import { formatChatTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';

interface Props {
  onOpenChat: (chat: Chat) => void;
}

interface RoomOption {
  id: string;
  name: string;
}

export default function MarketplaceScreen({ onOpenChat }: Props) {
  const { userId } = useAuth();
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const [showSell, setShowSell] = useState(false);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [room, setRoom] = useState<RoomOption | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  };

  const load = useCallback(async () => {
    try {
      setItems(await fetchMarketplace());
    } catch (err) {
      console.error('Could not load the marketplace', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSell = async () => {
    setError(null);
    setRoom(null);
    setShowSell(true);
    try {
      const [groups, channels] = await Promise.all([fetchGroups(), fetchChannels()]);
      setRooms([
        ...groups.map((g) => ({ id: g.id, name: g.name })),
        ...channels
          .filter((c) => c.gistRoomId && (c.isOwner || c.isSubscribed))
          .map((c) => ({ id: c.gistRoomId as string, name: `${c.name} · Gist Room` })),
      ]);
    } catch {
      setError('Could not load your rooms.');
    }
  };

  const post = async () => {
    if (!room) return setError('Choose a room to list it in.');
    if (title.trim().length < 2) return setError('Give it a short title.');
    setPosting(true);
    setError(null);
    try {
      await createListing(room.id, { title: title.trim(), description: description.trim(), price: price.trim(), file: file ?? undefined });
      setTitle('');
      setPrice('');
      setDescription('');
      setFile(null);
      setShowSell(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list it.');
    }
    setPosting(false);
  };

  // Connect to the seller: open (or reuse) a private chat and drop in a starter message.
  // No money moves through the app — the buyer and seller settle it between themselves.
  const ask = async (l: Listing) => {
    setConnecting(l.id);
    try {
      const { conversationId, starterMessage } = await requestToBuy(l.id);
      await sendText(conversationId, starterMessage);
      const chats = await fetchChats();
      const chat = chats.find((c) => c.id === conversationId);
      if (chat) onOpenChat(chat);
      else flash('Chat opened. Find it in your Chats tab.');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not reach the seller.');
    }
    setConnecting(null);
  };

  const remove = async (l: Listing) => {
    try {
      await deleteListing(l.id);
      setItems((prev) => prev.filter((x) => x.id !== l.id));
    } catch {
      flash('Could not remove it.');
    }
  };

  return (
    <div className="flex flex-col h-full relative select-none bg-paper">
      {toast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[60] max-w-[90%] px-4 py-2 rounded-xl bg-ink text-white text-xs font-semibold shadow-xl text-center">
          {toast}
        </div>
      )}

      <div className="bg-paper px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-extrabold text-ink tracking-tight">Marketplace</h1>
          <button
            onClick={() => void openSell()}
            className="h-10 px-3.5 flex items-center gap-1.5 rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 text-brand-700 text-xs font-bold transition-all"
          >
            <Plus className="w-4 h-4" /> Sell
          </button>
        </div>
        <p className="text-[11px] text-ink-mute mt-1">
          Things your groups and channels are selling. We only connect you — you pay the seller directly, never through the app.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-10 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-center py-14 px-8">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center mb-3">
              <ShoppingBag className="w-7 h-7" />
            </div>
            <p className="font-bold text-ink">Nothing for sale yet</p>
            <p className="text-xs text-ink-mute mt-1">Tap Sell to list something in one of your groups or Gist Rooms.</p>
          </div>
        )}
        {items.map((l) => {
          const mine = l.sellerId === userId;
          return (
            <div key={l.id} className="rounded-2xl bg-white ring-1 ring-black/[0.05] shadow-soft overflow-hidden">
              {l.photoUrl && <img src={l.photoUrl} alt={l.title} className="w-full max-h-56 object-cover" loading="lazy" />}
              <div className="p-3.5 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-[15px] text-ink leading-snug">{l.title}</h3>
                  {l.price && <span className="text-sm font-extrabold text-brand-700 flex-shrink-0">{l.price}</span>}
                </div>
                {l.description && <p className="text-[13px] text-ink-mute leading-relaxed">{l.description}</p>}
                <div className="flex items-center justify-between pt-1.5">
                  <span className="text-[11px] text-ink-faint">{formatChatTime(l.createdAt)}</span>
                  {mine ? (
                    <button onClick={() => void remove(l)} className="flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-700">
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => void ask(l)}
                      disabled={connecting === l.id}
                      className="px-3.5 py-2 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60 shadow-lift"
                    >
                      {connecting === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                      Message seller
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showSell && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl p-5 shadow-2xl max-h-[88%] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-paper-line">
              <h3 className="font-bold text-base text-ink">List something for sale</h3>
              <button onClick={() => setShowSell(false)} className="p-1 rounded-full hover:bg-paper-mist text-ink-mute">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-ink-soft">Where should it show up?</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {rooms.length === 0 && <p className="text-xs text-ink-faint">Join or create a group first, then you can list things in it.</p>}
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRoom(r)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        room?.id === r.id ? 'bg-brand-600 text-white border-brand-600' : 'bg-paper-mist text-ink-soft border-transparent hover:bg-brand-50'
                      }`}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                placeholder="What are you selling?"
                className="w-full px-3.5 py-3 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 text-sm text-ink outline-none transition-colors"
              />
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                maxLength={40}
                placeholder="Price (for example ₦15,000)"
                className="w-full px-3.5 py-3 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 text-sm text-ink outline-none transition-colors"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Describe it: condition, size, where to collect..."
                className="w-full p-3.5 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 text-sm text-ink outline-none resize-none transition-colors"
              />
              {file && (
                <div className="flex items-center justify-between text-xs text-brand-700 bg-brand-50 rounded-xl px-3 py-2">
                  <span className="truncate">{file.name}</span>
                  <button onClick={() => setFile(null)} className="text-ink-mute hover:text-ink ml-2">
                    Remove
                  </button>
                </div>
              )}
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-paper-mist hover:bg-brand-50 text-xs text-ink font-semibold"
                >
                  <ImageIcon className="w-4 h-4 text-brand-600" /> Photo
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <button
                  onClick={() => void post()}
                  disabled={posting}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white font-bold text-xs disabled:opacity-50 flex items-center gap-2 shadow-lift"
                >
                  {posting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} List it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
