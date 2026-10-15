import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '@/brand';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/http';
import { authenticateDevice, getDeviceContacts, getPushPermission, isNative, requestPushPermission } from '@/lib/native';
import { initialsAvatar } from '@/lib/format';
import { formatChatTime } from '@/lib/format';
import {
  createSupportRequest,
  fetchArchivedChats,
  fetchChats,
  fetchSettingsContacts,
  fetchStarredMessages,
  fetchStorageUsage,
  setConversationArchived,
  setMessageStarred,
  startDirectChat,
  syncPhoneContacts,
} from '@/lib/api';
import {
  User,
  Bell,
  Lock,
  HelpCircle,
  Database,
  Palette,
  Languages,
  LogOut,
  ChevronRight,
  Users,
  Archive,
  Star,
  Shield,
  X,
  Check,
  Edit2,
  Camera,
  Share2,
  RotateCcw,
  Trash2,
  QrCode,
  Search,
} from 'lucide-react';
import type { Chat, SettingsContact, SettingsPreferences, StarredMessageItem, StorageUsage, UserProfile } from '@/types';
import { secureSetItem } from '@/lib/secure';

interface SettingsScreenProps {
  onWallpaperChange?: (wallpaper: string) => void;
  activeWallpaper?: string;
  onOpenChat?: (chat: Chat) => void;
  onLogout?: () => void;
}

const DEFAULT_SETTINGS: SettingsPreferences = {
  privacy: { read_receipts: true, last_seen: 'Everyone', disappearing_timer: 'Off' },
  security: { two_factor_auth: false, biometrics_lock: false },
  notifications: { sound: 'Pulse Chime', vibrate: true, preview: true },
  appearance: { wallpaper: 'default' },
  translation: { mode: 'off', language: 'en' },
};

const TRANSLATION_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'ha', name: 'Hausa' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ee', name: 'Ewe' },
  { code: 'tw', name: 'Twi (Akuapem)' },
  { code: 'tw-asante', name: 'Twi (Asante)' },
  { code: 'ga', name: 'Ga' },
  { code: 'fr', name: 'French' },
  { code: 'sw', name: 'Swahili' },
];

export default function SettingsScreen({
  onWallpaperChange,
  onOpenChat,
  onLogout,
}: SettingsScreenProps) {
  const { profile: authProfile, requestOtp, updateProfile, uploadAvatar } = useAuth();
  const [profile, setProfile] = useState<UserProfile>({
    name: authProfile?.name ?? '',
    bio: authProfile?.bio ?? '',
    phone: authProfile?.phone ? `+${authProfile.phone}` : '',
    avatar: authProfile?.avatar_url || initialsAvatar(authProfile?.name ?? '', authProfile?.phone ?? ''),
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(authProfile?.avatar_url ?? null);
  const [savingProfile, setSavingProfile] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const pickAvatar = async (file?: File | null) => {
    if (!file) return;
    try {
      const url = await uploadAvatar(file);
      setAvatarUrl(url);
      setProfile((p) => ({ ...p, avatar: url }));
      await updateProfile({ avatar_url: url });
      showToast('Profile photo updated');
    } catch {
      showToast('Could not upload the photo');
    }
  };

  const saveProfile = async () => {
    if (!profile.name.trim()) {
      showToast('Name cannot be empty');
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({ name: profile.name.trim(), bio: profile.bio.trim(), avatar_url: avatarUrl });
      setActiveModal(null);
      showToast('Profile saved');
    } catch {
      showToast('Could not save profile');
    }
    setSavingProfile(false);
  };

  // Active sub-settings modal state
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const [settings, setSettings] = useState<SettingsPreferences>(DEFAULT_SETTINGS);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [contacts, setContacts] = useState<SettingsContact[]>([]);
  const [archivedChats, setArchivedChats] = useState<SettingsContact[]>([]);
  const [starredMessages, setStarredMessages] = useState<StarredMessageItem[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [twoFactorIntent, setTwoFactorIntent] = useState<boolean | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorPin, setTwoFactorPin] = useState('');
  const [twoFactorCurrentPin, setTwoFactorCurrentPin] = useState('');
  const [twoFactorDevCode, setTwoFactorDevCode] = useState<string | null>(null);
  const [preparingTwoFactor, setPreparingTwoFactor] = useState(false);
  const [loadingSection, setLoadingSection] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [sendingSupport, setSendingSupport] = useState(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const openSettingsSection = async (section: string) => {
    setActiveModal(section);
    setLoadingSection(true);
    try {
      if (section === 'contacts') setContacts(await fetchSettingsContacts());
      if (section === 'archived') setArchivedChats(await fetchArchivedChats());
      if (section === 'starred') setStarredMessages(await fetchStarredMessages());
      if (section === 'storage') setStorageUsage(await fetchStorageUsage());
    } catch {
      showToast(`Could not load ${section}`);
    } finally {
      setLoadingSection(false);
    }
  };

  const openContact = async (contact: SettingsContact) => {
    try {
      const conversationId = contact.conversation_id || (contact.other_phone ? await startDirectChat(contact.other_phone) : '');
      if (!conversationId) throw new Error('Contact has no phone number');
      const chat = (await fetchChats()).find((row) => row.id === conversationId);
      if (!chat) throw new Error('Conversation is unavailable');
      onOpenChat?.(chat);
      setActiveModal(null);
    } catch {
      showToast('Could not open this conversation');
    }
  };

  const restoreChat = async (conversationId: string) => {
    setWorkingId(conversationId);
    try {
      await setConversationArchived(conversationId, false);
      setArchivedChats((rows) => rows.filter((row) => row.conversation_id !== conversationId));
      showToast('Chat restored');
    } catch {
      showToast('Could not restore chat');
    } finally {
      setWorkingId(null);
    }
  };

  const removeStar = async (messageId: string) => {
    setWorkingId(messageId);
    try {
      await setMessageStarred(messageId, false);
      setStarredMessages((rows) => rows.filter((row) => row.message.id !== messageId));
      showToast('Removed from starred messages');
    } catch {
      showToast('Could not remove star');
    } finally {
      setWorkingId(null);
    }
  };

  const submitSupportRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setSendingSupport(true);
    try {
      await createSupportRequest(supportSubject, supportMessage);
      setSupportSubject('');
      setSupportMessage('');
      showToast('Support request sent');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send request');
    } finally {
      setSendingSupport(false);
    }
  };

  const clearTemporaryCache = async () => {
    try {
      const keys = 'caches' in window ? await caches.keys() : [];
      const appKeys = keys.filter((key) => key.startsWith('chatimall'));
      await Promise.all(appKeys.map((key) => caches.delete(key)));
      showToast(appKeys.length ? 'Temporary cache cleared' : 'No temporary cache found');
    } catch {
      showToast('Could not clear temporary cache');
    }
  };

  const syncPhoneContactsFromDevice = async () => {
    setSyncingContacts(true);
    try {
      const availableContacts = await getDeviceContacts();
      if (!availableContacts.length) {
        setContacts([]);
        showToast('No phone contacts with numbers were found');
        return;
      }
      const result = await syncPhoneContacts(availableContacts.slice(0, 200));
      setContacts(result.contacts);
      showToast(result.count ? `Synced ${result.count} contacts` : 'No valid contacts were found');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not sync phone contacts');
    } finally {
      setSyncingContacts(false);
    }
  };

  const requestNativeNotificationPermission = async () => {
    const permission = await requestPushPermission();
    setNotificationPermission(permission);
    showToast(permission === 'granted' ? 'Notifications enabled' : permission === 'unsupported' ? 'Notifications are not available on this device' : 'Notifications were not enabled');
  };

  const applyDeviceAppLock = async (enabled: boolean) => {
    if (!isNative()) throw new Error('App lock is available in the installed app.');
    if (enabled && !await authenticateDevice('Confirm app lock')) throw new Error('Device authentication was not completed.');
    await secureSetItem('device-lock', enabled ? 'on' : 'off');
    return enabled;
  };

  const beginTwoFactorSetup = async (enabled: boolean) => {
    if (!authProfile?.phone) {
      showToast('A phone number is required for account verification');
      return;
    }
    setPreparingTwoFactor(true);
    try {
      const response = await requestOtp(`+${authProfile.phone}`);
      setTwoFactorIntent(enabled);
      setTwoFactorCode('');
      setTwoFactorPin('');
      setTwoFactorCurrentPin('');
      setTwoFactorDevCode(response.devCode ?? null);
      setActiveModal('two-factor');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send a verification code');
    } finally {
      setPreparingTwoFactor(false);
    }
  };

  const submitTwoFactorSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (twoFactorIntent === null) return;
    setSavingSettings(true);
    try {
      await api('/api/me/security/two-factor', {
        method: 'POST',
        body: {
          enabled: twoFactorIntent,
          code: twoFactorCode,
          ...(twoFactorIntent ? { pin: twoFactorPin } : { current_pin: twoFactorCurrentPin }),
        },
      });
      setSettings((current) => ({
        ...current,
        security: { ...current.security, two_factor_auth: twoFactorIntent },
      }));
      setActiveModal('security');
      showToast(`Two-step verification ${twoFactorIntent ? 'enabled' : 'disabled'}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update two-step verification');
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    let active = true;
    api<SettingsPreferences>('/api/me/settings')
      .then((loadedSettings) => {
        if (!active) return;
        // Defensive: the server always includes every section, but never trust a response
        // shape blindly — a missing section here would otherwise crash the whole screen.
        const merged: SettingsPreferences = {
          ...DEFAULT_SETTINGS,
          ...loadedSettings,
          appearance: { ...DEFAULT_SETTINGS.appearance, ...loadedSettings.appearance },
          translation: { ...DEFAULT_SETTINGS.translation, ...loadedSettings.translation },
        };
        setSettings(merged);
        onWallpaperChange?.(merged.appearance.wallpaper);
      })
      .catch(() => {
        if (active) showToast('Could not load settings');
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onWallpaperChange]);

  useEffect(() => {
    void getPushPermission().then(setNotificationPermission);
  }, []);

  const saveSettings = async <Section extends keyof SettingsPreferences,>(
    section: Section,
    patch: Partial<SettingsPreferences[Section]>,
    successMessage: string
  ) => {
    setSavingSettings(true);
    try {
      const savedSettings = await api<SettingsPreferences>('/api/me/settings', {
        method: 'PATCH',
        body: { [section]: patch },
      });
      const merged: SettingsPreferences = {
        ...settings,
        ...savedSettings,
        appearance: { ...settings.appearance, ...savedSettings.appearance },
        translation: { ...settings.translation, ...savedSettings.translation },
      };
      setSettings(merged);
      if (section === 'appearance') onWallpaperChange?.(merged.appearance.wallpaper);
      showToast(successMessage);
    } catch {
      showToast('Could not save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const settingSections = [
    {
      title: 'Account',
      items: [
        { icon: User, label: 'Personal Info', color: 'emerald', keywords: 'profile name bio phone photo', onClick: () => setActiveModal('personal-info') },
        { icon: Lock, label: 'Privacy', color: 'emerald', keywords: 'read receipts last seen disappearing messages', badge: 'Updated', onClick: () => setActiveModal('privacy') },
        { icon: Shield, label: 'Security & Encryption', color: 'emerald', keywords: 'two step verification pin device lock keys', onClick: () => setActiveModal('security') },
        { icon: Users, label: 'Contacts', color: 'sky', keywords: 'address book phone sync', onClick: () => void openSettingsSection('contacts') },
      ],
    },
    {
      title: 'Preferences',
      items: [
        { icon: Bell, label: 'Notifications', color: 'amber', keywords: 'push sound alerts permission', onClick: () => setActiveModal('notifications') },
        { icon: Palette, label: 'Chat Wallpaper', color: 'rose', keywords: 'appearance background', badge: settings.appearance.wallpaper !== 'default' ? settings.appearance.wallpaper : undefined, onClick: () => setActiveModal('wallpaper') },
        { icon: Languages, label: 'Voice Note Translation', color: 'sky', keywords: 'translate language voice notes hausa yoruba igbo twi', badge: settings.translation.mode !== 'off' ? TRANSLATION_LANGUAGES.find((l) => l.code === settings.translation.language)?.name : 'Off', onClick: () => setActiveModal('translation') },
      ],
    },
    {
      title: 'Your activity',
      items: [
        { icon: Archive, label: 'Archived Chats', color: 'gray', keywords: 'restore hidden conversations', onClick: () => void openSettingsSection('archived') },
        { icon: Star, label: 'Starred Messages', color: 'amber', keywords: 'saved favorites', onClick: () => void openSettingsSection('starred') },
        { icon: Database, label: 'Storage & Data', color: 'teal', keywords: 'files usage media cache', onClick: () => void openSettingsSection('storage') },
      ],
    },
    {
      title: 'Support',
      items: [
        { icon: HelpCircle, label: 'Help & FAQ', color: 'sky', keywords: 'support contact us', onClick: () => setActiveModal('help') },
      ],
    },
  ];
  const normalizedQuery = settingsQuery.trim().toLowerCase();
  const visibleSettingSections = settingSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(normalizedQuery)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="flex flex-col h-full relative select-none">
      {/* Toast */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold shadow-xl flex items-center gap-1.5 animate-bounce">
          <Check className="w-3.5 h-3.5" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-paper px-4 pt-10 pb-4 flex-shrink-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Account center</p>
        <h1 className="mt-1 text-[28px] font-black leading-none text-ink">Settings</h1>
        <p className="mt-1.5 text-xs text-ink-mute">Manage your profile, privacy, and app preferences.</p>
      </div>

      <div className="flex-1 overflow-y-auto pb-6">
        <div className="mx-4 mt-1 overflow-hidden rounded-2xl border border-paper-line bg-[#F2F7F3]">
          <button
            onClick={() => setActiveModal('edit-profile')}
            className="flex w-full items-center gap-3 px-3.5 py-3.5 text-left transition-colors hover:bg-white/60"
          >
            <div className="relative shrink-0">
              <img
                src={profile.avatar}
                alt={profile.name}
                className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow-sm"
              />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-brand-600 text-white">
                <Edit2 className="h-2 w-2" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-ink">{profile.name || 'Complete your profile'}</div>
              <div className="mt-0.5 truncate text-xs text-ink-mute">{profile.phone}</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
          </button>

          <div className="flex items-center justify-between border-t border-paper-line px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs text-ink-mute">
              <QrCode className="h-4 w-4 text-brand-700" />
              Share your contact card
            </div>
            <button
              onClick={() => setActiveModal('qr-code')}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-brand-700 transition-colors hover:bg-white/70"
            >
              Show code <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <button
          onClick={() => setActiveModal('security')}
          className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-brand-200 bg-white px-3.5 py-3 text-left transition-colors hover:bg-brand-50/50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600/10 text-brand-700">
            <Shield className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-ink">Account protection</span>
            <span className="mt-0.5 block truncate text-[11px] text-ink-mute">
              {settingsLoading ? 'Loading security status' : `${settings.security.two_factor_auth ? '2-step on' : '2-step off'} · ${isNative() ? settings.security.biometrics_lock ? 'device lock on' : 'device lock off' : 'device lock in app'}`}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>

        <label className="mx-4 mt-4 flex h-10 items-center gap-2.5 rounded-lg border border-paper-line bg-white px-3 text-ink-mute focus-within:border-brand-400">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            type="search"
            value={settingsQuery}
            onChange={(event) => setSettingsQuery(event.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
          />
          {settingsQuery && (
            <button type="button" onClick={() => setSettingsQuery('')} className="text-[11px] font-semibold text-brand-700">
              Clear
            </button>
          )}
        </label>

        {visibleSettingSections.length ? visibleSettingSections.map((section) => (
          <section key={section.title} className="mt-4">
            <h2 className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{section.title}</h2>
            <div className="divide-y divide-paper-line border-y border-paper-line bg-white">
              {section.items.map((item) => (
                <SettingRow key={item.label} {...item} />
              ))}
            </div>
          </section>
        )) : (
          <div className="mx-4 mt-5 rounded-xl border border-dashed border-paper-line2 px-4 py-8 text-center">
            <Search className="mx-auto h-5 w-5 text-ink-faint" />
            <p className="mt-2 text-sm font-semibold text-ink">No settings found</p>
            <p className="mt-1 text-xs text-ink-mute">Try another word or clear your search.</p>
          </div>
        )}

        {/* Logout */}
        <div className="mt-4 px-4">
          <button
            onClick={() => setActiveModal('logout')}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 hover:bg-rose-500/10 active:scale-95 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-semibold text-sm">Log Out</span>
          </button>
        </div>

        <div className="text-center py-6">
          <p className="text-xs text-ink-faint tabular-nums">{APP_NAME} v2.0.1 (Stable)</p>
          <p className="text-xs text-ink-faint mt-0.5">Private · encrypted in transit</p>
        </div>
      </div>

      {/* --- SUB-SETTINGS MODALS --- */}

      {/* 1. Edit Profile Modal */}
      {activeModal === 'edit-profile' && (
        <ModalWrapper title="Edit Profile" onClose={() => setActiveModal(null)}>
          <div className="flex flex-col items-center mb-6">
            <div className="relative">
              <img
                src={profile.avatar}
                alt="Avatar"
                className="w-20 h-20 rounded-full object-cover border-2 border-brand-600/30 shadow-lg"
              />
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="absolute bottom-0 right-0 p-1.5 rounded-full bg-brand-600 text-white shadow-md hover:scale-105"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => void pickAvatar(e.target.files?.[0])}
              />
            </div>
            <span className="text-xs text-ink-mute mt-2">Tap to change avatar</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-ink-mute uppercase">Your Name</label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-paper-mist border border-paper-line text-ink text-sm outline-none focus:border-emerald-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-mute uppercase">About / Bio</label>
              <input
                type="text"
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                className="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-paper-mist border border-paper-line text-ink text-sm outline-none focus:border-emerald-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-mute uppercase">Phone Number</label>
              <input
                type="text"
                value={profile.phone}
                readOnly
                className="w-full mt-1.5 px-3 py-2.5 rounded-xl bg-[#0f1623]/60 border border-paper-line text-ink-mute text-sm outline-none cursor-not-allowed"
              />
            </div>

            <button
              disabled={savingProfile}
              onClick={() => void saveProfile()}
              className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white font-bold text-sm shadow-lg shadow-brand-600/25 active:scale-95 transition-all"
            >
              Save Profile
            </button>
          </div>
        </ModalWrapper>
      )}

      {activeModal === 'personal-info' && (
        <ModalWrapper title="Personal Info" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <InfoRow label="Name" value={profile.name || 'Not set'} />
            <InfoRow label="About" value={profile.bio || 'Not set'} />
            <InfoRow label="Phone number" value={profile.phone || 'Not set'} />
            <button
              onClick={() => setActiveModal('edit-profile')}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Edit profile
            </button>
          </div>
        </ModalWrapper>
      )}

      {activeModal === 'contacts' && (
        <ModalWrapper title="Contacts" onClose={() => setActiveModal(null)}>
          <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-paper-line bg-paper-mist p-3">
            <div>
              <div className="text-sm font-semibold text-ink">Phone contacts</div>
              <div className="text-[11px] text-ink-mute">Sync local address-book entries</div>
            </div>
            <button
              disabled={syncingContacts}
              onClick={() => void syncPhoneContactsFromDevice()}
              className="rounded-full bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
            >
              {syncingContacts ? 'Syncing…' : 'Sync'}
            </button>
          </div>
          {loadingSection ? <SectionLoading /> : contacts.length === 0 ? (
            <EmptySection message="Contacts appear here after you start a conversation." />
          ) : (
            <div className="divide-y divide-paper-line">
              {contacts.map((contact) => (
                <div key={contact.other_id} className="flex items-center gap-3 py-3">
                  <img
                    src={contact.other_avatar || initialsAvatar(contact.other_name, contact.other_phone ?? '')}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{contact.other_name || 'Unknown'}</div>
                    <div className="truncate text-xs text-ink-mute">{contact.other_phone ? `+${contact.other_phone}` : 'Chatimall contact'}</div>
                  </div>
                  <button
                    onClick={() => openContact(contact)}
                    className="rounded-lg bg-brand-600/10 px-3 py-2 text-xs font-semibold text-brand-700"
                  >
                    Message
                  </button>
                </div>
              ))}
            </div>
          )}
        </ModalWrapper>
      )}

      {activeModal === 'archived' && (
        <ModalWrapper title="Archived Chats" onClose={() => setActiveModal(null)}>
          {loadingSection ? <SectionLoading /> : archivedChats.length === 0 ? (
            <EmptySection message="You have no archived chats." />
          ) : (
            <div className="divide-y divide-paper-line">
              {archivedChats.map((chat) => (
                <div key={chat.conversation_id} className="flex items-center gap-3 py-3">
                  <button onClick={() => openContact(chat)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-semibold text-ink">{chat.other_name || `+${chat.other_phone ?? ''}`}</div>
                    <div className="truncate text-xs text-ink-mute">{chat.last_message_preview || 'No messages yet'}</div>
                  </button>
                  <button
                    disabled={workingId === chat.conversation_id}
                    onClick={() => void restoreChat(chat.conversation_id)}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-brand-700 disabled:opacity-50"
                    title="Restore chat"
                  >
                    <RotateCcw className="h-4 w-4" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </ModalWrapper>
      )}

      {activeModal === 'starred' && (
        <ModalWrapper title="Starred Messages" onClose={() => setActiveModal(null)}>
          {loadingSection ? <SectionLoading /> : starredMessages.length === 0 ? (
            <EmptySection message="Star a message in a conversation to keep it here." />
          ) : (
            <div className="divide-y divide-paper-line">
              {starredMessages.map(({ message }) => (
                <div key={message.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-ink">
                      {message.body || (message.type === 'image' ? 'Photo' : message.type === 'voice' ? 'Voice message' : message.type === 'video' ? 'Video' : 'Attachment')}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-mute">{formatChatTime(message.created_at)}</p>
                  </div>
                  <button
                    disabled={workingId === message.id}
                    onClick={() => void removeStar(message.id)}
                    className="rounded-lg p-2 text-rose-600 disabled:opacity-50"
                    title="Remove star"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </ModalWrapper>
      )}

      {/* 2. QR Code Modal */}
      {activeModal === 'qr-code' && (
        <ModalWrapper title={`Your ${APP_NAME} QR`} onClose={() => setActiveModal(null)}>
          <div className="flex flex-col items-center text-center py-4">
            <div className="p-4 bg-white rounded-3xl shadow-2xl mb-4">
              <div className="w-48 h-48 bg-[#100e20] rounded-2xl flex items-center justify-center p-4 relative overflow-hidden">
                <QrCode className="w-36 h-36 text-brand-600" />
                <div className="absolute inset-0 bg-gradient-to-tr from-brand-500/10 to-brand-600/5 pointer-events-none"></div>
              </div>
            </div>
            <h4 className="font-bold text-lg text-ink">{profile.name}</h4>
            <p className="text-xs text-ink-mute mt-0.5">{profile.phone}</p>
            <p className="text-xs text-ink-faint mt-2 max-w-xs">
              Your friends can scan this QR code with their phone camera to instantly start a private chat with you.
            </p>

            <button
              onClick={() => {
                navigator.clipboard?.writeText(`${window.location.origin}/u/johndoe`);
                showToast('Invite link copied!');
              }}
              className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-full bg-paper-mist hover:bg-brand-100 text-ink text-xs font-semibold transition-all"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Invite Link</span>
            </button>
          </div>
        </ModalWrapper>
      )}

      {/* 3. Privacy Modal */}
      {activeModal === 'privacy' && (
        <ModalWrapper title="Privacy Settings" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-paper-line">
              <div>
                <div className="text-sm font-semibold text-ink">Read Receipts</div>
                <div className="text-xs text-ink-mute">Show blue/cyan checkmarks when seen</div>
              </div>
              <button
                disabled={settingsLoading || savingSettings}
                onClick={() => void saveSettings('privacy', { read_receipts: !settings.privacy.read_receipts }, `Read receipts ${!settings.privacy.read_receipts ? 'enabled' : 'disabled'}`)}
                className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${settings.privacy.read_receipts ? 'bg-brand-600' : 'bg-paper-line2'
                  }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 ${settings.privacy.read_receipts ? 'left-[22px]' : 'left-0.5'
                    }`}
                ></div>
              </button>
            </div>

            <div className="py-2 border-b border-paper-line">
              <div className="text-sm font-semibold text-ink mb-1">Who can see Last Seen</div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {(['Everyone', 'Contacts', 'Nobody'] as const).map((opt) => (
                  <button
                    key={opt}
                    disabled={settingsLoading || savingSettings}
                    onClick={() => void saveSettings('privacy', { last_seen: opt }, `Last seen set to ${opt}`)}
                    className={`py-1.5 rounded-lg text-xs font-medium border disabled:opacity-50 ${settings.privacy.last_seen === opt
                      ? 'bg-brand-600/10 border-brand-600 text-brand-600'
                      : 'bg-paper-mist border-paper-line text-ink-mute'
                      }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="py-2">
              <div className="text-sm font-semibold text-ink mb-1">Disappearing Messages</div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {(['Off', '24h', '7d', '90d'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={settingsLoading || savingSettings}
                    onClick={() => void saveSettings('privacy', { disappearing_timer: t }, `Disappearing messages: ${t}`)}
                    className={`py-1.5 rounded-lg text-xs font-medium border disabled:opacity-50 ${settings.privacy.disappearing_timer === t
                      ? 'bg-brand-600/10 border-brand-600 text-brand-600'
                      : 'bg-paper-mist border-paper-line text-ink-mute'
                      }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ModalWrapper>
      )}

      {/* 4. Security Modal */}
      {activeModal === 'security' && (
        <ModalWrapper title="Security & Protection" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-brand-600/10 border border-emerald-500/20 flex items-start gap-3">
              <Shield className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-ink-soft leading-relaxed">
                <span className="font-bold text-ink block mb-0.5">Secure Messaging</span>
                Direct and group text require published, independently verified member keys. Media and calls are not end-to-end encrypted. This custom key exchange does not provide Signal-style forward secrecy and has not had an independent security audit.
              </div>
            </div>

            <div className="flex items-center justify-between py-2.5 border-b border-paper-line">
              <div>
                <div className="text-sm font-semibold text-ink">Two-Step Verification</div>
                <div className="text-xs text-ink-mute">Require PIN when re-registering phone</div>
              </div>
              <button
                disabled={settingsLoading || savingSettings || preparingTwoFactor}
                onClick={() => void beginTwoFactorSetup(!settings.security.two_factor_auth)}
                className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${settings.security.two_factor_auth ? 'bg-brand-600' : 'bg-paper-line2'
                  }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 ${settings.security.two_factor_auth ? 'left-[22px]' : 'left-0.5'
                    }`}
                ></div>
              </button>
            </div>

            <div className="flex items-center justify-between py-2.5 border-b border-paper-line">
              <div>
                <div className="text-sm font-semibold text-ink">Biometric App Lock</div>
                <div className="text-xs text-ink-mute">Use the device biometric or screen lock</div>
              </div>
              <button
                disabled={settingsLoading || savingSettings || !isNative()}
                onClick={() => {
                  const next = !settings.security.biometrics_lock;
                  void (async () => {
                    try {
                      const persisted = await applyDeviceAppLock(next);
                      await saveSettings('security', { biometrics_lock: persisted }, `Device lock ${next ? 'enabled' : 'disabled'}`);
                    } catch (error) {
                      showToast(error instanceof Error ? error.message : 'Could not update device lock');
                    }
                  })();
                }}
                className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${settings.security.biometrics_lock ? 'bg-brand-600' : 'bg-paper-line2'
                  }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 ${settings.security.biometrics_lock ? 'left-[22px]' : 'left-0.5'
                    }`}
                ></div>
              </button>
            </div>
            {!isNative() && <p className="text-xs text-ink-faint">Device lock controls are available in the installed app.</p>}

            <div className="rounded-xl border border-paper-line bg-paper-mist p-3 text-xs text-ink-mute">
              Device encryption keys are kept in the operating system secure store on native apps and encrypted IndexedDB on web.
            </div>
          </div>
        </ModalWrapper>
      )}

      {activeModal === 'two-factor' && (
        <ModalWrapper
          title={twoFactorIntent ? 'Enable Two-Step Verification' : 'Disable Two-Step Verification'}
          onClose={() => setActiveModal('security')}
        >
          <form onSubmit={(event) => void submitTwoFactorSetup(event)} className="space-y-3">
            <p className="text-xs text-ink-mute">Verify your phone number with the SMS code to {twoFactorIntent ? 'set' : 'change'} account protection.</p>
            {twoFactorDevCode && <p className="text-xs text-amber-700">Dev code: <b>{twoFactorDevCode}</b></p>}
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, ''))}
              placeholder="SMS verification code"
              className="w-full rounded-xl border border-paper-line bg-paper-mist px-3 py-2.5 text-center text-sm tabular-nums"
            />
            {twoFactorIntent ? (
              <input
                required
                inputMode="numeric"
                maxLength={12}
                minLength={6}
                value={twoFactorPin}
                onChange={(event) => setTwoFactorPin(event.target.value.replace(/\D/g, ''))}
                placeholder="New PIN (6 to 12 digits)"
                className="w-full rounded-xl border border-paper-line bg-paper-mist px-3 py-2.5 text-center text-sm tabular-nums"
              />
            ) : (
              <input
                required
                inputMode="numeric"
                maxLength={12}
                minLength={6}
                value={twoFactorCurrentPin}
                onChange={(event) => setTwoFactorCurrentPin(event.target.value.replace(/\D/g, ''))}
                placeholder="Current security PIN"
                className="w-full rounded-xl border border-paper-line bg-paper-mist px-3 py-2.5 text-center text-sm tabular-nums"
              />
            )}
            <button
              type="submit"
              disabled={savingSettings}
              className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingSettings ? 'Verifying…' : 'Confirm'}
            </button>
          </form>
        </ModalWrapper>
      )}

      {/* 5. Chat Wallpaper Modal */}
      {activeModal === 'wallpaper' && (
        <ModalWrapper title="Chat Wallpaper" onClose={() => setActiveModal(null)}>
          <div className="grid grid-cols-3 gap-3 my-2">
            {([
              { id: 'default', name: 'Vine Green', bg: 'wc-vine' },
              { id: 'light', name: 'Soft Vine', bg: 'wc-vine wc-vine-light' },
              { id: 'plain', name: 'Plain White', bg: 'bg-white' },
            ] as const).map((wp) => (
              <button
                key={wp.id}
                disabled={settingsLoading || savingSettings}
                onClick={() => {
                  void saveSettings('appearance', { wallpaper: wp.id }, `Wallpaper changed to ${wp.name}`);
                  setActiveModal(null);
                }}
                className={`p-3 rounded-2xl flex flex-col items-center gap-2 border transition-all disabled:opacity-50 ${wp.bg} ${settings.appearance.wallpaper === wp.id
                  ? 'border-brand-500 shadow-lg shadow-brand-600/25 scale-105'
                  : 'border-paper-line hover:border-brand-300'
                  }`}
              >
                <div className="w-8 h-8 rounded-full border border-paper-line2 flex items-center justify-center">
                  {settings.appearance.wallpaper === wp.id && <Check className="w-4 h-4 text-brand-600" />}
                </div>
                <span className="text-xs font-semibold text-ink">{wp.name}</span>
              </button>
            ))}
          </div>
        </ModalWrapper>
      )}

      {/* 5b. Voice Note Translation Modal */}
      {activeModal === 'translation' && (
        <ModalWrapper title="Voice Note Translation" onClose={() => setActiveModal(null)}>
          <p className="text-xs text-ink-faint mb-3">
            When this is on, voice notes you receive play back as a real spoken voice note in the language you pick below — just audio, nothing written. When it's off, voice notes play exactly as sent, in the original speaker's own language.
          </p>
          <div className="flex gap-2 mb-4">
            {([
              { id: 'off', name: 'Off' },
              { id: 'on', name: 'On' },
            ] as const).map((m) => (
              <button
                key={m.id}
                disabled={settingsLoading || savingSettings}
                onClick={() => void saveSettings('translation', { mode: m.id }, `Voice translation: ${m.name}`)}
                className={`flex-1 px-2 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-50 ${settings.translation.mode === m.id
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'border-paper-line text-ink hover:border-brand-300'
                  }`}
              >
                {m.name}
              </button>
            ))}
          </div>
          {settings.translation.mode !== 'off' && (
            <>
              <p className="text-xs font-semibold text-ink-faint mb-2">Translate into</p>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {TRANSLATION_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    disabled={settingsLoading || savingSettings}
                    onClick={() => void saveSettings('translation', { language: lang.code }, `Translation language: ${lang.name}`)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all disabled:opacity-50 ${settings.translation.language === lang.code
                      ? 'border-brand-500 bg-brand-50/60'
                      : 'border-paper-line hover:border-brand-300'
                      }`}
                  >
                    <span className="text-sm text-ink">{lang.name}</span>
                    {settings.translation.language === lang.code && <Check className="w-4 h-4 text-brand-600" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </ModalWrapper>
      )}

      {/* 6. Notifications Modal */}
      {activeModal === 'notifications' && (
        <ModalWrapper title="Notifications" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-paper-line bg-paper-mist p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-ink">Push notifications</div>
                  <div className="text-xs text-ink-mute">Device permission status: {notificationPermission === 'granted' ? 'Enabled' : notificationPermission === 'denied' ? 'Blocked' : notificationPermission === 'unsupported' ? 'Unavailable' : 'Not configured'}</div>
                </div>
                <button
                  onClick={() => void requestNativeNotificationPermission()}
                  className="rounded-full bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  {notificationPermission === 'granted' ? 'Manage' : 'Enable'}
                </button>
              </div>
            </div>

            <div className="py-2 border-b border-paper-line">
              <div className="text-sm font-semibold text-ink mb-2">Message Alert Tone</div>
              <div className="space-y-1.5">
                {(['Pulse Chime', 'Aurora', 'Celestial Bell'] as const).map((tone) => (
                  <button
                    key={tone}
                    disabled={settingsLoading || savingSettings}
                    onClick={() => void saveSettings('notifications', { sound: tone }, `Tone set to ${tone}`)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50 ${settings.notifications.sound === tone
                      ? 'bg-brand-600/10 text-brand-600'
                      : 'bg-paper-mist text-ink-soft'
                      }`}
                  >
                    <span>{tone}</span>
                    {settings.notifications.sound === tone && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-semibold text-ink">Vibrate on Message</div>
                <div className="text-xs text-ink-mute">Gentle haptic touch on incoming chat</div>
              </div>
              <button
                disabled={settingsLoading || savingSettings}
                onClick={() => void saveSettings('notifications', { vibrate: !settings.notifications.vibrate }, `Vibration ${!settings.notifications.vibrate ? 'enabled' : 'disabled'}`)}
                className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${settings.notifications.vibrate ? 'bg-brand-600' : 'bg-paper-line2'
                  }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 ${settings.notifications.vibrate ? 'left-[22px]' : 'left-0.5'
                    }`}
                ></div>
              </button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-semibold text-ink">Message Preview</div>
                <div className="text-xs text-ink-mute">Show message text in notifications</div>
              </div>
              <button
                disabled={settingsLoading || savingSettings}
                onClick={() => void saveSettings('notifications', { preview: !settings.notifications.preview }, `Message preview ${!settings.notifications.preview ? 'enabled' : 'disabled'}`)}
                className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${settings.notifications.preview ? 'bg-brand-600' : 'bg-paper-line2'}`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 ${settings.notifications.preview ? 'left-[22px]' : 'left-0.5'}`}
                ></div>
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}

      {/* 7. Storage & Data Modal */}
      {activeModal === 'storage' && (
        <ModalWrapper title="Storage & Data" onClose={() => setActiveModal(null)}>
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-paper-mist border border-paper-line">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs font-semibold text-ink-mute">Uploaded media</div>
                <div className="text-sm font-bold text-ink">{storageUsage ? formatBytes(storageUsage.total_bytes) : '...'}</div>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint">{storageUsage?.total_files ?? 0} files stored for your account</p>
              <div className="mt-4 space-y-3">
                {storageUsage ? (['photos', 'videos', 'audio', 'files'] as const).map((kind) => {
                  const item = storageUsage.by_type[kind];
                  const ratio = storageUsage.total_bytes ? item.bytes / storageUsage.total_bytes * 100 : 0;
                  const colors = { photos: 'bg-emerald-500', videos: 'bg-sky-500', audio: 'bg-amber-500', files: 'bg-rose-500' };
                  return (
                    <div key={kind}>
                      <div className="mb-1 flex justify-between text-xs text-ink-mute">
                        <span className="capitalize">{kind}</span>
                        <span>{formatBytes(item.bytes)} · {item.files}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-paper-line">
                        <div className={`h-full ${colors[kind]}`} style={{ width: `${ratio}%` }} />
                      </div>
                    </div>
                  );
                }) : <SectionLoading />}
              </div>
            </div>

            <button
              onClick={() => void clearTemporaryCache()}
              className="w-full py-2.5 rounded-xl border border-paper-line text-xs font-semibold text-ink-soft hover:bg-brand-50 active:scale-95 transition-all"
            >
              Clear Temporary Cache
            </button>
          </div>
        </ModalWrapper>
      )}

      {/* 8. Help Modal */}
      {activeModal === 'help' && (
        <ModalWrapper title="Help & About" onClose={() => setActiveModal(null)}>
          <div className="space-y-3">
            <form onSubmit={(event) => void submitSupportRequest(event)} className="space-y-3 rounded-xl border border-paper-line bg-paper-mist p-3">
              <div>
                <h4 className="font-bold text-sm text-ink">{APP_NAME} Support</h4>
                <p className="mt-1 text-xs text-ink-mute">Send a request to the support team.</p>
              </div>
              <input
                required
                maxLength={100}
                value={supportSubject}
                onChange={(event) => setSupportSubject(event.target.value)}
                placeholder="Subject"
                className="w-full rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand-500"
              />
              <textarea
                required
                maxLength={2000}
                rows={4}
                value={supportMessage}
                onChange={(event) => setSupportMessage(event.target.value)}
                placeholder="How can we help?"
                className="w-full resize-y rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand-500"
              />
              <button
                type="submit"
                disabled={sendingSupport}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {sendingSupport ? 'Sending...' : 'Send request'}
              </button>
            </form>
            <div className="p-3 rounded-xl bg-paper-mist border border-paper-line">
              <h4 className="font-bold text-sm text-ink mb-0.5">Privacy Manifesto</h4>
              <p className="text-xs text-ink-mute">
                {APP_NAME} never sells your personal metadata or uses conversations for targeted advertising.
              </p>
            </div>
          </div>
        </ModalWrapper>
      )}

      {/* 9. Logout Confirmation Modal */}
      {activeModal === 'logout' && (
        <ModalWrapper title="Log Out" onClose={() => setActiveModal(null)}>
          <div className="text-center py-3">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <LogOut className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-base text-ink">Log out of {APP_NAME}?</h4>
            <p className="text-xs text-ink-mute mt-1 max-w-xs mx-auto">
              Your messages and secret keys are stored securely on this device.
            </p>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setActiveModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-paper-line text-xs font-bold text-ink-soft hover:bg-brand-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setActiveModal(null);
                  onLogout?.();
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-xs font-bold text-white"
              >
                Log Out
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-paper-line py-2">
      <div className="text-xs font-semibold uppercase text-ink-faint">{label}</div>
      <div className="mt-1 break-words text-sm text-ink">{value}</div>
    </div>
  );
}

function SectionLoading() {
  return <div className="py-10 text-center text-sm text-ink-mute">Loading...</div>;
}

function EmptySection({ message }: { message: string }) {
  return <div className="py-10 text-center text-sm text-ink-mute">{message}</div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function SettingRow({
  icon: Icon,
  label,
  color,
  badge,
  onClick,
}: {
  icon: typeof User;
  label: string;
  color: string;
  badge?: string;
  onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-brand-600/10 text-brand-600',
    sky: 'bg-sky-500/10 text-sky-600',
    amber: 'bg-amber-500/10 text-amber-600',
    rose: 'bg-rose-500/10 text-rose-600',
    violet: 'bg-violet-500/10 text-violet-600',
    teal: 'bg-teal-500/10 text-teal-600',
    gray: 'bg-gray-500/10 text-ink-mute',
  };

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper-tint active:bg-brand-50"
    >
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${colorMap[color] || 'bg-brand-600/10 text-brand-600'
          }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <span className="flex-1 text-[13px] font-semibold text-ink">{label}</span>
      {badge && (
        <span className="px-2 py-0.5 rounded-full bg-brand-600/10 text-brand-600 text-[10px] font-semibold">
          {badge}
        </span>
      )}
      <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function ModalWrapper({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 bg-[#0f1720]/50 backdrop-blur-[2px]">
      <div className="flex h-full w-full flex-col bg-paper shadow-2xl">
        <div className="flex items-center justify-between border-b border-paper-line px-4 pt-12 pb-3">
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-paper-mist text-ink transition-colors hover:bg-brand-50"
            aria-label="Back"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
          <h3 className="flex-1 px-3 text-center text-[18px] font-bold tracking-[-0.03em] text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-paper-mist text-ink transition-colors hover:bg-brand-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
