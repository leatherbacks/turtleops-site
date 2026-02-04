'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        console.error('[Auth] Error getting session:', error.message);
        await supabase.auth.signOut({ scope: 'local' }).catch(console.error);
        setSession(null);
        setProfile(null);
        setOrganization(null);
        setLoading(false);
        return;
      }

      setSession(session);
      if (session?.user) {
        await loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] Auth state changed:', event);

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

    return () => subscription.unsubscribe();
  }, []);

  // Subscriber access checking and redirection
  useEffect(() => {
    if (!loading && profile) {
      const userIsAdmin = profile.role === 'admin';
      const userIsSubscriber = profile.role === 'admin' && profile.is_subscriber === true;

      setIsAdmin(userIsAdmin);
      setIsSubscriber(userIsSubscriber);

      // If not a subscriber and trying to access protected routes, redirect to login with error
      if (!userIsSubscriber && pathname && !pathname.includes('/login')) {
        console.warn('[Auth] Non-subscriber user trying to access admin console');
        router.push('/login?error=subscriber_required');
      }
    }
  }, [profile, loading, pathname, router]);

  async function loadProfile(userId: string) {
    try {
      console.log('[Auth] Loading profile for user:', userId);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Auth] Error loading profile:', error);
        throw error;
      }

      if (!data) {
        console.warn('[Auth] No profile found for user:', userId);
        setProfile(null);
        setOrganization(null);
        setLoading(false);
        return;
      }

      // Map profile data (handle potential column name variations)
      const profileData: Profile = {
        id: data.id,
        full_name: data.full_name,
        role: data.role,
        is_subscriber: data.is_subscriber || false,
        org_id: data.org_id || null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      console.log('[Auth] Profile loaded:', {
        id: profileData.id,
        name: profileData.full_name,
        role: profileData.role
      });

      setProfile(profileData);

      // Load organization if user has one
      if (profileData.org_id) {
        await loadOrganization(profileData.org_id);
      }

      setLoading(false);
    } catch (error) {
      console.error('[Auth] Error in loadProfile:', error);
      setProfile(null);
      setOrganization(null);
      setLoading(false);
    }
  }

  async function loadOrganization(orgId: string) {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (error) {
        console.error('[Auth] Error loading organization:', error);
        return;
      }

      setOrganization(data);
    } catch (error) {
      console.error('[Auth] Error in loadOrganization:', error);
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
