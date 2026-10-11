// Compact report encoding for device-to-device handoff (QR today; the same payload fits a LoRa text message).
// Only metadata travels: photos stay on the origin device until some carrier reaches the internet.

const TAG = 'FL1';
const KIND_CODES = ['water_over_road', 'bridge_damaged', 'landslide', 'tree_down', 'passable', 'closed', 'reopened'];

export function encodeReport(r) {
  return [
    TAG,
    r.report_id,
    r.segment_id,
    Math.floor(Date.parse(r.observed_at) / 1000).toString(36),
    KIND_CODES.indexOf(r.kind),
    r.lat.toFixed(5),
    r.lon.toFixed(5),
    Math.round(r.accuracy_m || 0),
    r.source === 'authority' ? 'a' : 'c',
    r.origin_device,
    r.origin_name,
    r.hops.length,
    r.photo_state && r.photo_state !== 'none' ? 1 : 0,
    (r.note || '').replace(/\|/g, '/').slice(0, 80),
  ].join('|');
}

/** Decodes a scanned payload into a report as held by the receiving device (one hop further on). */
export function decodeReport(text, device, now = Date.now()) {
  const f = String(text).trim().split('|');
  if (f[0] !== TAG || f.length < 14) throw new Error('Not a FloodLens report code');
  const kind = KIND_CODES[Number(f[4])];
  if (!kind) throw new Error('Unknown hazard type in code');
  const priorHops = Number(f[11]) || 0;
  return {
    report_id: f[1],
    segment_id: f[2],
    observed_at: new Date(parseInt(f[3], 36) * 1000).toISOString().slice(0, 19) + 'Z',
    kind,
    lat: Number(f[5]),
    lon: Number(f[6]),
    accuracy_m: Number(f[7]),
    source: f[8] === 'a' ? 'authority' : 'community',
    origin_device: f[9],
    origin_name: f[10],
    // Earlier carriers are not in the code, only how many there were.
    hops: [...Array(priorHops).fill({ device: null, name: 'earlier carrier', via: 'relay' }), { device: device.id, name: device.name, via: 'qr', at: new Date(now).toISOString() }],
    photo_state: f[12] === '1' ? 'pending' : 'none',
    note: f.slice(13).join('|'),
    delivery: 'carrying',
    received_at: new Date(now).toISOString(),
  };
}
