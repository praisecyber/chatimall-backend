import { useState, useEffect } from 'react';
import { ArrowLeft, Monitor, Smartphone } from 'lucide-react';
import LandingPage from '@/components/LandingPage';
import MobileApp from '@/components/MobileApp';
import { AuthProvider, useAuth } from '@/lib/auth';
import { CallProvider } from '@/lib/calls';
import { isNative, unregisterPush } from '@/lib/native';
import { AuthScreen, ProfileSetup, FullScreenSpinner } from '@/components/AuthScreen';
import type { Screen, Chat } from '@/types';

type View = 'landing' | 'app';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { userId, profile, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (!userId || !profile) return <AuthScreen />;
  if (!profile.name) return <ProfileSetup />;
  return <>{children}</>;
}

function App() {
  const { signOut } = useAuth();
  const [view, setView] = useState<View>(() => {
    if (isNative()) return 'app'; // the Android app skips the marketing page
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.toLowerCase();
      const params = new URLSearchParams(window.location.search);
      if (hash === '#app' || params.get('view') === 'app') {
        return 'app';
      }
    }
    return 'landing';
  });

  const [screen, setScreen] = useState<Screen>('chats');
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  // Default to desktop 2-column layout on PC
  const [desktopMode, setDesktopMode] = useState<'phone' | 'desktop'>(() =>
    isNative() || window.innerWidth < 768 ? 'phone' : 'desktop'
  );
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => window.innerWidth < 768);
  const desktopLayout = desktopMode === 'desktop' && !isNarrowViewport;

  useEffect(() => {
    const onResize = () => setIsNarrowViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const handleHash = () => {
      if (isNative()) return;
      if (window.location.hash === '#app') {
        setView('app');
      } else if (window.location.hash === '' || window.location.hash === '#top') {
        setView('landing');
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const openApp = () => {
    window.location.hash = 'app';
    setView('app');
    setScreen('chats');
    setActiveChat(null);
  };

  const backToLanding = () => {
    window.location.hash = '';
    if (!isNative()) setView('landing');
  };

  const logout = async () => {
    await unregisterPush();
    await signOut();
    setActiveChat(null);
    backToLanding();
  };

  if (view === 'landing') {
    return <LandingPage onDownload={openApp} />;
  }

  return (
    <AuthGate>
    <CallProvider>
    <div className="min-h-screen bg-paper-deep flex items-center justify-center p-0 md:p-6 relative">
      {/* Top Bar on Desktop */}
      <div className="hidden md:flex absolute top-4 left-6 right-6 items-center justify-between z-50">
        <button
          onClick={backToLanding}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-brand-50 text-ink-mute hover:text-ink transition-colors text-xs font-semibold border border-paper-line shadow-sm"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to landing page</span>
        </button>

        {/* View Switcher (desktop layout vs Mobile Phone preview) */}
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-paper-line shadow-sm">
          <button
            onClick={() => setDesktopMode('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              desktopMode === 'desktop' ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-mute hover:text-ink'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" /> Desktop View
          </button>
          <button
            onClick={() => setDesktopMode('phone')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              desktopMode === 'phone' ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-mute hover:text-ink'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" /> Mobile Phone
          </button>
        </div>
      </div>

      {/* App Container */}
      <div
        className={`relative w-full h-dvh overflow-hidden bg-[#0f1623] transition-all duration-300 ${
          desktopMode === 'phone'
            ? 'md:w-[390px] md:h-[800px] md:rounded-[3rem] md:border-[10px] md:border-gray-800 md:shadow-2xl md:mt-8'
            : 'md:w-full md:max-w-[1360px] md:h-[calc(100vh-76px)] md:rounded-2xl md:border border-white/10 md:shadow-2xl md:mt-12'
        }`}
      >
        {/* Notch (phone mode only) */}
        {desktopMode === 'phone' && (
          <div className="hidden md:block absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-2xl z-50"></div>
        )}

        <MobileApp
          screen={screen}
          setScreen={setScreen}
          activeChat={activeChat}
          setActiveChat={setActiveChat}
          onLogout={logout}
          isDesktopView={desktopLayout}
        />
      </div>
    </div>
    </CallProvider>
    </AuthGate>
  );
}

export default function Root() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
