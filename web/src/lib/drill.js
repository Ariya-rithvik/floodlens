// A simulated drill: invented observations on real roads, so the evidence rules can be shown without a real flood.
// Every drill report is flagged and labelled as simulated wherever it appears.
import { pack, nearestRoad, roadById } from './pack.js';
import { newReportId } from './db.js';

const place = (name) => pack.places.find((p) => p.n === name)?.p;

function bridgeNear(pt) {
  let best = null;
  for (const r of pack.roads.filter((x) => x.b)) {
    const m = r.p[0];
    const d = Math.hypot(m[0] - pt[0], m[1] - pt[1]);
    if (!best || d < best.d) best = { d, id: r.id };
  }
  return best.id;
}

export function buildDrill(device, now = Date.now()) {
  const used = new Set();
  const seg = (name, wantBridge) => {
    const pt = place(name);
    let id = wantBridge ? bridgeNear(pt) : nearestRoad(pt[0], pt[1]).id;
    if (used.has(id)) id = nearestRoad(pt[0] + 0.004, pt[1] + 0.004).id;
    used.add(id);
    return id;
  };
  const plan = [
    [seg('Chooralmala', true), 'water_over_road', 26, 'Egret 12', 'Water across the bridge approach'],
    [null, 'water_over_road', 11, 'Koel 31', 'Still under water, rising'],
    [seg('Mundakai'), 'landslide', 41, 'Drongo 55', 'Mud and rocks across the lane'],
    [seg('Meppadi'), 'passable', 33, 'Myna 20', 'Drove through slowly'],
    [null, 'water_over_road', 9, 'Barbet 77', 'Knee deep near the junction'],
    [seg('Puthumala'), 'water_over_road', 168, 'Lapwing 08', 'Stream overflowing onto road'],
    [seg('Attamala'), 'tree_down', 430, 'Hornbill 63', 'Large tree blocking both lanes'],
    [seg('Kalladi'), 'passable', 19, 'Bulbul 46', 'Clear, jeep got through'],
  ];
  let segment;
  return plan.map(([s, kind, minAgo, who, note]) => {
    segment = s || segment;
    const road = roadById.get(segment);
    const [lat, lon] = road.p[Math.floor(road.p.length / 2)];
    return {
      report_id: newReportId(), segment_id: segment, kind, note, lat, lon, accuracy_m: 15,
      observed_at: new Date(now - minAgo * 60000).toISOString(),
      source: 'community', origin_device: who.toLowerCase().replace(' ', '-'), origin_name: who,
      hops: [{ device: device.id, name: device.name, via: 'drill', at: new Date(now).toISOString() }],
      photo_state: 'none', delivery: 'carrying', drill: true,
    };
  });
}
