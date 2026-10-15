import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Users, X } from 'lucide-react';
import type { Group } from '@/types';
import { createGroup, fetchGroups } from '@/lib/api';
import { formatChatTime, initialsAvatar } from '@/lib/format';
import { connectSocket } from '@/lib/socket';

interface GroupsScreenProps {
  onOpenGroup: (group: Group) => void;
}

export default function GroupsScreen({ onOpenGroup }: GroupsScreenProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await fetchGroups());
    } catch (err) {
      console.error('Could not load groups', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const socket = connectSocket();
    const refresh = () => void load();
    socket.on('group:message', refresh);
    socket.on('group:anon_vote', refresh);
    socket.on('group:added', refresh);
    socket.on('connect', refresh);
    return () => {
      socket.off('group:message', refresh);
      socket.off('group:anon_vote', refresh);
      socket.off('group:added', refresh);
      socket.off('connect', refresh);
    };
  }, [load]);

  const create = async () => {
    if (name.trim().length < 2) {
      setError('Group name must be at least 2 characters.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const g = await createGroup(name.trim());
      setName('');
      setShowCreate(false);
      await load();
      onOpenGroup(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create group');
    }
    setCreating(false);
  };

  return (
    <div className="flex flex-col h-full relative select-none bg-paper">
      <div className="bg-paper px-4 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-[26px] font-extrabold text-ink tracking-tight">Groups</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 text-brand-700 transition-all"
            title="New Group"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-10 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && groups.length === 0 && (
          <p className="text-center text-sm text-ink-faint px-8 py-10">
            No groups yet. Tap + to start one, or follow a channel to get its Gist Room.
          </p>
        )}
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => onOpenGroup(g)}
            className="w-full flex items-center gap-3.5 px-4 py-3 hover:bg-brand-50 active:bg-brand-100 transition-colors text-left"
          >
            <img
              src={g.avatar_url || initialsAvatar(g.name, g.id)}
              alt={g.name}
              className="w-[52px] h-[52px] rounded-full object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-semibold text-ink truncate">{g.name}</span>
                {g.is_gist_room && (
                  <span className="text-[10px] font-bold text-brand-700 bg-brand-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    Gist Room
                  </span>
                )}
                {g.anonymous.active && (
                  <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    Anonymous
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-ink-mute mt-0.5">
                <Users className="w-3.5 h-3.5" /> {g.member_count} members
              </div>
              {g.last_message_preview && (
                <p className="text-[13px] text-ink-mute truncate mt-0.5">{g.last_message_preview}</p>
              )}
            </div>
            {g.last_message_at && (
              <span className="text-[11px] text-ink-mute flex-shrink-0 tabular-nums">
                {formatChatTime(g.last_message_at)}
              </span>
            )}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-paper-line">
              <h3 className="font-bold text-base text-ink">New Group</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded-full hover:bg-paper-mist text-ink-mute">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 space-y-3">
              <input
                autoFocus
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
                className="w-full px-3.5 py-3 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 text-ink text-sm outline-none transition-colors"
              />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <button
                onClick={() => void create()}
                disabled={creating}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-lift"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />} Create Group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
