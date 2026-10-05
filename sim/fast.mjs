// ===== 高速評価用のコンパクト盤面 =====
// ボットは1手ごとに数百通りの「もしこうしたら」を評価するので、
// 盤面を軽い配列表現に落として1年分の水の流れを高速に回す。
// 計算規則は engine.mjs の flowSeason / 収穫と一致させること（test.mjs で突き合わせ）。
import { VARIETIES, VARIETY_NAMES, lastSeason } from './engine.mjs';

export function compact(g) {
  return {
    N: g.N, P: g.P, weir: g.weir,
    rivers: g.rivers.map((rv) => ({
      res: rv.reservoir ? rv.reservoir.owner : null,
      plots: rv.nodes.map((nd, p) => nd.plots.map((pl, k) => ({ owner: pl.owner, p, k, conn: pl.conn, v: null }))),
    })),
  };
}
export function cloneCompact(cb) {
  return { N: cb.N, P: cb.P, weir: cb.weir, rivers: cb.rivers.map((rv) => ({ res: rv.res, plots: rv.plots.map((row) => row.map((f) => ({ ...f }))) })) };
}

function drawersAt(rv, q) {
  const out = [];
  for (const f of rv.plots[q]) if (f.owner !== null && f.conn === q) out.push(f);
  for (let p = q + 1; p < 3; p++) for (const f of rv.plots[p]) if (f.owner !== null && f.conn === q) out.push(f);
  return out;
}

// 1年分（春〜秋）を回して各自の収量を返す。各田の品種は f.v（null=植えない）
export function evalYear(cb, { typhoonExpected = true, rain = null } = {}) {
  const P = cb.P, N = cb.N;
  const yields = new Array(N).fill(0);
  const deficit = cb.rivers.map((rv) => rv.plots.map((row) => row.map(() => 0)));
  const stored = cb.rivers.map(() => 0);
  for (let s = 0; s < 3; s++) {
    const total = rain ? rain[s] : P.rainBase[s] * N;
    const share = Math.floor(total / N);
    const supply = new Array(N).fill(share);
    let rem = total - share * N;
    const needOf = (f) => (f.v ? (VARIETIES[f.v].need[s] ?? 0) : 0);
    if (cb.weir !== null) {
      const w = cb.weir;
      const ownNeed = cb.rivers.map((rv) => rv.plots.reduce((a, row) => a + row.reduce((b, f) => b + (f.owner === w ? needOf(f) : 0), 0), 0));
      let to = 0; ownNeed.forEach((v, i) => { if (v > ownNeed[to]) to = i; });
      supply[to] += rem; rem = 0;
      let from = -1;
      ownNeed.forEach((v, i) => { if (i !== to && supply[i] > 0 && (from === -1 || v < ownNeed[from])) from = i; });
      if (from !== -1 && ownNeed[to] > 0) { supply[from] -= 1; supply[to] += 1; }
    }
    cb.rivers.forEach((rv, r) => {
      let water = supply[r];
      const order = [], lacks = [];
      for (let q = 0; q < 3; q++) for (const f of drawersAt(rv, q)) {
        const need = needOf(f), got = Math.min(need, water);
        water -= got; deficit[r][f.p][f.k] += need - got;
        order.push(f); lacks.push(need - got);
      }
      if (rv.res !== null) {
        order.forEach((f, i) => {
          if (stored[r] <= 0 || f.owner !== rv.res) return;
          const add = Math.min(lacks[i], stored[r]);
          stored[r] -= add; deficit[r][f.p][f.k] -= add;
        });
        stored[r] = Math.min(P.reservoirCap, stored[r] + water);
      }
    });
    cb.rivers.forEach((rv, r) => rv.plots.forEach((row, p) => row.forEach((f) => {
      if (!f.v || f.owner === null || lastSeason(f.v) !== s) return;
      let y = P.fertility[p] - deficit[r][p][f.k] + VARIETIES[f.v].bonus;
      if (f.v === '晩稲' && s === 2 && typhoonExpected) y -= P.typhoonChance * P.typhoonPenalty;
      yields[f.owner] += Math.max(0, y);
    })));
  }
  return yields;
}

// 典型的な1年：全員の田を植える。他人は中稲、pid は貪欲に品種を最適化。戻り値は pid の「収量 − 種代」
export function typicalNet(cb, pid, { others = '中稲' } = {}) {
  const P = cb.P, mine = [];
  cb.rivers.forEach((rv) => rv.plots.forEach((row) => row.forEach((f) => {
    f.v = null;
    if (f.owner === null) return;
    if (f.owner === pid) mine.push(f); else f.v = others;
  })));
  if (!mine.length) return 0;
  mine.forEach((f) => { f.v = '中稲'; });
  const names = VARIETY_NAMES();
  for (let pass = 0; pass < 2; pass++) for (const f of mine) {
    let best = f.v, bestY = -Infinity;
    for (const v of names) { f.v = v; const y = evalYear(cb)[pid]; if (y > bestY + 1e-9) { bestY = y; best = v; } }
    f.v = best;
  }
  return evalYear(cb)[pid] - P.seedCost * mine.length;
}

// 構造物の効果だけを適用（費用・枠は bots 側で扱う）
export function applyCompact(cb, pid, a) {
  const c = cloneCompact(cb);
  const rv = c.rivers[a.r];
  if (a.type === 'claim') { const f = rv.plots[a.p][a.k]; f.owner = pid; f.conn = a.p; }
  else if (a.type === 'canal') rv.plots[a.p][a.k].conn = a.q;
  else if (a.type === 'reservoir') rv.res = pid;
  else if (a.type === 'weir') c.weir = pid;
  return c;
}

export const upkeepFields = (cb, pid) => cb.rivers.reduce((a, rv) => a + rv.plots[0].filter((f) => f.owner === pid).length, 0);
export function landscapeOf(cb, pid, canalLen) {
  const L = cb.P.landscape;
  let fields = 0, res = 0;
  cb.rivers.forEach((rv) => { rv.plots.forEach((row) => row.forEach((f) => { if (f.owner === pid) fields++; })); if (rv.res === pid) res++; });
  return fields * L.field + canalLen * L.canalLen + res * L.reservoir + (cb.weir === pid ? L.weir : 0);
}
