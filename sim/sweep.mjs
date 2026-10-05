// パラメータを振って、行動の偏り・勝率をざっくり見る
import { experiment } from './run.mjs';
import { VARIETIES } from './engine.mjs';
import { readFileSync } from 'node:fs';
// 引数: 設定JSONファイルのパス（Windowsでも引用符に悩まないように）か、JSON文字列。省略時は既定値で実行
const arg = process.argv[2];
const cfg = !arg ? { label: 'default' } : arg.trim().startsWith('{') ? JSON.parse(arg) : JSON.parse(readFileSync(arg, 'utf8'));
if (cfg.varieties) Object.assign(VARIETIES, cfg.varieties);
const r = experiment(cfg.label, cfg.lineup || ['upstream','downstream','network','greedy'], cfg.gpp || 1, cfg.params || {}, cfg.seed || 1);
const fmt = (x) => Math.round(x * 100) / 100;
console.log(JSON.stringify({
  label: r.label, games: r.games,
  win: Object.fromEntries(r.archRows.map(a => [a.arch, fmt(a.winRate)])),
  score: Object.fromEntries(r.archRows.map(a => [a.arch, fmt(a.avgScore)])),
  seat: r.seatRows.map(s => fmt(s.winRate)),
  act: Object.fromEntries(Object.entries(r.actionShare).map(([k,v]) => [k, fmt(v)])),
  yieldPos: r.avgYieldByPos.map(fmt), defPos: r.avgDeficitByPos.map(fmt), harvPos: r.harvestsByPos.map(fmt),
  variety: Object.fromEntries(Object.entries(r.varietyShare).map(([k,v]) => [k, fmt(v)])),
  struct: Object.fromEntries(r.archRows.map(a => [a.arch, {f: fmt(a.fields), c: fmt(a.canalLen), r: fmt(a.reservoirs), w: fmt(a.weirRate)}])),
}));
