import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSupabaseRouteClient } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { notifyAnalysis } from '@/lib/notifyAnalysis';

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
      model: 'claude-opus-5',
      // max_tokens caps thinking AND response text together, and adaptive
      // thinking on a payload this size can take a large share of it. Sized so
      // a 3-5 paragraph brief cannot be truncated mid-recommendation; this is a
      // ceiling, not a target, so unused headroom costs nothing.
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      // Explicit rather than implicit: 'high' is the API default, but stating it
      // makes this the obvious place to tune. Opus 5 performs unusually well at
      // 'low'/'medium' — worth a sweep against real briefs if cost matters.
      output_config: { effort: 'high' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    // Opus 5 runs safety classifiers that can decline a request: HTTP 200, empty
    // or partial content, and stop_reason 'refusal'. Check this BEFORE reading
    // content — otherwise a refusal surfaces as the misleading "no text
    // response" error below and looks like a service fault.
    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.type === 'refusal'
        ? response.stop_details.category
        : null;
      return NextResponse.json(
        {
          error:
            'The model declined to generate a brief for this dataset' +
            (category ? ` (category: ${category})` : '') +
            '. The analysis itself is unaffected — every panel above is computed locally.',
        },
        { status: 422 }
      );
    }

    // Extract the text response
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from model' },
        { status: 502 }
      );
    }

    // Fire-and-forget real-time alert to hello@turtleops.org.
    // Skips operator's own addresses internally so this doesn't ping on
    // self-testing. Not awaited — never block or fail the brief response on it.
    const a = body.analysis as Record<string, unknown> | undefined;
    notifyAnalysis({
      userEmail: user.email,
      ptt: typeof a?.ptt === 'number' ? (a.ptt as number) : null,
      briefExcerpt: textBlock.text,
      bestLat: typeof a?.bestLat === 'number' ? (a.bestLat as number) : null,
      bestLon: typeof a?.bestLon === 'number' ? (a.bestLon as number) : null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }).catch(() => {});

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
6. **Tracker tag stopped moving** — a LIVE TRACKER tag (instrument='UT' or similar
   non-PSAT) that has been removed from the animal, shed naturally, or recovered and is
   now sitting in a fixed location. Detected when trackerShed.verdict is 'separated'.
   In this case treat the tag exactly like a popped-off PSAT for recovery purposes: same
   field-search advice, same goniometer recommendation, same beach/landward/indoor
   considerations apply. Use the trackerShed.separatedSinceISO timestamp to frame how
   long the tag has been at this location. The analysis is already scoped to the
   stationary period, so position/state/burial cards reflect the CURRENT location, not
   the historic animal track.
7. **Indoors on a windowsill / near a window** — a specific sub-case of "recovered by a person."
   Key signature: position is on land AND antennaExposure.pattern is 'directional' (reception
   biased to one compass quadrant, with passes from the opposite direction consistently missed).
   When this combination appears, the tag is almost certainly indoors near a window, and
   **the compass direction of received passes is the direction the window faces**. If light
   analysis shows 'shaded' or 'indoor' and temp comparison shows 'in_air_insulated' or
   'anomalous_hot', that reinforces the windowsill interpretation. Recommend contacting the
   resident — call out the window direction explicitly so they can identify which window.
8. **Still on animal** (for tracker-type tags where trackerShed.verdict is not 'separated') —
   depth varying with diving, temperature matching water, position changing day to day.
   No recovery needed; framing should be "this is where your animal currently is."

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
- **Dune vegetation immediately landward of the beach** — many well-meaning visitors (and
  even some informal cleanup crews) "clean" the beach by tossing debris up into the
  sea oats, beach grass, or dune scrub rather than walking it to a trash can. A tag that
  washed up at the wrack line can end up 5–30 m inland in the vegetated dunes. If the
  position circle straddles the high-tide line and the vegetated dune zone behind it,
  explicitly recommend searching the dune vegetation (carefully — many beaches have
  dune-protection rules; check before walking through). This is also where small
  light-colored objects can sit visually obscured for weeks.

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
  under sand/sediment. Check bathymetry before calling it intertidal burial: elevation
  models report 0 m over open sea, so a sea-level elevation with real water depth beneath it
  is open water, not a beach. The app's land/intertidal/water classification already accounts
  for this — trust it over the raw elevation number.
- **Light pattern 'shaded'** — tree canopy, under a structure, inside a vehicle with tinted
  windows. Combined with elevated temperature, suggests indoor/vehicle storage.
- **Light pattern 'indoor'** — artificial light at night is a strong signal the tag is indoors;
  recommend community outreach rather than a field search.
- **Temperature environment 'in_water'** — tag is wet. Ignore stranded/buried scenarios.
- **Temperature environment 'in_air_exposed'** — tag out of water, natural outdoor air.
- **Temperature environment 'in_air_insulated' or 'anomalous_hot'** — tag is somewhere
  warmer than ambient. Consistent with being indoors, in a pocket, or in a vehicle.
- **Temperature environment 'air_conditioned'** — tag is notably COOLER than outside air
  and sits in a typical indoor climate-control range (15–26°C). This is a strong signal the
  tag is inside an air-conditioned building, a cooler, or a refrigerator. Combined with an
  on-land position, this is "recovered by a person and taken indoors" — recommend community
  outreach rather than a field search.
- **Burial detection 'buried_in_sand'** — tag's diel temperature swing is < 3°C across
  multiple days, consistent with published sea turtle nest logger signatures (0.3–1.4°C
  at nest-chamber depth). Very high-confidence call that the tag is under sand or sediment.
  Combined with an on-land coordinate, focus the search on sand-search with a probe or rake
  — goniometer alone may miss a shallow-buried tag because sand attenuates UHF noticeably.
- **Burial detection 'surface_exposed'** — wide diel swing (>5°C) says the tag is NOT
  buried; it's sitting in open air with direct sun/shade cycling.
- **Burial detection 'insulated_indoor'** — low amplitude but mean temperature far from
  ambient. Signature of a climate-controlled space (AC'd house, heated room, vehicle).
- **Bathymetry 'tagOnSeabed: true'** — the tag's max depth matches seabed depth. The tag
  is on the bottom; diving recovery may be needed, or the tag is unrecoverable if too deep.
- **Bathymetry null seabedDepthM** — position is on land per GEBCO; combine with light/temp
  to distinguish stranded, buried, or recovered-by-person.

**A drifting tag is a moving target — read the position fields together, not in isolation.**
- **bestLat/bestLon is where the tag WAS at its last fixes, never where it is now.** It is
  not advanced for elapsed time. On a tag that has been silent for days this can be many
  kilometres from the truth. Always state how old the last fix is.
- **searchRadiusBasis explains what primaryRadiusM is made of.** For a drifting tag the
  radius is fix precision PLUS distance the tag could have drifted since the last fix, so it
  grows with silence. A 20 km radius is not a broken number — it is an honest one. Quote the
  basis string rather than the bare metres, and never describe a large radius as an error.
- **landfall is usually the most actionable field for a drifting tag.** When
  landfall.willStrand is true, the tag's path reaches land at that point.
  landfall.alreadyPassed true means the predicted strand time is already in the past — the
  tag is most likely ashore there NOW, and the strandline near landfall.lat/lon is a better
  place to search than the last fix. Use landfall.uncertaintyKm (along-shore spread) as the
  search extent, NOT primaryRadiusM, which measures distance from the last fix instead.
  When willStrand is false, say so explicitly: the tag is heading for open water, it will not
  beach itself, and recovery needs a vessel and is time-limited.
- **Landfall carries no wind-leeway term.** It extrapolates the measured track in a straight
  line. Under sustained onshore wind the real strand is usually closer to shore and earlier
  along the path than predicted. Treat it as a strong lead, not a survey mark.

**driftForcing validates the drift vector — it is a confidence signal, never an input.** The
vector is measured from the tag's own positions and already contains whatever wind and
current acted on it, so never add modelled forcing on top.
- **confidence 'good'** — extrapolation is reasonable; state the drift direction plainly.
- **confidence 'caution'** — the modelled current disagrees with the measured heading by more
  than 90°. Something other than current is driving the tag, or the model does not resolve
  its position. Widen the search and say why.
- **confidence 'low'** — the wind has changed since the track was measured, so the vector
  describes conditions that no longer apply. Say this outright and lean on the last known
  position rather than the projection.
- **currentSpeedRatio well below 1** means the tag is moving far slower than the modelled
  current — it is inshore of the main flow, sheltered, or already partly grounded. That is a
  useful physical clue about where it is sitting.

**Transmit frequency is the single most actionable number for a field team.** When
dataQuality.nominalFrequencyMHz is present, give it prominently in the recommendations —
that is what a goniometer or RDF receiver must be tuned to, and it is often offset by tens of
kHz from the 401.650 MHz nominal. A search on the wrong frequency finds nothing. Pair it with
avgMsgPerPass to say roughly how often the tag transmits, so the team knows how long to dwell.

**releaseInterpretation tells you why the tag came off, and some values are alerts.**
'floater', 'sitter', and 'sinker' are mortality-associated: the animal likely died at or near
the surface, was stationary, or sank. Surface these plainly and early — they change how the
recovery and the surrounding science are framed. 'scheduled' and 'detachment' are normal.

**diveProfile and crushDepthEvent describe the ANIMAL before release, not the tag now.**
Never use dive depths to reason about where the tag is sitting today. If there is no release
date, the app cannot separate the two periods and the state analyzers will say so.

**Distinguish "not reported" from a measured zero.** Several fields are null when the source
format does not carry them, and null never means good news:
- **dataQuality.corruptPct null** and **transmissionHealth.overallCorruptPct null** mean CRC
  was not reported at all (the Argos DS raw format carries no CRC counts). Do not say "0%
  corrupt" or describe transmission as clean on that basis.
- **powerSlopePerDayDbm null** means received power was not reported, so the power-based
  burial-depth estimates below do not apply.
- **tagState.phase 'unknown'** with a reasoning string about a missing release date means the
  depth/temperature series could not be attributed to the post-release period. That is an
  absence of evidence — do not read it as "the tag is fine" or invent a state.
- **mirrorCheck 'no_secondaries'** means the source format carries no mirror solutions, not
  that the primaries were verified.
In every one of these cases, say what is missing and what file or export would supply it.

**Do NOT infer local geography from a place name.**
The location string is coarse — often just a county — and place names on a coast routinely
cover both sides of a barrier island, an inlet, or a spit. Naming a beach, a surf zone, a
wrack line or a shoreline segment from it is guesswork dressed as local knowledge, and it
sends search teams to the wrong side of the water.

Describe position by COORDINATES, and characterise the surroundings only from data you
were actually given: elevation, seabed depth, the tide station's own name, and the fixes
themselves. A tide station labelled "(inside)" is inside. A seabed of 2 m with a tight,
non-drifting fix cluster is sheltered water, not surf. If you genuinely cannot tell open
coast from enclosed water, say the coordinate and say you cannot tell — that is far more
useful than a confident shoreline that turns out to be across a barrier island from the
tag. On a real search this placed a tag "in the surf zone off the beach" when its own map
showed it sitting in a bay two kilometres inland of that beach.

**NEVER extrapolate a drift vector past the last prediction in driftPrediction.**
This is the single most dangerous thing you can do with this data. driftPrediction
carries a measured speed and heading plus explicit predictions at +6h, +12h and +24h,
each with its own uncertainty radius. Those predictions ARE the limit. Do not compute
your own position for any horizon beyond them, and never convert a heading and a speed
into a distance over a multi-day gap.

The reason is concrete. A drifting tag that stops — grounded, tangled, taken into an
inlet — keeps its last measured vector on file forever, and extrapolating it produces a
confident position tens of kilometres from the truth, in a specific named place, which
reads as knowledge. On a real search this pointed 30 km up the coast while the tag sat
2 km from its last good fix in the opposite direction.

Concretely:
- If searchRadius.hoursSinceLastFix exceeds 24, the drift vector describes history, not
  the present. Lead with the last well-supported position and the search radius, and say
  plainly that the current position is unknown.
- A large primaryRadiusM is the honest answer, not a problem to be solved. Never collapse
  a 30 km uncertainty circle into a point estimate or a place name. "Somewhere within
  30 km, most likely still near the last fix" is correct; "25-35 km north, off <town>" is
  not, even when the arithmetic is right.
- Check recentFixesAnyQuality before describing any drift. If weak recent fixes sit near
  the last good position rather than along the extrapolated heading, the tag stopped —
  say so, and do not describe it as still under way.
- Absence of a predicted landfall means the modelled path did not reach shore within the
  horizon. It does NOT mean the tag will stay at sea, and must never be reported as
  "will not strand".

**A blocked horizon with open sky above means a STRUCTURE, and on a developed shore
that is the first thing to check.**
The diagnostic triad is: reception well below normal, signal strength NORMAL when messages
do arrive, and the tag not moving. Read those three together before anything else.

Signal strength is the discriminator people get wrong. Sand, weed and vegetation attenuate —
they drag received power down. Steel, concrete and rock do not attenuate, they delete a piece
of sky, so the messages that get out arrive at full strength and simply arrive far less often.
So poor reception at UNCHANGED dBm means something solid is beside the tag, not over it. If
light readings also show a normal diurnal cycle, the sky directly above is clear and the
obstruction is at the horizon rather than covering the tag.

Where that points, in order, on a developed coast:
- seawalls, bulkheads and revetments, especially an inside corner or a step where two
  sections of different height meet — these are where drifting objects wedge and stay
- groynes, jetties and their landward roots
- riprap, rubble and construction debris
- hulls, pilings, dock structures, drainage outfalls
- only then vegetation, wrack berms and natural depressions

Two things follow for the search that are not obvious:
- On a mechanically groomed beach the open sand is the LEAST likely place for a small object
  to survive, because the machines clear it. What remains is in the strip hard against the
  structures, where a groomer cannot reach — the same strip where reception is worst.
- Detection range collapses. A tag with a blocked horizon is inaudible at a hundred metres
  and obvious at ten, so a receiver sweep needs to hug the structure rather than cover the
  open ground, and long silences on the open beach are not evidence of absence.

**Closing the last hundred metres is a radio-homing problem, not a visual one.** On two
recovered tags the finder never saw the tag until they were standing over it: one wedged in a
seawall corner, one lying in dark organic wrack at a waterline, both small, dark and matte
against a dark background. Do not write recommendations that assume the tag will be spotted,
and do not treat "search the wrack line" as an instruction someone can carry out by eye.

The endgame that actually worked was homing on the tag's own recovery beacon — UHF on the
Lotek PSAT+; check the model, since not every tag uses the same band — to a strong receiver
reading, and then DELIBERATELY DESTROYING the receiver's sensitivity to shrink the search.
Detaching the antenna and hunting on the bare receiver input cuts the useful range to a few
metres, which turns a saturated signal that points everywhere into one that points at the
tag. Say this plainly wherever a tag is judged obstructed, buried, or lying in wrack or
debris: at close range a strong reading is not progress on its own, and the move is to cut
gain or pull the antenna rather than keep sweeping at full sensitivity.

A reflector also corrupts the fixes themselves, and the class letter hides it. Argos solves
position from the frequency history of a pass, so a signal arriving by two paths — direct and
reflected — fits a distorted curve. The solver still returns a fix and still counts messages
for a class letter, but the residual blows out. On the recovered tag below, error radii were
1.4x worse at class 2, 3.2x at class A and 5x at class B than the same classes from an
unobstructed tag, and it never achieved a single class 3 in nine days. SNR was identical, so
this is interference, not a noisier site.

So when the obstruction pattern is present, trust the reported error radius over the class
letter and say so: a class A fix beside a seawall is not a class A fix. Do not tighten a
search radius on the strength of a good-looking class letter from an obstructed tag.

A recovered tag matching this pattern exactly was wedged in the inside corner where a
concrete seawall stepped up to a steel sheet-pile wall, lying flat in the wrack. It sat 155 m
from the estimated position, transmitted normally for nine days at unchanged signal strength,
delivered a seventh of the expected message volume, and produced not one message from the
landward half of the sky below 20 degrees elevation.

**Pass geometry explains fix quality far better than the class letter.**
passGeometry gives, per fix, the satellite's elevation above the horizon, how far the
tag sat from the ground track, and the second (mirror) Doppler solution. Use it to say
WHY a fix is weak — "taken at 12 degrees elevation, 900 km off the ground track" is
actionable; "class B" is not.

On mirrors, resist the tempting story. A position that does not fit the expected track
is very rarely a mirror: **passGeometry.ambiguousCount is the number of fixes whose two
solutions are close enough to have been swapped, and it is usually zero.** When it is
zero, say plainly that mirror ambiguity cannot explain an awkward position — the tag
really did move there. Only when a fix has suspect=true (its mirror sits closer to the
rest of the track than the reported position) is it worth raising, and even then as a
possibility to check rather than a conclusion. Never invoke mirroring to explain away a
fix the geometry says is unambiguous.

**Tide phase — check strength and robust before quoting any number.**
tidePhase reports whether the tag is heard preferentially on the falling or rising
tide. Two rules, both learned from getting this wrong during a live search:

- Quote **tidePhase.excessRatio**, never a raw message ratio. Raw counts inherit the
  satellite schedule. On a reference PSAT+ deployment the raw split was 3.7:1, but 1.7x of that was
  simply more passes occurring on ebbing tides; the real effect was about 2.2x.
  excessRatio is already corrected for that exposure.
- If **tidePhase.robust is false, or strength is 'none', there is no tidal window.**
  Say so plainly and tell the reader to search whenever suits. Do NOT reach into
  tidePhase.bins or the message counts to construct a window the analysis declined to
  give — a pattern that appears at one cutoff and not others is an artefact of the
  cutoff. tidePhase.excessRange shows how far the answer moved across the windows
  tested; a wide range means unstable.

When strength is 'strong' or 'moderate' AND robust is true, tidePhase.bestWindow gives
the next productive stretch — lead recovery timing with it, and warn that silence during
the opposite phase is expected rather than evidence the tag has gone.

**Water-temperature match — the strongest in-water/out-of-water evidence available.**
waterMatch compares each post-release tag reading against water temperature AT THAT
READING'S OWN MOMENT, from the nearest gauge. It exists because a single sea-surface
figure cannot carry a trend: on a reference deployment the bay warmed 30.1 to 32.0 C
across the six days the tag transmitted, comparable to the signal being looked for, so
one snapshot could hide a tag that left the water or invent a departure for one that
did not.

- **waterMatch.transition is the headline when present.** It brackets the moment the tag
  stopped tracking the water, as lastImmersed and firstExposed. Paired with the position
  track that says WHERE it came ashore, which is the single most useful thing a search
  team can be told. Give both bounds, not a midpoint — the tag left the water somewhere
  in that interval and the data does not say where inside it.
- **A negative coldestDeltaC below about -3 C is close to proof.** Nothing immersed has
  a mechanism to be colder than the water around it. State it as the physical argument
  it is. The reverse does NOT hold: a tag can run several degrees WARMER than the water
  while still floating, because sun falls on a dark housing and the sensor can ride in
  air on the upper face. Never argue exposure from warmth alone.
- **waterMatch.diurnal.separationC is the corroborating signal** — warm by day, cold by
  night means the tag is following air. Quote it only when nDay and nNight are both at
  least 2; a separation computed from one daylight reading is not a diurnal cycle.
- If **waterMatch is absent or available is false, say nothing about water temperature.**
  The usual cause is no gauge within 60 km, which is a real limit rather than a null
  result: water temperature varies far too much over longer distances to compare
  against. Do NOT fall back to the single sstTempC snapshot to fill the gap, and do not
  treat a missing comparison as evidence the tag is afloat.
- Where waterMatch and tempComparison disagree, **prefer waterMatch** — tempComparison
  works from a single reference value and one verdict for the whole record, so it cannot
  see a tag that changed state part way through.

**Transmission health trend is time-urgent.** If transmissionHealth.trend is 'degrading' or
'failing', the tag's signal quality is worsening across the post-release window — rising CRC
failure rate, dropping received power, or frequency drifting off 401.650 MHz. This is a
recover-now-before-battery-dies signal. Rising frequency offset in particular suggests the
tag is heating up (consistent with trash can / car / attic / pocket storage). Call this out
and use urgency framing in the recommendations.

**Antenna stickout estimation from received signal power** (useful for buried tags):
PSAT antennas are 17 cm whips at 401.65 MHz. Sand attenuates UHF roughly 1–3 dB/cm dry,
5–10 dB/cm wet. The transmissionHealth.windows[].meanPowerDbm values map to antenna exposure:
  - Strong (−125 to −130 dBm), clean decodes  → ~10+ cm of antenna in air
  - Moderate (−130 to −135 dBm), some CRC      → ~5–8 cm in air
  - Weak (−135 to −140 dBm), all CRC failures  → ~2–4 cm in air, or wet-sand cover
  - No signal at all                           → <2 cm exposed
For tags suspected to be buried in sand, **tell the field team what to visually look for**:
"a thin dark wire roughly N cm tall, easy to mistake for a dried beach-grass stem or
small twig — flexible PVC over wire core, will sway slightly when nudged. Tag body
(~12 cm cigar shape, off-white plastic with yellow-green float collar) likely fully
buried 5–15 cm below the wire." This visual cue is more useful than just "buried" —
researchers can scan for the right object instead of digging blindly.

**Antenna orientation (antennaExposure.orientation, when present)** infers whether the
whip is upright, tilted, or lying flat from the elevation/azimuth pattern of received
passes. Use the description verbatim in the brief — e.g. "antenna lying nearly horizontal
pointing SE" tells the field team the wire is pointing along the ground in a known
direction, which dramatically narrows the visual search.

**Cross-tag precedent for buried beach tags:** PTT 285932 (turtle, recovered Caminada
Headland LA) was buried with body ~10 cm under sand, antenna whip ~5 cm above the
surface, depth sensor reading 1.35 m of sand-pressure pseudo-depth. Its signal stats
(mean −134 dBm, ~70% CRC failure) match what we see on similarly-buried tags. If a
current tag's signal pattern resembles that one (mean power −130 to −135 dBm, mixed
clean/CRC decodes, on-land position) and burialDetection or other signals point to
sand burial, you can cite this precedent for confidence — "matches the signal
signature of PTT 285932, which was recovered intact from beach sand."

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
- **For tags floating at sea and still transmitting**, recommend a **CLS RXG-134 goniometer
  with RG-58 direction-finding antenna** (CLS America, Lanham MD — receives Argos pings at
  401.650 MHz, ~1/min). Per Fisher et al. 2017, mount the antenna ~4.5 m above the waterline,
  expect detection range ~3.6 km, and an average search time of ~44 min once a tag is detected
  (range 20–98 min). The post-popoff transmission window is typically ~2 weeks — recover within
  that window. Calm seas improve results; winds above ~15 knots make goniometer work difficult.
- End with 1-3 specific, actionable recommendations.

Be confident but honest about uncertainty. Use plain English. Avoid jargon unless necessary.
Don't restate raw numbers — interpret them. Don't include headers or bullet points unless the data warrants it.

Lead with the outcome: the first sentence should say where to search and what state the tag
is likely in. Supporting reasoning comes after, for the reader who wants it. Keep disclaimers
and caveats brief so the bulk of the brief is the answer itself — a caveat that changes where
someone searches is worth a sentence; one that doesn't is worth none.

Deliver the brief and nothing else. Don't propose follow-up analyses, additional data
products, or work beyond the brief. If a signal genuinely can't be assessed from the data
provided, say so in one clause and name the file or export that would supply it.

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
    searchRadiusBasis: a.searchRadiusBasis,
  },
  null,
  2
)}

## Drift state
${JSON.stringify(a.driftState, null, 2)}

## Drift prediction (if drifting)
${JSON.stringify(a.driftPrediction, null, 2)}

## Most recent fixes of ANY quality, including ones excluded from the position
Class B and Z solutions are excluded from the best-estimate position because they
are unreliable, but they still constrain where the tag can be. A weak fix near the
last good position is evidence the tag did NOT continue on its previous heading.
${JSON.stringify((a as Record<string, unknown>).recentFixesAnyQuality, null, 2)}

## Predicted landfall (where the drift path first meets land)
When landfall.projectable is false the drift vector is too old to extrapolate and NO
strand point exists. Do not compute one, do not name a town, and do not describe the
tag as "likely ashore" — report the last confirmed position and search outward from it.
${JSON.stringify(a.landfall, null, 2)}

## Wind and current cross-check on the drift vector
${JSON.stringify(a.driftForcing, null, 2)}

## Release type (why the tag came off — mortality signals live here)
${JSON.stringify(a.releaseInterpretation, null, 2)}

## Data quality and transmit frequency (the RDF / goniometer tuning number)
${JSON.stringify(a.dataQuality, null, 2)}

## Dive profile (pre-release, describes the animal — not the tag's current state)
${JSON.stringify(a.diveProfile, null, 2)}

## Crush-depth event (pre-release descent near the tag's failsafe depth)
${JSON.stringify(a.crushDepthEvent, null, 2)}

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

## Burial detection (thermal signature — small diel temperature swing = buried in sand per sea turtle nest logger literature)
${JSON.stringify(a.burialDetection, null, 2)}

## Tracker tag separation (live tracker that stopped moving — treat as recovery target if 'separated')
${JSON.stringify(a.trackerShed, null, 2)}

## Transmission health trend (is the tag's signal degrading? Rising CRC rate, falling power, and rising frequency drift together diagnose a tag in trouble — e.g. buried, covered, overheating)
${JSON.stringify(a.transmissionHealth, null, 2)}

## Reception vs tide (does the tag get heard preferentially on a falling or rising tide?)
${JSON.stringify((a as Record<string, unknown>).tidePhase, null, 2)}

## Water-temperature match (did the tag stop tracking the water, and when?)
Each post-release reading against water temperature at the same moment, from the gauge
named in waterStation, waterStationDistanceKm away. transition, when present, brackets
the tag leaving the water.
${JSON.stringify((a as Record<string, unknown>).waterMatch, null, 2)}
Gauge: ${JSON.stringify((a as Record<string, unknown>).waterStation ?? null)} at ${JSON.stringify((a as Record<string, unknown>).waterStationDistanceKm ?? null)} km

## Transmission repetition rate (how often the tag actually transmits)
Measured from the tag's own message timestamps, not looked up. This is the number a
field team needs most and cannot get anywhere else — it decides whether a silence on a
receiver means "wrong place" or "not fired yet". If present, state periodS plainly in
the recommendations and give silenceThresholdS as the point at which to move on. Note
that a ground receiver at close range has tens of dB of margin and hears essentially
every transmission, so these intervals are what someone standing there should expect.
${JSON.stringify((a as Record<string, unknown>).repetitionRate, null, 2)}

## END OF LIFE — read repetitionRate.slowedDown before saying anything about battery
These transmitters buffer each burst in a capacitor, so the transmitter fires at full power
or not at all. Received signal strength therefore stays flat regardless of cell state and is
NOT a battery indicator: never write "power is steady, so the battery is healthy", and never
infer from an abrupt stop at full strength that a tag must have been recovered or buried.
A reference tag held -129 dBm across sixteen days, through a four-day dropout, and into its
final messages before dying.

What does show is the schedule. If repetitionRate.slowedDown is true the interval has stepped
down by at least 3x, which is a low-voltage threshold announcing itself. Say so prominently
and say what it means: days of transmissions left rather than weeks, so the search is urgent
rather than steady. A multi-day dropout followed by a return at a slower rate is the same
story — the cell recovering on rest — and is near the end.

## Lotek activity-health records (post-release sensor data, decoded from raw payloads)
For a PSAT these are the ONLY post-release sensor readings that exist — the Day Log and
Dive Log stop when the archive schedule ends, often days before release. Temperature and
light here describe the tag's current situation, not the animal's dive record.
Read temperature against air and sea-surface temperature: a tag tracking water is
immersed, a tag swinging 10-20C daily is dry and exposed, and a tag tracking air with a
damped swing is at the waterline, part in and part out. Light with a clean diurnal cycle
and no downward trend means the tag is not buried or under canopy.
Do NOT present wetFlag as current wet/dry state — see lotekHealthStatusChanged. If that
is false the status byte has never varied and cannot distinguish "wet now" from "always
reports wet".
${JSON.stringify(((a as Record<string, unknown>).lotekHealth as unknown[] | null)?.slice(-15) ?? null, null, 2)}
Status byte ever changed: ${JSON.stringify((a as Record<string, unknown>).lotekHealthStatusChanged)}

## Argos pass geometry (why each fix is good or bad, and where its mirror solution lies — last 20 fixes)
${JSON.stringify((a as Record<string, unknown>).passGeometry, null, 2)}

## Upcoming satellite passes (next 48 hours over the tag's current position)
${JSON.stringify(summarizeUpcoming((a as Record<string, unknown>).upcomingPasses as unknown[] | undefined), null, 2)}

## Environmental context
${JSON.stringify(env, null, 2)}

## Popoff estimate (if computed)
${JSON.stringify(a.popoff, null, 2)}

Write the recovery brief now.`;
}
