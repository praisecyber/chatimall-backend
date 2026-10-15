/**
 * Talks to the Chatimall server (Node + MongoDB).
 * - In development the Vite dev server proxies /api and /socket.io to localhost:4000, so API_BASE is empty.
 * - In the Android app (and any separate hosting) set VITE_API_URL=https://your-server.example.com
 */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

const TOKEN_KEY = 'chatimall_token';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0, 'NETWORK');
  }

  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(data?.message || data?.error || `Request failed (${res.status})`, res.status, data?.error ?? 'ERROR');
  }
  return data as T;
}

/** Files are stored as "/api/files/<key>"; make them loadable from wherever the app is hosted. */
export const assetUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  return u.startsWith('/') ? `${API_BASE}${u}` : u;
};

/** Reverse of assetUrl – what we send back to the server. */
export const storedUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  return API_BASE && u.startsWith(API_BASE) ? u.slice(API_BASE.length) : u;
};
