// Turns the raw Overpass download into the compact offline community pack bundled with the app.
import { readFileSync, writeFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync(new URL('./osm_raw.json', import.meta.url), 'utf8'));
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const roads = [], water = [], places = [];
for (const e of raw.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && t.highway) {
    roads.push({ id: 'W' + e.id, n: t.name || t.ref || '', c: t.highway, b: t.bridge && t.bridge !== 'no' ? 1 : 0, p: e.geometry.map((g) => [r5(g.lat), r5(g.lon)]) });
  } else if (e.type === 'way' && t.waterway) {
    water.push({ c: t.waterway, n: t.name || '', p: e.geometry.map((g) => [r5(g.lat), r5(g.lon)]) });
  } else if (e.type === 'node' && (t.place || t.amenity) && (t.name || t['name:en'])) {
    places.push({ n: t['name:en'] || t.name, k: t.place || t.amenity, p: [r5(e.lat), r5(e.lon)] });
  }
}
const pack = {
  id: 'wayanad-meppadi', title: 'Meppadi – Chooralmala, Wayanad', bbox: [11.47, 76.09, 11.58, 76.2],
  built_at: new Date().toISOString(), source: '© OpenStreetMap contributors (ODbL)', roads, water, places,
};
const out = new URL('../web/src/data/pack.json', import.meta.url);
writeFileSync(out, JSON.stringify(pack));
console.log({ roads: roads.length, bridges: roads.filter((r) => r.b).length, water: water.length, places: places.length, kb: Math.round(JSON.stringify(pack).length / 1024) });
console.log(places.map((p) => p.n + ':' + p.k).join(', '));
