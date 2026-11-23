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

export const MODEL_VERSION = 'radar-1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow extends SnapshotProtocol {
  rank: number;
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  tvl_usd: number;
  change_7d: number | null;
  implied: number;
  farm_steps: string[];
}

export interface LiveRow extends SnapshotProtocol {
  rank: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  board: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;

  const asOfMs = Date.parse(asOf);
  const listedAtMs = Date.parse(listedAt);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedAtMs)) return null;

  return Math.floor((asOfMs - listedAtMs) / 86_400_000);
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowthPct = protocol.change_7d ?? 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowthPct));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) *
      model.maturity_range;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));

  return { implied, growthPct, growthMult, maturityMult, age };
}

export function isPreToken(protocol: SnapshotProtocol): boolean {
  return (
    protocol.mcap_usd === null &&
    protocol.gecko_id === null &&
    protocol.symbol === null
  );
}

export function isRankable(protocol: SnapshotProtocol): boolean {
  return (
    isPreToken(protocol) &&
    protocol.category !== 'CEX' &&
    !/\sV\d+(?:\.\d+)*$/i.test(protocol.name)
  );
}

function compareSlug(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((protocol) => [protocol.slug, protocol]));
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const protocol = bySlug.get(slug);
    if (protocol) chosen.set(slug, protocol);
  }

  const selectedSlugs = new Set(chosen.keys());
  const early = snapshot.protocols
    .filter(
      (protocol) =>
        isRankable(protocol) &&
        !selectedSlugs.has(protocol.slug) &&
        protocol.tvl_usd < snapshot.floor_usd,
    )
    .sort(
      (a, b) =>
        b.tvl_usd - a.tvl_usd || compareSlug(a.slug, b.slug),
    )
    .slice(0, EARLY_ROWS);

  const scored = [...chosen.values(), ...early]
    .map((protocol) => ({
      protocol,
      score: impliedValue(protocol, snapshot.as_of, MODEL),
    }))
    .sort(
      (a, b) =>
        b.score.implied - a.score.implied ||
        compareSlug(a.protocol.slug, b.protocol.slug),
    );

  return scored.map(({ protocol, score }, index) => ({
    ...protocol,
    rank: index + 1,
    implied: score.implied,
    growthPct: score.growthPct,
    growthMult: score.growthMult,
    maturityMult: score.maturityMult,
    age: score.age,
    farm_steps: farmSteps(protocol, score.age).map(stepText),
  }));
}

export function buildRadar(snapshot: Snapshot): RadarData {
  const board = buildBoard(snapshot);
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    board: board.map(radarRow),
    live: liveRows(snapshot.protocols),
  };
}

export function parseSnapshot(json: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SnapshotError(`Snapshot is not valid JSON: ${detail}`);
  }

  if (!isRecord(value)) throw new SnapshotError('Snapshot must be a JSON object.');

  const asOf = value.as_of;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new SnapshotError('Snapshot as_of must use YYYY-MM-DD format.');
  }
  const parsedAsOf = new Date(`${asOf}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsedAsOf.getTime()) ||
    parsedAsOf.toISOString().slice(0, 10) !== asOf
  ) {
    throw new SnapshotError('Snapshot as_of must be a real calendar date.');
  }

  if (typeof value.source !== 'string') {
    throw new SnapshotError('Snapshot source must be a string.');
  }
  if (!isFiniteNumber(value.floor_usd)) {
    throw new SnapshotError('Snapshot floor_usd must be a finite number.');
  }
  if (!Array.isArray(value.protocols)) {
    throw new SnapshotError('Snapshot protocols must be an array.');
  }
  if (!Array.isArray(value.watchlist) || !value.watchlist.every((item) => typeof item === 'string')) {
    throw new SnapshotError('Snapshot watchlist must be an array of strings.');
  }

  const protocols = value.protocols.map((entry, index) => parseProtocol(entry, index));

  return {
    as_of: asOf,
    source: value.source,
    floor_usd: value.floor_usd,
    protocols,
    watchlist: [...value.watchlist],
  };
}

export function boardIssue(board: BoardRow[], snapshot?: Snapshot): string | null {
  if (board.length === 0) return 'Board coverage is empty.';

  if (snapshot) {
    const expectedSlugs = buildBoard(snapshot).map((row) => row.slug);
    const actualSlugs = board.map((row) => row.slug);
    if (
      expectedSlugs.length !== actualSlugs.length ||
      expectedSlugs.some((slug, index) => actualSlugs[index] !== slug)
    ) {
      return 'Board coverage does not match the selected and eligible protocols.';
    }
  }

  for (let index = 0; index < board.length; index += 1) {
    if (board[index].rank !== index + 1) {
      return `Board rank at row ${index + 1} must be ${index + 1}.`;
    }
    if (index > 0 && board[index].implied > board[index - 1].implied) {
      return 'Board implied values rise as rank increases.';
    }

    const steps = board[index].farm_steps;
    if (steps.length < 3 || steps.length > 12) {
      return `Board row ${index + 1} must have 3 to 12 farm steps.`;
    }
    if (steps.some((step) => typeof step !== 'string' || step.length < 20 || step.length > 600)) {
      return `Board row ${index + 1} has a farm step outside the 20 to 600 character limit.`;
    }
  }

  if (board.length > 1 && new Set(board.map((row) => row.implied)).size === 1) {
    return 'Board implied values are all equal.';
  }

  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

export function farmSteps(protocol: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = protocol.chains[0] ?? 'its main chain';
  const capital =
    protocol.tvl_usd >= 5e9
      ? 250
      : protocol.tvl_usd >= 1e9
        ? 150
        : protocol.tvl_usd >= 1e8
          ? 100
          : 50;
  const holdDays = age !== null && age < 180 ? 60 : age !== null && age < 365 ? 45 : 30;
  const category = (protocol.category ?? '').toLowerCase();

  let primaryAction: string;
  if (category.includes('lend') || category.includes('borrow')) {
    primaryAction = `Supply a modest amount to ${protocol.name} on ${chain}, then check the position and any available rewards.`;
  } else if (category.includes('dex') || category.includes('exchange') || category.includes('amm')) {
    primaryAction = `Make a small swap on ${protocol.name} on ${chain}, then review the route and transaction in the app.`;
  } else if (category.includes('bridge')) {
    primaryAction = `Bridge a test amount through ${protocol.name} to ${chain}, confirming the destination before signing.`;
  } else if (category.includes('stake')) {
    primaryAction = `Stake a small amount through ${protocol.name} on ${chain}, then verify the receipt or staking position.`;
  } else {
    primaryAction = `Use the core feature of ${protocol.name} on ${chain} and verify that the interaction appears in your activity.`;
  }

  return [
    {
      text: `Create or choose a dedicated wallet for ${protocol.name}, and confirm that it is configured for ${chain}.`,
      cost: '$0',
      time: '10 minutes',
    },
    {
      text: `Fund the wallet with about $${capital} of the network asset and keep a separate amount available for transaction fees.`,
      cost: `$${capital} plus gas`,
      time: '15 minutes',
    },
    {
      text: primaryAction,
      cost: `up to $${capital}`,
      time: '20 minutes',
    },
    {
      text: `Return to ${protocol.name} on ${chain} and complete one additional low-value action supported by the app.`,
      cost: 'network fees',
      time: '15 minutes',
    },
    {
      text: `Keep the position active for about ${holdDays} days, checking the protocol status and your wallet activity periodically.`,
      cost: 'varies by position',
      time: `${holdDays} days`,
    },
    {
      text: `Before exiting, review current fees and balances, withdraw or unwind the position, and save the transaction records.`,
      cost: 'network fees',
      time: '15 minutes',
    },
  ];
}

export function stepText(step: FarmStep): string {
  const text = `${step.text.trim()} Cost: ${step.cost}. Time: ${step.time}.`;
  if (text.length > 600) return text.slice(0, 600).trimEnd();
  if (text.length < 20) return `${text} Follow the official steps.`.slice(0, 600);
  return text;
}

export function liveRows(protocols: SnapshotProtocol[]): LiveRow[] {
  return protocols
    .filter((protocol) => !isPreToken(protocol) && protocol.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? Number.NEGATIVE_INFINITY) -
          (a.mcap_usd ?? Number.NEGATIVE_INFINITY) ||
        b.tvl_usd - a.tvl_usd ||
        compareSlug(a.slug, b.slug),
    )
    .slice(0, LIVE_ROWS)
    .map((protocol, index) => ({ ...protocol, rank: index + 1 }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chain: row.chains[0] ?? 'its main chain',
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    implied: row.implied,
    farm_steps: [...row.farm_steps],
  };
}

function parseProtocol(value: unknown, index: number): SnapshotProtocol {
  if (!isRecord(value)) {
    throw new SnapshotError(`Protocol at index ${index} must be an object.`);
  }

  if (typeof value.slug !== 'string' || value.slug.length === 0) {
    throw new SnapshotError(`Protocol at index ${index} must have a non-empty slug.`);
  }
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new SnapshotError(`Protocol at index ${index} must have a non-empty name.`);
  }
  if (!isFiniteNumber(value.tvl_usd)) {
    throw new SnapshotError(`Protocol ${value.slug} tvl_usd must be a finite number.`);
  }

  const category = value.category === undefined ? null : value.category;
  if (category !== null && typeof category !== 'string') {
    throw new SnapshotError(`Protocol ${value.slug} category must be a string or null.`);
  }

  const chains = value.chains === undefined ? [] : value.chains;
  if (!Array.isArray(chains) || !chains.every((chain) => typeof chain === 'string')) {
    throw new SnapshotError(`Protocol ${value.slug} chains must be an array of strings.`);
  }

  return {
    slug: value.slug,
    name: value.name,
    category,
    chains: [...chains],
    tvl_usd: value.tvl_usd,
    change_7d: nullableNumber(value.change_7d, 'change_7d', value.slug),
    mcap_usd: nullableNumber(value.mcap_usd, 'mcap_usd', value.slug),
    listed_at: nullableString(value.listed_at, 'listed_at', value.slug),
    gecko_id: nullableString(value.gecko_id, 'gecko_id', value.slug),
    symbol: nullableString(value.symbol, 'symbol', value.slug),
  };
}

function nullableNumber(value: unknown, field: string, slug: string): number | null {
  if (value === undefined || value === null) return null;
  if (!isFiniteNumber(value)) {
    throw new SnapshotError(`Protocol ${slug} ${field} must be a finite number or null.`);
  }
  return value;
}

function nullableString(value: unknown, field: string, slug: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new SnapshotError(`Protocol ${slug} ${field} must be a string or null.`);
  }
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}