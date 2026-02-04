import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Supabase credentials from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Validate credentials
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create Supabase client for browser
// This is a singleton that will be reused across the app
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'turtleops-admin-auth',
  },
});

// Flag to check if Supabase is configured
export const isSupabaseConfigured = !!supabase;

// Export createClient for use in components if needed
export { createClient };
