import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configurationHint = import.meta.env.DEV
  ? '.env.local を確認してください。'
  : '公開環境の VITE_SUPABASE_URL と VITE_SUPABASE_PUBLISHABLE_KEY を確認してください。';

export const supabase: SupabaseClient | null = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(`Supabase接続情報が設定されていません。${configurationHint}`);
  }
  return supabase;
}
