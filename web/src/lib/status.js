// Evidence engine: turns the observations recorded against one road segment into a status.
// Pure functions only, so the same rules run on the phone, the dashboard and in tests.

export const KINDS = {
  water_over_road: { label: 'Water over road', icon: '≋', ttlH: 3, hazard: true },
  bridge_damaged: { label: 'Bridge damaged', icon: '⌒', ttlH: 24, hazard: true },
  landslide: { label: 'Landslide / debris', icon: '◣', ttlH: 12, hazard: true },
  tree_down: { label: 'Fallen tree', icon: '✕', ttlH: 6, hazard: true },
  passable: { label: 'Passed through OK', icon: '✓', ttlH: 2, hazard: false },
  closed: { label: 'Closed by authority', icon: '⛔', ttlH: 24, hazard: true },
  reopened: { label: 'Reopened by authority', icon: '✓', ttlH: 12, hazard: false },
};

export const STATUS = {
  unknown: { label: 'Unknown', tone: 'No observation on record. Unknown is not safe.', color: '#3b4954' },
  stale: { label: 'Stale', tone: 'Evidence has expired. Condition is unknown again.', color: '#8a7f63' },
  reported: { label: 'Hazard reported', tone: 'One source. Not yet corroborated.', color: '#ff9a3d' },
  corroborated: { label: 'Corroborated', tone: 'Independent sources agree. Not officially confirmed.', color: '#ff5a36' },
  conflict: { label: 'Conflicting reports', tone: 'Sources disagree. Needs a fresh check.', color: '#c77dff' },
  passable: { label: 'Recently passable', tone: 'Someone got through recently. Not a guarantee.', color: '#52d681' },
  verified_closed: { label: 'Closed · verified', tone: 'Confirmed by an authorised responder.', color: '#ff2e4c' },
  verified_open: { label: 'Open · verified', tone: 'Confirmed open by an authorised responder.', color: '#3ee0c5' },
};

const H = 3600e3;

/** 1 when just observed, 0 once the observation has outlived its time-to-live. */
export function freshness(obs, now) {
  const ttl = (KINDS[obs.kind]?.ttlH ?? 3) * H;
  const age = now - Date.parse(obs.observed_at);
  if (age < 0) return 1; // clock skew between phones: treat as just observed
  return Math.max(0, 1 - age / ttl);
}

/**
 * @param {Array} observations every observation known for one segment
 * @param {number} now epoch ms (the time lens passes a future value here)
 */
export function segmentStatus(observations, now = Date.now()) {
  if (!observations.length) return { status: 'unknown', freshness: 0, fresh: [], latest: null };
  const sorted = [...observations].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const latest = sorted[0];
  const fresh = sorted.filter((o) => freshness(o, now) > 0);
  if (!fresh.length) return { status: 'stale', freshness: 0, fresh, latest };

  const out = (status, basis = fresh) => ({
    status,
    freshness: Math.max(...basis.map((o) => freshness(o, now))),
    fresh,
    latest,
    expiresAt: Math.max(...basis.map((o) => Date.parse(o.observed_at) + KINDS[o.kind].ttlH * H)),
  });

  // An authority check settles everything observed before it; later community reports can still dispute it.
  const authority = fresh.find((o) => o.source === 'authority');
  const live = authority ? fresh.filter((o) => Date.parse(o.observed_at) >= Date.parse(authority.observed_at)) : fresh;
  const hazards = live.filter((o) => KINDS[o.kind].hazard && o.source !== 'authority');
  const clears = live.filter((o) => !KINDS[o.kind].hazard && o.source !== 'authority');

  if (authority) {
    const closed = KINDS[authority.kind].hazard;
    if ((closed && clears.length) || (!closed && hazards.length)) return out('conflict', live);
    return out(closed ? 'verified_closed' : 'verified_open', [authority]);
  }
  if (hazards.length && clears.length) return out('conflict', live);
  if (hazards.length) {
    const independent = new Set(hazards.map((o) => o.origin_device)).size;
    return out(independent >= 2 ? 'corroborated' : 'reported', hazards);
  }
  return out('passable', clears);
}

/** Groups a flat report list by segment and computes each segment's status. */
export function statusBySegment(reports, now = Date.now()) {
  const groups = new Map();
  for (const r of reports) {
    if (!groups.has(r.segment_id)) groups.set(r.segment_id, []);
    groups.get(r.segment_id).push(r);
  }
  const result = new Map();
  for (const [seg, obs] of groups) result.set(seg, { ...segmentStatus(obs, now), observations: obs });
  return result;
}

// Lower number = look at it first.
const URGENCY = { conflict: 0, corroborated: 1, reported: 2, stale: 3, verified_closed: 4, passable: 5, verified_open: 6, unknown: 7 };
export const urgency = (status) => URGENCY[status] ?? 9;

export function ago(iso, now = Date.now()) {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}
