import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Loader2, ShieldCheck } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '@/brand';
import BrandMark from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/http';
import { initialsAvatar, normalizePhone } from '@/lib/format';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full wc-vine flex flex-col items-center justify-center p-4 text-ink">
      <div className="flex items-center gap-2.5 mb-7">
        <BrandMark size={40} />
        <div className="leading-tight">
          <div className="font-extrabold text-lg tracking-tight text-ink">{APP_NAME}</div>
          <div className="text-[11px] text-brand-700 font-medium">{APP_TAGLINE}</div>
        </div>
      </div>
      <div className="w-full max-w-md bg-white rounded-3xl p-7 shadow-lift ring-1 ring-black/[0.03]">
        {children}
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-4 py-3.5 rounded-2xl bg-paper-mist border border-transparent focus:bg-white focus:border-brand-600/30 outline-none text-ink placeholder-ink-faint text-sm transition-colors';
const btnCls =
  'w-full py-3.5 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-lift hover:brightness-110 transition';

/** Phone number → OTP code (verified by the Chatimall server). */
export function AuthScreen() {
  const { requestOtp, verifyOtp } = useAuth();
  const [devCode, setDevCode] = useState<string | null>(null);
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [secondFactorRequired, setSecondFactorRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      setError('Enter your number with country code, e.g. +15551234567');
      return;
    }
    setBusy(true);
    try {
      const res = await requestOtp(normalized);
      setDevCode(res.devCode ?? null);
      setPhone(normalized);
      setPin('');
      setSecondFactorRequired(false);
      setStep('otp');
      setCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    }
    setBusy(false);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (code.trim().length < 4) {
      setError('Enter the code we sent you.');
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(phone, code.trim(), secondFactorRequired ? pin : undefined);
      // on success the auth context takes over and the app opens
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SECOND_FACTOR_REQUIRED') {
        setSecondFactorRequired(true);
        setError(null);
      } else if (err instanceof ApiError && err.code === 'BAD_SECOND_FACTOR') {
        setSecondFactorRequired(true);
        setError('That security PIN is incorrect.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not verify the code.');
      }
      setBusy(false);
    }
  };

  return (
    <Shell>
      {step === 'phone' ? (
        <form onSubmit={sendCode} className="space-y-4">
          <div>
            <h1 className="text-xl font-bold">Your phone number</h1>
            <p className="text-sm text-ink-mute mt-1">
              We will send a verification code. Include your country code.
            </p>
          </div>
          <input
            autoFocus
            type="tel"
            inputMode="tel"
            placeholder="+1 555 123 4567"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            className={inputCls}
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button type="submit" disabled={busy} className={btnCls}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send code
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setStep('phone');
              setCode('');
              setPin('');
              setSecondFactorRequired(false);
              setError(null);
            }}
            className="flex items-center gap-1 text-xs text-ink-mute hover:text-ink"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Change number
          </button>
          <div>
            <h1 className="text-xl font-bold">Enter the code</h1>
            <p className="text-sm text-ink-mute mt-1">Sent to +{phone.replace(/^\+/, '')}</p>
            {devCode && (
              <p className="text-xs text-amber-700 mt-2">Dev mode: your code is <b className="tabular-nums">{devCode}</b></p>
            )}
          </div>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={`${inputCls} text-center tracking-[0.4em] text-lg tabular-nums`}
          />
          {secondFactorRequired && (
            <div>
              <label htmlFor="account-security-pin" className="mb-1 block text-xs font-semibold text-ink-soft">Account security PIN</label>
              <input
                id="account-security-pin"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                placeholder="6 to 12 digits"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                className={`${inputCls} text-center tracking-[0.3em] text-lg tabular-nums`}
              />
            </div>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button type="submit" disabled={busy} className={btnCls}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Verify
          </button>
          <button
            type="button"
            disabled={cooldown > 0 || busy}
            onClick={() => sendCode()}
            className="w-full text-xs text-brand-600 disabled:text-gray-500"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        </form>
      )}
      <div className="mt-6 flex items-center gap-2 text-[11px] text-ink-faint">
        <ShieldCheck className="w-3.5 h-3.5 text-brand-600" /> Your number is only used to sign you in and let friends find you.
      </div>
    </Shell>
  );
}

/** First-time setup: name + photo. */
export function ProfileSetup() {
  const { profile, updateProfile, uploadAvatar } = useAuth();
  const [name, setName] = useState(profile?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      setAvatarUrl(await uploadAvatar(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
    setBusy(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setBusy(true);
    try {
      await updateProfile({ name: name.trim(), avatar_url: avatarUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
    setBusy(false);
  };

  return (
    <Shell>
      <form onSubmit={save} className="space-y-5">
        <div>
          <h1 className="text-xl font-bold">Set up your profile</h1>
          <p className="text-sm text-ink-mute mt-1">This is how your friends will see you.</p>
        </div>
        <div className="flex justify-center">
          <button type="button" onClick={() => fileRef.current?.click()} className="relative">
            <img
              src={avatarUrl || initialsAvatar(name, profile?.phone ?? '')}
              alt="avatar"
              className="w-24 h-24 rounded-full object-cover border-2 border-brand-600/30"
            />
            <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center border-2 border-[#131b29]">
              <Camera className="w-4 h-4 text-white" />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <input
          autoFocus
          maxLength={40}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <button type="submit" disabled={busy} className={btnCls}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Continue
        </button>
      </form>
    </Shell>
  );
}

export function FullScreenSpinner() {
  return (
    <div className="min-h-screen bg-paper-deep flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
    </div>
  );
}
