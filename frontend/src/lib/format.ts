/** Small offline avatar (initials on a colored circle) as a data URI. */
export function initialsAvatar(name: string, seed = ''): string {
  const label = (name || seed || '?').trim();
  // letters/numbers only, so an emoji in the name (e.g. "Squad 💚") never lands in the initials
  const words = label.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const initials =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : words.length === 1
      ? label.replace(/\D/g, '').length > 3
        ? '#'
        : words[0].slice(0, 2).toUpperCase()
      : '#';
  const colors = ['#0F8A5F', '#0B7A54', '#2FA37A', '#1F7A6B', '#4E9A6B', '#178F8F', '#B8842A', '#C0654A'];
  let h = 0;
  for (const ch of label + seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = colors[h % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${bg}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="38" font-weight="700" fill="#fff">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return formatClock(iso);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.max(0, Math.round(secs % 60));
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Turns "+1 (555) 123-4567" into "+15551234567". Returns null if it isn't plausible. */
export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s()\-.]/g, '');
  return /^\+\d{7,15}$/.test(cleaned) ? cleaned : null;
}
