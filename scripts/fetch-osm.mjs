// Downloads the offline community pack source data from OpenStreetMap (Overpass API).
import { writeFileSync } from 'node:fs';
const bbox = '11.47,76.09,11.58,76.20';
const q = `[out:json][timeout:60];(way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"](${bbox});way["waterway"~"^(river|stream)$"](${bbox});node["place"](${bbox});node["amenity"~"hospital|clinic|school|shelter|community_centre"](${bbox}););out geom;`;
const mirrors = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
for (const url of mirrors) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FloodLens-hackathon/0.1', Accept: '*/*' },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.timeout(90000),
    });
    const text = await res.text();
    if (!text.startsWith('{')) { console.log('fail', url, res.status); continue; }
    writeFileSync(new URL('./osm_raw.json', import.meta.url), text);
    const c = {};
    for (const e of JSON.parse(text).elements) {
      const k = e.tags.highway ? 'hw-' + e.tags.highway : e.tags.waterway ? 'ww-' + e.tags.waterway : e.tags.place ? 'place' : 'amenity';
      c[k] = (c[k] || 0) + 1;
    }
    console.log('OK', url, text.length, c);
    process.exit(0);
  } catch (e) { console.log('err', url, e.message); }
}
process.exit(1);
