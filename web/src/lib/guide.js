// Higher-ground options for someone who cannot leave by road. Works from the offline pack alone;
// a connection only sharpens the estimate of the person's own ground height.
// This compares heights for rising water. It knows nothing about landslide risk, and it is not a route.
import { pack } from './pack.js';
import { KINDS } from './status.js';

const KM = 111.32;
const flat = (p, ref) => [(p[1] - ref[1]) * KM * Math.cos((ref[0] * Math.PI) / 180), (p[0] - ref[0]) * KM];
const km = (a, b) => Math.hypot(...flat(a, b));

const KIND_LABEL = { community_centre: 'Community hall', school: 'School', hospital: 'Health facility', clinic: 'Health facility', village: 'Village centre', hamlet: 'Settlement' };
const MIN_GAIN_M = 10;
const MAX_KM = 3;
const NEAR_LINE_KM = 0.3;

function distToLineKm(p, a, b) {
  const [px, py] = flat(p, a), [bx, by] = flat(b, a);
  const t = bx || by ? Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by))) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** Ground height at a point: measured when there is a connection, otherwise borrowed from the nearest mapped place. */
export async function groundHeight(lat, lon, online) {
  if (online) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`, { signal: AbortSignal.timeout(6000) });
      const metres = (await res.json()).elevation?.[0];
      if (typeof metres === 'number') return { metres: Math.round(metres), source: 'measured for this exact point (online)' };
    } catch {
      // fall through to the offline estimate
    }
  }
  const nearest = pack.places.filter((p) => p.e != null).sort((a, b) => km(a.p, [lat, lon]) - km(b.p, [lat, lon]))[0];
  return { metres: nearest.e, source: `estimated from ${nearest.n}, the nearest mapped place (offline)` };
}

/**
 * @param {Map} statuses output of statusBySegment
 * @returns up to four higher places within 3 km, nearest first, each with the hazards known along the straight line to it
 */
export function higherGround(lat, lon, myHeight, statuses) {
  const here = [lat, lon];
  const hazards = [...statuses.values()].filter((s) => ['reported', 'corroborated', 'conflict', 'verified_closed'].includes(s.status));
  return pack.places
    .filter((p) => KIND_LABEL[p.k] && p.e != null && p.e - myHeight >= MIN_GAIN_M && km(p.p, here) <= MAX_KM && km(p.p, here) > 0.05)
    .map((p) => ({
      name: p.n,
      kind: KIND_LABEL[p.k],
      lat: p.p[0],
      lon: p.p[1],
      metres: Math.round(km(p.p, here) * 1000),
      gain: p.e - myHeight,
      // What has been reported near the direct line. An empty list means nothing is known, not that the way is clear.
      known: hazards
        .filter((s) => distToLineKm([s.latest.lat, s.latest.lon], here, p.p) <= NEAR_LINE_KM)
        .map((s) => `${KINDS[s.latest.kind].label.toLowerCase()} (${s.status === 'conflict' ? 'conflicting reports' : s.status.replace('_', ' ')})`),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, 4);
}

/** Street-level imagery for a point. Needs a connection, and coverage on hill roads is patchy. */
export const streetViewUrl = (lat, lon) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;
