// Records the demo video: drives the real app through web/stage.html and saves docs/floodlens-demo.mp4.
// By default it starts its own backend (port 8799, no CALL-E key, so no phone call is ever placed) and dev server (port 5199).
// With FLOODLENS_URL set, the phones and desk in the video are the deployed app at that address instead.
// Run from the repo root: node tools/record-demo.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { encodeReport } from '../web/src/lib/codec.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LIVE = (process.env.FLOODLENS_URL || '').replace(/\/$/, '');
const API = LIVE ? LIVE + '/api' : 'http://localhost:8799';
const WEB = 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36);
const slots = { A: `a${run}`, B: `b${run}`, D: `d${run}` };

const env = { ...process.env, PORT: '8799', FLOODLENS_API: API };
delete env.CALLE_API_KEY;
const backend = LIVE ? null : spawn('node', ['backend/local.mjs'], { cwd: ROOT, env, stdio: 'ignore' });
const web = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: ROOT + 'web', env, stdio: 'ignore', shell: true });
const stop = () => {
  backend?.kill();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(web.pid), '/T', '/F']);
  else web.kill();
};

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await sleep(500);
  }
  throw new Error('not reachable: ' + url);
}

try {
  await waitFor(API + '/whoami');
  await waitFor(WEB + '/stage.html');

  // One fictional member near the bridge, so the alert network has someone to pick. No call can go out from this backend.
  await fetch(API + '/members', {
    method: 'POST',
    body: JSON.stringify({ name: 'Asha (example member)', phone: '+910000000000', place: 'Chooralmala', lat: 11.4992, lon: 76.1602, consent: true }),
  });

  rmSync(ROOT + 'docs/_video', { recursive: true, force: true });
  mkdirSync(ROOT + 'docs/_video', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    permissions: ['camera'],
  });
  // Both phones start with the network cut; every tap leaves a visible ripple, since recordings have no cursor.
  await context.addInitScript((s) => {
    localStorage.setItem(`floodlens:${s.A}:airplane`, 'true');
    localStorage.setItem(`floodlens:${s.B}:airplane`, 'true');
    addEventListener('pointerdown', (e) => {
      const dot = document.createElement('div');
      dot.style.cssText = `position:fixed;z-index:99999;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:#ffffff55;border:2px solid #fff;pointer-events:none;transition:transform .5s,opacity .5s`;
      document.documentElement.appendChild(dot);
      requestAnimationFrame(() => ((dot.style.transform = 'scale(1.8)'), (dot.style.opacity = '0')));
      setTimeout(() => dot.remove(), 600);
    }, true);
  }, slots);

  const page = await context.newPage();
  await page.goto(WEB + '/stage.html');
  await page.evaluate((base) => { window.stage.base = base; }, LIVE);
  const frameOf = (slot) => page.frames().find((fr) => fr.url().includes(`device=${slot}`));
  // Capture the browser's own screencast frames with their timestamps; ffmpeg assembles them afterwards.
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (frame) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(ROOT + 'docs/_video/' + name, Buffer.from(frame.data, 'base64'));
    frames.push({ name, t: frame.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080 });
  const stage = (fn, ...args) => page.evaluate(([f, a]) => window.stage[f](...a), [fn, args]);
  const say = async (text, small, ms = 4200) => { await stage('caption', text, small || ''); await sleep(ms); };
  const A = page.frameLocator('#A'), B = page.frameLocator('#B'), D = page.frameLocator('#D');
  const tap = async (frame, name, wait = 900) => { await frame.getByRole('button', { name }).first().click(); await sleep(wait); };

  // ---------- 0. the problem ----------
  await stage('card', '<h1>FloodLens</h1><h2>After a flood, the map still shows a bridge that is gone,<br/>and the phone network is down.</h2><p>Who knows which roads are passable right now, and how do they know?</p>');
  await sleep(6500);

  // ---------- 1. report with no network ----------
  await stage('load', 'A', slots.A);
  await stage('load', 'B', slots.B);
  await stage('show', 'phones');
  await stage('step', '1 · Report with no network');
  await stage('label', 'A', 'Phone A · resident · no network');
  await stage('label', 'B', 'Phone B · volunteer · no network');
  await say('Two phones. Neither has a connection.', 'The map is real OpenStreetMap data for Chooralmala, Wayanad, stored inside the app. Network cut with the demo switch.', 5000);

  await tap(A, 'Report what you see');
  await say('A resident sees water over the Bailey Bridge and taps the road.', '', 2500);
  // The map opens centred on 11.515, 76.15 at zoom 13.25; this is where the bridge sits inside the 400 x 760 frame.
  const scale = (256 * 2 ** 13.25) / 360;
  const merc = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
  const at = { x: 200 + (76.16024 - 76.15) * scale, y: 380 - (merc(11.49923) - merc(11.515)) * scale };
  await page.locator('#A').click({ position: at });
  await sleep(1800);
  await tap(A, /Water over road/, 700);
  await A.getByPlaceholder('What did you see?').pressSequentially('Water above the knee, rising', { delay: 45 });
  await sleep(800);
  await tap(A, 'Save observation', 600);
  await say('Saved, not delivered.', 'The app never pretends a report has gone anywhere until it truly has.', 5500);

  // ---------- 2. hand it over ----------
  await stage('step', '2 · Hand it to someone who can walk out');
  await tap(A, 'Hand to a carrier', 1200);
  // Read the saved report straight from the phone's own storage and encode it the way the QR does.
  const saved = await frameOf(slots.A).evaluate((slot) => new Promise((resolve, reject) => {
    const open = indexedDB.open(`floodlens-${slot}`);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('reports').objectStore('reports').getAll();
      all.onsuccess = () => resolve(all.result[0]);
    };
  }), slots.A);
  const code = encodeReport(saved);
  await say('The report becomes a QR code. No network is used.', 'About 110 characters: the report only. A photo would stay on this phone until it reaches the internet.', 5000);

  await tap(B, 'Relay', 700);
  await tap(B, 'Receive a report', 1200);
  await say('A volunteer scans it.', 'On real phones the camera reads the code. In this recording the same code is pasted in.', 3500);
  await B.getByPlaceholder(/paste a code/).fill(code);
  await sleep(900);
  await tap(B, 'Import', 1200);
  await say('Phone B is now carrying the report for Phone A.', 'Scanning the same code twice never creates a second incident.', 4800);

  // ---------- 3. second witness, then signal ----------
  await stage('step', '3 · A second witness, then signal');
  await A.locator('.handoff').getByRole('button', { name: 'Close' }).click();
  await tap(B, 'Map', 1200);
  await tap(B, 'Add an observation here', 900);
  await tap(B, /Water over road/, 600);
  await B.getByPlaceholder('What did you see?').pressSequentially('Confirmed, could not cross', { delay: 45 });
  await tap(B, 'Save observation', 900);
  await say('The volunteer saw it too, and adds a second, independent observation.', '', 3800);
  await tap(B, 'Done', 500);
  await tap(B, 'Relay', 900);
  await say('The volunteer walks until the phone finds signal.', '', 2600);
  await stage('label', 'B', 'Phone B · volunteer · connected');
  await B.getByRole('checkbox').first().click();
  await sleep(LIVE ? 6000 : 3500);
  await say('Both reports are delivered to the response centre on AWS.', 'Each keeps its original time and its journey: who saw it, who carried it.', 5200);

  await tap(B, 'Map', 600);
  await sleep(1200);
  await say('Two independent phones agree: the road is now “corroborated”.', 'Not “closed”. Only an authorised responder can verify a closure.', 5200);
  await frameOf(slots.B).evaluate(() => document.querySelector('.obs-alert')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await say('That moment triggers the alert network.', 'Members who live within 3 km get an automated voice call through CALL-E. This recording has no phone line attached, so it shows who would be called.', 7000);

  // ---------- 4. the response desk ----------
  await stage('step', '4 · The response desk');
  await stage('load', 'D', slots.D);
  await stage('show', 'desk');
  await sleep(2500);
  await tap(D, 'Relay', 800);
  await tap(D, 'Load a simulated drill', LIVE ? 6000 : 3500);
  await say('The response desk sees every road with evidence, most urgent first.', 'Extra rows come from a simulated drill: invented observations on real roads, labelled as simulated.', 6000);
  await D.locator('.queue').first().click();
  await sleep(1500);
  await say('One person says “knee deep”. Another says “drove through”.', 'FloodLens does not average them. It keeps both and flags the road for a fresh check.', 6500);
  await D.locator('.sheet-close').click();
  // Back out to the whole valley so the roads going stale are visible.
  await page.mouse.move(1150, 480);
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 240); await sleep(450); }
  await stage('caption', 'Evidence expires. Drag the time lens forward…', '');
  for (let h = 0.5; h <= 4; h += 0.5) {
    await D.getByLabel('Time lens').evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(h));
    await sleep(550);
  }
  await say('…and roads nobody has re-checked turn stale.', 'Stale means unknown again. Unknown is never shown as safe.', 6500);

  // ---------- 5. how it is built ----------
  await stage('step', '');
  await stage('card', `<h2>Built on AWS</h2>
    <div class="grid">
      <div><b>CloudFront + S3</b>serve the offline-first app and photo evidence</div>
      <div><b>API Gateway + Lambda</b>ingest report batches from any carrier</div>
      <div><b>DynamoDB</b>conditional writes: two routes, one record</div>
      <div><b>Bedrock</b>describes a photo for the reviewer, decides nothing</div>
    </div>
    ${LIVE ? `<p>Everything in this video ran on the live deployment: <em>${LIVE.replace('https://', '')}</em></p>` : ''}
    <p>Not built yet: Wi-Fi Direct and LoRa radio handoff, responder accounts.</p>
    <p>FloodLens does not predict safe roads. It shortens the time between <em>someone seeing a broken road</em> and <em>a responder knowing about it</em>.</p>`);
  await stage('caption', '', '');
  await sleep(9000);

  const deviceIds = [];
  for (const slot of Object.values(slots)) deviceIds.push(await frameOf(slot).evaluate((k) => JSON.parse(localStorage.getItem(`floodlens:${k}:device`)).id, slot));
  await cdp.send('Page.stopScreencast');
  await context.close();
  await browser.close();
  const lines = frames.flatMap((f, k) => [`file '${f.name}'`, `duration ${(k + 1 < frames.length ? frames[k + 1].t - f.t : 1).toFixed(3)}`]);
  lines.push(`file '${frames.at(-1).name}'`, '');
  writeFileSync(ROOT + 'docs/_video/list.txt', lines.join(String.fromCharCode(10)));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', 'fps=30,scale=1920:1080', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', '../floodlens-demo.mp4'], { cwd: ROOT + 'docs/_video' });
  rmSync(ROOT + 'docs/_video', { recursive: true, force: true });
  console.log('saved docs/floodlens-demo.mp4');
  console.log('devices used:', JSON.stringify(deviceIds));
} finally {
  stop();
}
