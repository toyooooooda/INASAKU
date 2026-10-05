// ===== 豊穣の水田 v0.2（水系リデザイン）— 純ロジックエンジン =====
// React / boardgame.io 非依存。シミュレーションと将来のUIの両方から使う。ルールの要約は sim/README.md。
//
// v0 → v0.1：取水口の所有を廃止（死に田の解消）、手入れを追加、植付の上限を緩和
// v0.1 → v0.2：
// - 米は通貨に専念。点になるのは「献上」と「建設」のときだけ（その場で点数トラックに加算）
// - 献上レートは年ごとに下がる（3俵あたり 3,3,2,2,1 点）→ 序盤は「広げるか、点にするか」
// - 建設した部品に点が印刷されている（田1・水路は長さ1につき1・溜池3・堰3）
// - 札の市場：3枚表向き。費用（2＋持っている枚数）で1枚取り、効果は永続。同じ系統3枚で+5点

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
  careEnabled: true,             // 手入れ（植わった田を今年だけ収量+1）
  seedCost: 1,
  plantPerAction: 4,             // 植付1回で植えられる田の数（plantPhase=false のときだけ使う）
  plantPhase: true,              // 植付は配置せず、春・夏の頭に全員が同時に行う（v0.2）
  carePerAction: 3,              // 手入れ1回で手入れできる田の数
  rainBase: [4, 6, 4],           // ×人数（春・夏・秋）
  rainSpread: 1,                 // ±人数×この値
  typhoonChance: 0.3,
  typhoonPenalty: 3,             // 晩稲のみ
  printed: { field: 1, canalLen: 1, reservoir: 3, weir: 3 }, // 部品に印刷された点
  offerRate: [3, 3, 2, 2, 1],    // 献上：3俵あたりの点（年ごと）
  debtPenalty: 1,                // 維持費が払えない1俵ごとに−1点
  cardsEnabled: true,
  cardBaseCost: 2,               // 札の費用 = これ + 持っている枚数
  cardCopies: 2,                 // 各札の枚数
  marketSize: 3,
  setBonus: 5,                   // 同じ系統を3枚そろえたら
  slotsMinus: 1,                 // 開墾・水路・植付・手入れ・札の枠数 = 人数 − これ
  orderMode: 'lowest',           // season / year / lowest（点数の低い人から）
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

// ===== 札（永続効果・1行で書けること）=====
export const CARDS = [
  { id: 'canal',     name: '渡来の技術者',   tag: '水',   text: '水路の費用が長さ1あたり1俵安い（最低1）' },
  { id: 'temple',    name: '寺社の荘園',     tag: '水',   text: '上流の田の堤維持費がかからない' },
  { id: 'pond',      name: '溜池造りの名人', tag: '水',   text: '溜池が2俵安く、貯水の上限+2' },
  { id: 'irrigator', name: '水口の番人',     tag: '水',   text: '自分の中稲は夏の必要水量−1' },
  { id: 'kokushi',   name: '国司の縁者',     tag: '時',   text: '献上を前の年のレートで換算できる' },
  { id: 'wase',      name: '早稲の種籾',     tag: '時',   text: '自分の早稲の収量+1' },
  { id: 'uneme',     name: '采女の家',       tag: '時',   text: '1・2年目の献上は3俵ごとに+1点' },
  { id: 'pioneer',   name: '墾田の民',       tag: '景色', text: '開墾の費用−1俵' },
  { id: 'farmer',    name: '篤農家',         tag: '景色', text: '手入れで対象にできる田+2枚' },
  { id: 'nanushi',   name: '名主',           tag: '景色', text: '開墾するたび+1点' },
];
export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const hasCard = (g, pid, id) => g.players[pid].cards.includes(id);

// 札による「水・収量」の修正（エンジンと高速評価で共通）
export function modsOf(g) {
  return g.players.map((p) => ({ irrigator: p.cards.includes('irrigator'), wase: p.cards.includes('wase'), pond: p.cards.includes('pond') }));
}
export function needWith(v, s, mod) {
  const n = VARIETIES[v].need[s];
  if (n === null || n === undefined) return 0;
  if (mod && mod.irrigator && v === '中稲' && s === 1) return Math.max(1, n - 1);
  return n;
}
export const bonusWith = (v, mod) => VARIETIES[v].bonus + (mod && mod.wase && v === '早稲' ? 1 : 0);
export const resCapWith = (P, mod) => P.reservoirCap + (mod && mod.pond ? 2 : 0);

// ---- 乱数（シード付き・再現可能）----
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
function shuffle(rng, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// _rng（関数）は複製できないので外す。P は読み取り専用なので参照を共有する
export const clone = (x) => { const { _rng, P, ...rest } = x; const c = structuredClone(rest); c.P = P; return c; };

// ===== 初期化 =====
export function createGame(numPlayers, seed = 1, overrides = {}) {
  const P = { ...DEFAULT_PARAMS, ...overrides, printed: { ...DEFAULT_PARAMS.printed, ...(overrides.printed || {}) } };
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
    players.push({
      id: i, rice: P.startRice, points: 0, pts: { offer: 0, build: 0, set: 0, debt: 0 },
      canalLen: 0, harvested: 0, offeredRice: 0, cards: [], sets: [], actions: {},
    });
    rivers[(i + (P.riverOffset || 0)) % numPlayers].nodes[2].plots.slice(0, 2).forEach((pl) => { pl.owner = i; pl.conn = 2; }); // 出発点：自分の川の下流に田2枚（riverOffset は検証用）
  }
  const deck = P.cardsEnabled ? shuffle(rng, CARDS.flatMap((c) => Array(P.cardCopies).fill(c.id))) : [];
  const g = {
    P, N: numPlayers, year: 1, season: 0, startPlayer: 0,
    rivers, weir: null, players, deck, market: [],
    typhoon: rng() < P.typhoonChance,
    rain: null, forecast: null, slots: null, over: false, stage: null,
  };
  g._rng = rng;
  refillMarket(g);
  beginSeason(g);
  return g;
}

function refillMarket(g) {
  while (g.market.length < g.P.marketSize && g.deck.length) g.market.push(g.deck.pop());
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
  const up = hasCard(g, pid, 'temple') ? 0 : ownFields(g, pid).filter((x) => x.p === 0).length;
  return g.P.workers * g.P.workerUpkeep + up * g.P.upstreamUpkeep;
}
// 費用（札の割引込み）
export const claimCostOf = (g, pid, p) => Math.max(0, g.P.claimCost[p] - (hasCard(g, pid, 'pioneer') ? 1 : 0));
export const canalCostOf = (g, pid, len) => len * Math.max(1, g.P.canalCostPerLen - (hasCard(g, pid, 'canal') ? 1 : 0));
export const reservoirCostOf = (g, pid) => Math.max(0, g.P.reservoirCost - (hasCard(g, pid, 'pond') ? 2 : 0));
export const cardCostOf = (g, pid) => g.P.cardBaseCost + g.players[pid].cards.length;
// 献上：3俵あたりの点（札の効果込み）
export function offerRateOf(g, pid, year = g.year) {
  const R = g.P.offerRate;
  let r = R[Math.min(year, R.length) - 1];
  if (hasCard(g, pid, 'kokushi') && year >= 2) r = Math.max(r, R[Math.min(year - 1, R.length) - 1]);
  if (hasCard(g, pid, 'uneme') && year <= 2) r += 1;
  return r;
}

function addPoints(g, pid, kind, n) { const me = g.players[pid]; me.points += n; me.pts[kind] += n; }

function beginSeason(g) {
  const [lo, hi] = rainRange(g, g.season);
  g.forecast = [lo, hi];                 // 占い（公開）
  g.rain = randInt(g._rng, lo, hi);      // 実際の値（流れの計算まで非公開）
  const n = Math.max(1, g.N - g.P.slotsMinus);
  g.slots = { claim: n, canal: n, plant: n, care: n, buy: n, reservoir: 1, weir: 1 };
  g.workersLeft = g.players.map(() => g.P.workers);
  if (g.P.orderMode === 'lowest') {
    // 点数の低い人から（同点は 米の少ない順 → 席順）。追い上げの手番順
    g.order = [...Array(g.N).keys()].sort((a, b) => g.players[a].points - g.players[b].points || g.players[a].rice - g.players[b].rice || a - b);
  } else g.order = [...Array(g.N).keys()].map((i) => (g.startPlayer + i) % g.N);
  g.turnIdx = 0;
  // 田植えの段階：春・夏の頭に全員が同時に植える（手番順の運で植え損ねる問題の対策）
  g.stage = (g.P.plantPhase && g.season <= 1) ? 'plant' : null;
}

// 田植えの段階：picksOf(pid) が植える田と品種を返す。全員ぶん済んだら配置へ
export function runPlantPhase(g, picksOf) {
  if (g.stage !== 'plant') return;
  for (const pid of g.order) {
    const me = g.players[pid];
    for (const pk of picksOf(pid)) {
      const pl = plotAt(g, pk.r, pk.p, pk.k);
      if (pl.owner !== pid || pl.crop || me.rice < g.P.seedCost || firstSeason(pk.v) < g.season) continue;
      pl.crop = { v: pk.v, deficit: 0 }; me.rice -= g.P.seedCost;
    }
  }
  g.stage = null;
}

export function currentPlayer(g) {
  if (g.over || g.stage === 'winter' || g.stage === 'plant') return null;
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
  const R = G.N, mods = modsOf(G);
  const share = Math.floor(rain / R);
  const supply = Array(R).fill(share);
  let rem = rain - share * R;
  const needOf = (pl) => (pl.crop ? needWith(pl.crop.v, s, mods[pl.owner]) : 0);

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
      res.stored = Math.min(resCapWith(G.P, mods[res.owner]), res.stored + water);
    }
  });
  received.forEach((v, key) => {
    const [r, p, k] = key.split(',').map(Number);
    const pl = plotAt(G, r, p, k);
    if (pl.crop) pl.crop.deficit += v.need - v.got;
  });
  return { G, supply, received };
}

function cropYield(g, p, crop, s, typhoonMode, mod) {
  let y = g.P.fertility[p] - crop.deficit + bonusWith(crop.v, mod) + (crop.care || 0);
  if (crop.v === '晩稲' && s === 2) {
    if (typhoonMode === 'expected') y -= g.P.typhoonChance * g.P.typhoonPenalty;
    else if (typhoonMode === 'actual' && g.typhoon) y -= g.P.typhoonPenalty;
  }
  return Math.max(0, y);
}

function harvestSeason(g, s, typhoonMode, record) {
  const yields = g.players.map(() => 0);
  const mods = modsOf(g);
  allPlots(g).forEach(({ p, pl }) => {
    if (!pl.crop || lastSeason(pl.crop.v) !== s) return;
    const y = cropYield(g, p, pl.crop, s, typhoonMode, mods[pl.owner]);
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
    const cost = claimCostOf(g, pid, p);
    if (pl.owner === null && me.rice >= cost) acts.push({ type: 'claim', r, p, k, cost });
  });
  if (g.slots.canal > 0) plots.forEach(({ r, p, k, pl }) => {
    if (pl.owner !== pid) return;
    for (let q = 0; q < pl.conn; q++) {
      const len = pl.conn - q, cost = canalCostOf(g, pid, len);
      if (me.rice >= cost) acts.push({ type: 'canal', r, p, k, q, len, cost });
    }
  });
  if (!P.plantPhase && g.slots.plant > 0 && g.season <= 1 && me.rice >= P.seedCost
    && plots.some(({ pl }) => pl.owner === pid && !pl.crop)) acts.push({ type: 'plant', picks: null });
  if (P.careEnabled && g.slots.care > 0
    && plots.some(({ pl }) => pl.owner === pid && pl.crop && !pl.crop.care)) acts.push({ type: 'care', picks: null });
  if (P.cardsEnabled && g.slots.buy > 0 && me.rice >= cardCostOf(g, pid)) {
    g.market.forEach((id, idx) => { if (!me.cards.includes(id)) acts.push({ type: 'buy', idx, id, cost: cardCostOf(g, pid) }); });
  }
  const resCost = reservoirCostOf(g, pid);
  if (g.slots.reservoir > 0 && me.rice >= resCost) g.rivers.forEach((rv, r) => {
    if (!rv.reservoir && rv.nodes.some((nd) => nd.plots.some((pl) => pl.owner === pid))) acts.push({ type: 'reservoir', r, cost: resCost });
  });
  if (P.weirEnabled && g.slots.weir > 0 && g.weir === null && me.rice >= P.weirCost
    && g.rivers.some((rv) => rv.nodes[0].plots.some((pl) => pl.owner === pid))) acts.push({ type: 'weir', cost: P.weirCost });
  return acts;
}

// 植付の中身：空いた田に「今年の予測収量が最も増える」品種を最大 plantPerAction 枚
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

// 手入れの中身：今年収穫できる自分の田のうち、手入れ済みでないもの（収量+1）
export function bestCare(g, pid, maxFields = g.P.carePerAction + (hasCard(g, pid, 'farmer') ? 2 : 0)) {
  return allPlots(g)
    .filter(({ pl }) => pl.owner === pid && pl.crop && !pl.crop.care)
    .slice(0, maxFields).map(({ r, p, k }) => ({ r, p, k, val: 1 }));
}

// 同じ系統3枚で+5点（系統ごとに1回）
function checkSets(g, pid) {
  const me = g.players[pid];
  const count = {};
  me.cards.forEach((id) => { const t = CARD_BY_ID[id].tag; count[t] = (count[t] || 0) + 1; });
  Object.entries(count).forEach(([t, n]) => { if (n >= 3 && !me.sets.includes(t)) { me.sets.push(t); addPoints(g, pid, 'set', g.P.setBonus); } });
}

export function applyAction(g, pid, a) {
  const P = g.P, me = g.players[pid], PR = P.printed;
  me.actions[a.type] = (me.actions[a.type] || 0) + 1;
  switch (a.type) {
    case 'labor': me.rice += 1; break;
    case 'claim': {
      const pl = plotAt(g, a.r, a.p, a.k);
      if (pl.owner !== null) throw new Error('claimed');
      me.rice -= claimCostOf(g, pid, a.p); pl.owner = pid; pl.conn = a.p;
      addPoints(g, pid, 'build', PR.field + (hasCard(g, pid, 'nanushi') ? 1 : 0));
      g.slots.claim -= 1; break;
    }
    case 'canal': {
      const pl = plotAt(g, a.r, a.p, a.k);
      const len = pl.conn - a.q;
      me.rice -= canalCostOf(g, pid, len); me.canalLen += len; pl.conn = a.q;
      addPoints(g, pid, 'build', PR.canalLen * len);
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
    case 'buy': {
      const id = g.market[a.idx];
      if (id !== a.id || me.cards.includes(id)) throw new Error('bad buy');
      me.rice -= cardCostOf(g, pid);
      me.cards.push(id); g.market.splice(a.idx, 1); refillMarket(g);
      checkSets(g, pid);
      g.slots.buy -= 1; break;
    }
    case 'reservoir': me.rice -= reservoirCostOf(g, pid); g.rivers[a.r].reservoir = { owner: pid, stored: 0 }; addPoints(g, pid, 'build', PR.reservoir); g.slots.reservoir -= 1; break;
    case 'weir': g.weir = pid; me.rice -= P.weirCost; addPoints(g, pid, 'build', PR.weir); g.slots.weir -= 1; break;
    default: throw new Error('unknown action ' + a.type);
  }
  if (me.rice < 0) throw new Error('negative rice');
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
  if ((g.P.orderMode || 'season') === 'season') g.startPlayer = (g.startPlayer + 1) % g.N;
  if (s < 2) { g.season += 1; beginSeason(g); return; }
  g.stage = 'winter';
}

// 冬の決算：維持費 → 献上（offerFn(pid) が献上したい俵数を返す。3俵単位に切り下げ）
export function runWinter(g, offerFn) {
  const P = g.P;
  g.players.forEach((pl, i) => {
    const due = upkeepDue(g, i), paid = Math.min(due, pl.rice);
    pl.rice -= paid;
    if (due > paid) addPoints(g, i, 'debt', -(due - paid) * P.debtPenalty);
  });
  g.players.forEach((pl, i) => {
    const amt = Math.floor(Math.max(0, Math.min(pl.rice, Math.floor(offerFn(i)))) / 3) * 3;
    if (!amt) return;
    pl.rice -= amt; pl.offeredRice += amt;
    addPoints(g, i, 'offer', (amt / 3) * offerRateOf(g, i));
    (pl.offerYears || (pl.offerYears = [])).push(g.year);
  });
  g.rivers.forEach((rv) => { if (rv.reservoir) rv.reservoir.stored = 0; });
  if (g.year >= P.years) { g.over = true; g.stage = 'over'; return; }
  g.year += 1; g.season = 0; g.stage = null;
  if (P.orderMode === 'year') g.startPlayer = (g.startPlayer + 1) % g.N;
  g.typhoon = g._rng() < P.typhoonChance;
  beginSeason(g);
}

// ===== 得点（点数トラックそのもの。終了時の数え直しはない）=====
export function scoreOf(g, pid) {
  const me = g.players[pid];
  const fields = ownFields(g, pid).length;
  const reservoirs = g.rivers.filter((rv) => rv.reservoir && rv.reservoir.owner === pid).length;
  return { total: me.points, ...me.pts, fields, reservoirs, canalLen: me.canalLen, weir: g.weir === pid, cards: [...me.cards], offeredRice: me.offeredRice };
}
