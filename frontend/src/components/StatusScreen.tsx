import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Plus, X, Send, Trash2, Eye, Loader2, Image as ImageIcon, EyeOff, Users, Radio } from 'lucide-react';
import type { Group, Channel } from '@/types';
import {
  deleteStatus,
  fetchStatusFeed,
  fetchGroupStatusFeed,
  fetchChannelStatusFeed,
  fetchGroups,
  fetchChannels,
  markStatusViewed,
  postStatus,
  postGroupStatus,
  postChannelStatus,
  sendText,
  startDirectChat,
} from '@/lib/api';
import { formatChatTime, initialsAvatar } from '@/lib/format';
import { useAuth } from '@/lib/auth';

const BG: Record<string, string> = {
  emerald: 'from-emerald-700 to-teal-900',
  indigo: 'from-indigo-700 to-purple-900',
  rose: 'from-rose-600 to-orange-800',
  sky: 'from-sky-600 to-blue-900',
};
const STORY_MS = 5000;

/** A status item plus who it belongs to — the shape every feed (personal / group / channel) gets flattened into. */
interface StatusItem {
  id: string;
  type: 'text' | 'image';
  body: string;
  mediaUrl: string | null;
  bg: string;
  createdAt: string;
  viewed: boolean;
  viewCount?: number;
  anonymous: boolean;
  postedBy: string | null;
}
interface Entry {
  id: string;
  kind: 'user' | 'group' | 'channel';
  name: string;
  avatar: string;
  phone: string | null; // only set for kind === 'user' — needed to reply via a direct chat
  isMine: boolean; // "this is my own personal Status row" — only true for kind === 'user'
  items: StatusItem[];
  allViewed: boolean;
}

const isWeekend = () => [0, 6].includes(new Date().getDay());

export default function StatusScreen() {
  const { userId, profile } = useAuth();
  const [category, setCategory] = useState<'status' | 'groups' | 'channels'>('status');
  const [personal, setPersonal] = useState<Entry[]>([]);
  const [groupFeed, setGroupFeed] = useState<Entry[]>([]);
  const [channelFeed, setChannelFeed] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<{ entry: Entry; index: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState<false | 'status' | 'groups' | 'channels'>(false);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [pickerList, setPickerList] = useState<(Group | Channel)[]>([]);
  const [text, setText] = useState('');
  const [bg, setBg] = useState('emerald');
  const [file, setFile] = useState<File | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [feed, groups, channels] = await Promise.all([
        fetchStatusFeed(userId),
        fetchGroupStatusFeed(),
        fetchChannelStatusFeed(),
      ]);
      setPersonal(
        feed.map((g) => ({
          id: g.userId,
          kind: 'user',
          name: g.name,
          phone: g.phone,
          avatar: g.avatar,
          isMine: g.isMine,
          items: g.items,
          allViewed: g.allViewed,
        }))
      );
      setGroupFeed(
        groups.map((g) => ({ id: g.groupId, kind: 'group', name: g.name, avatar: g.avatar, phone: null, isMine: false, items: g.items, allViewed: g.allViewed }))
      );
      setChannelFeed(
        channels.map((c) => ({ id: c.channelId, kind: 'channel', name: c.name, avatar: c.avatar, phone: null, isMine: false, items: c.items, allViewed: c.allViewed }))
      );
    } catch (err) {
      console.error('Could not load statuses', err);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const mine = personal.find((g) => g.isMine);
  const feedFor = category === 'status' ? personal.filter((g) => !g.isMine) : category === 'groups' ? groupFeed : channelFeed;
  const recent = feedFor.filter((g) => !g.allViewed);
  const seen = feedFor.filter((g) => g.allViewed);

  const open = (entry: Entry) => {
    const first = entry.items.findIndex((i) => !i.viewed);
    setActive({ entry, index: first >= 0 && !entry.isMine ? first : 0 });
  };

  const close = useCallback(() => {
    setActive(null);
    setReply('');
    void load();
  }, [load]);

  const current = active ? active.entry.items[active.index] : null;
  useEffect(() => {
    if (!active || !current) return;
    setProgress(0);
    if (current.postedBy !== userId) void markStatusViewed(current.id);
    const started = Date.now();
    const timer = setInterval(() => {
      const pct = ((Date.now() - started) / STORY_MS) * 100;
      if (pct >= 100) {
        clearInterval(timer);
        if (active.index + 1 < active.entry.items.length) setActive({ entry: active.entry, index: active.index + 1 });
        else close();
      } else setProgress(pct);
    }, 100);
    return () => clearInterval(timer);
  }, [active?.entry.id, active?.index, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openComposer = async (cat: 'status' | 'groups' | 'channels') => {
    setError(null);
    setTarget(null);
    setAnonymous(false);
    if (cat === 'groups') setPickerList(await fetchGroups());
    else if (cat === 'channels') setPickerList((await fetchChannels()).filter((c) => c.isOwner || c.isSubscribed));
    setShowAdd(cat);
  };

  const post = async () => {
    if (!userId) return;
    if (!file && !text.trim()) {
      setError('Write something or pick a photo.');
      return;
    }
    if ((showAdd === 'groups' || showAdd === 'channels') && !target) {
      setError(showAdd === 'groups' ? 'Choose a group first.' : 'Choose a channel first.');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const opts = { type: (file ? 'image' : 'text') as 'image' | 'text', body: text.trim(), bg, file: file ?? undefined };
      if (showAdd === 'groups' && target) await postGroupStatus({ ...opts, groupId: target.id, anonymous });
      else if (showAdd === 'channels' && target) await postChannelStatus({ ...opts, channelId: target.id, anonymous });
      else await postStatus({ userId, ...opts });
      setText('');
      setFile(null);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post status');
    }
    setPosting(false);
  };

  const remove = async (id: string) => {
    try {
      await deleteStatus(id);
      close();
    } catch {
      flash('Could not delete');
    }
  };

  const sendReply = async () => {
    if (!active || !current || !reply.trim() || active.entry.kind !== 'user' || !active.entry.phone) return;
    try {
      const cid = await startDirectChat(`+${active.entry.phone}`);
      const quoted = current.body ? `"${current.body.slice(0, 60)}"` : 'your photo';
      await sendText(cid, `Replying to your status (${quoted}):\n${reply.trim()}`);
      setReply('');
      flash('Reply sent');
      close();
    } catch {
      flash('Could not send reply');
    }
  };

  const TabButton = ({ id, label, icon: Icon }: { id: typeof category; label: string; icon: typeof Users }) => (
    <button
      onClick={() => setCategory(id)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition-colors ${
        category === id ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-mute hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full relative select-none bg-paper">
      {toast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold shadow-xl">
          {toast}
        </div>
      )}

      <div className="bg-paper px-4 pt-12 pb-3 flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-extrabold text-ink tracking-tight">Status</h1>
          <button
            onClick={() => void openComposer(category)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 text-brand-700 transition-all"
            title="Add"
          >
            <Camera className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-1 bg-paper-mist p-1 rounded-2xl">
          <TabButton id="groups" label="Groups" icon={Users} />
          <TabButton id="channels" label="Channels" icon={Radio} />
          <TabButton id="status" label="Status" icon={Camera} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {category === 'status' && (
          <button
            onClick={() => (mine ? open(mine) : void openComposer('status'))}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 transition-colors text-left"
          >
            <div className="relative flex-shrink-0">
              <div className="w-12 h-12 rounded-full p-0.5 border-2 border-dashed border-brand-500/50">
                <img src={mine?.avatar || profile?.avatar_url || ''} alt="My status" className="w-full h-full rounded-full object-cover bg-paper-mist" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center border-2 border-paper">
                <Plus className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-ink">My Status</div>
              <div className="text-xs text-ink-mute truncate">
                {mine ? `${mine.items.length} update${mine.items.length > 1 ? 's' : ''} · tap to view` : 'Tap to add a status update'}
              </div>
            </div>
          </button>
        )}

        {loading && (
          <div className="flex justify-center py-8 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && feedFor.length === 0 && (
          <p className="text-center text-xs text-ink-faint px-8 py-6">
            {category === 'status' && 'Statuses from people you chat with appear here and disappear after 24 hours.'}
            {category === 'groups' && 'Statuses posted to your groups appear here.'}
            {category === 'channels' && 'Statuses posted to channels you follow appear here.'}
          </p>
        )}

        {recent.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs text-ink-faint font-semibold uppercase tracking-wide">Recent updates</div>
            {recent.map((e) => (
              <EntryRow key={e.id} entry={e} onClick={() => open(e)} />
            ))}
          </>
        )}
        {seen.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs text-ink-faint font-semibold uppercase tracking-wide">Viewed updates</div>
            {seen.map((e) => (
              <EntryRow key={e.id} entry={e} onClick={() => open(e)} />
            ))}
          </>
        )}
      </div>

      <button
        onClick={() => void openComposer(category)}
        className="absolute bottom-20 right-4 w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lift hover:scale-105 active:scale-95 transition-transform"
        title="New status"
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      {/* story viewer */}
      {active && current && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col">
          <div className="relative z-10 pt-4 px-4">
            <div className="flex gap-1">
              {active.entry.items.map((it, i) => (
                <div key={it.id} className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-400" style={{ width: i < active.index ? '100%' : i === active.index ? `${progress}%` : '0%' }} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2.5">
                <img src={active.entry.avatar} alt="" className="w-9 h-9 rounded-full object-cover border border-white/30" />
                <div>
                  <div className="font-semibold text-sm text-white flex items-center gap-1.5">
                    {active.entry.name}
                    {current.anonymous && (
                      <span className="text-[10px] font-bold text-violet-200 bg-violet-500/40 px-1.5 py-0.5 rounded-full">Anonymous</span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400">{formatChatTime(current.createdAt)}</div>
                </div>
              </div>
              <button onClick={close} className="p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            {current.type === 'image' && current.mediaUrl ? (
              <>
                <img src={current.mediaUrl} alt="" className="max-h-[60vh] max-w-full rounded-2xl object-contain" />
                {current.body && <p className="mt-4 text-sm text-white bg-black/60 px-4 py-2 rounded-xl">{current.body}</p>}
              </>
            ) : (
              <div className={`w-full py-16 px-6 rounded-3xl bg-gradient-to-br ${BG[current.bg] ?? BG.emerald}`}>
                <p className="text-2xl font-bold text-white leading-relaxed break-words">{current.body}</p>
              </div>
            )}
          </div>

          <div className="relative z-10 p-4 pb-8">
            {current.postedBy === userId ? (
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span className="flex items-center gap-1.5">
                  <Eye className="w-4 h-4" /> Seen by {current.viewCount ?? 0}
                </span>
                <button onClick={() => void remove(current.id)} className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            ) : active.entry.kind === 'user' ? (
              <div className="flex items-center gap-2">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void sendReply()}
                  placeholder={`Reply to ${active.entry.name}...`}
                  className="flex-1 bg-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-gray-400 outline-none border border-white/15"
                />
                <button onClick={() => void sendReply()} className="p-2.5 rounded-full bg-brand-500 text-white hover:scale-105 active:scale-95 transition-all">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* add status */}
      {showAdd && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl p-5 shadow-2xl max-h-[85%] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-paper-line">
              <h3 className="font-bold text-base text-ink">
                {showAdd === 'status' ? 'Share a status update' : showAdd === 'groups' ? 'Post to a group' : 'Post to a channel'}
              </h3>
              <button onClick={() => setShowAdd(false)} className="p-1 rounded-full hover:bg-paper-mist text-ink-mute">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 space-y-3">
              {(showAdd === 'groups' || showAdd === 'channels') && !target && (
                <div className="divide-y divide-paper-line max-h-60 overflow-y-auto rounded-2xl border border-paper-line">
                  {pickerList.length === 0 && <p className="text-xs text-ink-faint p-4 text-center">Nothing to pick from yet.</p>}
                  {pickerList.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setTarget({ id: p.id, name: p.name })}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50 text-left"
                    >
                      <img src={'avatar_url' in p ? p.avatar_url ?? initialsAvatar(p.name, p.id) : p.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                      <span className="text-sm font-semibold text-ink">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {(showAdd === 'status' || target) && (
                <>
                  {target && (
                    <div className="flex items-center justify-between text-xs bg-brand-50 text-brand-700 font-semibold px-3 py-2 rounded-xl">
                      Posting to {target.name}
                      <button onClick={() => setTarget(null)} className="text-ink-mute hover:text-ink">
                        Change
                      </button>
                    </div>
                  )}
                  {file && (
                    <div className="flex items-center justify-between text-xs text-brand-700 bg-brand-50 rounded-xl px-3 py-2">
                      <span className="truncate">📷 {file.name}</span>
                      <button onClick={() => setFile(null)} className="text-ink-mute hover:text-ink ml-2">
                        Remove
                      </button>
                    </div>
                  )}
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={file ? 'Add a caption (optional)' : 'What is on your mind?'}
                    rows={3}
                    maxLength={300}
                    className="w-full p-3.5 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 text-ink text-sm outline-none resize-none transition-colors"
                  />
                  {!file && (
                    <div className="flex gap-2">
                      {Object.keys(BG).map((k) => (
                        <button
                          key={k}
                          onClick={() => setBg(k)}
                          className={`w-8 h-8 rounded-full bg-gradient-to-br ${BG[k]} border-2 ${bg === k ? 'border-brand-600' : 'border-transparent'}`}
                        />
                      ))}
                    </div>
                  )}
                  {showAdd !== 'status' && (
                    <button
                      onClick={() => setAnonymous((v) => !v)}
                      disabled={!isWeekend()}
                      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl border text-xs font-semibold transition-colors ${
                        anonymous ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-paper-mist border-transparent text-ink-mute'
                      } ${!isWeekend() ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        <EyeOff className="w-4 h-4" /> Post anonymously
                      </span>
                      <span>{isWeekend() ? (anonymous ? 'On' : 'Off') : 'Weekends only'}</span>
                    </button>
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
                      {posting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Post Status
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry, onClick }: { entry: Entry; onClick: () => void }) {
  const last = entry.items[entry.items.length - 1];
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 transition-colors text-left">
      <div className={`w-12 h-12 rounded-full p-0.5 flex-shrink-0 ${entry.allViewed ? 'bg-paper-line2' : 'bg-gradient-to-br from-brand-400 to-brand-600'}`}>
        <img src={entry.avatar} alt="" className="w-full h-full rounded-full object-cover border-2 border-paper" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate text-ink">{entry.name}</div>
        <div className="text-xs text-ink-mute truncate">{formatChatTime(last.createdAt)}</div>
      </div>
      {!entry.allViewed && <div className="w-2.5 h-2.5 rounded-full bg-brand-500 flex-shrink-0" />}
    </button>
  );
}
