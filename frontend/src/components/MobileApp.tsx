import { useEffect, useState } from 'react';
import {
  MessageCircle,
  CircleDashed,
  Phone,
  Radio,
  UsersRound,
  Store,
  Settings,
  Shield,
} from 'lucide-react';
import type { Screen, Chat, Group } from '@/types';
import { APP_NAME } from '@/brand';
import BrandMark from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { useCall } from '@/lib/calls';
import { fetchChats } from '@/lib/api';
import { authenticateDevice, isNative, registerPush } from '@/lib/native';
import { secureGetItem } from '@/lib/secure';
import { api } from '@/lib/http';
import ChatList from '@/components/ChatList';
import StatusScreen from '@/components/StatusScreen';
import CallsScreen from '@/components/CallsScreen';
import ChannelsScreen from '@/components/ChannelsScreen';
import SettingsScreen from '@/components/SettingsScreen';
import ChatConversation from '@/components/ChatConversation';
import GroupsScreen from '@/components/GroupsScreen';
import GroupChat from '@/components/GroupChat';
import MarketplaceScreen from '@/components/MarketplaceScreen';
import CallOverlay from '@/components/CallOverlay';

interface MobileAppProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  activeChat: Chat | null;
  setActiveChat: (c: Chat | null) => void;
  onLogout?: () => void;
  isDesktopView?: boolean;
}

const navItems: { id: Screen; icon: typeof MessageCircle; label: string }[] = [
  { id: 'chats', icon: MessageCircle, label: 'Chats' },
  { id: 'status', icon: CircleDashed, label: 'Status' },
  { id: 'calls', icon: Phone, label: 'Calls' },
  { id: 'channels', icon: Radio, label: 'Channels' },
  { id: 'groups', icon: UsersRound, label: 'Groups' },
  { id: 'market', icon: Store, label: 'Market' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export default function MobileApp({
  screen,
  setScreen,
  activeChat,
  setActiveChat,
  onLogout,
  isDesktopView = false,
}: MobileAppProps) {
  const { userId } = useAuth();
  const { call, startCall } = useCall();

  // Global Chat Wallpaper setting
  const [activeWallpaper, setActiveWallpaper] = useState<string>('default');
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockReady, setLockReady] = useState(false);
  const [lockError, setLockError] = useState('');

  useEffect(() => {
    if (!isNative()) {
      setLockReady(true);
      return;
    }
    if (!userId) return;
    let active = true;
    void (async () => {
      let enabled: boolean;
      try {
        const settings = await api<{ security?: { biometrics_lock?: boolean } }>('/api/me/settings');
        enabled = settings.security?.biometrics_lock !== false;
      } catch {
        enabled = (await secureGetItem('device-lock')) !== 'off';
      }
      if (!active) return;
      setLockEnabled(enabled);
      setIsAppLocked(enabled);
      setLockReady(true);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const relock = () => {
      if (document.visibilityState === 'hidden' && lockEnabled) setIsAppLocked(true);
    };
    document.addEventListener('visibilitychange', relock);
    return () => document.removeEventListener('visibilitychange', relock);
  }, [lockEnabled]);

  const submitUnlock = async () => {
    setLockError('');
    if (await authenticateDevice()) {
      setIsAppLocked(false);
      return;
    }
    setLockError('Device authentication was not completed.');
  };

  // Android app: register for push notifications; tapping one opens that chat.
  useEffect(() => {
    if (!userId) return;
    void registerPush(userId, (data) => {
      if (!data.conversation_id) return;
      void fetchChats().then((all) => {
        const target = all.find((c) => c.id === data.conversation_id);
        if (target) {
          setScreen('chats');
          setActiveChat(target);
        }
      });
    });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isNative() && userId && (!lockReady || isAppLocked)) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f1720] p-6 text-white">
        <div className="w-full max-w-xs text-center">
          <Shield className="mx-auto mb-4 h-9 w-9 text-emerald-400" />
          <h2 className="text-lg font-bold">{lockReady ? 'Chatimall is locked' : 'Checking device lock'}</h2>
          {lockError && <p className="mt-2 text-xs text-rose-300">{lockError}</p>}
          {lockReady && (
            <button onClick={() => void submitUnlock()} className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
              Unlock with device security
            </button>
          )}
        </div>
      </div>
    );
  }

  const callChat = (chat: Chat, type: 'voice' | 'video') => {
    if (!chat.otherUserId) return;
    void startCall({ id: chat.otherUserId, name: chat.name, avatar: chat.avatar }, type);
  };

  // --- 1. DESKTOP 2-COLUMN VIEW (WhatsApp Web / Telegram Web style) ---
  if (isDesktopView) {
    return (
      <div className="flex w-full h-full bg-paper-tint text-ink relative overflow-hidden select-none">
        <CallOverlay />

        {/* Left Column: Sidebar with Navigation & Lists */}
        <div className="w-[380px] lg:w-[420px] flex-shrink-0 border-r border-paper-line flex flex-col h-full bg-paper">
          {/* Sidebar Top Header with Tab Switcher */}
          <div className="bg-paper px-4 py-3 flex items-center justify-between border-b border-paper-line flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <BrandMark size={32} />
              <span className="font-bold text-sm text-ink tracking-tight">{APP_NAME}</span>
            </div>

            {/* Desktop Navigation Tabs */}
            <div className="flex items-center gap-1 bg-paper-mist p-1 rounded-xl border border-paper-line">
              {navItems.map((item) => {
                const active = screen === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setScreen(item.id)}
                    className={`p-2 rounded-lg transition-all ${active
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-ink-mute hover:text-ink hover:bg-brand-50'
                      }`}
                    title={item.label}
                  >
                    <item.icon className="w-4 h-4 stroke-[2.2px]" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto">
            {screen === 'chats' && <ChatList onOpenChat={setActiveChat} />}
            {screen === 'status' && <StatusScreen />}
            {screen === 'calls' && <CallsScreen onStartCall={(peer, type) => void startCall(peer, type)} />}
            {screen === 'channels' && <ChannelsScreen onOpenGroup={setActiveGroup} />}
            {screen === 'groups' && <GroupsScreen onOpenGroup={setActiveGroup} />}
            {screen === 'market' && <MarketplaceScreen onOpenChat={setActiveChat} />}
            {screen === 'settings' && (
              <SettingsScreen
                activeWallpaper={activeWallpaper}
                onWallpaperChange={setActiveWallpaper}
                onOpenChat={setActiveChat}
                onLogout={onLogout}
              />
            )}
          </div>
        </div>

        {/* Right Column: Chat Conversation OR WhatsApp Web Style Welcome State */}
        <div className="flex-1 flex flex-col h-full bg-paper-tint relative">
          {activeChat ? (
            <ChatConversation
              chat={activeChat}
              onBack={() => setActiveChat(null)}
              onStartCall={(type) => callChat(activeChat, type)}
              wallpaper={activeWallpaper}
            />
          ) : activeGroup ? (
            <GroupChat group={activeGroup} onBack={() => setActiveGroup(null)} />
          ) : (
            /* WhatsApp Web / Telegram Web Style Empty State */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none my-auto">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-brand-500/20 to-brand-600/5 border border-brand-600/30 flex items-center justify-center mb-6 shadow-2xl shadow-brand-600/25">
                <MessageCircle className="w-12 h-12 text-brand-600" />
              </div>
              <h2 className="text-2xl font-bold text-ink mb-2">{APP_NAME} for Web</h2>
              <p className="text-sm text-ink-mute max-w-md leading-relaxed mb-6">
                Send and receive messages with zero lag, fluid voice notes, and private rooms. Select any conversation from the left to start messaging.
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-paper-mist border border-paper-line text-xs text-ink-mute">
                <Shield className="w-3.5 h-3.5 text-brand-600" />
                <span>Encrypted in transit</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- 2. MOBILE SINGLE-COLUMN VIEW ---
  return (
    <div className="flex flex-col h-full bg-paper text-ink relative overflow-hidden select-none">
      <CallOverlay />

      {/* Main View Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {activeChat ? (
          <ChatConversation
            chat={activeChat}
            onBack={() => setActiveChat(null)}
            onStartCall={(type) => callChat(activeChat, type)}
            wallpaper={activeWallpaper}
          />
        ) : activeGroup ? (
          <GroupChat group={activeGroup} onBack={() => setActiveGroup(null)} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {screen === 'chats' && <ChatList onOpenChat={setActiveChat} />}
            {screen === 'status' && <StatusScreen />}
            {screen === 'calls' && <CallsScreen onStartCall={(peer, type) => void startCall(peer, type)} />}
            {screen === 'channels' && <ChannelsScreen onOpenGroup={setActiveGroup} />}
            {screen === 'groups' && <GroupsScreen onOpenGroup={setActiveGroup} />}
            {screen === 'market' && <MarketplaceScreen onOpenChat={setActiveChat} />}
            {screen === 'settings' && (
              <SettingsScreen
                activeWallpaper={activeWallpaper}
                onWallpaperChange={setActiveWallpaper}
                onOpenChat={setActiveChat}
                onLogout={onLogout}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom Navigation Dock (Hidden when inside an active conversation or call) */}
      {!activeChat && !activeGroup && call.phase === 'idle' && (
        <div className="flex items-center justify-around bg-paper/95 backdrop-blur-md border-t border-paper-line px-2 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] flex-shrink-0 z-30">
          {navItems.map((item) => {
            const active = screen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                className={`flex-1 min-w-0 flex flex-col items-center gap-1 transition-colors ${active ? 'text-brand-700' : 'text-ink-mute hover:text-ink'
                  }`}
              >
                <span className={`h-8 w-11 rounded-full flex items-center justify-center transition-all ${active ? 'bg-brand-100' : 'bg-transparent'}`}>
                  <item.icon className={`w-[22px] h-[22px] ${active ? 'stroke-[2.4px]' : 'stroke-[1.8px]'}`} />
                </span>
                <span className={`text-[10px] tracking-tight ${active ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
