import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Plus, Users, ArrowLeft, X, Send, Image as ImageIcon, Loader2, MessagesSquare } from 'lucide-react';
import type { Channel, ChannelPost, Group } from '@/types';
import {
  createChannel,
  fetchChannelPosts,
  fetchChannels,
  mapPost,
  postToChannel,
  setFollowing,
} from '@/lib/api';
import { formatChatTime } from '@/lib/format';
import { connectSocket } from '@/lib/socket';
import { useAuth } from '@/lib/auth';

export default function ChannelsScreen({ onOpenGroup }: { onOpenGroup: (group: Group) => void }) {
  const { userId } = useAuth();
  const [list, setList] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await fetchChannels());
    } catch (err) {
      console.error('Could not load channels', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = list.find((c) => c.id === openId) ?? null;
  const filtered = list.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const toggleFollow = async (c: Channel) => {
    if (!userId) return;
    setList((prev) =>
      prev.map((x) =>
        x.id === c.id ? { ...x, isSubscribed: !c.isSubscribed, subscribers: x.subscribers + (c.isSubscribed ? -1 : 1) } : x
      )
    );
    try {
      await setFollowing(c.id, userId, !c.isSubscribed);
    } catch {
      void load();
    }
  };

  const create = async () => {
    if (name.trim().length < 2) {
      setFormError('Channel name must be at least 2 characters.');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      await createChannel(name.trim(), desc.trim());
      setName('');
      setDesc('');
      setShowCreate(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create channel');
    }
    setCreating(false);
  };

  if (active) {
    return (
      <ChannelView
        channel={active}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
        onToggleFollow={() => void toggleFollow(active)}
        onOpenGroup={onOpenGroup}
      />
    );
  }

  return (
    <div className="flex flex-col h-full relative select-none">
      <div className="bg-paper px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-[26px] font-extrabold text-ink tracking-tight">Channels</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 text-brand-700 transition-all"
            title="Create Channel"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full pl-10 pr-4 py-3 rounded-2xl bg-paper-mist text-sm text-ink placeholder-ink-faint outline-none border border-transparent focus:bg-white focus:border-brand-600/30 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-10 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-center text-sm text-ink-faint px-8 py-10">
            {list.length === 0 ? 'No channels yet. Create the first one!' : 'No channels found'}
          </p>
        )}
        {filtered.map((c) => (
          <div key={c.id} className="w-full flex items-start gap-3 px-4 py-3 hover:bg-brand-50 border-b border-paper-line cursor-pointer">
            <img src={c.avatar} alt="" onClick={() => setOpenId(c.id)} className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
            <div className="flex-1 min-w-0" onClick={() => setOpenId(c.id)}>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm truncate text-ink">{c.name}</span>
                <span className="text-[10px] text-ink-faint ml-auto flex-shrink-0">{c.time}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-ink-mute">
                <Users className="w-3.5 h-3.5 text-ink-faint" />
                {c.subscribers.toLocaleString()} subscriber{c.subscribers === 1 ? '' : 's'}
              </div>
              <div className="text-xs text-ink-soft truncate mt-1">{c.lastMessage}</div>
            </div>
            {!c.isOwner && (
              <button
                onClick={() => void toggleFollow(c)}
                className={`px-3 py-1 rounded-full text-xs font-semibold ml-1 flex-shrink-0 ${
                  c.isSubscribed ? 'bg-paper-mist text-ink-mute' : 'bg-brand-600/10 text-brand-600 border border-brand-600/30'
                }`}
              >
                {c.isSubscribed ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="absolute inset-0 z-40 bg-ink/45 backdrop-blur-md flex flex-col justify-end">
          <div className="bg-paper border-t border-paper-line rounded-t-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-paper-line">
              <h3 className="font-bold text-base text-ink">Create a Channel</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded-full hover:bg-brand-50 text-ink-mute">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 space-y-3">
              <input
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="Channel name"
                className="w-full px-3 py-2.5 rounded-xl bg-paper-mist border border-paper-line text-ink text-sm outline-none focus:border-emerald-400"
              />
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="What will you share here?"
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl bg-paper-mist border border-paper-line text-ink text-sm outline-none focus:border-emerald-400 resize-none"
              />
              {formError && <p className="text-xs text-rose-600">{formError}</p>}
              <button
                onClick={() => void create()}
                disabled={creating}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create Channel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelView({
  channel,
  onBack,
  onToggleFollow,
  onOpenGroup,
}: {
  channel: Channel;
  onBack: () => void;
  onToggleFollow: () => void;
  onOpenGroup: (group: Group) => void;
}) {
  const { userId } = useAuth();
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const add = useCallback((p: ChannelPost) => {
    setPosts((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p].sort((a, b) => a.created_at.localeCompare(b.created_at))));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchChannelPosts(channel.id)
      .then((p) => !cancelled && setPosts(p))
      .catch(() => !cancelled && setError('Could not load posts'));
    const socket = connectSocket();
    const join = () => socket.emit('channel:join', channel.id);
    const onPost = (p: ChannelPost) => {
      if (p.channel_id === channel.id) add(mapPost(p));
    };
    join();
    socket.on('connect', join); // re-join after a reconnect
    socket.on('channel:post', onPost);
    return () => {
      cancelled = true;
      socket.off('connect', join);
      socket.off('channel:post', onPost);
      socket.emit('channel:leave', channel.id);
    };
  }, [channel.id, add]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [posts.length]);

  const publish = async (file?: File) => {
    if (!userId || (!file && !text.trim())) return;
    setSending(true);
    setError(null);
    try {
      add(await postToChannel({ channelId: channel.id, userId, body: text.trim(), file }));
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post');
    }
    setSending(false);
  };

  return (
    <div className="flex flex-col h-full bg-paper-tint relative select-none">
      <div className="bg-paper px-3 pt-12 pb-3 flex items-center gap-3 border-b border-paper-line">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-brand-50 text-ink">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <img src={channel.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-ink truncate">{channel.name}</div>
          <div className="text-[11px] text-ink-mute">
            {channel.subscribers.toLocaleString()} subscriber{channel.subscribers === 1 ? '' : 's'}
          </div>
        </div>
        {(channel.isOwner || channel.isSubscribed) && channel.gistRoomId && (
          <button
            onClick={() =>
              onOpenGroup({
                id: channel.gistRoomId as string,
                name: channel.name,
                avatar_url: channel.avatar,
                owner_id: '',
                is_owner: channel.isOwner,
                is_admin: channel.isOwner,
                member_count: channel.subscribers,
                is_gist_room: true,
                channel_id: channel.id,
                last_message_at: new Date().toISOString(),
                last_message_preview: '',
                anonymous: { active: false, expires_at: null, vote: null },
              })
            }
            className="w-9 h-9 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 text-brand-700 flex-shrink-0"
            title="Gist Room"
          >
            <MessagesSquare className="w-4 h-4" />
          </button>
        )}
        {!channel.isOwner && (
          <button
            onClick={onToggleFollow}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex-shrink-0 ${
              channel.isSubscribed ? 'bg-paper-mist text-ink-soft' : 'bg-brand-600 text-white'
            }`}
          >
            {channel.isSubscribed ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {channel.description && (
          <div className="p-3 rounded-2xl bg-paper border border-paper-line text-xs text-ink-soft">{channel.description}</div>
        )}
        {posts.length === 0 && <p className="text-center text-xs text-ink-faint py-6">No posts yet.</p>}
        {posts.map((p) => (
          <div key={p.id} className="p-3 rounded-2xl bg-paper border border-paper-line space-y-2">
            {p.type === 'image' && p.media_url && (
              <img src={p.media_url} alt="" className="rounded-xl max-h-72 w-full object-cover" loading="lazy" />
            )}
            {p.body && <p className="text-sm text-ink-soft whitespace-pre-wrap break-words">{p.body}</p>}
            <div className="text-[10px] text-ink-faint text-right">{formatChatTime(p.created_at)}</div>
          </div>
        ))}
      </div>

      {error && <div className="px-4 py-2 text-xs bg-rose-500/10 text-rose-600">{error}</div>}

      {channel.isOwner ? (
        <div className="p-3 bg-paper border-t border-paper-line flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-full hover:bg-brand-50 text-ink-mute">
            <ImageIcon className="w-5 h-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void publish(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void publish()}
            placeholder="Broadcast to your followers..."
            className="flex-1 bg-paper-mist rounded-full px-4 py-2.5 text-sm text-ink placeholder-ink-faint outline-none border border-paper-line"
          />
          <button
            onClick={() => void publish()}
            disabled={sending}
            className="p-2.5 rounded-full bg-brand-600 text-white disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <div className="p-3 bg-paper text-center text-xs text-ink-mute border-t border-paper-line">
          This channel is a one-way broadcast. Only the owner can post.
        </div>
      )}
    </div>
  );
}
