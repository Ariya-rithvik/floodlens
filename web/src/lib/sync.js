// Store-carry-forward, last leg: push whatever this device is holding, then pull what the response centre knows.
import { roadName } from './pack.js';
import { allReports, getReport, importReport, prefs, putReport } from './db.js';

export const API = import.meta.env.VITE_API_URL || '/api';

async function call(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-responder-key': prefs.get('responderKey', '') || '', ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  return res.json();
}

/** @returns {{pushed:number, accepted:number, duplicates:number, rejected:number, pulled:number}} */
export async function syncNow(device) {
  const mine = await allReports();
  const outbox = mine.filter((r) => r.delivery === 'saved' || r.delivery === 'carrying' || (r.delivery === 'delivered' && r.photo_state === 'local'));
  const summary = { pushed: outbox.length, accepted: 0, duplicates: 0, rejected: 0, pulled: 0 };

  // Small batches: a weak connection should deliver some reports rather than fail on all of them.
  for (let i = 0; i < outbox.length; i += 5) {
    const batch = outbox.slice(i, i + 5).map(({ delivery, delivered_at, received_at, ...r }) => ({ ...r, road: roadName(r.segment_id) }));
    const { results, server_time } = await call('/sync', { method: 'POST', body: JSON.stringify({ device, reports: batch }) });
    for (const res of results) {
      const r = await getReport(res.report_id);
      if (!r) continue;
      if (res.outcome === 'rejected') {
        summary.rejected++;
        await putReport({ ...r, delivery: 'rejected', reject_reason: res.reason });
        continue;
      }
      res.outcome === 'duplicate' ? summary.duplicates++ : summary.accepted++;
      await putReport({ ...r, delivery: 'delivered', delivered_at: server_time, photo_state: r.photo ? 'synced' : r.photo_state });
    }
  }

  const { reports } = await call('/reports');
  for (const r of reports) {
    const outcome = await importReport({ ...r, delivery: 'delivered', delivered_at: r.first_delivered_at, photo_state: r.photo_url ? 'synced' : r.photo_state });
    if (outcome === 'new') summary.pulled++;
  }
  prefs.set('lastSync', new Date().toISOString());
  return summary;
}

export async function checkResponderKey(key) {
  const res = await fetch(API + '/whoami', { headers: { 'x-responder-key': key }, signal: AbortSignal.timeout(10000) });
  return res.ok && (await res.json()).responder === true;
}

/** Opt in to voice alerts about hazards near a home place. Needs a connection: the number is stored only at the response centre. */
export async function joinNetwork(member) {
  const res = await fetch(API + '/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(member), signal: AbortSignal.timeout(15000) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || 'Could not join');
  return out;
}
