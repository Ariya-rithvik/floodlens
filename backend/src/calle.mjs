// Places the alert network's voice calls through the CALL-E Developer API (https://docs.heycall-e.com).
// Only numbers that joined the network with consent are ever passed in here.

const toE164 = (phone) => (phone.startsWith('+') ? phone : `+91${phone.slice(-10)}`);
const REGIONS = { '+91': ['IN', 'en-IN'], '+977': ['NP', 'en-US'], '+1': ['US', 'en-US'] };
const regionFor = (phone) => Object.entries(REGIONS).find(([prefix]) => phone.startsWith(prefix))?.[1] || ['IN', 'en-IN'];

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['heard'],
  properties: { heard: { type: 'boolean', description: 'True if a person answered and the full message was read to them.' } },
};

/**
 * @param {object} cfg
 * @param {string} cfg.apiKey      CALL-E key. No key means no caller (the backend then only logs who it would call).
 * @param {string} [cfg.allowed]   Comma-separated numbers. When set, nobody else is ever dialled: use it for demos.
 * @param {number} [cfg.maxCalls]  Hard cap on calls for the life of this process, so a bug cannot drain credits.
 */
export function makeCaller({ apiKey, baseUrl, allowed = '', maxCalls = 20 }) {
  if (!apiKey) return null;
  const base = baseUrl || 'https://api.heycall-e.com';
  const allowlist = allowed.split(',').map((n) => n.replace(/[\s()-]/g, '')).filter(Boolean).map(toE164);
  let placed = 0;

  const post = (path, key, body) =>
    fetch(base + path, {
      method: 'POST',
      // The idempotency key makes a retried request the same call, not a second one.
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

  return async function notify({ text, to, report }) {
    const phone = toE164(to);
    if (allowlist.length && !allowlist.includes(phone)) return { status: 'skipped', reason: 'not on the demo allowlist' };
    if (placed >= maxCalls) return { status: 'skipped', reason: 'call limit reached' };

    const [region, locale] = regionFor(phone);
    const task =
      'You are an automated flood-alert line called FloodLens. Greet the person, then read the following message clearly and slowly in English, exactly as written. ' +
      'Offer to repeat it once if asked. Do not add advice, do not say whether any road is safe, and do not answer other questions. Then say goodbye and end the call. ' +
      `Message: "${text}"`;
    const key = `floodlens-${report.report_id}-${phone.slice(-4)}`;
    const metadata = { report_id: report.report_id, segment_id: report.segment_id };

    let res = await post('/v1/calls', key, { task, recipients: [{ phones: [phone], region, locale }], result_schema: RESULT_SCHEMA, metadata });
    // Accounts on the newer API version take a single phone instead of a recipients list.
    if (res.status === 404 || res.status === 410) res = await post('/v2/calls', key, { task, phone, region, result_schema: RESULT_SCHEMA, metadata });
    if (!res.ok) throw new Error(`CALL-E answered ${res.status}: ${(await res.text()).slice(0, 200)}`);

    placed++;
    const call = await res.json();
    return { status: 'placed', channel: 'CALL-E', call_id: call.call_id || call.id };
  };
}
