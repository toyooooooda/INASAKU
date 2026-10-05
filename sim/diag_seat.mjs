import { playGame } from './run.mjs';
import { VARIETIES } from './engine.mjs';
const cfg = JSON.parse(process.argv[2]);
Object.assign(VARIETIES, cfg.varieties);
const N = 4, G = cfg.games;
const acc = Array.from({ length: N }, () => ({ win: 0, score: 0, harvested: 0, fields: 0, up: 0, plant: 0, labor: 0 }));
for (let s = 1; s <= G; s++) {
  const r = playGame(Array(N).fill('greedy'), 1000 + s, cfg.params);
  r.scores.forEach((x, i) => { const a = acc[i]; a.score += x.total; a.harvested += r.g.players[i].harvested; a.fields += x.fields;
    a.up += r.g.rivers.reduce((t, rv) => t + rv.nodes[0].plots.filter(p => p.owner === i).length, 0);
    a.plant += r.g.players[i].actions.plant || 0; a.labor += r.g.players[i].actions.labor || 0; });
  r.winners.forEach((w) => { acc[w].win += 1 / r.winners.length; });
}
console.log(cfg.label, JSON.stringify(acc.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v / G * 100) / 100])))));
