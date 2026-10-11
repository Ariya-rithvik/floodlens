// The offline community pack: real OpenStreetMap geography bundled with the app, so the map needs no network.
import pack from '../data/pack.json';

export { pack };

export const roadById = new Map(pack.roads.map((r) => [r.id, r]));

const CLASS_NAMES = { primary: 'Main road', secondary: 'Secondary road', tertiary: 'Link road', unclassified: 'Local road', residential: 'Village lane', service: 'Access road', track: 'Track' };

const KM = 111.32;
const dist = (a, b) => {
  const dy = (a[0] - b[0]) * KM;
  const dx = (a[1] - b[1]) * KM * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

function nearestPlace(pt) {
  let best = null;
  for (const p of pack.places) {
    if (!['village', 'hamlet', 'quarter'].includes(p.k)) continue;
    const d = dist(pt, p.p);
    if (!best || d < best.d) best = { d, n: p.n };
  }
  return best;
}

/** A human name for a segment, even when OSM has none: "Bridge · Village lane near Chooralmala". */
export function roadName(id) {
  const r = roadById.get(id);
  if (!r) return 'Unmapped location';
  const mid = r.p[Math.floor(r.p.length / 2)];
  const near = nearestPlace(mid);
  const base = r.n || CLASS_NAMES[r.c] || 'Road';
  return `${r.b ? 'Bridge · ' : ''}${base}${near && near.d < 3 ? ` near ${near.n}` : ''}`;
}

export function roadMid(id) {
  const r = roadById.get(id);
  return r ? r.p[Math.floor(r.p.length / 2)] : null;
}

// Distance from point to the line segment a-b, in km, on a local flat projection.
function distToSegment(p, a, b) {
  const cos = Math.cos((p[0] * Math.PI) / 180);
  const px = p[1] * cos, py = p[0], ax = a[1] * cos, ay = a[0], bx = b[1] * cos, by = b[0];
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * KM;
}

/** Snaps a tapped or GPS position to the closest mapped road. */
export function nearestRoad(lat, lon) {
  const p = [lat, lon];
  let best = null;
  for (const r of pack.roads) {
    for (let i = 0; i < r.p.length - 1; i++) {
      const d = distToSegment(p, r.p[i], r.p[i + 1]);
      if (!best || d < best.km) best = { id: r.id, km: d };
    }
  }
  return best && { ...best, metres: Math.round(best.km * 1000) };
}

export const inPack = (lat, lon) => lat >= pack.bbox[0] && lat <= pack.bbox[2] && lon >= pack.bbox[1] && lon <= pack.bbox[3];
