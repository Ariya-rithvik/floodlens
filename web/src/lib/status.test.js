import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentStatus } from './status.js';
import { encodeReport, decodeReport } from './codec.js';

const now = Date.parse('2026-10-11T12:00:00Z');
const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const o = (kind, minAgo, dev = 'A', source = 'community') => ({ kind, observed_at: at(minAgo), origin_device: dev, source });

test('no observation is unknown, never safe', () => {
  assert.equal(segmentStatus([], now).status, 'unknown');
});
test('one hazard report is only "reported"', () => {
  assert.equal(segmentStatus([o('water_over_road', 10)], now).status, 'reported');
});
test('the same device twice does not corroborate itself', () => {
  assert.equal(segmentStatus([o('water_over_road', 10), o('water_over_road', 5)], now).status, 'reported');
});
test('two independent devices corroborate', () => {
  assert.equal(segmentStatus([o('water_over_road', 10, 'A'), o('water_over_road', 5, 'B')], now).status, 'corroborated');
});
test('hazard and passable both fresh is a conflict, not an average', () => {
  assert.equal(segmentStatus([o('water_over_road', 10, 'A'), o('passable', 5, 'B')], now).status, 'conflict');
});
test('expired evidence becomes stale, not safe', () => {
  assert.equal(segmentStatus([o('water_over_road', 200)], now).status, 'stale');
});
test('authority closure overrides earlier community reports', () => {
  assert.equal(segmentStatus([o('passable', 30, 'A'), o('closed', 10, 'R', 'authority')], now).status, 'verified_closed');
});
test('a community report after an authority check reopens the question', () => {
  assert.equal(segmentStatus([o('reopened', 30, 'R', 'authority'), o('water_over_road', 5, 'A')], now).status, 'conflict');
});
test('QR payload round-trips and counts the hop', () => {
  const r = {
    report_id: 'FL-8K42AB', segment_id: 'W123', observed_at: at(3), kind: 'bridge_damaged',
    lat: 11.50012, lon: 76.15934, accuracy_m: 12, source: 'community', origin_device: 'kite-41', origin_name: 'Kite 41', hops: [], photo_state: 'local', note: 'approach washed out',
  };
  const back = decodeReport(encodeReport(r), { id: 'heron-07', name: 'Heron 07' }, now);
  assert.equal(back.report_id, r.report_id);
  assert.equal(back.observed_at, r.observed_at.slice(0, 19) + 'Z');
  assert.equal(back.hops.length, 1);
  assert.equal(back.photo_state, 'pending');
  assert.throws(() => decodeReport('hello', { id: 'x', name: 'x' }, now));
});
