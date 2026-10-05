// ===== ボット =====
// 全ボット共通：各行動の価値を「典型的な1年の純収量の増分 × 残り年数 + 景色点 − 費用 − 維持費」で見積もり、
// 2手先（その行動のあとに水路を1本足した形）まで読む。
// 勝ち筋ごとのボットは、その筋の行動に倍率をかけて方針を寄せる。
import { legalActions, bestPlanting, bestCare, upkeepDue, ownFields } from './engine.mjs';
import { compact, typicalNet, applyCompact, upkeepFields, landscapeOf } from './fast.mjs';

export const ARCHETYPES = {
  greedy: { name: '貪欲', bias: () => 1, keep: 4 },
  upstream: {
    name: '上流の水利', keep: 5,
    bias: (a) => {
      if (a.type === 'claim') return a.p === 0 ? 1.8 : a.p === 1 ? 0.8 : 0.5;
      if (a.type === 'weir') return 2.0;
      if (a.type === 'canal') return 0.6;
      if (a.type === 'reservoir') return 0.3;
      return 1;
    },
  },
  downstream: {
    name: '下流の肥沃', keep: 4,
    bias: (a) => {
      if (a.type === 'claim') return a.p === 2 ? 1.8 : a.p === 1 ? 1.3 : 0.3;
      if (a.type === 'reservoir') return 2.0;
      if (a.type === 'weir') return 0.3;
      if (a.type === 'canal') return 0.5;
      return 1;
    },
  },
  network: {
    name: '水路網', keep: 6,
    bias: (a) => {
      if (a.type === 'canal') return 2.0;
      if (a.type === 'claim') return a.p === 2 ? 1.4 : a.p === 1 ? 1.0 : 0.5;
      if (a.type === 'reservoir') return 0.8;
      return 1;
    },
  },
};

function yearsLeft(g) {
  return (g.P.years - g.year) + (g.season === 0 ? 0.8 : g.season === 1 ? 0.4 : 0);
}

// その行動のあとに打てる追加1手（同じ川で、自分の田から上流へ水路）
function followUps(cb, pid, a, rice) {
  const P = cb.P, out = [];
  const rv = cb.rivers[a.r];
  if (!rv) return out;
  for (let p = 1; p < 3; p++) rv.plots[p].forEach((f, k) => {
    if (f.owner !== pid) return;
    for (let q = 0; q < f.conn; q++) {
      const len = f.conn - q, cost = P.canalCostPerLen * len;
      if (cost <= rice) out.push({ type: 'canal', r: a.r, p, k, q, len, cost });
    }
  });
  return out;
}

export function decide(g, pid, archKey, rng) {
  const arch = ARCHETYPES[archKey];
  const P = g.P, me = g.players[pid];
  const acts = legalActions(g, pid);
  const cb0 = compact(g);
  const base = typicalNet(cb0, pid);
  const yl = yearsLeft(g);
  const upYears = P.years - g.year + 1;
  const land0 = landscapeOf(cb0, pid, me.canalLen);
  const up0 = upkeepFields(cb0, pid);
  const reserve = g.season === 2 ? upkeepDue(g, pid)
    : Math.min(4, ownFields(g, pid).filter((x) => !x.pl.crop).length) * P.seedCost;

  const structValue = (cb1, extraLen, cost) => {
    const net = typicalNet(cb1, pid);
    const dLand = landscapeOf(cb1, pid, me.canalLen + extraLen) - land0;
    const dUp = (upkeepFields(cb1, pid) - up0) * P.upstreamUpkeep;
    return (net - base) * yl + dLand - cost - dUp * upYears;
  };

  let best = null;
  for (const a of acts) {
    let v;
    if (a.type === 'labor') v = 1;
    else if (a.type === 'plant') {
      a.picks = bestPlanting(g, pid);
      if (!a.picks.length) continue;
      v = a.picks.reduce((s, pk) => s + pk.val, 0);
    } else if (a.type === 'care') {
      a.picks = bestCare(g, pid);
      if (!a.picks.length) continue;
      v = a.picks.length;
    } else {
      const len1 = a.type === 'canal' ? a.len : 0;
      const cb1 = applyCompact(cb0, pid, a);
      v = structValue(cb1, len1, a.cost);
      if (a.type === 'claim') for (const b of followUps(cb1, pid, a, me.rice - a.cost)) {
        const v2 = structValue(applyCompact(cb1, pid, b), len1 + b.len, a.cost + b.cost) - 1;
        if (0.8 * v2 > v) v = 0.8 * v2;
      }
      const after = me.rice - a.cost;
      if (after < reserve) v -= (reserve - after) * 1.5;
    }
    if (v > 0) v *= arch.bias(a);
    v *= 1 + (rng() - 0.5) * (g.P.botNoise ?? 0.2);
    if (!best || v > best.v) best = { a, v };
  }
  return best.a;
}

// 冬の献上量。上限がなければ最終年まで溜めるのが合理的（v0 の献上には時期の意味がない）。
// P.offerCapPerYear があれば、来年の分（keep）を残して上限まで出す。
export function offerAmount(g, pid, archKey) {
  const me = g.players[pid];
  if (g.year >= g.P.years) return me.rice;
  if (!g.P.offerCapPerYear) return 0;
  return Math.max(0, Math.min(g.P.offerCapPerYear, me.rice - ARCHETYPES[archKey].keep));
}
