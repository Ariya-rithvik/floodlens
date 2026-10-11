import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { pack, roadById } from '../lib/pack.js';
import { KINDS, STATUS } from '../lib/status.js';

const ROAD_STYLE = {
  primary: { weight: 3.4, color: '#5b6b78' },
  secondary: { weight: 2.8, color: '#51606c' },
  tertiary: { weight: 2.3, color: '#48565f' },
  unclassified: { weight: 1.7, color: '#3c4850' },
  residential: { weight: 1.2, color: '#323d44' },
  service: { weight: 0.9, color: '#2b353b' },
  track: { weight: 0.9, color: '#2b353b', dashArray: '3 5' },
};
const DASH = { stale: '2 9', conflict: '12 8', unknown: null };

/** The map is drawn entirely from the bundled pack: no tiles, so nothing to fetch when the network is gone. */
export default function MapView({ statuses, selected, focus, picking, guide, onTap }) {
  const el = useRef(null);
  const ref = useRef({});
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  useEffect(() => {
    const [s, w, n, e] = pack.bbox;
    const map = L.map(el.current, {
      preferCanvas: true, zoomControl: false, attributionControl: false, zoomSnap: 0.25,
      minZoom: 12, maxZoom: 18, maxBounds: [[s - 0.03, w - 0.04], [n + 0.03, e + 0.04]],
    }).setView([11.515, 76.15], 13.25);
    const base = L.canvas({ padding: 0.3 });

    for (const wtr of pack.water) {
      const river = wtr.c === 'river';
      L.polyline(wtr.p, { renderer: base, interactive: false, color: river ? '#1f6f93' : '#163d50', weight: river ? 4 : 1.1, opacity: river ? 0.9 : 0.8 }).addTo(map);
    }
    for (const r of pack.roads) {
      L.polyline(r.p, { renderer: base, interactive: false, opacity: 1, ...(ROAD_STYLE[r.c] || ROAD_STYLE.service) }).addTo(map);
      if (r.b) L.polyline(r.p, { renderer: base, interactive: false, color: '#9fb1bd', weight: 5, opacity: 0.55, lineCap: 'butt' }).addTo(map);
    }
    for (const p of pack.places) {
      const care = ['hospital', 'clinic'].includes(p.k);
      const hall = p.k === 'community_centre';
      if (!care && !hall && !['village', 'hamlet'].includes(p.k)) continue;
      L.marker(p.p, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: `place place-${care ? 'care' : hall ? 'hall' : p.k}`, html: `<span>${care ? '✚ ' : hall ? '⌂ ' : ''}${p.n}</span>`, iconSize: [0, 0] }),
      }).addTo(map);
    }
    const sync = () => el.current?.setAttribute('data-zoom', map.getZoom() >= 14.5 ? 'near' : 'far');
    map.on('zoomend', sync);
    sync();
    map.on('click', (ev) => tapRef.current?.(ev.latlng.lat, ev.latlng.lng));

    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el.current);
    ref.current = { map, overlay: L.layerGroup().addTo(map), pick: L.layerGroup().addTo(map), guide: L.layerGroup().addTo(map) };
    return () => (resize.disconnect(), map.remove());
  }, []);

  // Status layer: colour says what is known, opacity says how fresh that knowledge is.
  useEffect(() => {
    const { overlay } = ref.current;
    if (!overlay) return;
    overlay.clearLayers();
    for (const [segId, s] of statuses) {
      const road = roadById.get(segId);
      if (!road) continue;
      const color = STATUS[s.status].color;
      const strength = s.status === 'stale' ? 0.55 : 0.4 + 0.6 * s.freshness;
      if (s.status !== 'stale') L.polyline(road.p, { interactive: false, color, weight: 16, opacity: 0.16 * strength }).addTo(overlay);
      L.polyline(road.p, { interactive: false, color, weight: 5.5, opacity: strength, dashArray: DASH[s.status], lineCap: 'round' }).addTo(overlay);
      const o = s.latest;
      L.marker([o.lat, o.lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({
          className: `pin pin-${s.status}`,
          html: `<i style="--c:${color}"></i><b style="--c:${color}">${s.status === 'stale' ? '?' : KINDS[o.kind].icon}</b>`,
          iconSize: [30, 30], iconAnchor: [15, 15],
        }),
      }).addTo(overlay);
    }
  }, [statuses]);

  useEffect(() => {
    const { pick, map } = ref.current;
    if (!pick) return;
    pick.clearLayers();
    const road = selected && roadById.get(selected);
    if (!road) return;
    L.polyline(road.p, { interactive: false, color: '#ffffff', weight: 11, opacity: 0.22 }).addTo(pick);
    L.polyline(road.p, { interactive: false, color: '#ffffff', weight: 1.5, opacity: 0.95, dashArray: '1 6' }).addTo(pick);
    if (map.getSize().x) map.panInside(road.p[Math.floor(road.p.length / 2)], { paddingTopLeft: [40, 90], paddingBottomRight: [40, 320] });
  }, [selected]);

  useEffect(() => {
    const { map } = ref.current;
    if (!focus || !map) return;
    const zoom = Math.max(map.getZoom(), 15.5);
    // A map with no size yet (hidden tab, first paint) cannot animate.
    if (map.getSize().x) map.flyTo([focus.lat, focus.lon], zoom, { duration: 0.7 });
    else map.setView([focus.lat, focus.lon], zoom, { animate: false });
  }, [focus]);

  // Straight line from the person to the chosen higher place: a bearing, deliberately not drawn along roads.
  const guideKey = guide ? JSON.stringify(guide) : '';
  useEffect(() => {
    const { guide: layer, map } = ref.current;
    if (!layer) return;
    layer.clearLayers();
    if (!guide) return;
    const dot = (cls) => L.divIcon({ className: `guide-dot ${cls}`, iconSize: [18, 18], iconAnchor: [9, 9] });
    L.marker(guide.from, { interactive: false, icon: dot('guide-here') }).addTo(layer);
    if (!guide.to) return;
    L.polyline([guide.from, guide.to], { interactive: false, color: '#3ee0c5', weight: 3, dashArray: '2 9', lineCap: 'round' }).addTo(layer);
    L.marker(guide.to, { interactive: false, icon: dot('guide-there') }).addTo(layer);
    if (map.getSize().x) map.fitBounds([guide.from, guide.to], { paddingTopLeft: [50, 110], paddingBottomRight: [50, 380], maxZoom: 15.5 });
  }, [guideKey]);

  return (
    <div className={`map ${picking ? 'map-picking' : ''}`}>
      <div ref={el} className="map-canvas" />
      <div className="map-credit">Offline pack · {pack.title} · {pack.source}</div>
    </div>
  );
}
