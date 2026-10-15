import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, assetUrl, getToken, setToken, setUnauthorizedHandler, storedUrl } from '@/lib/http';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { uploadFile } from '@/lib/api';
import { publishPublicKey } from '@/lib/e2ee';
import type { DbProfile } from '@/types';

interface AuthValue {
  userId: string | null;
  profile: DbProfile | null;
  loading: boolean;
  /** Sends the SMS code. In dev mode the server may return the code (dev_code). */
  requestOtp: (phone: string) => Promise<{ devCode?: string }>;
  verifyOtp: (phone: string, code: string, pin?: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<DbProfile, 'name' | 'bio' | 'avatar_url'>>) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const fixProfile = (p: DbProfile): DbProfile => ({ ...p, avatar_url: assetUrl(p.avatar_url) });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<DbProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const clear = useCallback(() => {
    setToken(null);
    disconnectSocket();
    setProfile(null);
  }, []);

  // restore the session on app start
  useEffect(() => {
    setUnauthorizedHandler(clear);
    if (!getToken()) return;
    api<DbProfile>('/api/me')
      .then((p) => {
        setProfile(fixProfile(p));
        void publishPublicKey().catch(() => { });
        connectSocket();
      })
      .catch((err: { status?: number }) => {
        if (err.status === 401) clear(); // network errors keep the token so you stay signed in
      })
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const requestOtp = useCallback(async (phone: string) => {
    const res = await api<{ ok: boolean; dev_code?: string }>('/api/auth/otp/request', { body: { phone } });
    return { devCode: res.dev_code };
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string, pin?: string) => {
    const res = await api<{ token: string; user: DbProfile }>('/api/auth/otp/verify', { body: { phone, code, ...(pin ? { pin } : {}) } });
    setToken(res.token);
    setProfile(fixProfile(res.user));
    void publishPublicKey().catch(() => { });
    connectSocket();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!getToken()) return;
    setProfile(fixProfile(await api<DbProfile>('/api/me')));
  }, []);

  const updateProfile: AuthValue['updateProfile'] = useCallback(async (patch) => {
    const body: Record<string, unknown> = { ...patch };
    if ('avatar_url' in patch) body.avatar_url = storedUrl(patch.avatar_url);
    setProfile(fixProfile(await api<DbProfile>('/api/me', { method: 'PATCH', body })));
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    const res = await uploadFile(file, file.name);
    return assetUrl(res.url) ?? res.url;
  }, []);

  const signOut = useCallback(async () => {
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({
      userId: profile?.id ?? null,
      profile,
      loading,
      requestOtp,
      verifyOtp,
      refreshProfile,
      updateProfile,
      uploadAvatar,
      signOut,
    }),
    [profile, loading, requestOtp, verifyOtp, refreshProfile, updateProfile, uploadAvatar, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
