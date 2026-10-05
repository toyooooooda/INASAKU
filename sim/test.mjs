// 本体エンジンと高速評価の計算が一致するかを、ランダムな盤面で突き合わせる
import { createGame, allPlots, forecastYields, makeRng, VARIETY_NAMES, flowSeason, plotAt, CARDS } from './engine.mjs';
import { compact, evalYear } from './fast.mjs';
import assert from 'node:assert/strict';

let checked = 0;
for (let seed = 1; seed <= 3000; seed++) {
  const n = 2 + (seed % 3);
  const g = createGame(n, seed, { plotsPerNode: 2 + (seed % 2) });
  const rng = makeRng(seed * 7919);
  const names = VARIETY_NAMES();
  allPlots(g).forEach(({ p, pl }) => {
    if (pl.owner === null && rng() < 0.6) pl.owner = Math.floor(rng() * n);
    if (pl.owner === null) return;
    pl.conn = Math.floor(rng() * (p + 1));
    pl.crop = rng() < 0.8 ? { v: names[Math.floor(rng() * names.length)], deficit: 0 } : null;
  });
  g.rivers.forEach((rv) => { if (rng() < 0.4) rv.reservoir = { owner: Math.floor(rng() * n), stored: 0 }; });
  if (rng() < 0.4) g.weir = Math.floor(rng() * n);
  // 水・収量に効く札をランダムに持たせる
  g.players.forEach((pl) => { ['irrigator', 'wase', 'pond'].forEach((id) => { if (rng() < 0.4) pl.cards.push(id); }); });

  const rain = [0, 1, 2].map(() => Math.floor(rng() * 6 * n));
  const a = forecastYields(g, { rainOf: (s) => rain[s] });
  const cb = compact(g);
  cb.rivers.forEach((rv, r) => rv.plots.forEach((row, p) => row.forEach((f, k) => { const c = plotAt(g, r, p, k).crop; f.v = c ? c.v : null; })));
  const b = evalYear(cb, { rain });
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `seed ${seed} player ${i}: engine ${v} vs fast ${b[i]}`));
  checked++;
}

// 手計算の例：4人・夏・降水16（各川4）。上流A(中稲:夏3) → 中流B(早稲:夏1) → 下流B(中稲:夏3)
{
  const g = createGame(4, 1);
  const rv = g.rivers[0];
  const set = (p, k, owner, v) => { const pl = rv.nodes[p].plots[k]; pl.owner = owner; pl.conn = p; pl.crop = v ? { v, deficit: 0 } : null; };
  set(0, 0, 1, '中稲'); set(1, 0, 0, '早稲'); set(2, 0, 0, '中稲'); rv.nodes[2].plots[1].owner = null;
  const { received } = flowSeason(g, 1, 16, false);
  assert.deepEqual(received.get('0,0,0'), { need: 3, got: 3 });
  assert.deepEqual(received.get('0,1,0'), { need: 1, got: 1 });
  assert.deepEqual(received.get('0,2,0'), { need: 3, got: 0 });
  // 水路：下流の田が上流の節から引くと、中流より先に取れる
  rv.nodes[2].plots[0].conn = 0;
  const r2 = flowSeason(g, 1, 16, false).received;
  assert.deepEqual(r2.get('0,2,0'), { need: 3, got: 1 }); // 上流の田(3)の次に節0で取る → 残り1
  assert.deepEqual(r2.get('0,1,0'), { need: 1, got: 0 });
}
console.log(`ok: ${checked} random boards matched + hand examples`);

// v0.2 の得点：建設のその場加点・献上レート・札の効果・系統そろえ
{
  const { applyAction, runWinter, scoreOf, offerRateOf } = await import('./engine.mjs');
  const g = createGame(2, 7, { cardsEnabled: false });
  const me = g.players[0];
  me.rice = 30;
  applyAction(g, 0, { type: 'claim', r: 1, p: 1, k: 0 });          // 中流の開墾：2俵・1点
  assert.equal(me.rice, 28); assert.equal(me.points, 1);
  applyAction(g, 1, { type: 'labor' });
  applyAction(g, 0, { type: 'canal', r: 1, p: 1, k: 0, q: 0 });    // 長さ1の水路：2俵・1点
  assert.equal(me.rice, 26); assert.equal(me.points, 2);
  assert.deepEqual([1, 2, 3, 4, 5].map((y) => offerRateOf(g, 0, y)), [3, 3, 2, 2, 1]);
  me.cards.push('kokushi'); assert.deepEqual([1, 2, 3, 4, 5].map((y) => offerRateOf(g, 0, y)), [3, 3, 3, 2, 2]);
  me.cards = ['uneme']; assert.deepEqual([1, 2, 3, 4, 5].map((y) => offerRateOf(g, 0, y)), [4, 4, 2, 2, 1]);
  me.cards = [];
  // 冬：維持費2（働き手2）→ 献上は3俵単位（10俵出そうとすると9俵＝3点×3）
  g.stage = 'winter'; me.rice = 12; g.players[1].rice = 0;
  runWinter(g, (pid) => (pid === 0 ? 10 : 0));
  assert.equal(me.rice, 1); assert.equal(me.pts.offer, 9);
  assert.equal(g.players[1].pts.debt, -2);                        // 払えない維持費 2俵 → −2点
  assert.equal(scoreOf(g, 0).total, me.points);
}
{
  const { applyAction } = await import('./engine.mjs');
  const g = createGame(2, 3);
  g.market = ['canal', 'temple', 'pond']; g.deck = ['wase'];
  const me = g.players[0]; me.rice = 30;
  applyAction(g, 0, { type: 'buy', idx: 0, id: 'canal' }); assert.equal(me.rice, 28);       // 2＋0枚
  assert.deepEqual(g.market, ['temple', 'pond', 'wase']);
  applyAction(g, 1, { type: 'labor' });
  applyAction(g, 0, { type: 'buy', idx: 0, id: 'temple' }); assert.equal(me.rice, 25);      // 2＋1枚
  applyAction(g, 1, { type: 'labor' });
  me.cards.push('irrigator'); g.market = ['pond'];
  // 水の札が3枚目→そろえ+5（ここでは pond を買って4枚目でも1回だけ）
  const before = me.points;
  g.workersLeft[0] = 2; g.workersLeft[1] = 2; g.slots.buy = 3;
  applyAction(g, 0, { type: 'buy', idx: 0, id: 'pond' });
  assert.equal(me.points - before, 5); assert.equal(me.pts.set, 5);
}
console.log('ok: scoring / cards');
