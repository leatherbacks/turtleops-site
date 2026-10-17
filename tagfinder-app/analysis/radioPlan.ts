import type { RepetitionRate } from '@/lib/types';
import { radioGear, type RadioGear } from './radioGear';

/**
 * Radio direction-finding before searching by eye or knocking on doors.
 *
 * A stopped Argos tag keeps transmitting, indoors, under sand or in wrack, and
 * a receiver finds it where eyes cannot. MiniPAT 285927 was found buried flat
 * in the Padre Island sand, not visible; MiniPAT 33938 was carried indoors
 * somewhere in a 390 × 220 m block of houses at Melbourne Beach. In both the
 * search area was too big to walk or knock through, and both tags were on the
 * air every 60 seconds. The plan here gives the two numbers a receiver needs,
 * measured from the tag's own data, and four listening spots around the
 * position whose bearings should cross on it.
 */

export type RadioScenario = 'in_hand' | 'covered_ground' | 'ashore' | 'unknown';

export interface RadioStation {
  id: string;
  /** Compass side of the position the spot is on. */
  side: 'north' | 'east' | 'south' | 'west';
  lat: number;
  lon: number;
  /** True bearing from the spot to the position. */
  bearingDeg: number;
  distanceM: number;
}

export interface RadioPlan {
  scenario: RadioScenario;
  headline: string;
  /** Measured transmit frequency, MHz, or null when no pass carried one. */
  frequencyMHz: number | null;
  /** Transmission interval from the tag's own message times, seconds. */
  periodS: number | null;
  /** Silence longer than this means the tag is not transmitting. */
  silenceS: number | null;
  /** How long to listen at each spot. */
  dwellS: number;
  stations: RadioStation[];
  /** Wildlife Computers tags may carry a recovery pinger or beacon. */
  askAboutPinger: boolean;
  /** Days since the newest message; past a week the tag may have gone quiet. */
  messageAgeDays: number | null;
  steps: string[];
  /** Settings per receiver type, from the tag's frequency and interval. */
  gear: RadioGear[];
}

export interface RadioPlanInput {
  lat: number;
  lon: number;
  searchRadiusM: number;
  frequencyMHz: number | null;
  repetition: RepetitionRate | null;
  manufacturer: string;
  /** Tag state phase from analysis/tagState. */
  phase: string | null;
  /** Antenna covered by message rate, or light covered since the stop. */
  covered: boolean;
  /** The position is a house, campground, marina, etc. */
  inhabited: boolean;
  drifting: boolean;
  newestMessage: Date | null;
  now?: Date;
}

/** Listening spots sit this far out, scaled to the search area. */
const MIN_STANDOFF_M = 300;
const MAX_STANDOFF_M = 1200;
/**
 * A covered tag carries a short way on the ground. 33938, shut in a boat
 * lockup, was heard on a CLS RXG-234 only within about 200 m; spots 750 m
 * out would hear nothing and read as "not transmitting".
 */
const COVERED_MAX_STANDOFF_M = 400;
/** Nominal Argos uplink, for when no pass carried a frequency. */
const ARGOS_NOMINAL_MHZ = 401.65;

export function planRadio(i: RadioPlanInput): RadioPlan | null {
  if (i.drifting) return null;
  const now = (i.now ?? new Date()).getTime();
  const period = i.repetition?.periodS ?? null;
  const dwellS = period ? Math.max(120, Math.ceil(((2 * period + (i.repetition?.jitterS ?? 0)) * 1.2) / 60) * 60) : 180;
  const shut = i.phase === 'likely_recovered' || i.phase === 'buried' || i.covered;
  const d = Math.round(Math.min(shut ? COVERED_MAX_STANDOFF_M : MAX_STANDOFF_M, Math.max(MIN_STANDOFF_M, 1.5 * i.searchRadiusM)) / 50) * 50;
  const stations = (['north', 'east', 'south', 'west'] as const).map((side, k) => {
    const back = [180, 270, 0, 90][k];
    const [la, lo] = offset(i.lat, i.lon, (back + 180) % 360, d);
    return { id: `L${k + 1}`, side, lat: la, lon: lo, bearingDeg: back, distanceM: d };
  });
  const ageDays = i.newestMessage ? (now - i.newestMessage.getTime()) / 86_400_000 : null;

  const scenario: RadioScenario =
    i.phase === 'likely_recovered' || (i.covered && i.inhabited)
      ? 'in_hand'
      : i.phase === 'buried' || i.covered
        ? 'covered_ground'
        : i.phase === 'stranded_on_land'
          ? 'ashore'
          : 'unknown';
  const headline = {
    in_hand: 'Radio first, then knock on the door it points to.',
    covered_ground: 'Radio first: a covered tag is not visible. Close in by signal, then probe the sand or wrack where it is loudest.',
    ashore: 'Radio narrows the sweep: listen before walking the shore.',
    unknown: 'A receiver can confirm the tag is still transmitting and narrow the search before anyone walks it.',
  }[scenario];

  const f = i.frequencyMHz ?? ARGOS_NOMINAL_MHZ;
  const steps = [
    i.frequencyMHz
      ? `Tune to ${f.toFixed(3)} MHz, the tag's own frequency measured from its passes, not the 401.650 nominal.`
      : `No pass carried a frequency; scan 401.620–401.680 MHz around the 401.650 Argos nominal.`,
    period
      ? `It transmits a short burst every ${period} s. Listen at least ${Math.round(dwellS / 60)} minutes at each spot; ` +
        `silence longer than ${Math.round((i.repetition?.silenceThresholdS ?? 3 * period) / 60)} minutes means it is not transmitting, not that you are in the wrong place.`
      : `The interval could not be measured from this export; Argos tags usually send every 30–90 s. Listen at least 3 minutes at each spot.`,
    `Use an Argos direction finder (goniometer), a handheld UHF radio, or a software radio with a waterfall display, with a small directional antenna (a 70 cm amateur Yagi works, slightly off-tune at 401 MHz). Bring an attenuator or gain control for the last 50 m. Settings for each are below; check the frequency on the receiver before trusting what you hear.`,
    `Take a bearing from each listening spot (the nearest public road or beach access to it). Sweep a full circle, then hold on the strongest direction for the next burst. Try the antenna upright and on its side: a tag lying flat radiates sideways.`,
    `Write the bearings down. Reflections off buildings and dunes shift any one bearing by 20–30°; three or four that cross give the spot. If they disagree with the expected bearings by much more than 30°, believe the radio, not the map.`,
    scenario === 'covered_ground'
      ? `Close in on foot. As the signal saturates, turn the gain down, add attenuation, then take the antenna off: if the bare receiver still hears it you are within a few metres. Probe or sweep the sand there; buried tags lie flat and shallow.`
      : `Close in along public ways. As the signal saturates, turn the gain down, add attenuation, then take the antenna off: if the bare receiver still hears it you are within a few tens of metres.`,
  ];
  if (i.manufacturer === 'wildlife_computers')
    steps.unshift(
      `Before going: ask whoever programmed the tag (or Wildlife Computers support, with the serial number) whether a recovery pinger or VHF beacon is fitted and enabled. If it is, home on that; it is easier than Argos. The export does not say.`
    );
  if (ageDays !== null && ageDays > 7)
    steps.unshift(
      `The newest message is ${ageDays.toFixed(0)} days old. Pull a fresh export first: if the tag has gone quiet there is nothing to hear.`
    );

  return {
    scenario,
    headline,
    frequencyMHz: i.frequencyMHz,
    periodS: period,
    silenceS: i.repetition?.silenceThresholdS ?? null,
    dwellS,
    stations,
    askAboutPinger: i.manufacturer === 'wildlife_computers',
    messageAgeDays: ageDays,
    steps,
    gear: radioGear({ frequencyMHz: i.frequencyMHz, periodS: period, manufacturer: i.manufacturer }),
  };
}

/** Destination point a distance along a true bearing. */
function offset(lat: number, lon: number, bearingDeg: number, distM: number): [number, number] {
  const R = 6371008.8, d = distM / R, b = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(p2 * 180) / Math.PI, (l2 * 180) / Math.PI];
}
