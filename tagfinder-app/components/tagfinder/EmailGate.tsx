'use client';

import { useState } from 'react';
import { Mail, Loader2, ShieldCheck } from 'lucide-react';
import { useTagFinderAuth } from '@/hooks/useTagFinderAuth';

interface EmailGateProps {
  /** Called when verification succeeds */
  onVerified?: () => void;
}

/**
 * Email gate shown before analysis. Two-step OTP flow:
 *   1. User enters email → we send a 6-digit code
 *   2. User enters code → we verify and create a session
 */
export default function EmailGate({ onVerified }: EmailGateProps) {
  const { sendOtp, verifyOtp } = useTagFinderAuth();
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    const { error: err } = await sendOtp(email);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    setPhase('code');
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    const { error: err } = await verifyOtp(email, code);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    onVerified?.();
  };

  return (
    <div className="max-w-md mx-auto bg-surface rounded-xl border border-border p-6">
      {phase === 'email' ? (
        <>
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-lg">Enter your email to continue</h3>
          </div>

          <p className="text-sm text-muted mb-4">
            We&apos;ll send you a 6-digit code to verify. This helps prevent abuse
            of the free analysis service and lets us notify you about tool
            updates. We don&apos;t share your email.
          </p>

          <form onSubmit={handleSendCode} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg bg-surface-elevated border border-border text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
            />

            {error && (
              <div className="text-sm text-error p-2.5 rounded bg-error/10 border border-error/20">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-2.5 rounded-lg bg-primary text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-light transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending code...
                </>
              ) : (
                'Send verification code'
              )}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-lg">Enter the code</h3>
          </div>

          <p className="text-sm text-muted mb-4">
            We sent a verification code to <strong className="text-foreground">{email}</strong>.
            Enter it below.
          </p>

          <form onSubmit={handleVerifyCode} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="code"
              maxLength={10}
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg bg-surface-elevated border border-border text-foreground placeholder:text-muted focus:border-primary focus:outline-none text-center text-2xl font-mono tracking-widest"
            />

            {error && (
              <div className="text-sm text-error p-2.5 rounded bg-error/10 border border-error/20">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full py-2.5 rounded-lg bg-primary text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-light transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify and continue'
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setPhase('email');
                setCode('');
                setError(null);
              }}
              className="w-full text-xs text-muted hover:text-foreground transition-colors pt-1"
            >
              ← Use a different email
            </button>
          </form>
        </>
      )}
    </div>
  );
}
