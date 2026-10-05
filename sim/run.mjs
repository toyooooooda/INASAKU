// ===== 自己対戦の実行と集計 =====
// 使い方: node run.mjs [games] [jsonOut]
import { createGame, currentPlayer, applyAction, runWinter, scoreOf } from './engine.mjs';
import { decide, offerAmount, ARCHETYPES } from './bots.mjs';
import { makeRng } from './engine.mjs';
import { writeFileSync } from 'node:fs';

export function playGame(archs, seed, params = {}) {
  const g = createGame(archs.length, seed, params);
  const rng = makeRng(seed * 104729 + 7);
  let guard = 0;
  while (!g.over) {
    if (++guard > 10000) throw new Error('stuck');
    if (g.stage === 'winter') { runWinter(g, (pid) => offerAmount(g, pid, archs[pid])); continue; }
    const pid = currentPlayer(g);
    applyAction(g, pid, decide(g, pid, archs[pid], rng));
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

// 実験：ラインナップを全席順で回し、勝ち筋ごと・席ごとに集計
export function experiment(label, lineup, gamesPerPerm, params = {}, seedBase = 1) {
  const perms = permutations(lineup);
  const byArch = {}, bySeat = lineup.map(() => ({ wins: 0, games: 0 }));
  const actionTotals = {};
  const pos = { yieldPos: [0, 0, 0], countPos: [0, 0, 0], deficitPos: [0, 0, 0], variety: {} };
  let games = 0, seed = seedBase;
  for (const perm of perms) for (let i = 0; i < gamesPerPerm; i++) {
    const { g, scores, winners } = playGame(perm, seed++, params);
    games++;
    perm.forEach((arch, seat) => {
      const A = byArch[arch] || (byArch[arch] = { n: 0, wins: 0, total: 0, offered: 0, landscape: 0, debt: 0, fields: 0, canalLen: 0, reservoirs: 0, weir: 0, actions: {} });
      const s = scores[seat];
      A.n++; A.total += s.total; A.offered += s.offered; A.landscape += s.landscape; A.debt += s.debt;
      A.fields += s.fields; A.canalLen += s.canalLen; A.reservoirs += s.reservoirs; A.weir += s.weir ? 1 : 0;
      if (winners.includes(seat)) { A.wins += 1 / winners.length; bySeat[seat].wins += 1 / winners.length; }
      bySeat[seat].games++;
      Object.entries(g.players[seat].actions).forEach(([k, v]) => { A.actions[k] = (A.actions[k] || 0) + v; actionTotals[k] = (actionTotals[k] || 0) + v; });
    });
    if (g.stats) for (let p = 0; p < 3; p++) { pos.yieldPos[p] += g.stats.yieldPos[p]; pos.countPos[p] += g.stats.countPos[p]; pos.deficitPos[p] += g.stats.deficitPos[p]; }
    if (g.stats) Object.entries(g.stats.variety).forEach(([k, v]) => { pos.variety[k] = (pos.variety[k] || 0) + v; });
  }
  const archRows = Object.entries(byArch).map(([k, A]) => ({
    arch: k, name: ARCHETYPES[k].name, winRate: A.wins / A.n, avgScore: A.total / A.n,
    offered: A.offered / A.n, landscape: A.landscape / A.n, debt: A.debt / A.n,
    fields: A.fields / A.n, canalLen: A.canalLen / A.n, reservoirs: A.reservoirs / A.n, weirRate: A.weir / A.n,
    actionsPerGame: Object.fromEntries(Object.entries(A.actions).map(([a, v]) => [a, v / A.n])),
  }));
  const seatRows = bySeat.map((s, i) => ({ seat: i + 1, winRate: s.wins / s.games }));
  const totalActs = Object.values(actionTotals).reduce((a, b) => a + b, 0);
  return {
    label, games, lineup, archRows, seatRows,
    actionShare: Object.fromEntries(Object.entries(actionTotals).map(([k, v]) => [k, v / totalActs])),
    avgYieldByPos: pos.yieldPos.map((y, p) => y / Math.max(1, pos.countPos[p])),
    avgDeficitByPos: pos.deficitPos.map((d, p) => d / Math.max(1, pos.countPos[p])),
    harvestsByPos: pos.countPos.map((c) => c / games),
    varietyShare: (() => { const t = Object.values(pos.variety).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(pos.variety).map(([k, v]) => [k, v / t])); })(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] || 2);
  const t0 = Date.now();
  const r = experiment('smoke', ['upstream', 'downstream', 'network', 'greedy'], n);
  console.log(JSON.stringify(r, null, 1));
  console.log('sec', (Date.now() - t0) / 1000);
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(r, null, 1));
}
