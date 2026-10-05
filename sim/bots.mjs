// ===== ボット（v0.2）=====
// 米は点ではないので、「米1俵＝何点か」をそのボットが献上する予定の年のレートで換算して比べる。
//   行動の価値（点） = 収量の増分×残り年数×λ(将来) − 費用×λ(今) + 建設で入る点
// 方針は { arch: 勝ち筋, k: 献上を始める年 } の組。k より前の年は献上せず、米をすべて投資に回す。
import { legalActions, bestPlanting, bestCare, upkeepDue, ownFields, offerRateOf, hasCard, CARD_BY_ID } from './engine.mjs';
import { compact, cloneCompact, typicalNet, applyCompact, upkeepFields, buildPoints } from './fast.mjs';

export const ARCHETYPES = {
  greedy: { name: '貪欲', k: 3, bias: () => 1 },
  upstream: {
    name: '上流の水利', k: 2,
    bias: (a) => {
      if (a.type === 'claim') return a.p === 0 ? 1.8 : a.p === 1 ? 0.8 : 0.5;
      if (a.type === 'weir') return 2.0;
      if (a.type === 'canal') return 0.6;
      if (a.type === 'reservoir') return 0.3;
      return 1;
    },
  },
  downstream: {
    name: '下流の肥沃', k: 3,
    bias: (a) => {
      if (a.type === 'claim') return a.p === 2 ? 1.8 : a.p === 1 ? 1.3 : 0.3;
      if (a.type === 'reservoir') return 2.0;
      if (a.type === 'weir') return 0.3;
      if (a.type === 'canal') return 0.5;
      return 1;
    },
  },
  network: {
    name: '水路網', k: 4,
    bias: (a) => {
      if (a.type === 'canal') return 2.0;
      if (a.type === 'claim') return a.p === 2 ? 1.4 : a.p === 1 ? 1.0 : 0.5;
      if (a.type === 'reservoir') return 0.8;
      return 1;
    },
  },
  cards: {
    name: '札の道', k: 3,
    bias: (a) => (a.type === 'buy' ? 2.2 : a.type === 'claim' ? 0.8 : 1),
  },
};

export const strat = (arch, k) => ({ arch, k: k ?? ARCHETYPES[arch].k });

// 米1俵の価値（点）：その年に持っている米は max(年, k) の年に献上する前提
const lam = (g, pid, s, year) => offerRateOf(g, pid, Math.min(g.P.years, Math.max(year, s.k))) / 3;
function lamFuture(g, pid, s) {
  let t = 0, n = 0;
  for (let y = g.year + (g.season === 2 ? 1 : 0); y <= g.P.years; y++) { t += lam(g, pid, s, y); n++; }
  return n ? t / n : 0;
}
function yearsLeft(g) {
  return (g.P.years - g.year) + (g.season === 0 ? 0.8 : g.season === 1 ? 0.4 : 0);
}

function followUps(cb, pid, a, rice, canalCost) {
  const out = [];
  const rv = cb.rivers[a.r];
  if (!rv) return out;
  for (let p = 1; p < 3; p++) rv.plots[p].forEach((f, k) => {
    if (f.owner !== pid) return;
    for (let q = 0; q < f.conn; q++) {
      const len = f.conn - q, cost = canalCost(len);
      if (cost <= rice) out.push({ type: 'canal', r: a.r, p, k, q, len, cost });
    }
  });
  return out;
}

// 札の価値の見積もり（点）。効果が水・収量に効くものは実際に1年回して測る
function cardValue(g, pid, s, id, ctx) {
  const { cb0, base, yl, lNow, lFut } = ctx;
  const me = g.players[pid];
  const futureYears = g.P.years - g.year + (g.season < 2 ? 1 : 0);
  let v = 0;
  const measure = (key) => {
    const cb = cloneCompact(cb0); cb.mods[pid] = { ...cb.mods[pid], [key]: true };
    return (typicalNet(cb, pid) - base) * yl * lFut;
  };
  switch (id) {
    case 'irrigator': case 'wase': case 'pond': v = measure(id); if (id === 'pond') v += 2 * lNow * (futureYears >= 2 ? 1 : 0); break;
    case 'canal': v = (s.arch === 'network' ? 4 : 1.5) * lNow * Math.min(1, yl / 3); break;
    case 'temple': v = (upkeepFields(cb0, pid) + (s.arch === 'upstream' ? 2 : 0.5)) * Math.max(0, g.P.years - g.year + 1) * lNow; break;
    case 'pioneer': v = (s.arch === 'upstream' || s.arch === 'downstream' ? 3 : 2) * Math.min(1, yl / 4) * lNow; break;
    case 'nanushi': v = (s.arch === 'upstream' || s.arch === 'downstream' ? 3 : 2) * Math.min(1, yl / 4); break;
    case 'farmer': v = ownFields(g, pid).length >= 4 ? 2 * 1.5 * futureYears * lFut : 0.5 * futureYears * lFut; break;
    case 'kokushi': case 'uneme': {
      // 献上予定の年に、どれだけレートが上がるか × 1年の献上量の見込み（6俵）
      for (let y = Math.max(g.year, s.k); y <= g.P.years; y++) {
        const R = g.P.offerRate[y - 1];
        const gain = id === 'kokushi' ? (y >= 2 ? Math.max(0, g.P.offerRate[y - 2] - R) : 0) : (y <= 2 ? 1 : 0);
        v += gain * 2;
      }
      break;
    }
    default: break;
  }
  // 系統そろえ（3枚で+5点）への近さ
  const tag = CARD_BY_ID[id].tag;
  const have = me.cards.filter((c) => CARD_BY_ID[c].tag === tag).length;
  if (!me.sets.includes(tag)) v += have >= 2 ? g.P.setBonus : have === 1 ? 1.5 : 0.5;
  return v;
}

export function decide(g, pid, s, rng) {
  const arch = ARCHETYPES[s.arch];
  const P = g.P, me = g.players[pid];
  const acts = legalActions(g, pid);
  const cb0 = compact(g);
  const base = typicalNet(cb0, pid);
  const yl = yearsLeft(g);
  const upYears = P.years - g.year + 1;
  const lNow = lam(g, pid, s, g.year), lFut = lamFuture(g, pid, s);
  const up0 = upkeepFields(cb0, pid);
  const temple = hasCard(g, pid, 'temple');
  const nanushi = hasCard(g, pid, 'nanushi');
  const canalCost = (len) => len * Math.max(1, P.canalCostPerLen - (hasCard(g, pid, 'canal') ? 1 : 0));
  const reserve = g.season === 2 ? upkeepDue(g, pid)
    : Math.min(4, ownFields(g, pid).filter((x) => !x.pl.crop).length) * P.seedCost;
  const ctx = { cb0, base, yl, lNow, lFut };

  const structValue = (cb1, cost, pts) => {
    const net = typicalNet(cb1, pid);
    const dUp = temple ? 0 : (upkeepFields(cb1, pid) - up0) * P.upstreamUpkeep;
    return (net - base) * yl * lFut - (cost + dUp * upYears) * lNow + pts;
  };

  let best = null;
  for (const a of acts) {
    let v;
    if (a.type === 'labor') v = lNow;
    else if (a.type === 'plant') {
      a.picks = bestPlanting(g, pid);
      if (!a.picks.length) continue;
      v = a.picks.reduce((t, pk) => t + pk.val, 0) * lNow;
    } else if (a.type === 'care') {
      a.picks = bestCare(g, pid);
      if (!a.picks.length) continue;
      v = a.picks.length * lNow;
    } else if (a.type === 'buy') {
      v = cardValue(g, pid, s, a.id, ctx) - a.cost * lNow;
    } else {
      const cb1 = applyCompact(cb0, pid, a);
      const pts = buildPoints(cb0, a, nanushi);
      v = structValue(cb1, a.cost, pts);
      if (a.type === 'claim') for (const b of followUps(cb1, pid, a, me.rice - a.cost, canalCost)) {
        const v2 = structValue(applyCompact(cb1, pid, b), a.cost + b.cost, pts + buildPoints(cb0, b)) - lNow;
        if (0.8 * v2 > v) v = 0.8 * v2;
      }
    }
    if (a.cost !== undefined) {
      const after = me.rice - a.cost;
      if (after < reserve) v -= (reserve - after) * 1.5 * Math.max(lNow, 0.34);
    }
    if (v > 0) v *= arch.bias(a);
    v *= 1 + (rng() - 0.5) * (P.botNoise ?? 0.2);
    if (!best || v > best.v) best = { a, v };
  }
  return best.a;
}

// 冬の献上：k年目より前は0。k年目以降は来年の種代ぶんを残して出す。最終年は全部
export function offerAmount(g, pid, s) {
  const me = g.players[pid];
  if (g.year >= g.P.years) return me.rice;
  if (g.year < s.k) return 0;
  const keep = Math.min(ownFields(g, pid).length, g.P.plantPerAction * 2) * g.P.seedCost + 2;
  return Math.max(0, me.rice - keep);
}
