import { createClient } from '@supabase/supabase-js';

function cleanEnvValue(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/^["']|["']$/g, '').trim()
    : '';
}

export function isValidSupabaseUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

const rawSupabaseUrl = cleanEnvValue(
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : ''
);
const rawSupabaseAnonKey = cleanEnvValue(
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : ''
);

export const isSupabaseConfigured = Boolean(
  isValidSupabaseUrl(rawSupabaseUrl) &&
  rawSupabaseAnonKey.length > 0 &&
  !rawSupabaseAnonKey.toLowerCase().includes('placeholder')
);

if (!isSupabaseConfigured) {
  console.warn('Supabase URL or Anon Key is missing or invalid. Supabase integration will use safe fallback.');
}

const safeSupabaseUrl = isValidSupabaseUrl(rawSupabaseUrl)
  ? rawSupabaseUrl
  : 'https://placeholder.supabase.co';
const safeSupabaseAnonKey = rawSupabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(safeSupabaseUrl, safeSupabaseAnonKey);
