'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, Organization } from '@/lib/types';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  loading: boolean;
  isAdmin: boolean;
  isSubscriber: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSubscriber, setIsSubscriber] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const initialLoadDone = useRef(false);

  useEffect(() => {
    // Safety timeout: if loading takes more than 8 seconds, force it to stop.
    // This prevents a permanent "Loading..." screen from network issues.
    const safetyTimeout = setTimeout(() => {
      setLoading((current) => {
        if (current) {
          console.warn('[Auth] Safety timeout: forcing loading to false after 8s');
          return false;
        }
        return current;
      });
    }, 8000);

    // Get initial session — this is the primary init path
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        console.error('[Auth] Error getting session:', error.message);
        await supabase.auth.signOut({ scope: 'local' }).catch(console.error);
        setSession(null);
        setProfile(null);
        setOrganization(null);
        initialLoadDone.current = true;
        setLoading(false);
        return;
      }

      setSession(session);
      if (session?.user) {
        await loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
      initialLoadDone.current = true;
    }).catch((err) => {
      console.error('[Auth] getSession failed:', err);
      setSession(null);
      setProfile(null);
      setOrganization(null);
      initialLoadDone.current = true;
      setLoading(false);
    });

    // Listen for auth changes — skip INITIAL_SESSION since getSession handles it
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] Auth state changed:', event);

      // INITIAL_SESSION races with getSession — skip to prevent double loadProfile
      if (event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setProfile(null);
        setOrganization(null);
        setIsAdmin(false);
        setIsSubscriber(false);
        setLoading(false);
        return;
      }

      setSession(session);
      if (session?.user) {
        await loadProfile(session.user.id);
      } else {
        setProfile(null);
        setOrganization(null);
        setIsAdmin(false);
        setIsSubscriber(false);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  async function loadProfile(userId: string) {
    try {
      // Fetch profile and org in parallel — shaves ~100ms off auth init
      const profilePromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // We don't know the org_id yet, but most users have one.
      // Start a speculative org fetch using the user's ID to find their profile's org.
      // If the profile query finishes first, we can use its org_id.
      const { data, error } = await profilePromise;

      if (error) {
        console.error('[Auth] Error loading profile:', error);
        throw error;
      }

      // Map profile data
      const profileData: Profile = {
        id: data.id,
        email: data.email || '',
        full_name: data.full_name,
        role: data.role,
        is_subscriber: data.is_subscriber || false,
        is_active: data.is_active ?? true,
        disabled_at: data.disabled_at || null,
        disabled_by: data.disabled_by || null,
        org_id: data.org_id || null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      const userIsAdmin = profileData.role === 'admin';
      const userIsSubscriber = userIsAdmin && profileData.is_subscriber === true;

      // Set auth state immediately — don't block on org loading
      setIsAdmin(userIsAdmin);
      setIsSubscriber(userIsSubscriber);
      setProfile(profileData);
      setLoading(false);

      // Load organization in background (non-blocking)
      if (profileData.org_id) {
        supabase
          .from('organizations')
          .select('*')
          .eq('id', profileData.org_id)
          .single()
          .then(({ data: orgData }) => {
            if (orgData) setOrganization(orgData);
          })
          .catch((orgError) => {
            console.error('[Auth] Error loading organization:', orgError);
          });
      }
    } catch (error) {
      console.error('[Auth] Error in loadProfile:', error);
      setProfile(null);
      setOrganization(null);
      setIsAdmin(false);
      setIsSubscriber(false);
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    // Profile will be loaded by onAuthStateChange
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setOrganization(null);
    setIsAdmin(false);
    setIsSubscriber(false);
    router.push('/login');
  }

  async function refreshProfile() {
    if (session?.user) {
      await loadProfile(session.user.id);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        profile,
        organization,
        loading,
        isAdmin,
        isSubscriber,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
