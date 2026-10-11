import { useState } from 'react';
import { KINDS, STATUS, ago, urgency } from '../lib/status.js';
import { pack, roadName } from '../lib/pack.js';
import { prefs } from '../lib/db.js';
import { joinNetwork } from '../lib/sync.js';
import { Chip, Journey, deliveryLine } from './sheets.jsx';

// Rehearsal aids (fake network cut, invented drill data) exist only when the address carries ?demo. Real use never shows them.
const DEMO = new URLSearchParams(location.search).has('demo');

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function ReportCard({ r, now, onQr, onOpen }) {
  const held = r.delivery !== 'delivered';
  return (
    <li className={`card ${held ? 'card-held' : ''}`}>
      <button className="card-main" onClick={() => onOpen(r)}>
        <div className="card-top">
          <b>{KINDS[r.kind].icon} {KINDS[r.kind].label}</b>
          <code>{r.report_id}</code>
        </div>
        <div className="card-road">{roadName(r.segment_id)} · seen {ago(r.observed_at, now)}</div>
        <Journey r={r} />
        <div className="card-delivery">{deliveryLine(r)}{r.photo_state === 'pending' ? ' · photo not received' : ''}</div>
      </button>
      {held && r.delivery !== 'rejected' && <button className="btn btn-small" onClick={() => onQr(r)}>Hand off</button>}
    </li>
  );
}

const HOMES = pack.places.filter((p) => ['village', 'hamlet'].includes(p.k)).sort((a, b) => a.n.localeCompare(b.n));

/** Opt-in list of people to phone when a hazard near their home is confirmed by two independent reports. */
function AlertNetwork({ online, responder, say }) {
  const [joined, setJoined] = useState(prefs.get('network'));
  const [form, setForm] = useState({ name: '', phone: '', place: '', consent: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async () => {
    const home = HOMES.find((p) => p.n === form.place);
    setBusy(true);
    try {
      const out = await joinNetwork({ name: form.name.trim(), phone: form.phone.trim(), place: home.n, lat: home.p[0], lon: home.p[1], consent: true, role: responder ? 'responder' : 'resident' });
      const saved = { name: form.name.trim(), place: home.n, size: out.network_size };
      prefs.set('network', saved);
      setJoined(saved);
      say('You are on the alert network.');
    } catch (e) {
      say(e.message);
    }
    setBusy(false);
  };
  if (joined) {
    return (
      <div className="network">
        <b>{joined.name}, you are on the alert network for {joined.place}.</b>
        <p className="muted">You will get a voice call when two independent reports confirm a hazard within 3 km of {joined.place}. Network size when you joined: {joined.size}.</p>
      </div>
    );
  }
  const ready = form.name.trim() && /^[+]?[0-9 -]{10,15}$/.test(form.phone.trim()) && form.place && form.consent;
  return (
    <div className="network">
      <b>Get a call when a road near you is hit</b>
      <p className="muted">When two independent reports confirm a hazard within 3 km of your home place, FloodLens phones you. {responder ? 'As a responder you are called for every confirmed hazard.' : ''}</p>
      <input className="input" placeholder="Your name" maxLength={40} value={form.name} onChange={set('name')} />
      <input className="input" type="tel" placeholder="Phone number" value={form.phone} onChange={set('phone')} />
      <select className="input" value={form.place} onChange={set('place')}>
        <option value="">Home place</option>
        {HOMES.map((p) => <option key={p.n}>{p.n}</option>)}
      </select>
      <label className="toggle">
        <input type="checkbox" checked={form.consent} onChange={set('consent')} />
        <span>I agree to receive automated calls from FloodLens. My number is stored at the response centre and is not shown to other users.</span>
      </label>
      <button className="btn btn-primary" disabled={!ready || !online || busy} onClick={submit}>{online ? 'Join the alert network' : 'Needs a connection to join'}</button>
    </div>
  );
}

/** Relay: what this phone is holding, and every way it can pass it on. */
export function RelayPanel({ reports, now, net, sync, device, responder, actions }) {
  const [key, setKey] = useState('');
  const held = reports.filter((r) => r.delivery !== 'delivered').sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const delivered = reports.filter((r) => r.delivery === 'delivered').sort((a, b) => Date.parse(b.delivered_at) - Date.parse(a.delivered_at));
  const waiting = held.filter((r) => r.delivery !== 'rejected').length;
  const headline = !net.online
    ? waiting ? `Holding ${waiting} report${waiting > 1 ? 's' : ''}. No route out.` : 'No connection. Nothing waiting.'
    : sync.state === 'failed' ? 'Network is up, but the response centre is unreachable.'
    : waiting ? `Connected. ${waiting} still to deliver.` : 'Connected. Everything delivered.';
  return (
    <div className="panel">
      <div className={`netcard ${net.online ? (sync.state === 'failed' ? 'warn' : 'up') : 'down'}`}>
        <div className="sheet-eyebrow">{device.name} · this device</div>
        <h2>{headline}</h2>
        <p className="muted">
          {sync.state === 'running' ? 'Delivering…' : sync.last ? `Last exchange with the response centre: ${clock(sync.last)}.` : 'This device has never reached the response centre.'}
          {sync.note ? ` ${sync.note}` : ''}
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={actions.scan}>Receive a report</button>
          <button className="btn" disabled={!net.online || sync.state === 'running'} onClick={actions.sync}>Deliver now</button>
        </div>
        {DEMO && (
          <label className="toggle">
            <input type="checkbox" checked={net.airplane} onChange={(e) => net.setAirplane(e.target.checked)} />
            <span>Cut this device off from the network (demo switch)</span>
          </label>
        )}
      </div>

      <h3 className="section">On this device, not delivered · {held.length}</h3>
      {held.length === 0 && <p className="empty">Nothing is waiting. Reports you save or receive without a connection are kept here until they can move.</p>}
      <ul className="cards">{held.map((r) => <ReportCard key={r.report_id} r={r} now={now} onQr={actions.qr} onOpen={actions.open} />)}</ul>

      <h3 className="section">Reached the response centre · {delivered.length}</h3>
      <ul className="cards">{delivered.slice(0, 12).map((r) => <ReportCard key={r.report_id} r={r} now={now} onQr={actions.qr} onOpen={actions.open} />)}</ul>

      <h3 className="section">Alert network</h3>
      <AlertNetwork online={net.online} responder={responder} say={actions.say} />

      <h3 className="section">Setup</h3>
      <div className="setup">
        {DEMO && <button className="btn btn-ghost" onClick={actions.drill}>Load a simulated drill</button>}
        <button className="btn btn-ghost" onClick={actions.wipe}>Erase this device</button>
        {responder ? (
          <p className="muted">Responder mode is on for this device. <button className="link" onClick={() => actions.responder('')}>Turn off</button></p>
        ) : (
          <div className="row">
            <input className="input" type="password" placeholder="Responder key" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn" disabled={!key || !net.online} onClick={() => actions.responder(key)}>Unlock</button>
          </div>
        )}
      </div>
    </div>
  );
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Response desk: one row per road with evidence, most urgent first. */
export function DeskPanel({ statuses, reports, now, lensH, onOpen }) {
  const rows = [...statuses.entries()].map(([seg, s]) => ({ seg, ...s })).sort((a, b) => urgency(a.status) - urgency(b.status) || b.freshness - a.freshness);
  const count = (...names) => rows.filter((r) => names.includes(r.status)).length;
  const hazards = count('reported', 'corroborated', 'verified_closed');
  const backed = count('corroborated', 'verified_closed');
  const lag = median(reports.filter((r) => r.delivered_at).map((r) => (Date.parse(r.delivered_at) - Date.parse(r.observed_at)) / 60000));
  const stats = [
    [count('conflict'), 'conflicts to resolve'],
    [hazards ? `${Math.round((backed / hazards) * 100)}%` : '–', 'of hazards corroborated'],
    [count('stale'), 'gone stale'],
    [lag == null ? '–' : `${Math.round(lag)} min`, 'median seen → delivered'],
  ];
  return (
    <div className="panel">
      <div className="sheet-eyebrow">Response desk{lensH ? ` · looking ${lensH} h ahead` : ''}</div>
      <h2>{rows.length ? `${rows.length} roads with evidence` : 'No evidence yet'}</h2>
      <div className="stats">{stats.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
      <h3 className="section">Inspection queue</h3>
      {rows.length === 0 && <p className="empty">Roads appear here once an observation reaches this device. Until then every road is unknown, which is not the same as safe.</p>}
      <ul className="cards">
        {rows.map((r) => (
          <li key={r.seg} className="card" style={{ '--c': STATUS[r.status].color }}>
            <button className="card-main queue" onClick={() => onOpen(r.seg)}>
              <div className="card-top"><Chip status={r.status} /><span className="muted">{r.observations.length} report{r.observations.length > 1 ? 's' : ''}</span></div>
              <div className="card-road strong">{roadName(r.seg)}</div>
              <div className="card-delivery">{STATUS[r.status].tone} Last seen {ago(r.latest.observed_at, now)}.</div>
              <div className="fresh-bar"><i style={{ width: `${Math.round(r.freshness * 100)}%` }} /></div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
