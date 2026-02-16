import { createBrowserClient } from '@supabase/ssr';

// Supabase credentials from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Flag to check if Supabase is configured (don't throw during build)
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Create Supabase client for browser using SSR-compatible cookie storage
// This allows the server-side middleware to read the session
// Use placeholder values during build to prevent errors
export const supabase = createBrowserClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);
