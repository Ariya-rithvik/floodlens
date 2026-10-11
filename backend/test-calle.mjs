// Checks the CALL-E request shape and guards against a stand-in for fetch. No real call is placed. Run: node backend/test-calle.mjs
import assert from 'node:assert/strict';
import { makeCaller } from './src/calle.mjs';

const sent = [];
let v1Status = 200;
globalThis.fetch = async (url, options) => {
  sent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
  const status = url.endsWith('/v1/calls') ? v1Status : 200;
  return { ok: status === 200, status, json: async () => ({ call_id: 'call_1' }), text: async () => 'gone' };
};
const report = { report_id: 'FL-AAAA1', segment_id: 'W1' };

assert.equal(makeCaller({ apiKey: '' }), null, 'no key, no caller');

const open = makeCaller({ apiKey: 'k', maxCalls: 2 });
assert.deepEqual(await open({ text: 'hello', to: '9876500001', report }), { status: 'placed', channel: 'CALL-E', call_id: 'call_1' });
assert.equal(sent[0].url, 'https://api.heycall-e.com/v1/calls');
assert.deepEqual(sent[0].body.recipients, [{ phones: ['+919876500001'], region: 'IN', locale: 'en-IN' }]);
assert.equal(sent[0].headers['Idempotency-Key'], 'floodlens-FL-AAAA1-0001');
await open({ text: 'hello', to: '9876500002', report });
assert.equal((await open({ text: 'hello', to: '9876500003', report })).reason, 'call limit reached');

const guarded = makeCaller({ apiKey: 'k', allowed: '+91 98765-00001' });
sent.length = 0;
assert.equal((await guarded({ text: 'hello', to: '9876500009', report })).status, 'skipped');
assert.equal(sent.length, 0, 'a number off the allowlist is never dialled');
assert.equal((await guarded({ text: 'hello', to: '9876500001', report })).status, 'placed');

v1Status = 404;
sent.length = 0;
await makeCaller({ apiKey: 'k' })({ text: 'hello', to: '+919876500001', report });
assert.deepEqual(sent.map((s) => s.url.slice(-9)), ['/v1/calls', '/v2/calls']);
assert.equal(sent[1].body.phone, '+919876500001');
console.log('CALL-E adapter: all checks passed');
