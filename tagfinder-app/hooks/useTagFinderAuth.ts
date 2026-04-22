'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase';

interface UseAuthReturn {
  session: Session | null;
  email: string | null;
  loading: boolean;
  /** Send a 6-digit OTP to the email */
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  /** Verify the OTP and create a session */
  verifyOtp: (
    email: string,
    code: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

/**
 * Lightweight auth for TagFinder:
 *   - Email-only (no password)
 *   - OTP (6-digit code emailed to user)
 *   - Session persists in the browser for ~30 days
 *
 * Usage:
 *   const { session, sendOtp, verifyOtp } = useTagFinderAuth();
 *   if (!session) <EmailGate />;
 */
export function useTagFinderAuth(): UseAuthReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    try {
      const supabase = createSupabaseBrowserClient();

      supabase.auth.getSession().then(({ data }) => {
        if (!cancelled) {
          setSession(data.session);
          setLoading(false);
        }
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s);
      });

      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    } catch {
      // Supabase env vars missing — dev mode without auth
      if (!cancelled) setLoading(false);
    }
  }, []);

  const sendOtp = useCallback(async (email: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          // Don't create new users via magic link, only OTP codes
          shouldCreateUser: true,
        },
      });
      if (error) return { error: error.message };
      return { error: null };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Failed to send code',
      };
    }
  }, []);

  const verifyOtp = useCallback(async (email: string, code: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: 'email',
      });
      if (error) return { error: error.message };
      if (!data.session) return { error: 'No session created' };
      setSession(data.session);
      return { error: null };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Failed to verify code',
      };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      setSession(null);
    } catch {
      // ignore
    }
  }, []);

  return {
    session,
    email: session?.user?.email ?? null,
    loading,
    sendOtp,
    verifyOtp,
    signOut,
  };
}
