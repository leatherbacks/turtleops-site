import { createSupabaseAdminClient } from './supabase';

/**
 * Simple per-key rate limiter backed by Supabase.
 * Upserts count into the `tag_rate_limits` table and compares to the limit.
 *
 * Key convention:
 *   - `email:alice@example.com` for user-scoped limits
 *   - `ip:1.2.3.4` for anonymous IP-based limits
 */
export async function checkRateLimit({
  key,
  maxPerDay,
}: {
  key: string;
  maxPerDay: number;
}): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const supabase = createSupabaseAdminClient();

  // Day bucket — UTC midnight
  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Get current count
  const { data: existing } = await supabase
    .from('tag_rate_limits')
    .select('count, day_start')
    .eq('key', key)
    .maybeSingle();

  const currentCount =
    existing && existing.day_start === dayStart.toISOString()
      ? existing.count
      : 0;

  if (currentCount >= maxPerDay) {
    return { allowed: false, remaining: 0, resetAt: dayEnd };
  }

  // Increment
  const newCount = currentCount + 1;
  await supabase.from('tag_rate_limits').upsert(
    {
      key,
      count: newCount,
      day_start: dayStart.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: 'key' }
  );

  return {
    allowed: true,
    remaining: maxPerDay - newCount,
    resetAt: dayEnd,
  };
}
