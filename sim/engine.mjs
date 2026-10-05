// ===== 豊穣の水田 v0.1（水系リデザイン）— 純ロジックエンジン =====
// React / boardgame.io 非依存。シミュレーションと将来のUIの両方から使う。
// ルールの説明は sim/RULES.md を参照。
//
// v0 → v0.1 の変更（シミュレーションで見つかった欠陥の修正）
// - 取水口の所有を廃止。田は自分の節で水を取る。水路は「上流の節から取る権利」。
//   （v0 では上流を開墾しても、その節の取水口を他人に取られると水が来ない「死に田」ができた）
// - 手入れ（草取り）を追加（P.careEnabled）。働き手の使い道が日雇いしかない問題の対策候補。

export const SEASONS = ['春', '夏', '秋'];
export const POS_LABEL = ['上流', '中流', '下流'];

export const DEFAULT_PARAMS = {
  years: 5,
  workers: 2,
  startRice: 5,
  plotsPerNode: 3,
  fertility: [4, 5, 6],          // 上・中・下の地力
  claimCost: [3, 2, 1],          // 開墾の費用（俵）
  upstreamUpkeep: 1,             // 上流の田1枚あたり年1俵の堤維持費
  workerUpkeep: 1,               // 働き手1人あたり年1俵
  canalCostPerLen: 2,
  reservoirCost: 4,
  reservoirCap: 4,
  weirCost: 6,
  weirEnabled: true,
  careEnabled: true,             // 手入れ（植わった田2枚まで今年の収量+1）
  seedCost: 1,
  plantPerAction: 4,             // 植付1回で植えられる田の数
  carePerAction: 3,              // 手入れ1回で手入れできる田の数
  rainBase: [4, 6, 4],           // ×人数（春・夏・秋）
  rainSpread: 1,                 // ±人数×この値
  typhoonChance: 0.3,
  typhoonPenalty: 3,             // 晩稲のみ
  landscape: { field: 1, canalLen: 1, reservoir: 2, weir: 2 },
  leftoverRate: 3,               // 終了時の残り米 3俵=1点
  slotsMinus: 1,                 // 開墾・水路・植付・手入れの枠数 = 人数 − これ
  offerCapPerYear: 0,            // 0=制限なし（v0は時期に意味がない）
  orderMode: 'lowest',           // season / year / lowest（合計の低い人から）
  botNoise: 0.4,                 // ボットの判断の揺らぎ
};

// 品種：need[季節] = 必要水量（null=その季節は田にいない）
export const VARIETIES = {
  早稲: { need: [2, 1, null], bonus: 0 },
  中稲: { need: [1, 3, 1], bonus: 1 },
  晩稲: { need: [null, 2, 3], bonus: 1 },
};
export const VARIETY_NAMES = () => Object.keys(VARIETIES);
export const firstSeason = (v) => VARIETIES[v].need.findIndex((x) => x !== null);
export const lastSeason = (v) => { const n = VARIETIES[v].need; for (let i = n.length - 1; i >= 0; i--) if (n[i] !== null) return i; return -1; };

// ---- 乱数（シード付き・再現可能）----
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// _rng（関数）は複製できないので外す。P は読み取り専用なので参照を共有する
export const clone = (x) => { const { _rng, P, ...rest } = x; const c = structuredClone(rest); c.P = P; return c; };

// ===== 初期化 =====
export function createGame(numPlayers, seed = 1, overrides = {}) {
  const P = { ...DEFAULT_PARAMS, ...overrides, landscape: { ...DEFAULT_PARAMS.landscape, ...(overrides.landscape || {}) } };
  const rng = makeRng(seed);
  const rivers = [];
  for (let r = 0; r < numPlayers; r++) {
    const nodes = [];
    for (let p = 0; p < 3; p++) {
      const plots = [];
      for (let k = 0; k < P.plotsPerNode; k++) plots.push({ owner: null, conn: null, crop: null });
      nodes.push({ plots });
    }
    rivers.push({ nodes, reservoir: null });
  }
  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    players.push({ id: i, rice: P.startRice, offered: 0, debt: 0, canalLen: 0, harvested: 0, actions: {} });
    // 出発点：自分の川の下流に田2枚
    rivers[i].nodes[2].plots.slice(0, 2).forEach((pl) => { pl.owner = i; pl.conn = 2; });
  }
  const g = {
    P, N: numPlayers, year: 1, season: 0, startPlayer: 0,
    rivers, weir: null, players,
    typhoon: rng() < P.typhoonChance,
    rain: null, forecast: null, slots: null, over: false, stage: null,
  };
  g._rng = rng;
  beginSeason(g);
  return g;
}

// ===== 盤面ヘルパ =====
export function allPlots(g) {
  const out = [];
  g.rivers.forEach((rv, r) => rv.nodes.forEach((nd, p) => nd.plots.forEach((pl, k) => out.push({ r, p, k, pl }))));
  return out;
}
export const plotAt = (g, r, p, k) => g.rivers[r].nodes[p].plots[k];
export const ownFields = (g, pid) => allPlots(g).filter((x) => x.pl.owner === pid);
export function rainRange(g, s) {
  const base = g.P.rainBase[s] * g.N, d = Math.round(g.P.rainSpread * g.N);
  return [Math.max(0, base - d), base + d];
}
export const rainExpected = (g, s) => g.P.rainBase[s] * g.N;
export function upkeepDue(g, pid) {
  const up = ownFields(g, pid).filter((x) => x.p === 0).length;
  return g.P.workers * g.P.workerUpkeep + up * g.P.upstreamUpkeep;
}

function beginSeason(g) {
  const [lo, hi] = rainRange(g, g.season);
  g.forecast = [lo, hi];                 // 占い（公開）
  g.rain = randInt(g._rng, lo, hi);      // 実際の値（流れの計算まで非公開）
  const n = Math.max(1, g.N - g.P.slotsMinus);
  g.slots = { claim: n, canal: n, plant: n, care: n, reservoir: 1, weir: 1 };
  g.workersLeft = g.players.map(() => g.P.workers);
  if (g.P.orderMode === 'lowest') {
    // 米＋献上が少ない順（追い上げ）。同点は席順
    const worth = (i) => g.players[i].rice + g.players[i].offered;
    g.order = [...Array(g.N).keys()].sort((a, b) => worth(a) - worth(b) || a - b);
  } else g.order = [...Array(g.N).keys()].map((i) => (g.startPlayer + i) % g.N);
  g.turnIdx = 0;
}

export function currentPlayer(g) {
  if (g.over || g.stage === 'winter') return null;
  for (let t = 0; t < g.N; t++) {
    const pid = g.order[(g.turnIdx + t) % g.N];
    if (g.workersLeft[pid] > 0) return pid;
  }
  return null;
}

// ある節で水を取る田の順番：その節の田（区画順）→ 下流から水路で引いている田（上流側から）
function drawersAt(rv, q) {
  const out = [];
  rv.nodes[q].plots.forEach((pl, k) => { if (pl.owner !== null && pl.conn === q) out.push({ p: q, k, pl }); });
  for (let p = q + 1; p < 3; p++) rv.nodes[p].plots.forEach((pl, k) => { if (pl.owner !== null && pl.conn === q) out.push({ p, k, pl }); });
  return out;
}

// ===== 水の流れ（3行ルール）=====
// 1. 降水を川の本数で均等に分ける（余りは堰の持ち主へ、なければ消える）
// 2. 各川で上流の節から順に、その節で水を取る田が必要量まで取る
// 3. 余りは下流へ。末端の溜池に溜まる（溜池の持ち主は貯水を自分の不足に注げる）
export function flowSeason(g, s, rain, commit = true) {
  const G = commit ? g : clone(g);
  const R = G.N;
  const share = Math.floor(rain / R);
  const supply = Array(R).fill(share);
  let rem = rain - share * R;
  const needOf = (pl) => (pl.crop ? (VARIETIES[pl.crop.v].need[s] ?? 0) : 0);

  // 堰：余り＋1単位の移動（持ち主の需要が最大の川へ、最小の川から）
  if (G.weir !== null) {
    const w = G.weir;
    const ownNeed = G.rivers.map((rv) => rv.nodes.reduce((a, nd) => a + nd.plots.reduce((b, pl) => b + (pl.owner === w ? needOf(pl) : 0), 0), 0));
    let to = 0; ownNeed.forEach((v, i) => { if (v > ownNeed[to]) to = i; });
    supply[to] += rem; rem = 0;
    let from = -1;
    ownNeed.forEach((v, i) => { if (i !== to && supply[i] > 0 && (from === -1 || v < ownNeed[from])) from = i; });
    if (from !== -1 && ownNeed[to] > 0) { supply[from] -= 1; supply[to] += 1; }
  }

  const received = new Map(); // "r,p,k" -> {need, got}
  G.rivers.forEach((rv, r) => {
    let water = supply[r];
    const order = [];
    for (let q = 0; q < 3; q++) for (const d of drawersAt(rv, q)) {
      const need = needOf(d.pl), got = Math.min(need, water);
      water -= got;
      const rec = { need, got };
      received.set(`${r},${d.p},${d.k}`, rec);
      order.push({ ...d, rec });
    }
    const res = rv.reservoir;
    if (res) {
      for (const d of order) {
        if (res.stored <= 0) break;
        if (d.pl.owner !== res.owner) continue;
        const add = Math.min(d.rec.need - d.rec.got, res.stored);
        d.rec.got += add; res.stored -= add;
      }
      res.stored = Math.min(G.P.reservoirCap, res.stored + water);
    }
  });
  received.forEach((v, key) => {
    const [r, p, k] = key.split(',').map(Number);
    const pl = plotAt(G, r, p, k);
    if (pl.crop) pl.crop.deficit += v.need - v.got;
  });
  return { G, supply, received };
}

function cropYield(g, p, crop, s, typhoonMode) {
  let y = g.P.fertility[p] - crop.deficit + VARIETIES[crop.v].bonus + (crop.care || 0);
  if (crop.v === '晩稲' && s === 2) {
    if (typhoonMode === 'expected') y -= g.P.typhoonChance * g.P.typhoonPenalty;
    else if (typhoonMode === 'actual' && g.typhoon) y -= g.P.typhoonPenalty;
  }
  return Math.max(0, y);
}

function harvestSeason(g, s, typhoonMode, record) {
  const yields = g.players.map(() => 0);
  allPlots(g).forEach(({ p, pl }) => {
    if (!pl.crop || lastSeason(pl.crop.v) !== s) return;
    const y = cropYield(g, p, pl.crop, s, typhoonMode);
    yields[pl.owner] += y;
    if (record) {
      const st = g.stats || (g.stats = { yieldPos: [0, 0, 0], countPos: [0, 0, 0], deficitPos: [0, 0, 0], variety: {} });
      st.yieldPos[p] += y; st.countPos[p] += 1; st.deficitPos[p] += pl.crop.deficit;
      st.variety[pl.crop.v] = (st.variety[pl.crop.v] || 0) + 1;
    }
    pl.crop = null;
  });
  return yields;
}

// ===== 予測：今の盤面のまま、残りの季節を降水の期待値（または指定値）で回したときの各自の収量 =====
export function forecastYields(g, { rainOf = (s) => rainExpected(g, s) } = {}) {
  const G = clone(g);
  const total = G.players.map(() => 0);
  for (let s = G.season; s < 3; s++) {
    flowSeason(G, s, rainOf(s), true);
    harvestSeason(G, s, 'expected', false).forEach((v, i) => { total[i] += v; });
  }
  return total;
}

// ===== 行動 =====
export function legalActions(g, pid) {
  const P = g.P, me = g.players[pid], acts = [{ type: 'labor' }];
  const plots = allPlots(g);
  if (g.slots.claim > 0) plots.forEach(({ r, p, k, pl }) => {
    if (pl.owner === null && me.rice >= P.claimCost[p]) acts.push({ type: 'claim', r, p, k, cost: P.claimCost[p] });
  });
  if (g.slots.canal > 0) plots.forEach(({ r, p, k, pl }) => {
    if (pl.owner !== pid) return;
    for (let q = 0; q < pl.conn; q++) {
      const len = pl.conn - q, cost = P.canalCostPerLen * len;
      if (me.rice >= cost) acts.push({ type: 'canal', r, p, k, q, len, cost });
    }
  });
  if (g.slots.plant > 0 && g.season <= 1 && me.rice >= P.seedCost
    && plots.some(({ pl }) => pl.owner === pid && !pl.crop)) acts.push({ type: 'plant', picks: null });
  if (P.careEnabled && g.slots.care > 0
    && plots.some(({ pl }) => pl.owner === pid && pl.crop && !pl.crop.care)) acts.push({ type: 'care', picks: null });
  if (g.slots.reservoir > 0 && me.rice >= P.reservoirCost) g.rivers.forEach((rv, r) => {
    if (!rv.reservoir && rv.nodes.some((nd) => nd.plots.some((pl) => pl.owner === pid))) acts.push({ type: 'reservoir', r, cost: P.reservoirCost });
  });
  if (P.weirEnabled && g.slots.weir > 0 && g.weir === null && me.rice >= P.weirCost
    && g.rivers.some((rv) => rv.nodes[0].plots.some((pl) => pl.owner === pid))) acts.push({ type: 'weir', cost: P.weirCost });
  return acts;
}

// 植付の中身：空いた田に「今年の予測収量が最も増える」品種を最大2枚
export function bestPlanting(g, pid, maxFields = g.P.plantPerAction) {
  const P = g.P;
  const empties = allPlots(g).filter(({ pl }) => pl.owner === pid && !pl.crop);
  const G = clone(g);
  const picks = [];
  let base = forecastYields(G)[pid];
  for (let n = 0; n < maxFields; n++) {
    if (g.players[pid].rice < P.seedCost * (picks.length + 1)) break;
    let best = null;
    for (const x of empties) {
      if (picks.some((pk) => pk.r === x.r && pk.p === x.p && pk.k === x.k)) continue;
      for (const v of VARIETY_NAMES()) {
        if (firstSeason(v) < g.season) continue;
        const pl = plotAt(G, x.r, x.p, x.k);
        pl.crop = { v, deficit: 0 };
        const val = forecastYields(G)[pid] - base - P.seedCost;
        pl.crop = null;
        if (!best || val > best.val) best = { r: x.r, p: x.p, k: x.k, v, val };
      }
    }
    if (!best || best.val <= 0) break;
    plotAt(G, best.r, best.p, best.k).crop = { v: best.v, deficit: 0 };
    base += best.val + P.seedCost;
    picks.push(best);
  }
  return picks;
}

// 手入れの中身：今年収穫できる自分の田のうち、手入れ済みでないもの最大2枚（収量+1）
export function bestCare(g, pid, maxFields = g.P.carePerAction) {
  return allPlots(g)
    .filter(({ p, pl }) => pl.owner === pid && pl.crop && !pl.crop.care && cropYield(g, p, pl.crop, 2, 'expected') >= 0)
    .slice(0, maxFields).map(({ r, p, k }) => ({ r, p, k, val: 1 }));
}

export function applyAction(g, pid, a) {
  const P = g.P, me = g.players[pid];
  me.actions[a.type] = (me.actions[a.type] || 0) + 1;
  switch (a.type) {
    case 'labor': me.rice += 1; break;
    case 'claim': {
      const pl = plotAt(g, a.r, a.p, a.k);
      if (pl.owner !== null) throw new Error('claimed');
      me.rice -= P.claimCost[a.p]; pl.owner = pid; pl.conn = a.p;
      g.slots.claim -= 1; break;
    }
    case 'canal': {
      const pl = plotAt(g, a.r, a.p, a.k);
      me.rice -= a.cost; me.canalLen += pl.conn - a.q; pl.conn = a.q;
      g.slots.canal -= 1; break;
    }
    case 'plant': {
      const picks = a.picks || bestPlanting(g, pid);
      picks.forEach((pk) => { const pl = plotAt(g, pk.r, pk.p, pk.k); if (!pl.crop) { pl.crop = { v: pk.v, deficit: 0 }; me.rice -= P.seedCost; } });
      g.slots.plant -= 1; break;
    }
    case 'care': {
      const picks = a.picks || bestCare(g, pid);
      picks.forEach((pk) => { const pl = plotAt(g, pk.r, pk.p, pk.k); if (pl.crop) pl.crop.care = 1; });
      g.slots.care -= 1; break;
    }
    case 'reservoir': g.rivers[a.r].reservoir = { owner: pid, stored: 0 }; me.rice -= P.reservoirCost; g.slots.reservoir -= 1; break;
    case 'weir': g.weir = pid; me.rice -= P.weirCost; g.slots.weir -= 1; break;
    default: throw new Error('unknown action ' + a.type);
  }
  g.workersLeft[pid] -= 1;
  g.turnIdx = (g.order.indexOf(pid) + 1) % g.N;
  if (g.workersLeft.every((w) => w === 0)) endSeason(g);
}

// 配置がすべて終わったら：流れ → 収穫 → 季節を進める
function endSeason(g) {
  const s = g.season;
  const { received } = flowSeason(g, s, g.rain, true);
  g.lastFlow = { season: s, rain: g.rain, received };
  harvestSeason(g, s, 'actual', true).forEach((v, i) => { g.players[i].rice += v; g.players[i].harvested += v; });
  // 手番順の回し方（P.orderMode）：season=季節ごとに先手を1つずらす / year=年ごとにずらす / lowest=合計点の低い人から
  if ((g.P.orderMode || 'season') === 'season') g.startPlayer = (g.startPlayer + 1) % g.N;
  if (s < 2) { g.season += 1; beginSeason(g); return; }
  g.stage = 'winter';
}

// 冬の決算：維持費 → 献上（offerFn(pid) が献上量を返す）
export function runWinter(g, offerFn) {
  const P = g.P;
  g.players.forEach((pl, i) => {
    const due = upkeepDue(g, i), paid = Math.min(due, pl.rice);
    pl.rice -= paid; pl.debt += due - paid;
  });
  g.players.forEach((pl, i) => {
    let amt = Math.max(0, Math.min(pl.rice, Math.floor(offerFn(i))));
    if (P.offerCapPerYear && g.year < P.years) amt = Math.min(amt, P.offerCapPerYear);
    pl.rice -= amt; pl.offered += amt;
  });
  g.rivers.forEach((rv) => { if (rv.reservoir) rv.reservoir.stored = 0; });
  if (g.year >= P.years) { g.over = true; g.stage = 'over'; return; }
  g.year += 1; g.season = 0; g.stage = null;
  if (P.orderMode === 'year') g.startPlayer = (g.startPlayer + 1) % g.N;
  g.typhoon = g._rng() < P.typhoonChance;
  beginSeason(g);
}

// ===== 得点 =====
export function scoreOf(g, pid) {
  const P = g.P, L = P.landscape, me = g.players[pid];
  const fields = ownFields(g, pid).length;
  const reservoirs = g.rivers.filter((rv) => rv.reservoir && rv.reservoir.owner === pid).length;
  const landscape = fields * L.field + me.canalLen * L.canalLen + reservoirs * L.reservoir + (g.weir === pid ? L.weir : 0);
  const leftover = Math.floor(me.rice / P.leftoverRate);
  return { offered: me.offered, landscape, leftover, debt: me.debt, total: me.offered + landscape + leftover - me.debt, fields, reservoirs, canalLen: me.canalLen, weir: g.weir === pid };
}
