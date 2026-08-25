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
  strict = false,
  key,
  maxPerDay,
}: {
  strict?: boolean;
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
  const { data: existing, error: readError } = await supabase
    .from('tag_rate_limits')
    .select('count, day_start')
    .eq('key', key)
    .maybeSingle();

  // Fail-open is the right default for the free environment proxies — an
  // outage of the limit table should not take the tool down. It is the wrong
  // default anywhere a request costs money: for those callers pass strict, and
  // a limiter that cannot count refuses rather than waving spend through.
  if (readError && strict) {
    throw new Error(`rate limit unavailable: ${readError.message}`);
  }

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
