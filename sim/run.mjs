// ===== 自己対戦の実行と集計 =====
import { createGame, currentPlayer, applyAction, runWinter, runPlantPhase, bestPlanting, scoreOf, makeRng, CARDS } from './engine.mjs';
import { decide, offerAmount, strat } from './bots.mjs';

// strats: 席ごとの方針 { arch, k }
export function playGame(strats, seed, params = {}) {
  const g = createGame(strats.length, seed, params);
  const rng = makeRng(seed * 104729 + 7);
  let guard = 0;
  while (!g.over) {
    if (++guard > 20000) throw new Error('stuck');
    if (g.stage === 'winter') { runWinter(g, (pid) => offerAmount(g, pid, strats[pid])); continue; }
    if (g.stage === 'plant') { runPlantPhase(g, (pid) => bestPlanting(g, pid, Infinity)); continue; }
    const pid = currentPlayer(g);
    applyAction(g, pid, decide(g, pid, strats[pid], rng));
  }
  const scores = g.players.map((_, i) => scoreOf(g, i));
  const top = Math.max(...scores.map((s) => s.total));
  const winners = scores.map((s, i) => (s.total === top ? i : -1)).filter((i) => i >= 0);
  return { g, scores, winners };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

// 集計器：キー（方針・札など）ごとに 勝ち・点・内訳 を数える
function tally() {
  const rows = {};
  return {
    add(key, s, win) {
      const R = rows[key] || (rows[key] = { n: 0, wins: 0, total: 0, offer: 0, build: 0, set: 0, debt: 0, fields: 0, canalLen: 0, cards: 0 });
      R.n++; R.wins += win; R.total += s.total; R.offer += s.offer; R.build += s.build; R.set += s.set; R.debt += s.debt;
      R.fields += s.fields; R.canalLen += s.canalLen; R.cards += s.cards.length;
    },
    rows: () => Object.fromEntries(Object.entries(rows).map(([k, R]) => [k, {
      n: R.n, win: R.wins / R.n, score: R.total / R.n, offer: R.offer / R.n, build: R.build / R.n, set: R.set / R.n,
      debt: R.debt / R.n, fields: R.fields / R.n, canalLen: R.canalLen / R.n, cards: R.cards / R.n,
    }])),
  };
}

// mode 'lineup'：決まった顔ぶれを全席順で回す（勝ち筋の比較・席順の確認）
// mode 'random'：毎局、席ごとに勝ち筋と献上開始年kをランダムに選ぶ（k の山の形・札の強さの確認）
export function runExperiment(cfg) {
  const params = cfg.params || {};
  const byStrat = tally(), byArch = tally(), byK = tally(), byCard = tally(), noCard = tally();
  const seat = [];
  const acts = {};
  const pos = { y: [0, 0, 0], c: [0, 0, 0], d: [0, 0, 0], v: {} };
  let games = 0, seed = cfg.seed || 1;

  const record = (strats, res) => {
    games++;
    const { g, scores, winners } = res;
    strats.forEach((s, i) => {
      const w = winners.includes(i) ? 1 / winners.length : 0;
      byStrat.add(`${s.arch}/k${s.k}`, scores[i], w);
      byArch.add(s.arch, scores[i], w);
      byK.add(`k${s.k}`, scores[i], w);
      CARDS.forEach((c) => (scores[i].cards.includes(c.id) ? byCard : noCard).add(c.id, scores[i], w));
      (seat[i] || (seat[i] = { w: 0, n: 0 })); seat[i].w += w; seat[i].n++;
      Object.entries(g.players[i].actions).forEach(([a, v]) => { acts[a] = (acts[a] || 0) + v; });
    });
    if (g.stats) for (let p = 0; p < 3; p++) { pos.y[p] += g.stats.yieldPos[p]; pos.c[p] += g.stats.countPos[p]; pos.d[p] += g.stats.deficitPos[p]; }
    if (g.stats) Object.entries(g.stats.variety).forEach(([k, v]) => { pos.v[k] = (pos.v[k] || 0) + v; });
  };

  if (cfg.mode === 'random') {
    const n = cfg.players || 4;
    const archs = cfg.archs || ['greedy', 'upstream', 'downstream', 'network', 'cards'];
    const ks = cfg.ks || [1, 2, 3, 4, 5];
    const rng = makeRng((cfg.seed || 1) * 31337);
    for (let i = 0; i < (cfg.games || 200); i++) {
      const strats = Array.from({ length: n }, () => strat(archs[Math.floor(rng() * archs.length)], ks[Math.floor(rng() * ks.length)]));
      record(strats, playGame(strats, seed++, params));
    }
  } else {
    const lineup = (cfg.lineup || [{ arch: 'upstream' }, { arch: 'downstream' }, { arch: 'network' }, { arch: 'cards' }]).map((s) => strat(s.arch, s.k));
    for (const perm of permutations(lineup)) for (let i = 0; i < (cfg.gpp || 1); i++) record(perm, playGame(perm, seed++, params));
  }

  const tot = Object.values(acts).reduce((a, b) => a + b, 0);
  const vt = Object.values(pos.v).reduce((a, b) => a + b, 0);
  const cardRows = byCard.rows(), noCardRows = noCard.rows();
  return {
    label: cfg.label, games,
    strategies: byStrat.rows(), archetypes: byArch.rows(), offerStartYear: byK.rows(),
    cards: Object.fromEntries(CARDS.map((c) => [c.id, {
      name: c.name, tag: c.tag,
      takenPerGame: (cardRows[c.id]?.n || 0) / games,
      winWith: cardRows[c.id]?.win ?? null, winWithout: noCardRows[c.id]?.win ?? null,
    }])),
    seatWin: seat.map((s) => s.w / s.n),
    actionShare: Object.fromEntries(Object.entries(acts).map(([k, v]) => [k, v / tot])),
    yieldByPos: pos.y.map((y, p) => y / Math.max(1, pos.c[p])),
    deficitByPos: pos.d.map((d, p) => d / Math.max(1, pos.c[p])),
    varietyShare: Object.fromEntries(Object.entries(pos.v).map(([k, v]) => [k, v / vt])),
  };
}
