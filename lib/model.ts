// Token launch radar model.
// Pure functions over a snapshot. No external dependencies.

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export type FarmStep = string;

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: { base_multiple: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'radar-1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const ms = Date.parse(asOf) - Date.parse(listedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  if (p.category === 'CEX') return false;
  if (VERSION_RE.test(p.name)) return false;
  return true;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): number {
  const info = computeModel(protocol, asOf, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const value = Math.round(base * info.growth_multiplier * info.maturity_multiplier);
  return Math.max(1, value);
}

function computeModel(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { base_multiple: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null } {
  const ad = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(protocol.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    model.maturity_floor +
    (Math.min(ad ?? model.unknown_age_days, model.maturity_days) / model.maturity_days) * model.maturity_range;
  return {
    base_multiple: model.base_multiple,
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    maturity_multiplier: maturityMult,
    age_days: ad,
  };
}

function categoryAction(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('borrow')) return 'supply USDC';
  if (c.includes('dex') || c.includes('liquidity') || c.includes('amm')) return 'provide liquidity';
  if (c.includes('bridge')) return 'bridge funds';
  if (c.includes('stak')) return 'stake';
  if (c.includes('perp') || c.includes('deriv')) return 'deposit margin';
  if (c.includes('stable')) return 'mint/deposit stable';
  if (c.includes('rwa')) return 'mint yield asset';
  if (c.includes('insurance')) return 'buy cover';
  if (c.includes('curator') || c.includes('allocator')) return 'deposit into vault';
  return 'deposit USDC';
}

function capitalFor(tvl: number): number {
  if (tvl >= 5e9) return 250;
  if (tvl >= 1e9) return 150;
  if (tvl >= 1e8) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function makeStep(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  s = s.trim();
  if (s.length > 600) s = s.slice(0, 597) + '...';
  while (s.trim().length < 20) s = s.trim() + ' Note.';
  return s.trim();
}

function buildFarmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const ad = ageDays(asOf, p.listed_at);
  const chain = (p.chains && p.chains.length ? p.chains[0] : 'primary chain');
  const capital = capitalFor(p.tvl_usd);
  const action = categoryAction(p.category);
  const hold = holdDays(ad);

  const steps: string[] = [];
  steps.push(
    makeStep(
      'Use a fresh dedicated wallet for this protocol to isolate farming activity and protect your main funds.',
      '0 USD (wallet setup)',
      '5 minutes',
    ),
  );
  steps.push(
    makeStep(
      `On ${chain}, ${action} with ${capital} USD of capital scaled to the protocol TVL of ${Math.round(p.tvl_usd)} USD.`,
      `${capital} USD (capital)`,
      '10 minutes',
    ),
  );
  steps.push(
    makeStep(
      'Perform one qualifying action every week to maintain eligibility for any future token distribution.',
      '0 USD (gas only)',
      '15 minutes per week',
    ),
  );
  steps.push(
    makeStep(
      `Hold your position for ${hold} days before considering any claim or withdrawal.`,
      '0 USD',
      `${hold} days`,
    ),
  );
  steps.push(
    makeStep(
      'Claim rewards only from the protocol official page and never pay any fee to claim.',
      '0 USD (no claim fee)',
      '5 minutes',
    ),
  );
  steps.push(
    makeStep(
      'Keep a farm log recording wallet address, dates, and transaction hashes for auditing.',
      '0 USD',
      '5 minutes',
    ),
  );
  return steps;
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const bySlug = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) bySlug.set(p.slug, p);

  const chosen: SnapshotProtocol[] = [];
  const chosenSlugs = new Set<string>();

  // watchlist first
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p && !chosenSlugs.has(p.slug)) {
      chosen.push(p);
      chosenSlugs.add(p.slug);
    }
  }

  // early rows candidates
  const earlyCandidates = snapshot.protocols.filter((p) => {
    if (chosenSlugs.has(p.slug)) return false;
    if (!isPreToken(p)) return false;
    if (p.tvl_usd >= snapshot.floor_usd) return false;
    if (!isRankable(p)) return false;
    return true;
  });
  earlyCandidates.sort((a, b) => {
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const early = earlyCandidates.slice(0, EARLY_ROWS);
  for (const p of early) {
    if (!chosenSlugs.has(p.slug)) {
      chosen.push(p);
      chosenSlugs.add(p.slug);
    }
  }

  const rows: BoardRow[] = chosen.map((p) => {
    const ad = ageDays(snapshot.as_of, p.listed_at);
    const info = computeModel(p, snapshot.as_of, MODEL);
    const iv = impliedValue(p, snapshot.as_of, MODEL);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: ad,
      implied_value_usd: iv,
      model: {
        base_multiple: info.base_multiple,
        growth_pct: info.growth_pct,
        growth_multiplier: info.growth_multiplier,
        maturity_multiplier: info.maturity_multiplier,
        age_days: info.age_days,
      },
      farm_steps: buildFarmSteps(p, snapshot.as_of),
    };
  });

  rows.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  // coverage
  const slugs = new Set(board.map((r) => r.slug));
  const missing: string[] = [];
  for (const s of snapshot.watchlist) {
    if (!slugs.has(s)) missing.push(s);
    if (missing.length >= 5) break;
  }
  // check all missing but report first few
  const allMissing: string[] = [];
  for (const s of snapshot.watchlist) {
    if (!slugs.has(s)) allMissing.push(s);
  }
  if (allMissing.length > 0) {
    return `coverage: missing watchlist slugs: ${allMissing.slice(0, 5).join(', ')}`;
  }

  // ranks
  const N = board.length;
  for (let i = 0; i < N; i++) {
    const expected = i + 1;
    if (board[i].rank !== expected) {
      return `rank ${i + 1} is ${board[i].rank}`;
    }
  }
  // also sorted ranks exactly 1..N check via above? Need check no gaps/repeats; above checks position. But if ranks array unsorted, first mismatch catches. Also ensure sorted ascending? The spec: sorted ranks exactly 1..N. Check sorted order of ranks.
  const sortedRanks = board.map((r) => r.rank).slice().sort((a, b) => a - b);
  for (let i = 0; i < N; i++) {
    if (sortedRanks[i] !== i + 1) {
      return `rank ${i + 1} is ${sortedRanks[i]}`;
    }
  }

  // order: implied_value never rises as rank ascends
  // assume board sorted by rank asc? Need sort by rank to validate.
  const byRank = board.slice().sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) {
      return `order: implied_value_usd rises at row ${byRank[i].slug} (rank ${byRank[i].rank})`;
    }
  }

  // equality: if board.length >=2 and first and last implied values equal
  if (board.length >= 2) {
    const first = byRank[0].implied_value_usd;
    const last = byRank[byRank.length - 1].implied_value_usd;
    if (first === last) {
      return `equality: first and last implied_value_usd are equal (${first})`;
    }
  }

  // per row
  for (const r of board) {
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug}: farm_steps count ${r.farm_steps?.length}`;
    }
    for (const step of r.farm_steps) {
      if (typeof step !== 'string') return `row ${r.slug}: farm_step not string`;
      const t = step.trim();
      if (t.length < 20 || t.length > 600) {
        return `row ${r.slug}: farm_step length ${t.length}`;
      }
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `row ${r.slug}: implied_value_usd invalid`;
    }
  }

  return null;
}

export function buildRadar(snapshot: Snapshot): RadarData {
  const board = buildBoard(snapshot);
  const watchSet = new Set(snapshot.watchlist);

  const early_size = board.filter((r) => !watchSet.has(r.slug)).length;

  // live rows
  const liveCandidates = snapshot.protocols.filter((p) => {
    // has token: not all null
    if (isPreToken(p)) return false;
    if (p.category === 'CEX') return false;
    return true;
  });
  liveCandidates.sort((a, b) => {
    const ma = a.mcap_usd ?? -Infinity;
    const mb = b.mcap_usd ?? -Infinity;
    if (mb !== ma) return mb - ma;
    if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const liveProtos = liveCandidates.slice(0, LIVE_ROWS);
  const live: LiveRow[] = liveProtos.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: [...p.chains],
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));

  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: [...r.chains],
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    growth_multiplier: Math.round(r.model.growth_multiplier * 10000) / 10000,
    maturity_multiplier: Math.round(r.model.maturity_multiplier * 10000) / 10000,
  }));

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...MODEL },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size,
    live_size: live.length,
    rows,
    live,
  };
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function coerceStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return null;
}

function coerceChains(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string') out.push(x);
    else if (x !== null && x !== undefined) out.push(String(x));
  }
  return out;
}

function coerceNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SnapshotError('invalid JSON: ' + (e instanceof Error ? e.message : String(e)));
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot must be an object');
  }
  const o = raw as Record<string, unknown>;

  // as_of
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('as_of must be YYYY-MM-DD string');
  }
  // source
  if (typeof o.source !== 'string') {
    throw new SnapshotError('source must be a string');
  }
  // floor_usd
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('floor_usd must be a positive safe integer');
  }

  // protocols
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError('protocols must be an array');
  }
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < o.protocols.length; i++) {
    const entry = o.protocols[i];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`protocols[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== 'string') throw new SnapshotError(`protocols[${i}].slug must be string`);
    if (typeof e.name !== 'string') throw new SnapshotError(`protocols[${i}].name must be string`);
    if (!isFiniteNumber(e.tvl_usd)) throw new SnapshotError(`protocols[${i}].tvl_usd must be finite number`);

    const category = coerceStringOrNull(e.category);
    // but if category is string keep; if null keep null. If some other type, null (tolerant)
    const chains = coerceChains(e.chains);
    const change_7d = coerceNumOrNull(e.change_7d);
    const mcap_usd = coerceNumOrNull(e.mcap_usd);
    const listed_at = coerceStringOrNull(e.listed_at);
    const gecko_id = coerceStringOrNull(e.gecko_id);
    const symbol = coerceStringOrNull(e.symbol);

    protocols.push({
      slug: e.slug,
      name: e.name,
      category,
      chains,
      tvl_usd: e.tvl_usd,
      change_7d,
      mcap_usd,
      listed_at,
      gecko_id,
      symbol,
    });
  }

  // watchlist
  if (!Array.isArray(o.watchlist)) {
    throw new SnapshotError('watchlist must be an array');
  }
  const watchlist: string[] = [];
  for (let i = 0; i < o.watchlist.length; i++) {
    if (typeof o.watchlist[i] !== 'string') {
      throw new SnapshotError(`watchlist[${i}] must be string`);
    }
    watchlist.push(o.watchlist[i] as string);
  }

  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist,
  };
}
