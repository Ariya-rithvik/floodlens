import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import { DeskPanel, RelayPanel } from './components/panels.jsx';
import { QrModal, ReportSheet, Scanner, SegmentSheet, Ticket } from './components/sheets.jsx';
import { allReports, clearReports, getDevice, importReport, newReportId, prefs, putReport } from './lib/db.js';
import { decodeReport } from './lib/codec.js';
import { buildDrill } from './lib/drill.js';
import { inPack, nearestRoad, roadMid } from './lib/pack.js';
import { statusBySegment } from './lib/status.js';
import { checkResponderKey, syncNow } from './lib/sync.js';

const device = getDevice();

function useNet() {
  const [browser, setBrowser] = useState(navigator.onLine);
  const [airplane, setAirplaneState] = useState(new URLSearchParams(location.search).has('demo') && prefs.get('airplane', false));
  useEffect(() => {
    const on = () => setBrowser(true), off = () => setBrowser(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => (removeEventListener('online', on), removeEventListener('offline', off));
  }, []);
  const setAirplane = (v) => (prefs.set('airplane', v), setAirplaneState(v));
  return { online: browser && !airplane, airplane, setAirplane };
}

export default function App() {
  const [reports, setReports] = useState([]);
  const [tab, setTab] = useState('map');
  const [realNow, setRealNow] = useState(Date.now());
  const [lensH, setLensH] = useState(0);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(null);
  const [ticketId, setTicketId] = useState(null);
  const [qr, setQr] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState('');
  const [responder, setResponder] = useState(!!prefs.get('responderKey'));
  const [sync, setSync] = useState({ state: 'idle', last: prefs.get('lastSync'), note: '' });
  const net = useNet();
  const busy = useRef(false);

  const refresh = useCallback(async () => setReports(await allReports()), []);
  const say = (msg) => (setToast(msg), setTimeout(() => setToast((t) => (t === msg ? '' : t)), 4200));

  useEffect(() => {
    refresh();
    const t = setInterval(() => setRealNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const deliver = useCallback(async (manual) => {
    if (busy.current) return;
    busy.current = true;
    setSync((s) => ({ ...s, state: 'running' }));
    try {
      const r = await syncNow(device);
      const parts = [r.accepted && `${r.accepted} delivered`, r.duplicates && `${r.duplicates} already there`, r.rejected && `${r.rejected} refused`, r.pulled && `${r.pulled} new from the centre`].filter(Boolean);
      setSync({ state: 'idle', last: prefs.get('lastSync'), note: parts.join(', ') });
      if (parts.length || manual) say(parts.length ? `Response centre: ${parts.join(', ')}` : 'Up to date with the response centre');
    } catch {
      setSync((s) => ({ ...s, state: 'failed', note: '' }));
      if (manual) say('Could not reach the response centre. Reports stay on this device.');
    }
    busy.current = false;
    refresh();
  }, [refresh]);

  // Whenever a route to the response centre exists, use it. Otherwise hold everything and say so.
  useEffect(() => {
    if (!net.online) return;
    deliver(false);
    const t = setInterval(() => deliver(false), 45000);
    return () => clearInterval(t);
  }, [net.online, deliver]);

  const now = realNow + lensH * 3600e3;
  const statuses = useMemo(() => statusBySegment(reports, now), [reports, now]);
  const waiting = reports.filter((r) => r.delivery === 'saved' || r.delivery === 'carrying').length;

  const startDraft = (lat, lon, gps, onSegment) => {
    // Adding to a road that is already open must stay on that road, even where it touches another one.
    const hit = onSegment ? { id: onSegment, metres: 0 } : nearestRoad(lat, lon);
    // A point far from any mapped road is more likely a mis-tap than a road we do not know about.
    if (hit.metres > (gps ? 300 : 150)) return say(`No mapped road within ${gps ? 300 : 150} m of that point. Zoom in and tap on the road itself.`);
    setPicking(false);
    setSelected(hit.id);
    setDraft({ lat, lon, seg: hit.id, metres: hit.metres, viaGps: !!gps, accuracy: gps ? Math.round(gps) : 0 });
  };

  const onMapTap = (lat, lon) => {
    if (picking) return startDraft(lat, lon);
    if (draft) return;
    const hit = nearestRoad(lat, lon);
    setSelected(hit.metres < 120 ? hit.id : null);
    if (tab !== 'desk') setTab('map');
  };

  const useGps = () => {
    if (!navigator.geolocation) return say('This device has no location service. Tap the road on the map.');
    navigator.geolocation.getCurrentPosition(
      (p) => (inPack(p.coords.latitude, p.coords.longitude) ? startDraft(p.coords.latitude, p.coords.longitude, p.coords.accuracy) : say('You are outside the downloaded area. Tap the road on the map instead.')),
      () => say('Could not get a GPS fix. Tap the road on the map.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const save = async (fields, at, source = 'community') => {
    const r = {
      report_id: newReportId(), segment_id: at.seg, lat: at.lat, lon: at.lon, accuracy_m: at.accuracy || 0,
      observed_at: new Date().toISOString(), kind: fields.kind, note: fields.note || '',
      photo: fields.photo || null, photo_state: fields.photo ? 'local' : 'none',
      source, origin_device: device.id, origin_name: device.name, hops: [], delivery: 'saved',
    };
    await putReport(r);
    setDraft(null);
    await refresh();
    setTicketId(r.report_id);
    if (net.online) deliver(false);
  };

  const verify = (kind) => {
    const [lat, lon] = roadMid(selected);
    save({ kind }, { seg: selected, lat, lon }, 'authority');
  };

  const receive = async (text) => {
    try {
      const r = decodeReport(text, device);
      const outcome = await importReport(r);
      setScanning(false);
      await refresh();
      say(outcome === 'new' ? `Now carrying ${r.report_id} for ${r.origin_name}` : `${r.report_id} is already on this device. Not duplicated.`);
      setSelected(r.segment_id);
      setFocus({ lat: r.lat, lon: r.lon });
      if (net.online) deliver(false);
    } catch (e) {
      say(e.message);
    }
  };

  const actions = {
    say,
    scan: () => setScanning(true),
    sync: () => deliver(true),
    qr: setQr,
    open: (r) => (setSelected(r.segment_id), setFocus({ lat: r.lat, lon: r.lon }), setTab('map')),
    drill: async () => {
      for (const r of buildDrill(device)) await putReport(r);
      await refresh();
      say('Simulated drill loaded: 8 invented observations on real roads');
      setTab('desk');
      if (net.online) deliver(false);
    },
    wipe: async () => {
      if (!confirm('Erase every report stored on this device? Undelivered reports will be lost.')) return;
      await clearReports();
      prefs.set('lastSync', null);
      setSync({ state: 'idle', last: null, note: '' });
      setSelected(null);
      refresh();
    },
    responder: async (key) => {
      if (!key) return prefs.set('responderKey', ''), setResponder(false);
      const ok = await checkResponderKey(key).catch(() => false);
      if (!ok) return say('That responder key was not accepted.');
      prefs.set('responderKey', key);
      setResponder(true);
      say('Responder mode on: you can verify closures and reopenings.');
    },
  };

  const ticket = ticketId && reports.find((r) => r.report_id === ticketId);
  const sheetOpen = tab !== 'relay' && (draft || selected);

  return (
    <div className={`app tab-${tab} ${sheetOpen ? 'has-sheet' : ''}`}>
      <header className="bar">
        <div className="brand"><i />FloodLens</div>
        <button className={`net ${net.online ? (sync.state === 'failed' ? 'warn' : 'up') : 'down'}`} onClick={() => setTab('relay')}>
          <i />
          {net.online ? (sync.state === 'failed' ? 'Centre unreachable' : 'Connected') : 'No network'}
          {waiting > 0 && <b>{waiting} held</b>}
        </button>
      </header>

      <MapView statuses={statuses} selected={selected} focus={focus} picking={picking} onTap={onMapTap} />

      {tab !== 'relay' && !picking && (
        <div className={`lens ${lensH ? 'lens-on' : ''}`}>
          <div className="lens-label">
            <b>{lensH ? `+${lensH} h from now` : 'Now'}</b>
            <span>{lensH ? 'What will still be known if nobody checks again' : 'Drag to watch evidence expire'}</span>
          </div>
          <input type="range" min="0" max="12" step="0.5" value={lensH} onChange={(e) => setLensH(Number(e.target.value))} aria-label="Time lens" />
        </div>
      )}

      {picking && (
        <div className="pickbar">
          <b>Tap the road where you saw it</b>
          <div className="row">
            <button className="btn btn-primary" onClick={useGps}>Use my GPS position</button>
            <button className="btn btn-ghost" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}

      {tab === 'map' && !sheetOpen && !picking && <button className="fab" onClick={() => setPicking(true)}>Report what you see</button>}

      {tab === 'relay' && <RelayPanel reports={reports} now={realNow} net={net} sync={sync} device={device} responder={responder} actions={actions} />}
      {tab === 'desk' && <DeskPanel statuses={statuses} reports={reports} now={realNow} lensH={lensH} onOpen={(seg) => (setSelected(seg), setFocus({ lat: roadMid(seg)[0], lon: roadMid(seg)[1] }))} />}

      {tab !== 'relay' && draft && <ReportSheet pick={draft} onCancel={() => setDraft(null)} onSave={(f) => save(f, draft)} />}
      {tab !== 'relay' && !draft && selected && (
        <SegmentSheet
          segId={selected} info={statuses.get(selected)} now={now} realNow={realNow} responder={responder}
          onClose={() => setSelected(null)} onVerify={verify}
          onReport={() => { const [lat, lon] = roadMid(selected); startDraft(lat, lon, null, selected); }}
        />
      )}

      <nav className="tabs">
        {[['map', 'Map'], ['relay', 'Relay'], ['desk', 'Desk']].map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'relay' && waiting > 0 && <b>{waiting}</b>}
          </button>
        ))}
      </nav>

      {ticket && <Ticket r={ticket} onClose={() => setTicketId(null)} onQr={() => (setQr(ticket), setTicketId(null))} />}
      {qr && <QrModal r={qr} onClose={() => setQr(null)} />}
      {scanning && <Scanner onCode={receive} onClose={() => setScanning(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
