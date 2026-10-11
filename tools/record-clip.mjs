// Records the "higher ground" clip against the deployed app and splices it into docs/floodlens-demo.mp4
// just before the closing card, keeping the rest of the existing video as it is.
// Run from the repo root: FLOODLENS_URL=https://... node tools/record-clip.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LIVE = (process.env.FLOODLENS_URL || '').replace(/\/$/, '');
if (!LIVE) throw new Error('set FLOODLENS_URL to the deployed app');
const CLOSING_CARD_SECONDS = 2.0; // how long the closing card runs at the end of the existing video
const HOLD_CARD_SECONDS = 8; // extra time to hold it, so it can be read
const WEB = 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slot = `g${Date.now().toString(36)}`;
const TMP = ROOT + 'docs/_video/';

const web = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: ROOT + 'web', stdio: 'ignore', shell: true });
const stop = () => (process.platform === 'win32' ? spawn('taskkill', ['/pid', String(web.pid), '/T', '/F']) : web.kill());

try {
  for (let i = 0; i < 60 && !(await fetch(WEB + '/stage.html').then((r) => r.ok, () => false)); i++) await sleep(500);
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(() => {
    addEventListener('pointerdown', (e) => {
      const dot = document.createElement('div');
      dot.style.cssText = `position:fixed;z-index:99999;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:#ffffff55;border:2px solid #fff;pointer-events:none;transition:transform .5s,opacity .5s`;
      document.documentElement.appendChild(dot);
      requestAnimationFrame(() => ((dot.style.transform = 'scale(1.8)'), (dot.style.opacity = '0')));
      setTimeout(() => dot.remove(), 600);
    }, true);
  });
  const page = await context.newPage();
  await page.goto(WEB + '/stage.html');
  await page.evaluate((base) => {
    window.stage.base = base;
    document.querySelector('#B').closest('.device').hidden = true;
  }, LIVE);
  const stage = (fn, ...args) => page.evaluate(([f, a]) => window.stage[f](...a), [fn, args]);
  const A = page.frameLocator('#A');
  const tap = async (name, wait = 900) => { await A.getByRole('button', { name }).first().click(); await sleep(wait); };

  // Set the scene off camera: a connected phone that already holds the drill's reports.
  await stage('load', 'A', slot);
  await stage('show', 'phones');
  await stage('label', 'A', 'Phone · resident · connected');
  await stage('step', '5 · With a connection: where is higher ground?');
  await sleep(3000);
  await tap('Relay', 700);
  await tap('Load a simulated drill', 6000);
  await tap('Map', 1500);
  await stage('caption', 'When there is a connection, for example a satellite link, FloodLens can also advise.', 'The road reports on this phone come from the simulated drill.');

  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (frame) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(TMP + name, Buffer.from(frame.data, 'base64'));
    frames.push({ name, t: frame.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080 });
  await sleep(4500);

  await tap('Find higher ground', 900);
  await stage('caption', 'Someone in Chooralmala cannot leave by road. They tap where they are.', '');
  await sleep(2600);
  // Chooralmala sits here in the 400 x 760 frame when the map is at its opening view (11.515, 76.15, zoom 13.25).
  const scale = (256 * 2 ** 13.25) / 360;
  const merc = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
  await page.locator('#A').click({ position: { x: 200 + (76.1598 - 76.15) * scale, y: 380 - (merc(11.5005) - merc(11.515)) * scale } });
  await sleep(3500);
  await stage('caption', 'It lists higher ground within 3 km: how far, how much higher, and what has been reported on the way.', 'Ground heights are stored in the offline map. Online, the person’s own height is measured for the exact point.');
  await sleep(7500);
  await A.locator('.guide-main', { hasText: 'landslide' }).first().click();
  await sleep(1200);
  await stage('caption', 'This option is higher, but a landslide is reported on the way. FloodLens shows that, it does not hide it.', 'It is advice to weigh, not a route. A way with no reports is unknown, never “clear”.');
  await sleep(7500);
  await stage('caption', '“Street view” opens street-level imagery of the place, so they can see where they are heading.', 'It needs a connection, and coverage on hill roads is patchy.');
  await sleep(5500);

  await cdp.send('Page.stopScreencast');
  const deviceId = await page.frames().find((fr) => fr.url().includes(slot)).evaluate((k) => JSON.parse(localStorage.getItem(`floodlens:${k}:device`)).id, slot);
  await context.close();
  await browser.close();

  const lines = frames.flatMap((f, k) => [`file '${f.name}'`, `duration ${(k + 1 < frames.length ? frames[k + 1].t - f.t : 1).toFixed(3)}`]);
  lines.push(`file '${frames.at(-1).name}'`, '');
  writeFileSync(TMP + 'list.txt', lines.join(String.fromCharCode(10)));
  const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { cwd: TMP });
  const enc = ['-vf', 'fps=30,scale=1920:1080', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-an'];
  ff('-f', 'concat', '-safe', '0', '-i', 'list.txt', ...enc, 'clip.mp4');

  const total = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', '../floodlens-demo.mp4'], { cwd: TMP, encoding: 'utf8' }));
  const cut = (total - CLOSING_CARD_SECONDS).toFixed(2);
  ff('-i', '../floodlens-demo.mp4', '-t', cut, ...enc, 'head.mp4');
  ff('-ss', cut, '-i', '../floodlens-demo.mp4', ...enc.with(1, `fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration=${HOLD_CARD_SECONDS}`), 'tail.mp4');
  writeFileSync(TMP + 'join.txt', ['head.mp4', 'clip.mp4', 'tail.mp4'].map((n) => `file '${n}'`).join(String.fromCharCode(10)));
  ff('-f', 'concat', '-safe', '0', '-i', 'join.txt', '-c', 'copy', '-movflags', '+faststart', 'joined.mp4');
  renameSync(ROOT + 'docs/floodlens-demo.mp4', ROOT + 'docs/floodlens-demo-before-clip.mp4');
  renameSync(TMP + 'joined.mp4', ROOT + 'docs/floodlens-demo.mp4');
  rmSync(TMP, { recursive: true, force: true });
  console.log('spliced the clip in at', cut, 's. device used:', deviceId);
} finally {
  stop();
}
