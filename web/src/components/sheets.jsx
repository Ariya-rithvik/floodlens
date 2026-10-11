import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { KINDS, STATUS, ago } from '../lib/status.js';
import { roadMid, roadName } from '../lib/pack.js';
import { streetViewUrl } from '../lib/guide.js';
import { encodeReport } from '../lib/codec.js';

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Chip({ status }) {
  return <span className="chip" style={{ '--c': STATUS[status].color }}>{STATUS[status].label}</span>;
}

/** Where a report has been: origin → carriers → response centre. Hollow cloud means "not there yet". */
export function Journey({ r }) {
  const delivered = r.delivery === 'delivered';
  return (
    <div className="journey">
      <span className="hop hop-origin">{r.origin_name}</span>
      {r.hops.map((h, i) => (
        <span key={i} className="hop">{h.name}</span>
      ))}
      <span className={`hop hop-cloud ${delivered ? 'on' : ''}`}>{delivered ? 'Response centre' : 'not delivered'}</span>
    </div>
  );
}

export function deliveryLine(r) {
  if (r.delivery === 'delivered') {
    const mins = Math.max(0, Math.round((Date.parse(r.delivered_at) - Date.parse(r.observed_at)) / 60000));
    const routes = r.deliveries?.length > 1 ? ` · arrived by ${r.deliveries.length} routes, counted once` : '';
    return `Delivered ${clock(r.delivered_at)} · ${mins} min after it was seen${routes}`;
  }
  if (r.delivery === 'rejected') return `Refused by the response centre: ${r.reject_reason}`;
  if (r.delivery === 'carrying') return `Carrying for ${r.origin_name} · has not reached the response centre`;
  return 'Saved on this device · has not reached the response centre';
}

function Photo({ r }) {
  const src = r.photo || r.photo_url;
  if (src) return <img className="evidence-photo" src={src} alt="Photo evidence" />;
  if (r.photo_state === 'pending') return <div className="evidence-missing">Photo exists on the reporter's phone. It has not arrived yet.</div>;
  return null;
}

const CALL_STATE = { simulated: 'not placed, no phone line configured', failed: 'call failed', placed: 'call placed', skipped: 'not called' };

/** Who was phoned when this road was confirmed. Names and places only: numbers never leave the response centre. */
function AlertLog({ alert }) {
  const calls = alert.calls || [];
  return (
    <div className="obs-alert">
      <b>☎ Confirmed by {alert.phones} phones at {clock(alert.at)}. {calls.length ? `Alert network: ${calls.length} call${calls.length > 1 ? 's' : ''}.` : 'Nobody on the alert network is within 3 km.'}</b>
      {calls.length > 0 && (
        <ul>
          {calls.map((c, i) => (
            <li key={i}>{c.name} · {c.role === 'responder' ? 'responder' : `${c.place}, ${c.km} km away`} · {CALL_STATE[c.status] || c.status}{c.reason ? ` (${c.reason})` : ''}</li>
          ))}
        </ul>
      )}
      <p>“{alert.text}”</p>
    </div>
  );
}

export function Observation({ r, now }) {
  const k = KINDS[r.kind];
  return (
    <li className={`obs ${k.hazard ? 'obs-hazard' : 'obs-clear'}`}>
      <div className="obs-head">
        <b>{k.icon} {k.label}</b>
        <span>{ago(r.observed_at, now)} · {clock(r.observed_at)}</span>
      </div>
      {r.note && <p className="obs-note">“{r.note}”</p>}
      <Photo r={r} />
      {r.ai && <p className="obs-ai">AI read of the photo (assists review, decides nothing): {r.ai.summary}</p>}
      {r.alert && <AlertLog alert={r.alert} />}
      <div className="obs-meta">
        <span className={`src src-${r.source}`}>{r.source === 'authority' ? 'Authorised responder' : 'Community'}</span>
        <code>{r.report_id}</code>
        {r.drill && <span className="src src-drill">Simulated drill</span>}
      </div>
      <Journey r={r} />
      <div className="obs-delivery">{deliveryLine(r)}</div>
    </li>
  );
}

/** Options for reaching higher ground. It lays out what is known and leaves the decision with the person. */
export function GuideSheet({ guide, options, online, onChoose, onClose }) {
  return (
    <section className="sheet sheet-guide" style={{ '--c': '#3ee0c5' }}>
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <div className="sheet-eyebrow">Higher ground from where you are</div>
      <h2>You are at about {guide.height.metres} m</h2>
      <p className="muted">Height {guide.height.source}.</p>
      <p className="guide-warning">
        This compares ground height for rising water. It is not a route, it does not know about landslide risk, and a way with no reports is unknown, not clear. Follow official evacuation instructions when you have them.
      </p>
      {options.length === 0 && <p className="empty">No mapped place within 3 km is clearly higher than this point. Move away from the river and uphill, and stay off bridges.</p>}
      <ol className="guide-list">
        {options.map((o, i) => (
          <li key={o.name} className={i === guide.chosen ? 'on' : ''}>
            <button className="guide-main" onClick={() => onChoose(i)}>
              <b>{o.name}</b>
              <span>{o.kind} · {o.metres >= 1000 ? `${(o.metres / 1000).toFixed(1)} km` : `${o.metres} m`} in a straight line · {o.gain} m higher</span>
              <em className={o.known.length ? 'bad' : ''}>
                {o.known.length ? `Reported near the direct line: ${o.known.join(', ')}` : 'No reports near the direct line. Unknown, not confirmed clear.'}
              </em>
            </button>
            {online && <a className="btn btn-small" href={streetViewUrl(o.lat, o.lon)} target="_blank" rel="noreferrer">Street view</a>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SegmentSheet({ segId, info, now, realNow, responder, online, onClose, onReport, onVerify }) {
  const status = info?.status || 'unknown';
  const obs = info ? [...info.observations].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at)) : [];
  const minsLeft = info?.expiresAt ? Math.round((info.expiresAt - now) / 60000) : null;
  return (
    <section className="sheet" style={{ '--c': STATUS[status].color }}>
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <div className="sheet-eyebrow">Road segment</div>
      <h2>{roadName(segId)}</h2>
      <div className="verdict">
        <Chip status={status} />
        <span>{STATUS[status].tone}</span>
      </div>
      {info && status !== 'stale' && (
        <div className="fresh">
          <div className="fresh-bar"><i style={{ width: `${Math.round(info.freshness * 100)}%` }} /></div>
          <span>{minsLeft > 0 ? `Evidence expires in ${minsLeft >= 60 ? `${Math.floor(minsLeft / 60)} h ${minsLeft % 60} min` : `${minsLeft} min`} unless someone checks again` : ''}</span>
        </div>
      )}
      <div className="sheet-actions">
        <button className="btn" onClick={onReport}>Add an observation here</button>
        {online && roadMid(segId) && <a className="btn btn-ghost" href={streetViewUrl(...roadMid(segId))} target="_blank" rel="noreferrer">Street view</a>}
        {responder && (
          <>
            <button className="btn btn-danger" onClick={() => onVerify('closed')}>Verify closed</button>
            <button className="btn btn-ok" onClick={() => onVerify('reopened')}>Verify open</button>
          </>
        )}
      </div>
      {obs.length > 0 && (
        <>
          <div className="sheet-eyebrow">Evidence timeline · {obs.length}</div>
          <ol className="timeline">{obs.map((r) => <Observation key={r.report_id} r={r} now={realNow} />)}</ol>
        </>
      )}
    </section>
  );
}

async function shrinkPhoto(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

export function ReportSheet({ pick, onSave, onCancel }) {
  const [kind, setKind] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState('');
  return (
    <section className="sheet sheet-report">
      <button className="sheet-close" onClick={onCancel} aria-label="Cancel">×</button>
      <div className="sheet-eyebrow">New observation · {pick.viaGps ? `GPS ±${pick.accuracy} m` : 'placed on map'}</div>
      <h2>{roadName(pick.seg)}</h2>
      <p className="muted">{pick.metres ? `Snapped to the nearest mapped road, ${pick.metres} m from the point.` : 'Recorded on this road.'}</p>
      <div className="kinds">
        {Object.entries(KINDS).filter(([id]) => !['closed', 'reopened'].includes(id)).map(([id, k]) => (
          <button key={id} className={`kind ${kind === id ? 'on' : ''} ${k.hazard ? '' : 'kind-clear'}`} onClick={() => setKind(id)}>
            <b>{k.icon}</b>
            {k.label}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="btn btn-ghost photo-btn">
          {photo ? 'Retake photo' : 'Add a photo'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => e.target.files[0] && setPhoto(await shrinkPhoto(e.target.files[0]))} />
        </label>
        {photo && <img className="photo-thumb" src={photo} alt="" />}
      </div>
      <input className="input" placeholder="What did you see? (optional)" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary btn-wide" disabled={!kind} onClick={() => onSave({ kind, photo, note })}>Save observation</button>
    </section>
  );
}

/** Shown right after saving. Saving and delivering are different things, and the ticket says which has happened. */
export function Ticket({ r, onQr, onClose }) {
  const delivered = r.delivery === 'delivered';
  return (
    <div className="modal" onClick={onClose}>
      <div className={`ticket ${delivered ? 'ticket-delivered' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ticket-stamp">{delivered ? 'Delivered' : 'Saved · not delivered'}</div>
        <h3>{delivered ? 'The response centre has this report' : 'Report saved on this device'}</h3>
        <p>{delivered ? 'It is now visible to responders.' : 'No route to the response centre yet. Nobody else can see this report until it is carried out or the network returns.'}</p>
        <dl>
          <div><dt>Report ID</dt><dd><code>{r.report_id}</code></dd></div>
          <div><dt>Observed</dt><dd>{clock(r.observed_at)}</dd></div>
          <div><dt>Road</dt><dd>{roadName(r.segment_id)}</dd></div>
          <div><dt>Evidence</dt><dd>{r.photo ? '1 photo, kept on this phone' : 'No photo'}</dd></div>
          <div><dt>Delivery</dt><dd>{delivered ? `Reached centre ${clock(r.delivered_at)}` : 'Waiting for a carrier or a connection'}</dd></div>
        </dl>
        <div className="ticket-actions">
          {!delivered && <button className="btn btn-primary" onClick={onQr}>Hand to a carrier</button>}
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function QrModal({ r, onClose }) {
  const [src, setSrc] = useState('');
  const code = encodeReport(r);
  useEffect(() => {
    QRCode.toDataURL(code, { margin: 2, width: 560, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [code]);
  return (
    <div className="modal" onClick={onClose}>
      <div className="handoff" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-eyebrow">Hand off · no network needed</div>
        <h3>{KINDS[r.kind].label}</h3>
        <p className="muted">{roadName(r.segment_id)} · seen {clock(r.observed_at)}</p>
        {src && <img className="qr" src={src} alt="Report code" />}
        <p className="muted">The carrier scans this in FloodLens. Only the report travels ({code.length} characters){r.photo ? '; the photo stays here until this phone reaches the internet' : ''}.</p>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(code)}>Copy as text</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function Scanner({ onCode, onClose }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    let stream, raf, stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      const v = video.current;
      if (stopped || !v) return;
      if (v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (hit?.data?.startsWith('FL1|')) return onCode(hit.data);
      }
      raf = requestAnimationFrame(tick);
    };
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.current.srcObject = s;
        video.current.play();
        tick();
      })
      .catch(() => setError('Camera unavailable. Paste the report code instead.')) ?? setError('Camera unavailable. Paste the report code instead.');
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="modal" onClick={onClose}>
      <div className="handoff" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-eyebrow">Receive a report · no network needed</div>
        <h3>Scan the reporter's code</h3>
        {error ? <p className="muted">{error}</p> : <div className="scan"><video ref={video} playsInline muted /><i /></div>}
        <div className="row">
          <input className="input" placeholder="or paste a code: FL1|…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onCode(text)}>Import</button>
        </div>
        <button className="btn btn-ghost btn-wide" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
