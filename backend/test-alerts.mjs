// Checks who the alert network calls. Run: node backend/test-alerts.mjs
import assert from 'node:assert/strict';
import { makeApi } from './src/core.mjs';

const items = new Map();
const store = {
  get: async (id) => items.get(id),
  put: async (it) => (items.has(it.report_id) ? false : (items.set(it.report_id, it), true)),
  update: async (id, p) => items.set(id, { report_id: id, ...items.get(id), ...p }),
  list: async () => [...items.values()],
};
const placed = [];
const api = makeApi({ store, photos: { put: async () => '' }, notify: async ({ text, to }) => (placed.push({ to, text }), { status: 'simulated' }), responderKey: 'k' });
const call = async (method, path, body, headers = {}) => JSON.parse((await api({ method, path, headers, body: body && JSON.stringify(body) })).body);

const join = (name, phone, place, lat, lon, extra = {}) => call('POST', '/members', { name, phone, place, lat, lon, consent: true, ...extra });
await join('Asha', '9876500001', 'Chooralmala', 11.5, 76.16);
await join('Ravi', '9876500002', 'Meppadi', 11.555, 76.135); // about 6 km away
await join('Duty desk', '9876500003', 'Meppadi', 11.555, 76.135, { role: 'responder' });
assert.match((await call('POST', '/members', { name: 'X', phone: '9876500004', place: 'X', lat: 11.5, lon: 76.16 })).error, /Consent/);
assert.deepEqual(await call('GET', '/members'), { network_size: 3 });
assert.equal((await call('GET', '/members', null, { 'x-responder-key': 'k' })).members[0].phone, '*******001');

const now = Date.now();
const report = (id, dev, minAgo) => ({
  report_id: id, segment_id: 'W1', kind: 'water_over_road', observed_at: new Date(now - minAgo * 60000).toISOString(),
  lat: 11.501, lon: 76.161, origin_device: dev, origin_name: dev, hops: [], road: 'Bailey Bridge near Chooralmala',
});
const sync = (r) => call('POST', '/sync', { device: { id: 'c', name: 'c' }, reports: [r] });

await sync(report('FL-AAAA1', 'a', 20));
assert.equal(placed.length, 0, 'one report calls nobody');
await sync(report('FL-AAAA2', 'b', 5));
assert.deepEqual(placed.map((p) => p.to), ['9876500003', '9876500001'], 'responder first, then the nearby resident; the distant one is left alone');
await sync(report('FL-AAAA3', 'c', 1));
assert.equal(placed.length, 2, 'a road is only alerted once');

const { reports } = await call('GET', '/reports');
assert.equal(reports.length, 3, 'members never appear among reports');
assert.ok(!JSON.stringify(reports).includes('98765'), 'no phone number leaks into reports');
console.log('alert network: all checks passed');
console.log(placed[1].text);
