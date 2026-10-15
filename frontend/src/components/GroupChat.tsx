import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, EyeOff, Flag, Loader2, Send, ShieldCheck, Tv, Users, VoteIcon, X } from 'lucide-react';
import type { Group, GroupMessage } from '@/types';
import { useAuth } from '@/lib/auth';
import { connectSocket } from '@/lib/socket';
import {
  fetchGroup,
  fetchGroupEncryptionKeys,
  fetchGroupMessages,
  type GroupEncryptionMember,
  mapGroupMessage,
  proposeAnonymousMode,
  reportGroupMessage,
  sendGroupText,
  turnOffAnonymousMode,
  voteAnonymousMode,
} from '@/lib/api';
import { decryptMessageBody, getPeerKeyStatus, trustPeerKey } from '@/lib/e2ee';
import { formatClock, initialsAvatar } from '@/lib/format';
import WatchTogether from '@/components/WatchTogether';

interface GroupChatProps {
  group: Group;
  onBack: () => void;
}

export default function GroupChat({ group: initial, onBack }: GroupChatProps) {
  const { userId } = useAuth();
  const [group, setGroup] = useState<Group>(initial);
  const [rows, setRows] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [showWatch, setShowWatch] = useState(false);
  const [showEncryptionKeys, setShowEncryptionKeys] = useState(false);
  const [encryptionMembers, setEncryptionMembers] = useState<GroupEncryptionMember[]>([]);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, { fingerprint: string; trusted: boolean }>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const addRow = useCallback((m: GroupMessage) => {
    setRows((prev) => (prev.some((r) => r.id === m.id) ? prev : [...prev, m].sort((a, b) => a.created_at.localeCompare(b.created_at))));
  }, []);

  const reloadGroup = useCallback(() => {
    void fetchGroup(group.id).then(setGroup).catch(() => { });
  }, [group.id]);

  const decodeGroupMessage = useCallback(async (message: GroupMessage): Promise<GroupMessage> => {
    if (!message.encrypted || !message.body) return message;
    return { ...message, body: await decryptMessageBody(message.body, group.id) };
  }, [group.id]);

  useEffect(() => {
    let cancelled = false;
    void fetchGroupEncryptionKeys(group.id).then(async (members) => {
      const statuses = await Promise.all(members
        .filter((member) => member.user_id !== userId && member.public_key)
        .map(async (member) => [member.user_id, await getPeerKeyStatus(member.user_id, member.public_key!)] as const));
      if (!cancelled) {
        setEncryptionMembers(members);
        setKeyStatuses(Object.fromEntries(statuses));
      }
    }).catch(() => {
      if (!cancelled) setError('Could not load group encryption keys.');
    });
    return () => { cancelled = true; };
  }, [group.id, userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchGroupMessages(group.id)
      .then(async (messages) => {
        const decoded = await Promise.all(messages.map(decodeGroupMessage));
        if (!cancelled) setRows(decoded);
      })
      .catch(() => !cancelled && setError('Could not load messages.'))
      .finally(() => !cancelled && setLoading(false));

    const socket = connectSocket();
    const onMessage = async (p: { group_id: string; message: GroupMessage }) => {
      if (p.group_id === group.id) addRow(await decodeGroupMessage(mapGroupMessage(p.message)));
    };
    const onVote = (p: { group_id: string }) => {
      if (p.group_id === group.id) reloadGroup();
    };
    socket.on('group:message', onMessage);
    socket.on('group:anon_vote', onVote);
    return () => {
      cancelled = true;
      socket.off('group:message', onMessage);
      socket.off('group:anon_vote', onVote);
    };
  }, [group.id, addRow, decodeGroupMessage, reloadGroup]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [rows.length]);

  const send = async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');
    setError(null);
    try {
      if (!userId) throw new Error('Sign in again to send an encrypted message.');
      addRow(await sendGroupText(group.id, body, encryptionMembers, userId));
    } catch (err) {
      setInput(body);
      setError(err instanceof Error ? err.message : 'Message failed to send.');
    }
  };

  const anon = group.anonymous;
  const vote = anon.vote;

  return (
    <div className="flex flex-col h-full bg-paper-tint relative select-none">
      <div className="bg-paper px-3 pt-12 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-paper-line z-20">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-paper-mist active:scale-95 transition-all" title="Back">
          <ArrowLeft className="w-5 h-5 text-ink" />
        </button>
        <img src={group.avatar_url || initialsAvatar(group.name, group.id)} alt="" className="w-10 h-10 rounded-full object-cover" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-ink truncate">{group.name}</div>
          <div className="text-[11px] text-ink-mute flex items-center gap-1">
            <Users className="w-3 h-3" /> {group.member_count} members
            {anon.active && <span className="text-violet-600 font-semibold ml-1">· Anonymous is on</span>}
          </div>
        </div>
        <button
          onClick={() => setShowEncryptionKeys((visible) => !visible)}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 flex-shrink-0"
          title="Group encryption keys"
        >
          <ShieldCheck className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowWatch(true)}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-50 hover:bg-brand-100 active:scale-95 text-brand-700 transition-all flex-shrink-0"
          title="Watch Together"
        >
          <Tv className="w-5 h-5" />
        </button>
      </div>

      {showEncryptionKeys && (
        <div className="absolute left-3 right-3 top-24 z-40 rounded-xl border border-paper-line bg-paper p-4 shadow-xl max-h-[70%] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Group safety codes</h3>
              <p className="mt-1 text-xs text-ink-mute">Compare each code with that member over another trusted channel. All keys must be verified before sending.</p>
            </div>
            <button onClick={() => setShowEncryptionKeys(false)} className="p-1 text-ink-mute" title="Close safety codes">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {encryptionMembers.filter((member) => member.user_id !== userId).map((member) => {
              const status = keyStatuses[member.user_id];
              return (
                <div key={member.user_id} className="border-t border-paper-line pt-3">
                  <div className="text-xs font-semibold text-ink">{member.name || 'Group member'}</div>
                  {status ? (
                    <>
                      <div className="mt-1 break-all rounded-lg bg-paper-mist p-2 font-mono text-[11px] leading-5 text-ink">{status.fingerprint}</div>
                      <div className="mt-1 text-[11px] text-ink-mute">{status.trusted ? 'Verified on this device' : 'Not verified'}</div>
                      {!status.trusted && member.public_key && (
                        <button
                          onClick={() => void trustPeerKey(member.user_id, member.public_key!).then(() => {
                            setKeyStatuses((current) => ({ ...current, [member.user_id]: { ...status, trusted: true } }));
                          }).catch(() => setError('Could not save the verified member key.'))}
                          className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white"
                        >
                          I compared and verified this code
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-rose-700">No encryption key published. This member must sign in on a supported device.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Anonymous Mode banner: no vote running, mode is off */}
      {!anon.active && !vote && (
        <div className="px-4 py-2.5 bg-violet-50 border-b border-violet-100 flex items-center justify-between gap-2">
          <span className="text-xs text-violet-800">Anonymous Mode is off.</span>
          <button
            onClick={() => void proposeAnonymousMode(group.id).then(setGroup)}
            className="text-xs font-bold text-violet-700 bg-violet-100 hover:bg-violet-200 px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors"
          >
            <VoteIcon className="w-3.5 h-3.5" /> Propose it
          </button>
        </div>
      )}

      {/* A vote is running */}
      {vote && vote.open && (
        <div className="px-4 py-3 bg-violet-50 border-b border-violet-100 space-y-2">
          <p className="text-xs text-violet-900">
            A vote is on to turn <b>Anonymous Mode</b> on for tonight ({vote.yes} yes · {vote.no} no of {vote.total_members}{' '}
            members). Voting stays open a full day, until {formatClock(vote.closes_at)} tomorrow, so everyone gets a say.
          </p>
          {vote.my_vote ? (
            <p className="text-xs text-violet-700 italic">You voted {vote.my_vote}.</p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => void voteAnonymousMode(group.id, 'yes').then(setGroup)}
                className="flex-1 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 py-2 rounded-xl transition-colors"
              >
                Vote Yes
              </button>
              <button
                onClick={() => void voteAnonymousMode(group.id, 'no').then(setGroup)}
                className="flex-1 text-xs font-bold text-violet-700 bg-white border border-violet-200 hover:bg-violet-50 py-2 rounded-xl transition-colors"
              >
                Vote No
              </button>
            </div>
          )}
        </div>
      )}

      {/* Anonymous Mode is active */}
      {anon.active && (
        <div className="px-4 py-2.5 bg-violet-600 flex items-center justify-between gap-2">
          <span className="text-xs text-white font-medium flex items-center gap-1.5">
            <EyeOff className="w-3.5 h-3.5" /> Anonymous Mode is on until {anon.expires_at ? formatClock(anon.expires_at) : 'later'}
          </span>
          {(group.is_owner || group.is_admin) && (
            <button
              onClick={() => void turnOffAnonymousMode(group.id).then(setGroup)}
              className="text-[11px] font-bold text-violet-700 bg-white hover:bg-violet-50 px-2.5 py-1 rounded-full transition-colors"
            >
              Turn off
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
        {loading && (
          <div className="flex justify-center py-6 text-ink-faint">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!loading && rows.length === 0 && <p className="text-center text-xs text-ink-faint py-6">No messages yet.</p>}
        {rows.map((m) => {
          const sent = m.sender_id === userId;
          const label = m.anonymous ? (sent ? 'You (anonymous)' : 'Anonymous') : null;
          return (
            <div key={m.id} className={`flex ${sent ? 'justify-end' : 'justify-start'} group`}>
              <div className="max-w-[78%]">
                {label && <div className="text-[10px] text-violet-600 font-semibold mb-0.5 px-1">{label}</div>}
                <div
                  className={`px-3.5 py-2.5 rounded-2xl transition-all ${sent
                      ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white rounded-tr-sm shadow-md shadow-brand-700/15'
                      : m.anonymous
                        ? 'bg-violet-50 text-ink rounded-tl-sm ring-1 ring-violet-100'
                        : 'bg-white text-ink rounded-tl-sm shadow-sm ring-1 ring-black/[0.04]'
                    }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <span className="text-[10px] opacity-60 tabular-nums">{formatClock(m.created_at)}</span>
                    {!sent && (
                      <button
                        onClick={() => setReportTarget(m.id)}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        title="Report"
                      >
                        <Flag className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="px-4 py-2 text-xs bg-rose-50 text-rose-700">{error}</div>}

      <div className="bg-paper border-t border-paper-line p-3 flex items-center gap-2 flex-shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          placeholder={anon.active ? 'Message anonymously...' : 'Message...'}
          className="flex-1 bg-paper-mist rounded-full px-4 py-2.5 text-sm text-ink placeholder-ink-faint outline-none border border-transparent focus:bg-white focus:border-brand-600/30 transition-colors"
        />
        <button
          onClick={() => void send()}
          className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95 transition-transform shadow-lift"
        >
          <Send className="w-5 h-5 text-white" />
        </button>
      </div>

      {showWatch && <WatchTogether roomId={group.id} onClose={() => setShowWatch(false)} />}

      {reportTarget && (
        <ReportModal
          onClose={() => setReportTarget(null)}
          onSubmit={async (reason) => {
            await reportGroupMessage(group.id, reportTarget, reason);
            setReportTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ReportModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex flex-col justify-end">
      <div className="bg-white rounded-t-3xl p-5 shadow-2xl">
        <h3 className="font-bold text-base text-ink mb-1">Report this message</h3>
        <p className="text-xs text-ink-mute mb-3">
          Even if it was sent anonymously, we keep the real sender on our side, so a report still reaches them.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What's wrong with this message?"
          rows={3}
          maxLength={300}
          className="w-full p-3 rounded-2xl bg-paper-mist border border-transparent focus:border-brand-600/30 text-sm text-ink outline-none resize-none"
        />
        <div className="flex gap-2 mt-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-paper-mist text-ink text-sm font-semibold">
            Cancel
          </button>
          <button
            onClick={async () => {
              setSending(true);
              await onSubmit(reason);
              setSending(false);
            }}
            disabled={sending}
            className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending && <Loader2 className="w-4 h-4 animate-spin" />} Submit report
          </button>
        </div>
      </div>
    </div>
  );
}
