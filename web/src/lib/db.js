// On-device storage. Everything the app shows comes from here first, so it works with no network.
import { openDB } from 'idb';

// ?device=B gives a second, fully separate device in another window of the same browser (for demos and tests).
const slot = new URLSearchParams(location.search).get('device') || 'main';
const LS = (k) => `floodlens:${slot}:${k}`;

const BIRDS = ['Kite', 'Heron', 'Egret', 'Hornbill', 'Drongo', 'Bulbul', 'Barbet', 'Koel', 'Lapwing', 'Myna'];

export function getDevice() {
  let d = JSON.parse(localStorage.getItem(LS('device')) || 'null');
  if (!d) {
    const n = Math.floor(10 + Math.random() * 90);
    const bird = BIRDS[Math.floor(Math.random() * BIRDS.length)];
    d = { id: `${bird.toLowerCase()}-${n}-${Math.random().toString(36).slice(2, 6)}`, name: `${bird} ${n}` };
    localStorage.setItem(LS('device'), JSON.stringify(d));
  }
  return d;
}

export const prefs = {
  get: (k, fallback = null) => JSON.parse(localStorage.getItem(LS(k)) ?? 'null') ?? fallback,
  set: (k, v) => localStorage.setItem(LS(k), JSON.stringify(v)),
};

const dbp = openDB(`floodlens-${slot}`, 1, {
  upgrade(db) {
    db.createObjectStore('reports', { keyPath: 'report_id' });
  },
});

export async function allReports() {
  return (await dbp).getAll('reports');
}

export async function getReport(id) {
  return (await dbp).get('reports', id);
}

export async function putReport(r) {
  await (await dbp).put('reports', r);
}

export async function clearReports() {
  await (await dbp).clear('reports');
}

/**
 * Imports a report that arrived from another device or the server.
 * The report ID is the identity: receiving it twice never creates a second incident.
 * @returns {'new'|'duplicate'}
 */
export async function importReport(incoming) {
  const db = await dbp;
  const existing = await db.get('reports', incoming.report_id);
  if (!existing) {
    await db.put('reports', incoming);
    return 'new';
  }
  const merged = { ...existing };
  if (!existing.photo && incoming.photo) Object.assign(merged, { photo: incoming.photo, photo_state: incoming.photo_state });
  if (!existing.photo_url && incoming.photo_url) merged.photo_url = incoming.photo_url;
  if (incoming.ai) merged.ai = incoming.ai;
  if (incoming.alert) merged.alert = incoming.alert;
  if (incoming.deliveries) merged.deliveries = incoming.deliveries;
  if (incoming.delivery === 'delivered' && existing.delivery !== 'delivered') {
    merged.delivery = 'delivered';
    merged.delivered_at = incoming.delivered_at;
  }
  await db.put('reports', merged);
  return 'duplicate';
}

export function newReportId() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alike characters: IDs get read aloud over bad phone lines
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(6))) s += a[b % a.length];
  return `FL-${s}`;
}
