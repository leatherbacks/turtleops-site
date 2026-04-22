import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSupabaseRouteClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';

const MAX_ANALYSES_PER_DAY = 10;

/**
 * Generate a natural-language recovery brief from the structured analysis.
 * POST /api/summarize with { analysis, environment }
 *
 * Protected by:
 *   - Verified email session (via Supabase auth) — blocks anonymous abuse
 *   - Per-email rate limit (10 analyses/day)
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server is not configured with ANTHROPIC_API_KEY' },
      { status: 503 }
    );
  }

  // Require a verified Supabase session
  const response = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json(
      { error: 'Email verification required' },
      { status: 401 }
    );
  }

  // Per-email rate limit
  const limit = await checkRateLimit({
    key: `email:${user.email.toLowerCase()}`,
    maxPerDay: MAX_ANALYSES_PER_DAY,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Daily limit reached (${MAX_ANALYSES_PER_DAY} analyses/day). Resets at ${limit.resetAt.toISOString()}.`,
      },
      { status: 429 }
    );
  }

  let body: { analysis?: unknown; environment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.analysis) {
    return NextResponse.json({ error: 'Missing analysis payload' }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const prompt = buildPrompt(body.analysis, body.environment);

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract the text response
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from model' },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        brief: textBlock.text,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limited — try again in a moment' },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `API error: ${error.message}` },
        { status: error.status || 502 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

const SYSTEM_PROMPT = `You are an expert marine biologist and satellite tag recovery specialist.
You write concise, actionable recovery briefs for field teams searching for lost satellite tags.

Your job: translate structured analysis data into a clear 3-5 paragraph natural-language brief.

Possible tag scenarios to consider:
1. **Drifting at sea** — still in water, moving with currents.
2. **Beached / stranded** — washed up on shore, tag exposed, position in intertidal zone.
3. **Buried** — on land with non-zero depth reading (sand/sediment pressure) and poor satellite reception.
4. **Tidally flooded** — in marsh / low-lying coastal area where tide cycles wet and dry the tag.
5. **Possibly recovered by a person** — tag has been picked up and taken home. Key signals:
   - Position is on land AND significantly inland (not intertidal / beach)
   - Elevation well above sea level (> 3m)
   - Position clusters very tightly (sub-100m), consistent with a building/yard
   - Transmission history is short (ended shortly after the tag reached this location)
   - Temperature readings anomalously high (> 35°C) suggest indoor/car/window — not natural sun-on-sand
   - Location name suggests residential area, urban, not coastal natural feature
6. **Indoors on a windowsill / near a window** — a specific sub-case of "recovered by a person."
   Key signature: position is on land AND antennaExposure.pattern is 'directional' (reception
   biased to one compass quadrant, with passes from the opposite direction consistently missed).
   When this combination appears, the tag is almost certainly indoors near a window, and
   **the compass direction of received passes is the direction the window faces**. If light
   analysis shows 'shaded' or 'indoor' and temp comparison shows 'in_air_insulated' or
   'anomalous_hot', that reinforces the windowsill interpretation. Recommend contacting the
   resident — call out the window direction explicitly so they can identify which window.
7. **Still on animal** (for tracker-type tags) — depth varying with diving, temperature matching water.

**Urban/developed beach considerations:**
When the tag is beached near an urban, developed, or actively-maintained shoreline (boardwalks,
hotels, piers, popular parks), expand the search to include:
- **Public trash cans** and dumpsters along the beach — well-meaning visitors often "clean up" tags
  thinking they're debris
- **Beach debris collection piles** — municipal cleanup crews gather debris; the tag may be in a pile
  waiting for pickup
- **Lifeguard stands / beach patrol offices** — found-object collection points
- **Hotel/condo lost-and-found** — if the tag stranded near lodging
- **Raking / mechanical beach cleaning schedules** — if the area is mechanically groomed, the tag
  may have been pushed into wrack line rows or collected into piles

This guidance is especially important when the geocoded location suggests an urban, populated,
or tourist beach area (as opposed to a remote/undeveloped shoreline).

IMPORTANT: Use the environment data (location name, elevation, coastal vs inland) as the source of truth
for geography. Don't guess county names — use env.location.name verbatim if available.

**Mirror solution check is authoritative when it fires.** If mirrorCheck.verdict is
'secondaries_match_better', the as-reported 'bestLat/bestLon' are UNRELIABLE — Argos picked
wrong mirrors on some passes. Use mirrorCheck.correctedLat / correctedLon as the true
position, and explicitly note in the brief that the position was corrected via mirror-
solution analysis. Frame the search and state inference around the corrected coordinates,
not the weighted mean. Also: when mirrors needed correcting, reception is almost certainly
obstructed (beached, buried, indoors) — combine with light/temp/elevation signals to pick
the physical state.

**Light, temperature, and bathymetry signals (when available) are authoritative for physical state:**
- **Light pattern 'buried' or 'fully_dark'** — the tag's light sensor is blocked. If on land, it's
  under sand/sediment. If the elevation is at sea level, think intertidal burial.
- **Light pattern 'shaded'** — tree canopy, under a structure, inside a vehicle with tinted
  windows. Combined with elevated temperature, suggests indoor/vehicle storage.
- **Light pattern 'indoor'** — artificial light at night is a strong signal the tag is indoors;
  recommend community outreach rather than a field search.
- **Temperature environment 'in_water'** — tag is wet. Ignore stranded/buried scenarios.
- **Temperature environment 'in_air_exposed'** — tag out of water, natural outdoor air.
- **Temperature environment 'in_air_insulated' or 'anomalous_hot'** — tag is somewhere
  warmer than ambient. Consistent with being indoors, in a pocket, or in a vehicle.
- **Bathymetry 'tagOnSeabed: true'** — the tag's max depth matches seabed depth. The tag
  is on the bottom; diving recovery may be needed, or the tag is unrecoverable if too deep.
- **Bathymetry null seabedDepthM** — position is on land per GEBCO; combine with light/temp
  to distinguish stranded, buried, or recovered-by-person.

Guidelines:
- Start with a one-sentence headline about where the tag is and your best guess at its state.
- Describe the current position with context (use env.location.name verbatim).
- Explain the tag's physical state with specific evidence from the data.
- **If release type is 'Floater', 'Sitter', 'Sinker', or 'Crush depth', acknowledge that the animal
  likely died** — phrase it compassionately but factually. These are mortality signals.
- **If release type is 'Detachment', the animal shed the tag but is likely still alive.**
- **If crush-depth event was detected (pre-release depths >1500m), note this strongly suggests
  mortality followed by sinking, and the tag released via the failsafe just above crush depth.**
- If relevant, describe tide/weather timing for recovery access.
- If signals suggest the tag was recovered by a person, say so clearly and recommend outreach
  (e.g. "post in local community groups", "check with nearby property owners") rather than a field search.
- If the tag is beached in an urban/developed/tourist area, explicitly suggest checking
  trash cans, debris piles, lifeguard stands, and beach maintenance collection points — tags
  often get mistaken for debris and "cleaned up" by visitors or crews.
- If drifting, predict where it's likely to wash up or drift next.
- **For stationary/findable tags, mention the MiniPAT optional UHF pinger (~1-2 sec interval)** —
  recovery teams with directional RDF antennas can track it. Note this is a separate signal from
  Argos transmissions and requires different tuning than the Argos transmit frequency.
- End with 1-3 specific, actionable recommendations.

Be confident but honest about uncertainty. Use plain English. Avoid jargon unless necessary.
Don't restate raw numbers — interpret them. Don't include headers or bullet points unless the data warrants it.
Keep the total response under 300 words.`;

/** Strip the verbose trackPoints arrays from satCoverage before sending to the AI.
 *  Per-pass sky trajectories don't add signal beyond the summary stats. */
function stripSatPasses(sc: unknown): unknown {
  if (!sc || typeof sc !== 'object') return sc;
  const obj = sc as Record<string, unknown>;
  const passes = obj.passes as Array<Record<string, unknown>> | undefined;
  if (!passes) return sc;
  return {
    ...obj,
    passes: passes.map((p) => {
      const rest = { ...p };
      delete rest.trackPoints;
      return rest;
    }),
  };
}

/** Summarize upcoming passes: next likely, count in next 24h, etc. */
function summarizeUpcoming(passes: unknown[] | undefined): unknown {
  if (!passes || passes.length === 0) return null;
  const now = Date.now();
  const parsed = passes.map((p) => {
    const pass = p as Record<string, unknown>;
    const riseTimeRaw = pass.riseTime;
    const riseTime =
      typeof riseTimeRaw === 'string' ? new Date(riseTimeRaw) : (riseTimeRaw as Date);
    return {
      satelliteName: pass.satelliteName,
      riseTime: riseTime instanceof Date ? riseTime.toISOString() : riseTimeRaw,
      hoursFromNow:
        riseTime instanceof Date
          ? Math.round(((riseTime.getTime() - now) / 3600_000) * 10) / 10
          : null,
      maxElevation: pass.maxElevation,
      peakAzimuth: pass.peakAzimuth,
      direction: pass.direction,
    };
  });
  return parsed.slice(0, 10);
}

function buildPrompt(analysis: unknown, environment: unknown): string {
  const a = analysis as Record<string, unknown>;
  const env = (environment || {}) as Record<string, unknown>;

  return `Here is the structured analysis of a satellite tag. Write a recovery brief.

## Tag info
${JSON.stringify(
  {
    ptt: a.ptt,
    tagCategory: a.tagCategory,
    summary: a.summary,
  },
  null,
  2
)}

## Position
${JSON.stringify(
  {
    bestLat: a.bestLat,
    bestLon: a.bestLon,
    positionMethod: a.positionMethod,
    primaryRadiusM: a.primaryRadiusM,
    expandedRadiusM: a.expandedRadiusM,
    fixesUsed: (a.validFixes as unknown[])?.length,
    totalFixes: (a.allFixes as unknown[])?.length,
  },
  null,
  2
)}

## Drift state
${JSON.stringify(a.driftState, null, 2)}

## Drift prediction (if drifting)
${JSON.stringify(a.driftPrediction, null, 2)}

## Tag state (depth, submersion, physical condition)
${JSON.stringify(a.tagState, null, 2)}

## Tidal intrusion analysis
${JSON.stringify(a.tidalIntrusion, null, 2)}

## Satellite coverage (reception health)
${JSON.stringify(stripSatPasses(a.satCoverage), null, 2)}

## Mirror solution check (if primary Argos fixes diverge, the secondaries may reveal the true position)
${JSON.stringify(a.mirrorCheck, null, 2)}

## Antenna exposure analysis (what the sky-pass pattern reveals about the tag's physical condition)
${JSON.stringify(a.antennaExposure, null, 2)}

## Light-level analysis (from LightLoc.csv — tells us if the tag is buried/shaded/indoors/in open sky)
${JSON.stringify(a.lightAnalysis, null, 2)}

## Temperature comparison (tag internal temp vs air/SST — helps distinguish in-water vs in-air vs inside a warm space)
${JSON.stringify(a.tempComparison, null, 2)}

## Bathymetry (seabed depth at tag position — is the tag resting on the bottom, or floating above deep water?)
${JSON.stringify(a.bathymetry, null, 2)}

## Upcoming satellite passes (next 48 hours over the tag's current position)
${JSON.stringify(summarizeUpcoming((a as Record<string, unknown>).upcomingPasses as unknown[] | undefined), null, 2)}

## Environmental context
${JSON.stringify(env, null, 2)}

## Popoff estimate (if computed)
${JSON.stringify(a.popoff, null, 2)}

Write the recovery brief now.`;
}
