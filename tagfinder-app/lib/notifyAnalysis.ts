/**
 * Fire-and-forget real-time email alert when someone uses TagFinder.
 *
 * Sends to hello@turtleops.org via Brevo's transactional API
 * (the SPF record on turtleops.org already authorizes Brevo as a sender).
 *
 * Designed to never block or fail the calling request:
 *   - If BREVO_API_KEY isn't set, silently no-op.
 *   - If the upstream Brevo call fails, log + return; don't throw.
 *   - Caller does NOT await this — fire-and-forget.
 *
 * Skips alerts for the operator's own email addresses so testing doesn't
 * generate self-pings.
 */

const ALERT_TO = 'hello@turtleops.org';
const ALERT_FROM_NAME = 'TagFinder';
const ALERT_FROM_EMAIL = 'hello@turtleops.org';

// Operator addresses — alerts skipped for these so Chris doesn't get pinged
// by his own testing or admin actions.
const SELF_ADDRESSES = new Set([
  'leatherbacks@gmail.com',
  'leatherbacks+appstore@gmail.com',
  'chris@turtleops.com',
  'test@turtleops.org',
  'appreview@turtleops.org',
  'appreview-delete@turtleops.org',
  'volunteer-test@turtleops.org',
]);

interface AnalysisAlertInput {
  userEmail: string;
  ptt: number | null;
  briefExcerpt: string | null;
  bestLat: number | null;
  bestLon: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function notifyAnalysis(input: AnalysisAlertInput): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return; // not configured — silently skip

  const normalized = input.userEmail.trim().toLowerCase();
  if (SELF_ADDRESSES.has(normalized)) return; // skip operator's own usage

  // First-line teaser from the brief, capped so the email subject stays terse
  const teaser =
    input.briefExcerpt
      ?.split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 20)
      ?.slice(0, 240) ?? '(brief generated successfully)';

  const subject = `TagFinder · ${normalized}${input.ptt ? ` · PTT ${input.ptt}` : ''}`;

  const lines: string[] = [
    `${normalized} just generated an AI recovery brief.`,
    '',
  ];
  if (input.ptt) lines.push(`PTT: ${input.ptt}`);
  if (input.bestLat !== null && input.bestLon !== null) {
    lines.push(
      `Position: ${input.bestLat.toFixed(4)}°${input.bestLat >= 0 ? 'N' : 'S'}, ${Math.abs(input.bestLon).toFixed(4)}°${input.bestLon >= 0 ? 'E' : 'W'}`
    );
  }
  if (input.inputTokens !== null && input.outputTokens !== null) {
    lines.push(`Claude tokens: ${input.inputTokens} in / ${input.outputTokens} out`);
  }
  lines.push('');
  lines.push('Brief excerpt:');
  lines.push(teaser);
  lines.push('');
  lines.push('--');
  lines.push('Sent from TagFinder — tagfinder.turtleops.org');

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: ALERT_FROM_EMAIL, name: ALERT_FROM_NAME },
        to: [{ email: ALERT_TO }],
        subject,
        textContent: lines.join('\n'),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[notifyAnalysis] Brevo non-OK:', res.status, detail.slice(0, 200));
    }
  } catch (err) {
    console.warn('[notifyAnalysis] send failed:', err);
  }
}
