// FloodLens ingest logic, independent of where it runs.
// `store` and `photos` are injected: DynamoDB + S3 in Lambda (aws.mjs), memory in the local dev server (local.mjs).

const KINDS = ['water_over_road', 'bridge_damaged', 'landslide', 'tree_down', 'passable', 'closed', 'reopened'];
// Hours an observation stays current, and what a caller is told it was. Mirrors web/src/lib/status.js.
const HAZARDS = {
  water_over_road: [3, 'water over the road'],
  bridge_damaged: [24, 'a damaged bridge'],
  landslide: [12, 'a landslide'],
  tree_down: [6, 'a fallen tree'],
};
const ALERT_RADIUS_KM = 3;
const MAX_CALLS = 20;
function distanceKm(a, b) {
  const dy = (a.lat - b.lat) * 111.32;
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function validate(r) {
  if (!/^FL-[A-Z0-9]{4,10}$/.test(r.report_id || '')) return 'bad report_id';
  if (!KINDS.includes(r.kind)) return 'bad kind';
  if (Number.isNaN(Date.parse(r.observed_at))) return 'bad observed_at';
  if (typeof r.lat !== 'number' || typeof r.lon !== 'number' || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return 'bad location';
  if (!r.segment_id || !r.origin_device) return 'missing segment or origin';
  if (r.photo && (!r.photo.startsWith('data:image/jpeg;base64,') || r.photo.length > 400000)) return 'bad photo';
  return null;
}

export function makeApi({ store, photos, classify, notify, responderKey }) {
  const reports = async () => (await store.list()).filter((x) => x.type !== 'member');
  const members = async () => (await store.list()).filter((x) => x.type === 'member');

  // A second independent phone confirming a hazard is the moment worth waking people for.
  // One round of calls per road: responders anywhere, and members who said they live within reach of it.
  async function maybeAlert(item, now) {
    if (!notify || item.source !== 'community' || !HAZARDS[item.kind]) return;
    const current = (await reports()).filter(
      (r) => r.segment_id === item.segment_id && HAZARDS[r.kind] && r.source === 'community' && Date.parse(now) - Date.parse(r.observed_at) < HAZARDS[r.kind][0] * 3600e3,
    );
    const phones = new Set(current.map((r) => r.origin_device)).size;
    if (phones < 2 || current.some((r) => r.alert)) return;

    const seen = new Date(item.observed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const what =
      (current.every((r) => r.drill) ? 'This is a FloodLens drill, not a real emergency. ' : 'This is a FloodLens alert. ') +
      `${phones} independent phones report ${HAZARDS[item.kind][1]} at ${item.road || 'a mapped road'}. Last seen at ${seen}. This is not officially confirmed. `;
    const rank = (m) => (m.role === 'responder' ? 0 : 1);
    const toCall = (await members())
      .map((m) => ({ ...m, km: distanceKm(m, item) }))
      .filter((m) => m.role === 'responder' || m.km <= ALERT_RADIUS_KM)
      .sort((x, y) => rank(x) - rank(y) || x.km - y.km)
      .slice(0, MAX_CALLS);

    const calls = [];
    for (const m of toCall) {
      const text = what + (m.role === 'responder'
        ? 'Please send someone to check, then record the result in FloodLens.'
        : `This is about ${m.km.toFixed(1)} kilometres from ${m.place}. Please avoid this road until it has been checked.`);
      // The log keeps who was called and where they are, never their number: reports are readable by every device.
      const entry = { name: m.name, place: m.place, role: m.role, km: Math.round(m.km * 10) / 10 };
      try {
        Object.assign(entry, await notify({ text, to: m.phone, report: item }));
      } catch (err) {
        console.error('voice call failed', err);
        entry.status = 'failed';
      }
      calls.push(entry);
    }
    await store.update(item.report_id, { alert: { text: what.trim(), at: now, phones, calls } });
  }

  async function join(body) {
    const m = JSON.parse(body || '{}');
    const phone = String(m.phone || '').replace(/[ -]/g, '');
    if (!/^[+]?[0-9]{10,13}$/.test(phone)) return json(400, { error: 'Enter a phone number with 10 to 13 digits.' });
    if (!m.name || !m.place || typeof m.lat !== 'number' || typeof m.lon !== 'number') return json(400, { error: 'Name and home place are required.' });
    if (m.consent !== true) return json(400, { error: 'Consent to receive calls is required.' });
    await store.update(`MEMBER#${phone}`, {
      type: 'member', phone, name: String(m.name).slice(0, 40), place: String(m.place).slice(0, 60), lat: m.lat, lon: m.lon,
      role: m.role === 'responder' ? 'responder' : 'resident', joined_at: new Date().toISOString(),
    });
    return json(200, { joined: true, network_size: (await members()).length });
  }

  const isResponder = (headers) => !!responderKey && headers['x-responder-key'] === responderKey;

  async function ingest(report, carrier, responder, now) {
    const problem = validate(report);
    if (problem) return { report_id: report.report_id, outcome: 'rejected', reason: problem };
    if (report.source === 'authority' && !responder) {
      return { report_id: report.report_id, outcome: 'rejected', reason: 'authority reports need a responder key' };
    }
    const delivery = { by: carrier.id, name: carrier.name, at: now, hops: (report.hops || []).length };
    const existing = await store.get(report.report_id);

    if (existing) {
      // Same report arriving by a second route: remember the route, never create a second incident.
      const patch = { deliveries: [...existing.deliveries, delivery].slice(-20) };
      let outcome = 'duplicate';
      if (!existing.photo_url && report.photo) {
        patch.photo_url = await photos.put(report.report_id, report.photo);
        patch.photo_state = 'synced';
        patch.ai = await classify?.(report).catch(() => null);
        outcome = 'photo_added';
      }
      await store.update(report.report_id, patch);
      return { report_id: report.report_id, outcome };
    }

    const { photo, ...meta } = report;
    const item = {
      report_id: meta.report_id, segment_id: meta.segment_id, kind: meta.kind, observed_at: meta.observed_at,
      lat: meta.lat, lon: meta.lon, accuracy_m: meta.accuracy_m || 0, note: String(meta.note || '').slice(0, 200),
      source: meta.source === 'authority' ? 'authority' : 'community',
      origin_device: meta.origin_device, origin_name: String(meta.origin_name || '').slice(0, 40),
      hops: (meta.hops || []).slice(0, 20), drill: !!meta.drill, road: String(meta.road || '').slice(0, 80),
      photo_state: photo ? 'synced' : meta.photo_state === 'none' ? 'none' : 'pending',
      first_delivered_at: now, deliveries: [delivery],
    };
    if (photo) {
      item.photo_url = await photos.put(meta.report_id, photo);
      item.ai = await classify?.(report).catch(() => null);
    }
    // put() is conditional on the ID not existing, so two carriers syncing at the same instant still yield one record.
    const created = await store.put(item);
    if (created) await maybeAlert(item, now);
    return { report_id: meta.report_id, outcome: created ? 'accepted' : 'duplicate' };
  }

  return async function handle({ method, path, headers = {}, body }) {
    try {
      if (method === 'OPTIONS') return json(204, {});
      if (method === 'GET' && path === '/whoami') return json(200, { responder: isResponder(headers) });
      if (method === 'GET' && path === '/reports') return json(200, { reports: await reports(), server_time: new Date().toISOString() });
      if (method === 'POST' && path === '/members') return join(body);
      if (method === 'GET' && path === '/members') {
        const list = await members();
        // Anyone may see how large the network is; only a responder sees who is in it, and never full numbers.
        if (!isResponder(headers)) return json(200, { network_size: list.length });
        return json(200, { network_size: list.length, members: list.map((m) => ({ name: m.name, place: m.place, role: m.role, phone: '*******' + m.phone.slice(-3) })) });
      }
      if (method === 'POST' && path === '/sync') {
        const { device, reports } = JSON.parse(body || '{}');
        if (!device?.id || !Array.isArray(reports) || reports.length > 25) return json(400, { error: 'expected { device, reports[<=25] }' });
        const now = new Date().toISOString();
        const results = [];
        for (const r of reports) results.push(await ingest(r, device, isResponder(headers), now));
        return json(200, { results, server_time: now });
      }
      return json(404, { error: 'not found' });
    } catch (err) {
      console.error(err);
      return json(500, { error: 'internal error' });
    }
  };
}
