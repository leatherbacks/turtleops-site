/**
 * A tab left open across a deployment keeps the bundle it loaded. "New
 * analysis" resets state but not code, so on 1 Oct 2026 a tab opened before
 * four fixes shipped produced a report with every one of the bugs they fixed,
 * an hour after they were live. The commit SHA is baked into the client at
 * build time and served fresh by /api/version; when they differ, the page
 * reloads before it touches the next tag's data.
 *
 * Both sides read 'dev' outside Vercel, so local work never reloads.
 */

export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

/** True when a reload was triggered; the caller should stop what it was doing. */
export async function reloadIfStale(): Promise<boolean> {
  if (typeof window === 'undefined' || BUILD_ID === 'dev') return false;
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return false;
    const { build } = (await res.json()) as { build?: string };
    if (typeof build === 'string' && build !== 'dev' && build !== BUILD_ID) {
      window.location.reload();
      return true;
    }
  } catch {
    // Offline or blocked: carry on with the bundle we have.
  }
  return false;
}
