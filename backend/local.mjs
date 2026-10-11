// Local stand-in for the AWS backend: same core logic, in-memory storage. Run: node local.mjs
import { createServer } from 'node:http';
import { makeApi } from './src/core.mjs';
import { makeCaller } from './src/calle.mjs';

const PORT = Number(process.env.PORT) || 8787;
const items = new Map();
const store = {
  get: async (id) => items.get(id),
  put: async (item) => (items.has(item.report_id) ? false : (items.set(item.report_id, item), true)),
  update: async (id, patch) => items.set(id, { report_id: id, ...items.get(id), ...patch }),
  list: async () => [...items.values()],
};
const photos = { put: async (id, dataUrl) => dataUrl }; // no S3 locally: hand the image straight back
// No phone line locally: print what the call would say.
const simulated = async ({ text, to }) => {
  console.log('VOICE CALL to', to, '(not placed, local mode):', text);
  return { status: 'simulated', channel: 'voice call' };
};
// With CALLE_API_KEY set in the environment, real calls go out. Without it, calls are only printed.
const notify = makeCaller({ apiKey: process.env.CALLE_API_KEY, baseUrl: process.env.CALLE_BASE_URL, allowed: process.env.CALLE_ALLOWED_NUMBERS || process.env.DEMO_PHONE, maxCalls: Number(process.env.CALLE_MAX_CALLS) || 20 }) || simulated;
const handle = makeApi({ store, photos, notify, responderKey: process.env.RESPONDER_KEY || 'drill-2026' });

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const out = await handle({ method: req.method, path: new URL(req.url, 'http://x').pathname, headers: req.headers, body });
  res.writeHead(out.statusCode, { ...out.headers, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-responder-key' });
  res.end(out.body);
  console.log(req.method, req.url, out.statusCode, `(${items.size} reports held)`);
}).listen(PORT, () => console.log(`FloodLens local backend on http://localhost:${PORT}`, '  responder key:', process.env.RESPONDER_KEY || 'drill-2026'));
console.log('Voice calls:', process.env.CALLE_API_KEY ? 'REAL, placed through CALL-E' + (process.env.CALLE_ALLOWED_NUMBERS || process.env.DEMO_PHONE ? ' (allowlisted numbers only)' : ' (ANY member who joined: set CALLE_ALLOWED_NUMBERS to restrict)') : 'simulated (set CALLE_API_KEY to place real calls)');
