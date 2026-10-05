// ===== 実験の実行（ここだけ叩けばよい）=====
// 使い方: node exp.mjs configs/timing.json
//   結果は画面に表で出し、最後の1行に「Claude に貼る用」の短いJSONを出す。
//   詳細は results/<設定名>.json に保存。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { runExperiment } from './run.mjs';
import { VARIETIES } from './engine.mjs';

const path = process.argv[2] || 'configs/default.json';
const cfg = JSON.parse(readFileSync(path, 'utf8'));
if (cfg.varieties) Object.assign(VARIETIES, cfg.varieties);
const t0 = Date.now();
const r = runExperiment(cfg);
const sec = ((Date.now() - t0) / 1000).toFixed(0);

const pct = (x) => (x === null || x === undefined ? '  -  ' : `${(x * 100).toFixed(0).padStart(3)}%`);
const f1 = (x) => x.toFixed(1).padStart(5);
console.log(`\n■ ${r.label}（${r.games}局・${sec}秒）`);
const table = (title, rows, keyName) => {
  console.log(`\n[${title}]`);
  console.log(`${keyName.padEnd(16)}  件数  勝率   平均点  献上  建設  そろえ  田   水路  札`);
  Object.entries(rows).sort((a, b) => b[1].win - a[1].win).forEach(([k, v]) => {
    console.log(`${k.padEnd(16)} ${String(v.n).padStart(5)} ${pct(v.win)} ${f1(v.score)} ${f1(v.offer)} ${f1(v.build)} ${f1(v.set)} ${f1(v.fields)} ${f1(v.canalLen)} ${f1(v.cards)}`);
  });
};
table('勝ち筋', r.archetypes, '勝ち筋');
table('献上を始める年', r.offerStartYear, '開始年');
if (cfg.mode === 'random') table('勝ち筋×開始年（上位）', Object.fromEntries(Object.entries(r.strategies).filter(([, v]) => v.n >= 20)), '方針');
console.log('\n[札]  取られた数/局  持っていた人の勝率  持っていない人の勝率');
Object.entries(r.cards).forEach(([id, c]) => console.log(`${c.name.padEnd(8)}(${c.tag}) ${c.takenPerGame.toFixed(2).padStart(5)}   ${pct(c.winWith)}   ${pct(c.winWithout)}`));
console.log(`\n席ごとの勝率: ${r.seatWin.map(pct).join(' ')}`);
console.log(`行動の割合: ${Object.entries(r.actionShare).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(' / ')}`);
console.log(`品種: ${Object.entries(r.varietyShare).map(([k, v]) => `${k} ${pct(v)}`).join(' / ')}`);
console.log(`位置ごとの平均収量(上/中/下): ${r.yieldByPos.map((x) => x.toFixed(1)).join(' / ')}  不足: ${r.deficitByPos.map((x) => x.toFixed(1)).join(' / ')}`);

// Claude に貼る用（短い）
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
const short = {
  l: r.label, n: r.games,
  arch: Object.fromEntries(Object.entries(r.archetypes).map(([k, v]) => [k, [r2(v.win), r2(v.score)]])),
  k: Object.fromEntries(Object.entries(r.offerStartYear).map(([k, v]) => [k, [r2(v.win), r2(v.score)]])),
  card: Object.fromEntries(Object.entries(r.cards).map(([k, c]) => [k, [r2(c.takenPerGame), r2(c.winWith)]])),
  seat: r.seatWin.map(r2), act: Object.fromEntries(Object.entries(r.actionShare).map(([k, v]) => [k, r2(v)])),
  var: Object.fromEntries(Object.entries(r.varietyShare).map(([k, v]) => [k, r2(v)])),
};
if (cfg.mode === 'random') short.sk = Object.fromEntries(Object.entries(r.strategies).filter(([, v]) => v.n >= 20).map(([k, v]) => [k, r2(v.win)]));
mkdirSync('results', { recursive: true });
writeFileSync(`results/${basename(path, '.json')}.json`, JSON.stringify(r, null, 1));
console.log('\n--- Claude に貼る用 ---');
console.log(JSON.stringify(short));
