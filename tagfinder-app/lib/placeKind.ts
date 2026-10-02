/**
 * What is at the position? Not the county — the thing the search circle is
 * centred on.
 *
 * MiniPAT 40996 (Waves NC, Oct 2026) spent a day on a camper table at Ocean
 * Waves Campground. Fourteen fixes centred on the campground, the panel said
 * "Dare County, NC", and the brief sent the team to walk the wrack line a
 * hundred metres from the camper. A street-level reverse geocode of the same
 * point returns "Ocean Waves Campground, camp_site". That word is the
 * difference between a two-day search and a question at the office.
 *
 * OpenStreetMap tags the thing at a point with a class and a type; this maps
 * them onto the handful of kinds that change what a searcher should do.
 */

export type PlaceKind =
  | 'campground'
  | 'lodging'
  | 'residence'
  | 'marina'
  | 'parking'
  | 'business'
  | 'pier'
  | 'beach'
  | 'park'
  | 'road'
  | 'water'
  | 'other';

export interface Place {
  /** The feature's own name, e.g. "Ocean Waves Campground". */
  name: string | null;
  kind: PlaceKind;
  /** OSM class and type, kept for the brief. */
  category: string;
  type: string;
}

/** Kinds where a tag is most likely in somebody's possession. */
export const INHABITED_KINDS: ReadonlySet<PlaceKind> = new Set(['campground', 'lodging', 'residence', 'marina', 'parking', 'business']);

export function classifyPlace(category: string, type: string): PlaceKind {
  const c = (category || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t === 'camp_site' || t === 'caravan_site' || t === 'camp_pitch') return 'campground';
  if (['hotel', 'motel', 'guest_house', 'hostel', 'chalet', 'apartment', 'apartments', 'resort'].includes(t)) return 'lodging';
  if (c === 'leisure' && (t === 'marina' || t === 'slipway')) return 'marina';
  if (t === 'harbour' || t === 'boatyard' || t === 'boat_storage') return 'marina';
  if (t === 'parking' || t === 'parking_space') return 'parking';
  if (c === 'man_made' && (t === 'pier' || t === 'breakwater' || t === 'groyne' || t === 'jetty')) return 'pier';
  if (c === 'natural' && (t === 'beach' || t === 'coastline' || t === 'sand' || t === 'dune')) return 'beach';
  if (c === 'leisure' && (t === 'park' || t === 'nature_reserve' || t === 'beach_resort')) return 'park';
  if (c === 'boundary' && t === 'protected_area') return 'park';
  if (c === 'highway') return 'road';
  if (c === 'natural' && (t === 'water' || t === 'bay' || t === 'strait')) return 'water';
  if (c === 'waterway') return 'water';
  if (c === 'building' && ['house', 'residential', 'detached', 'semidetached_house', 'bungalow', 'terrace', 'yes'].includes(t)) return 'residence';
  if (c === 'place' && (t === 'house' || t === 'houses')) return 'residence';
  if (c === 'landuse' && t === 'residential') return 'residence';
  if (c === 'shop' || c === 'amenity' || c === 'office' || c === 'craft' || c === 'tourism') return 'business';
  if (c === 'building') return 'business';
  return 'other';
}

/** One sentence a searcher can act on, or null for kinds that say nothing. */
export function placeAdvice(place: Place): string | null {
  const name = place.name ? `${place.name}` : null;
  switch (place.kind) {
    case 'campground':
      return `The search circle is centred on ${name ?? 'a campground'}. A tag in someone's camper or tent reads exactly like a tag on the beach beside it. Ask at the office and post a note before walking the sand.`;
    case 'lodging':
      return `The search circle is centred on ${name ?? 'a hotel or rental'}. A tag on a guest's balcony or in a room reads like one on the beach in front. Ask at the front desk first.`;
    case 'residence':
      return `The search circle is centred on ${name ? `${name}, a house` : 'a house or residential lot'}. A tag carried home from the beach ends up on a porch or a table that reads like the sand outside. Knock before searching.`;
    case 'marina':
      return `The search circle is centred on ${name ?? 'a marina'}. A tag hauled aboard or left on a dock reads like one floating alongside. Ask the dockmaster.`;
    case 'parking':
      return `The search circle is centred on ${name ?? 'a parking area'}. A tag in a parked vehicle reads like one on the ground beside it. Check for a car that stays.`;
    case 'business':
      return `The search circle is centred on ${name ?? 'a business'}. Somebody may have handed the tag in; ask inside.`;
    default:
      return null;
  }
}
