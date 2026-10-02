/**
 * Keep the AI brief in agreement with the panels above it.
 *
 * The brief is written from the same analysis the panels render, yet on the
 * first MiniPAT test (PTT 40996, 1 Oct 2026) it opened with "afloat at the
 * surface over about 18 m of water — search by boat" beneath a Tag State panel
 * reading STRANDED ON LAND, elevation 1.8 m, and a temperature panel at 39 °C.
 * The "18 m" was the pre-release dive profile's average depth, read as seabed.
 * The tag was on a windowsill in Waves, NC.
 *
 * Two defences, both deterministic:
 *
 *   1. verdictsBlock — the computed verdicts go FIRST in the prompt, stated as
 *      facts the headline must agree with, instead of as the ninth of fourteen
 *      JSON blocks.
 *   2. findContradiction — the finished brief's opening is checked against
 *      the tag-state verdict. A contradiction gets one rewrite; a second gets
 *      a notice prepended so the reader is told which to trust.
 */

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Phases that mean the tag is out of the water, on something solid. */
const ASHORE_PHASES = new Set(['stranded_on_land', 'buried', 'likely_recovered']);
/** Phases that mean the tag is in the water. */
const AFLOAT_PHASES = new Set(['surface', 'partially_submerged', 'submerged']);

export function verdictsBlock(analysis: unknown, environment: unknown): string {
  const a = rec(analysis);
  const env = rec(environment);
  const tagState = rec(a.tagState);
  const temp = rec(a.tempComparison);
  const bathy = rec(a.bathymetry);
  const drift = rec(a.driftState);
  const release = rec(a.releaseInterpretation);
  const elevation = rec(env.elevation);
  const location = rec(env.location);
  const tides = rec(env.tides);

  const phase = str(tagState.phase) ?? 'unknown';
  const lines: string[] = [];
  lines.push(`- Tag state: ${phase.toUpperCase()}${str(tagState.reasoning) ? ` — ${tagState.reasoning}` : ''}`);
  lines.push(`- Temperature environment: ${(str(temp.environment) ?? 'unknown').toUpperCase()}${str(temp.reasoning) ? ` — ${temp.reasoning}` : ''}`);
  const seabed = num(bathy.seabedDepthM);
  lines.push(
    seabed === null
      ? '- Seabed: none — the position is on land per GEBCO'
      : `- Seabed at the position: ${seabed} m${bathy.tagOnSeabed === true ? ' (tag max depth matches it)' : ''}`
  );
  const elev = num(elevation.meters);
  lines.push(elev === null ? '- Elevation: not available' : `- Elevation: ${elev.toFixed(1)} m (${str(elevation.classification) ?? 'unclassified'})`);
  lines.push(`- Place: ${str(location.name) ?? str(location.displayName) ?? 'no place name resolved'}`);
  const place = rec(location.place);
  if (str(place.name) || (str(place.kind) && place.kind !== 'other'))
    lines.push(`- At the position itself: ${str(place.name) ?? ''}${str(place.kind) ? ` (${place.kind})` : ''} — if this is a campground, rental, house, marina or parking area, the tag is probably in someone's possession there; lead with asking, not searching.`);
  if (str(tides.station)) lines.push(`- Tide station: ${tides.station}, ${num(tides.stationDistanceKm)?.toFixed(1) ?? '?'} km away`);
  lines.push(`- Drift: last 24 h ${str(drift.recent) ?? 'unknown'}, 72 h ${str(drift.medium) ?? 'unknown'}, all time ${str(drift.allTime) ?? 'unknown'}`);
  if (str(release.label)) lines.push(`- Release: ${release.label}`);
  const grounding = rec(a.grounding);
  if (str(grounding.verdict) === 'grounded') lines.push(`- Out of the water: ${grounding.reasoning}`);
  const carried = rec(a.carried);
  if (str(carried.verdict) === 'carried') lines.push(`- Carried: ${carried.reasoning} Search at the latest fix, not at the place it was carried from.`);

  const rule = ASHORE_PHASES.has(phase)
    ? 'The tag is OUT OF THE WATER. The headline must say so. Do not describe it as afloat, at sea, over water, or drifting, and do not recommend a boat. The dive profile is the animal\'s pre-release record and says nothing about water at the tag\'s current position.'
    : AFLOAT_PHASES.has(phase)
      ? 'The tag is IN THE WATER. The headline must say so. Do not describe it as stranded, ashore, beached, buried or indoors.'
      : 'The tag state is undetermined; say so rather than choosing a scenario the data does not support.';

  return `## Verdicts from the deterministic analysis — the brief MUST agree with these
These are computed from the data and are shown to the reader as panels beside this brief.
A brief that contradicts them is wrong, whatever the raw numbers below seem to suggest.
${lines.join('\n')}

${rule}
`;
}

const ASHORE_CLAIMS = /\b(afloat|at sea|open water|over (about |roughly )?\d+ ?m of water|drifting at the surface|riding the surface|search by boat|vessel search|still in (the )?water)\b/i;
const AFLOAT_CLAIMS = /\b(stranded|ashore|beached|washed up|on (the )?(beach|sand|land)|buried|indoors|on a windowsill)\b/i;

/** The brief's opening — headline and first paragraph — is what gets acted on. */
function opening(brief: string): string {
  const paras = brief.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.slice(0, 2).join('\n');
}

/**
 * Null when the brief's opening agrees with the tag-state verdict, otherwise
 * a sentence saying how it disagrees, for the rewrite instruction and the log.
 */
export function findContradiction(brief: string, analysis: unknown): string | null {
  const phase = str(rec(rec(analysis).tagState).phase) ?? 'unknown';
  const head = opening(brief);
  if (ASHORE_PHASES.has(phase)) {
    const m = ASHORE_CLAIMS.exec(head);
    if (m) return `The computed tag state is ${phase.toUpperCase()} (out of the water), but the brief opens by calling the tag "${m[0]}".`;
  }
  if (AFLOAT_PHASES.has(phase)) {
    const m = AFLOAT_CLAIMS.exec(head);
    if (m) return `The computed tag state is ${phase.toUpperCase()} (in the water), but the brief opens by calling the tag "${m[0]}".`;
  }
  return null;
}

/** Prepended to a brief that still contradicts the panels after one rewrite. */
export function contradictionNotice(reason: string): string {
  return `**Note from the analysis:** ${reason} The panels are computed from the data and are authoritative; read this brief with that in mind.\n\n`;
}
