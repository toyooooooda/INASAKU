import { useState, useEffect, useRef, useCallback } from "react";

// ===== ユーティリティ =====
const deepClone = obj => JSON.parse(JSON.stringify(obj));
const SEASONS = ["春", "夏", "秋", "冬"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function totalRound(game) {
  return (game.year - 1) * 8 + game.seasonIdx * 2 + game.roundInSeason + 1;
}

function addLog(g, msg) {
  const label = `[${g.year}年 ${SEASONS[g.seasonIdx]}R${g.roundInSeason + 1}]`;
  g.log.push(`${label} ${msg}`);
  if (g.log.length > 150) g.log.shift();
}

// 構造化プレイデータ記録（バランス分析用・トリムしない）
function addEvent(g, type, playerId, data = {}) {
  if (!g.events) g.events = [];
  g.events.push({
    seq: g.events.length,
    round: totalRound(g),
    year: g.year,
    season: SEASONS[g.seasonIdx],
    r: g.roundInSeason + 1,
    phase: g.phase,
    player: playerId, // null = 全体イベント
    type,
    ...data,
  });
}

// ===== 定数 =====

const WEATHER_CARDS = [
  { name: "晴れ",       effect: "none",         desc: "通常の天気" },
  { name: "晴れ",       effect: "none",         desc: "通常の天気" },
  { name: "晴れ",       effect: "none",         desc: "通常の天気" },
  { name: "曇り",       effect: "cloudy",       desc: "全田：水位変化なし（蒸発しない）" },
  { name: "台風",       effect: "typhoon",      desc: "全田：品質-1（立ち稲が傷む）" },
  { name: "冷夏",       effect: "cool_summer",  desc: "夏のみ：全田 成長-1" },
  { name: "早霜",       effect: "early_frost",  desc: "秋のみ：晩稲 成長-2" },
  { name: "大雪",       effect: "heavy_snow",   desc: "冬のみ：次の春 -1行動" },
  { name: "小春日和",   effect: "mild_day",     desc: "全員：並俵+2" },
  { name: "小春日和",   effect: "mild_day",     desc: "全員：並俵+2" },
  { name: "大雨",       effect: "heavy_rain",   desc: "全田：水位+2" },
  { name: "恵みの露",   effect: "gentle_rain",  desc: "全田：水位+1" },
  { name: "干ばつ",     effect: "drought",      desc: "全田：水位-2" },
  { name: "豊穣の兆し", effect: "bountiful",    desc: "全田：成長+1" },
  { name: "豊穣の兆し", effect: "bountiful",    desc: "全田：成長+1" },
];

// ダイス目 → 効果（☀️1-2 / 💧3-4 / 🌬️5 / ✨6）
function diceEffect(d) {
  if (d <= 2) return { type: "sun",  icon: "☀️", desc: "全田 水位-1" };
  if (d <= 4) return { type: "rain", icon: "💧", desc: "全田 水位+1" };
  if (d === 5) return { type: "wind", icon: "🌬️", desc: "追加天候" };
  return             { type: "star", icon: "✨", desc: "全田 成長+1" };
}

const VARIETIES = {
  野良稲: { requiredGrowth: 3, baseQuality: 1, maxQuality: 1, cost: 0, harvestMin: 2, harvestMax: 2, desc: "3R・並どまり・無料・収穫2（金欠時の保険）" },
  早稲: { requiredGrowth: 2, baseQuality: 1, maxQuality: 1, cost: 1, harvestMin: 3, harvestMax: 4, desc: "2R・並どまり・1俵・収穫3〜4（速い量産型）" },
  中稲: { requiredGrowth: 3, baseQuality: 1, maxQuality: 2, cost: 2, harvestMin: 3, harvestMax: 4, desc: "3R・並〜上質・2俵・収穫3〜4（平均型）" },
  晩稲: { requiredGrowth: 4, baseQuality: 2, maxQuality: 3, cost: 2, harvestMin: 2, harvestMax: 3, desc: "4R・上質〜特上・2俵・収穫2〜3（少量高品質型）" },
};

const QUALITY_LABEL = ["", "並", "上質", "特上"];
const RANK_LABELS = ["平民", "小名", "大名", "公家"];
// 位階昇進コスト（評判）：位階0→1=3, 1→2=6, 2→3=10
const RANK_COSTS = [3, 6, 10];
// ネズミの大量発生：レア（年2以降・各年20%）・ゲーム1回まで・甚大な被害
const RAT_OUTBREAK_CHANCE = 0.2;

// 水位 → 成長修正値（-99=洪水流出）
function waterMod(water) {
  if (water === 0) return 0;   // 干ばつ：成長なし
  if (water === 1) return 0;   // 低水位：成長なし
  if (water <= 3) return 1;   // 最適
  if (water === 4) return 0;  // 病害：成長なし
  return -99;                  // 洪水：流出
}

// ===== ゲーム初期化 =====

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createField(id) {
  return { id, status: "empty", variety: null, growth: 0, requiredGrowth: 0, quality: 1, water: 2, fertilized: false, growthFertilized: false, overripe: 0, tilled: false };
}

function createGame(playerNames) {
  const players = playerNames.map((name, i) => ({
    id: i, name,
    rice: [{ quality: 1, count: 8 }, { quality: 2, count: 0 }, { quality: 3, count: 0 }],
    reputation: 0, rank: 0,
    workers: 3, workersUsed: 0,
    tools: { plow: false, ox: false, barn: false },
    donatedThisYear: false,
    strawworkThisYear: false,
    seedlings: 0,
    compost: 0,
    penaltyNextSpring: 0,
    landLimit: 4,
    fields: [createField(`f${i}_0`), createField(`f${i}_1`)],
    // 初期荒れ地4枚：昇進しなくても開墾で田を増やせる余裕を持たせる
    wildlands: [{ id: `w${i}_0`, gauge: 0 }, { id: `w${i}_1`, gauge: 0 }, { id: `w${i}_2`, gauge: 0 }, { id: `w${i}_3`, gauge: 0 }],
  }));

  return {
    phase: "weather_draw",
    year: 1, seasonIdx: 0, roundInSeason: 0,
    turnOrder: playerNames.map((_, i) => i),
    actionTurnIdx: 0,
    weatherDraw: { card: null, dice: [], effects: [] },
    weatherDeck: shuffle([...WEATHER_CARDS]),
    players,
    log: ["=== 豊穣の水田 改訂版 ゲーム開始 ==="],
    yearEndStep: null,
    yearEndPlayerIdx: 0,
    // ── プレイデータ記録 ──
    gameId: `g${Date.now()}`,
    playerCount: playerNames.length,
    ratOutbreakDone: false,
    events: [],        // 構造化イベントログ
    yearSnapshots: [], // 年度末ごとの全プレイヤー状態
    exportData: null,  // doEndGame で構築
  };
}

// ===== ロジック関数 =====

function applyCardEffect(g, card) {
  switch (card.effect) {
    case "typhoon":
      g.players.forEach(p => p.fields.forEach(f => {
        if ((f.status === "planted" || f.status === "mature") && f.quality > 1) {
          f.quality -= 1;
        }
      }));
      addLog(g, "台風：植え付け中・成熟の全田 品質-1");
      break;
    case "cool_summer":
      if (g.seasonIdx === 1) {
        g.players.forEach(p => p.fields.forEach(f => {
          if (f.status === "planted") f.growth = Math.max(0, f.growth - 1);
        }));
        addLog(g, "冷夏：全田 成長-1");
      }
      break;
    case "early_frost":
      if (g.seasonIdx === 2) {
        g.players.forEach(p => p.fields.forEach(f => {
          if (f.variety === "晩稲") f.growth = Math.max(0, f.growth - 2);
        }));
        addLog(g, "早霜：晩稲 成長-2");
      }
      break;
    case "heavy_snow":
      if (g.seasonIdx === 3) {
        g.players.forEach(p => { p.penaltyNextSpring = (p.penaltyNextSpring || 0) + 1; });
        addLog(g, "大雪：次の春 各-1行動");
      }
      break;
    case "mild_day":
      g.players.forEach(p => { p.rice[0].count += 2; });
      addLog(g, "小春日和：全員 並俵+2");
      break;
    case "heavy_rain":
      g.players.forEach(p => p.fields.forEach(f => { f.water = clamp(f.water + 2, 0, 5); }));
      addLog(g, "大雨：全田 水位+2");
      break;
    case "drought":
      g.players.forEach(p => p.fields.forEach(f => { f.water = clamp(f.water - 2, 0, 5); }));
      addLog(g, "干ばつ：全田 水位-2");
      break;
    case "bountiful":
      g.players.forEach(p => p.fields.forEach(f => {
        if (f.status === "planted") f.growth++;
      }));
      addLog(g, "豊穣の兆し：全田 成長+1");
      break;
    case "gentle_rain":
      g.players.forEach(p => p.fields.forEach(f => { f.water = clamp(f.water + 1, 0, 5); }));
      addLog(g, "恵みの露：全田 水位+1");
      break;
    case "cloudy":
      // 蒸発を今ラウンドは相殺（成長フェーズで別途処理するため、フラグだけ立てる）
      g.cloudyThisRound = true;
      addLog(g, "曇り：このラウンドの蒸発はなし");
      break;
    default: break;
  }
}

function drawCard(g) {
  if (g.weatherDeck.length === 0) g.weatherDeck = shuffle([...WEATHER_CARDS]);
  return g.weatherDeck.pop();
}

function doDrawWeather(g) {
  const card = drawCard(g);
  const dice = [Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)];
  const effects = dice.map(diceEffect);
  g.weatherDraw = { card, dice, effects };
  addLog(g, `天候カード：【${card.name}】${card.desc} ／ ダイス ${effects.map((e, i) => `${e.icon}(${dice[i]})`).join(" ")} `);
  addEvent(g, "weather", null, { card: card.name, effect: card.effect, dice: [...dice], diceTypes: effects.map(e => e.type) });
  g.phase = "weather_apply";
}

function doApplyWeather(g) {
  const { effects, dice, card } = g.weatherDraw;

  effects.forEach((eff, i) => {
    if (eff.type === "sun") {
      g.players.forEach(p => p.fields.forEach(f => { f.water = clamp(f.water - 1, 0, 5); }));
      addLog(g, `☀️(${dice[i]})：全田 水位-1`);
    } else if (eff.type === "rain") {
      g.players.forEach(p => p.fields.forEach(f => { f.water = clamp(f.water + 1, 0, 5); }));
      addLog(g, `💧(${dice[i]})：全田 水位+1`);
    } else if (eff.type === "wind") {
      const extra = drawCard(g);
      addLog(g, `🌬️(${dice[i]})：追加天候【${extra.name}】${extra.desc}`);
      applyCardEffect(g, extra);
    } else if (eff.type === "star") {
      g.players.forEach(p => p.fields.forEach(f => {
        if (f.status === "planted") f.growth++;
      }));
      addLog(g, `✨(${dice[i]})：全田（植付済）成長+1`);
    }
  });

  applyCardEffect(g, card);
  g.phase = "action";
  g.actionTurnIdx = 0;

  // 大雪ペナルティ：春の開始時に workersUsed を先積みする
  if (g.seasonIdx === 0) {
    g.players.forEach(p => {
      if (p.penaltyNextSpring > 0) {
        const pen = Math.min(p.penaltyNextSpring, p.workers);
        p.workersUsed = Math.min(p.workers, (p.workersUsed || 0) + pen);
        addLog(g, `${p.name}：大雪ペナルティで-${pen}行動`);
        p.penaltyNextSpring = 0;
      }
    });
  }
}

function doGrowthPhase(g) {
  const evaporate = g.cloudyThisRound ? 0 : 1; // 曇りは蒸発なし
  g.cloudyThisRound = false;
  g.players.forEach(p => {
    p.fields.forEach(f => {
      if (f.status === "empty") {
        f.water = clamp(f.water - evaporate, 0, 5);
        return;
      }
      if (f.status === "mature") {
        f.water = clamp(f.water - evaporate, 0, 5);
        // 収穫せず放置すると傷んで品質が落ちる（2ラウンドごとに-1、並まで）
        f.overripe = (f.overripe || 0) + 1;
        if (f.overripe >= 2 && f.quality > 1) {
          f.quality -= 1;
          f.overripe = 0;
          addLog(g, `${p.name}の${f.variety}が傷んで品質低下（→${QUALITY_LABEL[f.quality]}）`);
          addEvent(g, "overripe", p.id, { variety: f.variety, quality: f.quality });
        }
        return;
      }
      // planted
      const mod = waterMod(f.water);
      f.water = clamp(f.water - evaporate, 0, 5);
      if (mod === -99) {
        addLog(g, `${p.name}の${f.variety}が洪水で流出！`);
        addEvent(g, "flood_loss", p.id, { variety: f.variety, growth: f.growth });
        Object.assign(f, createField(f.id));
        f.water = 0;
        return;
      }
      f.growth += mod;
      if (f.growth >= f.requiredGrowth) {
        f.status = "mature";
        addLog(g, `${p.name}の${f.variety}が成熟！（${QUALITY_LABEL[f.quality]}）`);
      }
    });
  });
}

// 俵を amount 枚支払う（並→上質→特上の順）。足りなければ false
function payRice(p, amount) {
  let rem = amount;
  for (let i = 0; i < 3 && rem > 0; i++) {
    const t = Math.min(rem, p.rice[i].count);
    p.rice[i].count -= t;
    rem -= t;
  }
  return rem === 0;
}

function totalRiceCount(p) {
  return p.rice.reduce((s, r) => s + r.count, 0);
}

function executeAction(g, playerIdx, action) {
  const p = g.players[playerIdx];

  if (action.type === "plant") {
    const { fieldId, variety, useSeedling } = action;
    const f = p.fields.find(x => x.id === fieldId);
    const def = VARIETIES[variety];
    if (!f || f.status !== "empty") return;
    const seedCost = Math.max(0, def.cost - (p.tools.ox ? 1 : 0)); // 牛：植え付けコスト-1
    if (totalRiceCount(p) < seedCost) { addLog(g, `${p.name}：俵不足`); return; }
    payRice(p, seedCost);
    const useNae = !!useSeedling && p.seedlings > 0; // 育苗：成長+1で開始
    const tilledBonus = f.tilled ? 1 : 0;            // 土づくり：次作の品質+1
    f.status = "planted";
    f.variety = variety;
    f.growth = useNae ? 1 : 0;
    f.requiredGrowth = def.requiredGrowth;
    f.quality = clamp(def.baseQuality + tilledBonus, 1, def.maxQuality);
    f.fertilized = false;
    f.growthFertilized = false;
    f.tilled = false;
    if (useNae) p.seedlings -= 1;
    p.workersUsed += 1;
    addLog(g, `${p.name}：${variety}を植え付け（-${seedCost}俵${p.tools.ox && def.cost > 0 ? "・牛割引" : ""}${useNae ? "・苗で成長+1" : ""}${tilledBonus ? "・耕地で品質+1" : ""}）`);
    addEvent(g, "plant", p.id, { variety, cost: seedCost, useSeedling: useNae, tilled: tilledBonus > 0 });
  }

  if (action.type === "irrigate") {
    const { fieldId } = action;
    const f = p.fields.find(x => x.id === fieldId);
    if (!f) return;
    f.water = clamp(f.water + 2, 0, 5);
    p.workersUsed += 1;
    addLog(g, `${p.name}：水を引く →水位${f.water}`);
    addEvent(g, "irrigate", p.id, { water: f.water });
  }

  if (action.type === "fertilize") {
    const { fieldId } = action;
    const f = p.fields.find(x => x.id === fieldId);
    if (!f || f.status !== "planted") { addLog(g, `${p.name}：植付中の田がありません`); return; }
    if (f.fertilized) { addLog(g, `${p.name}：すでに追肥済みです`); return; }
    const maxQ = VARIETIES[f.variety]?.maxQuality ?? 3;
    if (f.quality >= maxQ) { addLog(g, `${p.name}：${f.variety}はこれ以上品質が上がりません（上限${QUALITY_LABEL[maxQ]}）`); return; }
    let paidWith;
    if (p.compost > 0) { p.compost -= 1; paidWith = "堆肥"; }
    else if (payRice(p, 1)) { paidWith = "俵1"; }
    else { addLog(g, `${p.name}：俵も堆肥も不足`); return; }
    f.quality = clamp(f.quality + 1, 1, maxQ);
    f.fertilized = true;
    p.workersUsed += 1;
    addLog(g, `${p.name}：品質肥料（${paidWith}）→ 品質 ${QUALITY_LABEL[f.quality]}`);
    addEvent(g, "fertilize", p.id, { quality: f.quality });
  }

  if (action.type === "growth_fert") {
    const { fieldId } = action;
    const f = p.fields.find(x => x.id === fieldId);
    if (!f || f.status !== "planted") { addLog(g, `${p.name}：植付中の田がありません`); return; }
    if (f.growthFertilized) { addLog(g, `${p.name}：すでに成長肥料済みです`); return; }
    let paidWith;
    if (p.compost > 0) { p.compost -= 1; paidWith = "堆肥"; }
    else if (payRice(p, 1)) { paidWith = "俵1"; }
    else { addLog(g, `${p.name}：俵も堆肥も不足`); return; }
    f.growth += 1;
    f.growthFertilized = true;
    p.workersUsed += 1;
    if (f.growth >= f.requiredGrowth) {
      f.status = "mature"; f.overripe = 0;
      addLog(g, `${p.name}：成長肥料（${paidWith}）→ ${f.variety}が成熟！`);
    } else {
      addLog(g, `${p.name}：成長肥料（${paidWith}）→ 成長 ${f.growth}/${f.requiredGrowth}`);
    }
    addEvent(g, "growth_fert", p.id, { growth: f.growth });
  }

  if (action.type === "reclaim") {
    const { wildlandId } = action;
    const w = p.wildlands.find(x => x.id === wildlandId);
    if (!w || w.gauge >= 3) { addLog(g, `${p.name}：開墾できる荒れ地がありません`); return; }
    const bonus = (p.tools.plow ? 1 : 0) + (p.tools.ox ? 1 : 0);
    const before = w.gauge;
    w.gauge = Math.min(3, w.gauge + 1 + bonus);
    const actual = w.gauge - before;
    p.workersUsed += 1;
    addLog(g, `${p.name}：開墾 ゲージ+${actual} → ${w.gauge}/3${bonus > 0 ? `（道具ボーナス+${bonus}）` : ""}`);
    // 完成チェック
    let reclaimResult = "progress";
    if (w.gauge >= 3) {
      if (p.fields.length < p.landLimit) {
        const newId = `f${p.id}_d${p.fields.length}`;
        p.fields.push(createField(newId));
        p.wildlands = p.wildlands.filter(x => x.id !== wildlandId);
        addLog(g, `${p.name}：開墾完了！ → 田${p.fields.length}枚`);
        reclaimResult = "completed";
      } else {
        addLog(g, `${p.name}：開墾完了（土地上限${p.landLimit}枚のため待機中・位階昇進で変換）`);
        reclaimResult = "waiting";
      }
    }
    addEvent(g, "reclaim", p.id, { gain: actual, gauge: w.gauge, bonus, result: reclaimResult });
  }

  if (action.type === "harvest") {
    const { fieldId, workers } = action; // workers: 1 or 2
    const f = p.fields.find(x => x.id === fieldId);
    if (!f || f.status !== "mature") { addLog(g, `${p.name}：収穫できる田がありません`); return; }
    if (p.workersUsed + workers > p.workers) { addLog(g, `${p.name}：働き手不足`); return; }

    const def = VARIETIES[f.variety];
    const plowBonus = p.tools.plow ? 1 : 0; // 道具：収穫+1
    const count = (workers >= 2 ? def.harvestMax : def.harvestMin) + plowBonus;
    const quality = clamp(f.quality, 1, 3);

    p.rice[quality - 1].count += count;
    p.workersUsed += workers;

    // 評判変化
    const repBefore = p.reputation;
    if (quality >= 2) {
      p.reputation += 1;
      addLog(g, `${p.name}：${f.variety}収穫 ${QUALITY_LABEL[quality]}×${count}俵 評判+1${plowBonus > 0 ? "（道具+1）" : ""}`);
    } else {
      addLog(g, `${p.name}：${f.variety}収穫 並×${count}俵${plowBonus > 0 ? "（道具+1）" : ""}`);
      if (count >= 4) {
        p.reputation = Math.max(0, p.reputation - 1);
        addLog(g, `${p.name}：並の大量収穫（${count}俵）→ 評判-1`);
      }
    }
    addEvent(g, "harvest", p.id, { variety: f.variety, workers, count, quality, plowBonus, repDelta: p.reputation - repBefore });

    // 田をリセット
    const oldWater = f.water;
    Object.assign(f, createField(f.id));
    f.water = Math.max(0, oldWater - 1); // 収穫後の田の水位を引き継ぐ（蒸発分だけ減）
  }

  if (action.type === "buy_tool") {
    const { item, payment } = action; // item: "plow"|"ox"|"barn", payment: "rice"|"reputation"
    const SHOP = {
      plow: { name: "道具", riceCost: 8,  repCost: 4 },
      ox:   { name: "牛",   riceCost: 16, repCost: 6 },
      barn: { name: "倉",   riceCost: 6,  repCost: 3 },
    };
    const s = SHOP[item];
    if (!s) return;
    if (p.tools[item]) { addLog(g, `${p.name}：すでに${s.name}を持っています`); return; }
    if (payment === "rice") {
      if (totalRiceCount(p) < s.riceCost) { addLog(g, `${p.name}：俵不足（${s.riceCost}俵必要）`); return; }
      payRice(p, s.riceCost);
      addLog(g, `${p.name}：${s.name}を購入（-${s.riceCost}俵）`);
    } else {
      if (p.reputation < s.repCost) { addLog(g, `${p.name}：評判不足（評判${s.repCost}必要）`); return; }
      p.reputation -= s.repCost;
      addLog(g, `${p.name}：${s.name}を購入（-評判${s.repCost}）`);
    }
    p.tools[item] = true;
    addEvent(g, "buy_tool", p.id, { item, payment, cost: payment === "rice" ? s.riceCost : s.repCost });
  }

  if (action.type === "donate") {
    const { quality } = action; // 2=上質 / 3=特上
    if (p.donatedThisYear) { addLog(g, `${p.name}：献上は年1回のみです`); return; }
    if (p.workersUsed + 2 > p.workers) { addLog(g, `${p.name}：働き手不足（献上は2個必要）`); return; }
    if (p.rice[quality - 1].count < 1) { addLog(g, `${p.name}：${QUALITY_LABEL[quality]}の俵がありません`); return; }
    p.rice[quality - 1].count -= 1;
    p.reputation += 2;
    p.workersUsed += 2;
    p.donatedThisYear = true;
    addLog(g, `${p.name}：献上（${QUALITY_LABEL[quality]}1俵）→ 評判+2（合計${p.reputation}）`);
    addEvent(g, "donate", p.id, { quality, repDelta: 2 });
  }

  if (action.type === "migrant") {
    if (g.seasonIdx < 2) { addLog(g, `${p.name}：出稼ぎは秋・冬のみ（農閑期の仕事）`); return; }
    if (p.workersUsed + 2 > p.workers) { addLog(g, `${p.name}：働き手不足（出稼ぎは2人）`); return; }
    p.rice[0].count += 2;
    p.workersUsed += 2;
    addLog(g, `${p.name}：出稼ぎ（働き手2）→ 並2俵を稼いだ`);
    addEvent(g, "migrant", p.id, { gain: 2, workers: 2 });
  }

  if (action.type === "nursery") {
    if (p.workersUsed + 1 > p.workers) { addLog(g, `${p.name}：働き手不足`); return; }
    p.seedlings += 1;
    p.workersUsed += 1;
    addLog(g, `${p.name}：育苗 → 苗+1（計${p.seedlings}）。翌春以降の植え付けで成長+1に使える`);
    addEvent(g, "nursery", p.id, { seedlings: p.seedlings });
  }

  if (action.type === "till") {
    const { fieldId } = action;
    const f = p.fields.find(x => x.id === fieldId);
    if (!f || f.status !== "empty") { addLog(g, `${p.name}：耕せる空き田がありません`); return; }
    if (f.tilled) { addLog(g, `${p.name}：すでに耕済みです`); return; }
    if (p.workersUsed + 1 > p.workers) { addLog(g, `${p.name}：働き手不足`); return; }
    f.tilled = true;
    p.workersUsed += 1;
    addLog(g, `${p.name}：土づくり → この田の次の作物は品質+1で始まる`);
    addEvent(g, "till", p.id, {});
  }

  if (action.type === "strawwork") {
    if (p.strawworkThisYear) { addLog(g, `${p.name}：藁仕事は年1回のみです`); return; }
    if (p.workersUsed + 2 > p.workers) { addLog(g, `${p.name}：働き手不足（藁仕事は2人）`); return; }
    p.reputation += 1;
    p.strawworkThisYear = true;
    p.workersUsed += 2;
    addLog(g, `${p.name}：藁仕事（縄ない・働き手2）→ 評判+1（計${p.reputation}）`);
    addEvent(g, "strawwork", p.id, { repDelta: 1, workers: 2 });
  }

  if (action.type === "compost") {
    if (g.seasonIdx < 2) { addLog(g, `${p.name}：堆肥作りは秋・冬のみ`); return; }
    if (p.workersUsed + 1 > p.workers) { addLog(g, `${p.name}：働き手不足`); return; }
    p.compost += 2;
    p.workersUsed += 1;
    addLog(g, `${p.name}：堆肥作り → 堆肥+2（計${p.compost}）。肥料の俵コストを肩代わり`);
    addEvent(g, "compost", p.id, { compost: p.compost });
  }
}

function advanceAction(g) {
  g.actionTurnIdx++;
  if (g.actionTurnIdx >= g.players.length) {
    g.players.forEach(pl => { pl.workersUsed = 0; });
    doGrowthPhase(g);
    doAdvanceTime(g);
  }
}

function doAdvanceTime(g) {
  addLog(g, `─── ${g.year}年目 ${SEASONS[g.seasonIdx]}R${g.roundInSeason + 1} 終了 ───`);
  const first = g.turnOrder.shift();
  g.turnOrder.push(first);

  if (g.roundInSeason === 0) {
    g.roundInSeason = 1;
    g.phase = "weather_draw";
    g.actionTurnIdx = 0;
  } else {
    g.roundInSeason = 0;
    if (g.seasonIdx < 3) {
      g.seasonIdx++;
      g.phase = "weather_draw";
      g.actionTurnIdx = 0;
    } else {
      beginYearEnd(g); // 年6でも年度末処理（租・保管・維持費）を必ず通す
    }
  }
}

// ── 年度末フェーズ ──

function beginYearEnd(g) {
  addLog(g, `=== ${g.year}年度末 開始 ===`);

  // A. 租：田の数×1俵
  g.players.forEach(p => {
    const rent = p.fields.length;
    const before = totalRiceCount(p);
    payRice(p, rent);
    const paid = before - totalRiceCount(p);
    if (paid < rent) addLog(g, `A. ${p.name}：租 ${rent}俵 → ${paid}俵のみ支払い（俵不足）`);
    else addLog(g, `A. ${p.name}：租 -${paid}俵（田${p.fields.length}枚×1俵）`);
    addEvent(g, "tax", p.id, { due: rent, paid, shortfall: rent - paid });
  });

  // B. 保管リスク：保管量に応じた俵損失（倉あれば半減）
  g.players.forEach(p => {
    const total = totalRiceCount(p);
    if (total === 0) { addLog(g, `B. ${p.name}：保管リスクなし（俵ゼロ）`); return; }
    const raw = total <= 10 ? 0 : total <= 20 ? 1 : total <= 30 ? 2 : 3; // ネズミ大発生を脅威の主役にし、通常の保管リスクは軽め
    if (raw === 0) { addLog(g, `B. ${p.name}：保管リスクなし（${total}俵）`); return; }
    const loss = p.tools.barn ? Math.ceil(raw / 2) : raw;
    const before = totalRiceCount(p);
    payRice(p, loss);
    const paid = before - totalRiceCount(p);
    addLog(g, `B. ${p.name}：保管リスク -${paid}俵（保管${total}俵${p.tools.barn ? "・倉あり→半減" : ""}）`);
    addEvent(g, "storage_risk", p.id, { stored: total, loss: paid, barn: p.tools.barn });
  });

  // B-2. ネズミの大量発生（レア・ゲーム1回まで・備蓄が半分消える大災害／倉で1/4に軽減）
  if (!g.ratOutbreakDone && g.year >= 2 && Math.random() < RAT_OUTBREAK_CHANCE) {
    g.ratOutbreakDone = true;
    addLog(g, "🐀🐀 ネズミの大量発生！ 蔵に入れていない俵が食い荒らされる…");
    g.players.forEach(p => {
      const total = totalRiceCount(p);
      if (total === 0) { addLog(g, `🐀 ${p.name}：被害なし（俵ゼロ）`); return; }
      const lossRate = p.tools.barn ? 0.25 : 0.5; // 倉で被害1/4に軽減
      const loss = Math.ceil(total * lossRate);
      const before = totalRiceCount(p);
      payRice(p, loss);
      const paid = before - totalRiceCount(p);
      addLog(g, `🐀 ${p.name}：ネズミ被害 -${paid}俵（保管${total}俵 → ${p.tools.barn ? "倉で軽減（1/4）" : "倉なし（半減）"}）`);
      addEvent(g, "rat_outbreak", p.id, { stored: total, loss: paid, barn: p.tools.barn });
    });
  }

  // → 維持費(D)を先に徴収してから C. 雇用の質問へ
  g.phase = "year_end";
  doYearEndMaintenance(g);
}

// C. 労働力の雇用：count 個雇う（0=雇用なし）
function doYearEndHire(g, count) {
  const p = g.players[g.yearEndPlayerIdx];
  if (count > 0) {
    const cost = count * 4;
    if (totalRiceCount(p) < cost) { addLog(g, `${p.name}：俵不足（必要${cost}俵）`); return; }
    payRice(p, cost);
    p.workers += count;
    addLog(g, `C. ${p.name}：働き手${count}個雇用（-${cost}俵） → 計${p.workers}個`);
    addEvent(g, "hire", p.id, { count, cost, workersAfter: p.workers });
  } else {
    addLog(g, `C. ${p.name}：雇用なし`);
    addEvent(g, "hire", p.id, { count: 0, cost: 0, workersAfter: p.workers });
  }
  g.yearEndPlayerIdx++;
  if (g.yearEndPlayerIdx >= g.players.length) {
    g.yearEndStep = "E";
    g.yearEndPlayerIdx = 0;
  }
}

// D. 労働力の維持費：保有数×1俵（払えない分だけ労働者が離脱＋評判減）
function doYearEndMaintenance(g) {
  g.players.forEach(p => {
    const cost = p.workers;
    const before = totalRiceCount(p);
    payRice(p, cost);
    const paid = before - totalRiceCount(p);
    const unpaid = cost - paid;
    if (unpaid > 0) {
      p.workers = Math.max(0, p.workers - unpaid);
      p.reputation = Math.max(0, p.reputation - unpaid);
      addLog(g, `D. ${p.name}：維持費${cost}俵中${paid}俵のみ → 労働者${unpaid}人離脱・評判-${unpaid}（働き手${p.workers}）`);
      addEvent(g, "maintenance", p.id, { workers: cost, paid, laidOff: unpaid, repLoss: unpaid });
    } else {
      addLog(g, `D. ${p.name}：維持費 -${paid}俵（${cost}個×1俵）`);
      addEvent(g, "maintenance", p.id, { workers: cost, paid, laidOff: 0, repLoss: 0 });
    }
  });
  // → C. 雇用フェーズへ（出費を済ませた状態で雇用を判断）
  g.yearEndStep = "C";
  g.yearEndPlayerIdx = 0;
}

// E. 位階の昇進（任意）：評判を消費して位階を上げる
function doYearEndRankUp(g, advance) {
  const p = g.players[g.yearEndPlayerIdx];
  if (advance) {
    if (p.rank >= RANK_COSTS.length) { addLog(g, `${p.name}：すでに最高位階`); return; }
    const cost = RANK_COSTS[p.rank];
    if (p.reputation < cost) { addLog(g, `${p.name}：評判不足（必要${cost}）`); return; }
    p.reputation -= cost;
    p.rank++;
    p.landLimit += 2;
    // 待機中の開墾完成地を自動変換
    const remaining = [];
    for (const w of p.wildlands) {
      if (w.gauge >= 3 && p.fields.length < p.landLimit) {
        p.fields.push(createField(`f${p.id}_d${p.fields.length}`));
        addLog(g, `${p.name}：待機中の開墾地が田に変換されました（田${p.fields.length}枚）`);
      } else {
        remaining.push(w);
      }
    }
    p.wildlands = remaining;
    // 新たな荒れ地を2枚付与（新しい土地枠に対応）
    const base = `w${p.id}_r${p.rank}`;
    p.wildlands.push({ id: `${base}_0`, gauge: 0 }, { id: `${base}_1`, gauge: 0 });
    addLog(g, `E. ${p.name}：位階昇進 → ${RANK_LABELS[p.rank]}（評判-${cost}、土地上限${p.landLimit}枚、荒れ地+2）`);
    addEvent(g, "rankup", p.id, { toRank: p.rank, rankLabel: RANK_LABELS[p.rank], cost, landLimit: p.landLimit });
  } else {
    addLog(g, `E. ${p.name}：昇進なし`);
  }
  g.yearEndPlayerIdx++;
  if (g.yearEndPlayerIdx >= g.players.length) {
    finishYearEnd(g);
  }
}

// 年度末ごとの全プレイヤー状態スナップショット（年度末A〜E処理後）
function takeYearSnapshot(g) {
  g.yearSnapshots.push({
    year: g.year,
    players: g.players.map(p => ({
      id: p.id,
      name: p.name,
      rice: { 並: p.rice[0].count, 上質: p.rice[1].count, 特上: p.rice[2].count },
      totalRice: totalRiceCount(p),
      ricePoints: p.rice.reduce((s, r) => s + r.count * r.quality, 0),
      reputation: p.reputation,
      rank: p.rank,
      workers: p.workers,
      fields: p.fields.length,
      landLimit: p.landLimit,
      wildlandsInProgress: p.wildlands.length,
      tools: { ...p.tools },
    })),
  });
}

function finishYearEnd(g) {
  takeYearSnapshot(g); // 年末決算後の状態を記録
  g.players.forEach(p => { p.donatedThisYear = false; p.strawworkThisYear = false; p.workersUsed = 0; });
  if (g.year >= 6) { doEndGame(g); return; }
  g.year++;
  g.seasonIdx = 0; g.roundInSeason = 0;
  g.phase = "weather_draw";
  g.yearEndStep = null; g.yearEndPlayerIdx = 0; g.actionTurnIdx = 0;
  addLog(g, `=== ${g.year}年目 開始 ===`);
}

function doEndGame(g) {
  addLog(g, "=== 6年間が終わりました。最終得点計算 ===");

  g.scores = g.players.map(p => {
    const breakdown = p.rice.map(r => ({
      quality: r.quality,
      count: r.count,
      points: r.count * r.quality,
    }));
    const ricePoints = breakdown.reduce((s, r) => s + r.points, 0);
    const repPoints  = p.reputation;
    const baseScore  = ricePoints + repPoints;
    const misuBonus  = baseScore >= 88 ? 10 : 0;
    const total      = baseScore + misuBonus;
    addLog(g,
      `${p.name}：俵${ricePoints}点 + 評判${repPoints}点` +
      (misuBonus > 0 ? " + 米寿+10点" : "") +
      ` = ${total}点`
    );
    return {
      id: p.id, name: p.name,
      breakdown,
      ricePoints, repPoints, misuBonus, total,
      rank: p.rank, tools: { ...p.tools }, fieldCount: p.fields.length,
    };
  }).sort((a, b) => b.total - a.total);

  addLog(g, `🏆 優勝：${g.scores[0].name}（${g.scores[0].total}点）`);

  // ── 集計指標の構築 ──
  g.exportData = {
    schema: "hojo_suiden_v2_playlog",
    version: 1,
    gameId: g.gameId,
    finishedAt: new Date().toISOString(),
    playerCount: g.playerCount,
    players: g.players.map(p => ({ id: p.id, name: p.name })),
    finalScores: g.scores,
    yearSnapshots: g.yearSnapshots,
    metrics: computeGameMetrics(g),
    events: g.events,
  };

  g.phase = "result";
}

// イベントログからバランス分析用の集計指標を算出
function computeGameMetrics(g) {
  const totalActionsByType = {};
  const byPlayer = g.players.map(p => ({ id: p.id, name: p.name, counts: {} }));
  const weatherCounts = {};
  const harvestByQuality = { 並: 0, 上質: 0, 特上: 0 };
  const varietyPlanted = { 野良稲: 0, 早稲: 0, 中稲: 0, 晩稲: 0 };
  const qLabel = { 1: "並", 2: "上質", 3: "特上" };
  let floods = 0, donations = 0, unusedWorkers = 0, turns = 0;

  for (const e of g.events) {
    if (e.type === "weather") { weatherCounts[e.card] = (weatherCounts[e.card] || 0) + 1; continue; }
    if (e.type === "flood_loss") { floods++; continue; }

    totalActionsByType[e.type] = (totalActionsByType[e.type] || 0) + 1;
    if (e.player != null && byPlayer[e.player]) {
      byPlayer[e.player].counts[e.type] = (byPlayer[e.player].counts[e.type] || 0) + 1;
    }
    if (e.type === "harvest") harvestByQuality[qLabel[e.quality]] += e.count;
    if (e.type === "plant" && varietyPlanted[e.variety] != null) varietyPlanted[e.variety]++;
    if (e.type === "donate") donations++;
    if (e.type === "turn_end") { unusedWorkers += (e.unused || 0); turns++; }
  }

  return {
    totalEvents: g.events.length,
    totalActionsByType,
    actionsByPlayer: byPlayer,
    weatherCounts,
    harvestByQuality,
    varietyPlanted,
    floods,
    donations,
    avgUnusedWorkersPerTurn: turns ? +(unusedWorkers / turns).toFixed(2) : 0,
  };
}

// ===== UI コンポーネント =====

function SetupScreen({ onStart }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(["農家A", "農家B", "農家C", "農家D"]);
  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-3xl font-bold text-amber-800 text-center mb-1">豊穣の水田</h1>
        <p className="text-center text-amber-400 text-sm mb-6">改訂版 v2</p>
        <div className="mb-5">
          <p className="text-sm font-medium text-gray-700 mb-2">プレイヤー数</p>
          <div className="flex gap-2">
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => setCount(n)}
                className={`flex-1 py-2 rounded-lg font-bold text-sm ${count === n ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}>
                {n}人
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2 mb-6">
          {Array.from({ length: count }, (_, i) => (
            <div key={i}>
              <label className="text-xs text-gray-500">プレイヤー {i + 1}</label>
              <input type="text" value={names[i]}
                onChange={e => { const n = [...names]; n[i] = e.target.value; setNames(n); }}
                className="w-full mt-0.5 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          ))}
        </div>
        <button onClick={() => onStart(names.slice(0, count))}
          className="w-full bg-amber-600 text-white rounded-xl py-3 font-bold text-lg hover:bg-amber-700">
          ゲーム開始
        </button>
        <p className="mt-4 text-xs text-gray-400 text-center">6年間 48ラウンドの農業経営ゲーム（2〜4人）</p>
      </div>
    </div>
  );
}

function Header({ game }) {
  const phaseLabel = {
    weather_draw:  "☁️ 天候",
    weather_apply: "⛅ 天候適用",
    action:        "🌿 行動",
    year_end:      "📜 年度末",
    result:        "🏆 終了",
  }[game.phase] ?? "";
  // 手番順表示（行動フェーズ中のみ）
  const turnLine = game.phase === "action"
    ? game.turnOrder.map((pi, ti) => {
        const name = game.players[pi]?.name ?? "";
        const isNow = ti === game.actionTurnIdx;
        return isNow ? `▶${name}` : name;
      }).join(" → ")
    : null;

  return (
    <div className="bg-amber-800 text-white px-4 py-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">🌾 豊穣の水田</span>
        <div className="text-center">
          <div className="font-bold text-sm">{game.year}年目 {SEASONS[game.seasonIdx]} R{game.roundInSeason + 1}</div>
          <div className="text-amber-300 text-xs">{totalRound(game)} / 48 ラウンド</div>
        </div>
        <span className="text-amber-200 text-xs bg-amber-700 px-2 py-0.5 rounded">{phaseLabel}</span>
      </div>
      {turnLine && (
        <div className="text-center text-xs text-amber-300 mt-0.5">{turnLine}</div>
      )}
    </div>
  );
}

function WaterBar({ water }) {
  const color = water === 0 ? "bg-red-400" : water === 1 ? "bg-orange-300" : water <= 3 ? "bg-blue-400" : water === 4 ? "bg-blue-700" : "bg-indigo-900";
  const label = water === 0 ? "干" : water === 5 ? "洪" : water;
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <div key={i} className={`w-2 h-3 rounded-sm ${i <= water ? color : "bg-gray-200"}`} />
        ))}
      </div>
      <span className={`text-xs font-bold ${water === 0 ? "text-red-500" : water === 5 ? "text-indigo-700" : "text-gray-600"}`}>{label}</span>
    </div>
  );
}

function FieldCard({ field, selectable, selected, onClick }) {
  const statusLabel = { empty: "空き", planted: "植付中", mature: "収穫可" }[field.status];
  const borderClass = selected ? "border-amber-500 ring-2 ring-amber-300" : selectable ? "border-blue-300 cursor-pointer hover:border-blue-500" : "border-gray-200";
  return (
    <div onClick={selectable || selected ? onClick : undefined}
      className={`border-2 rounded-lg p-2 text-xs bg-white transition-colors ${borderClass}`}>
      <div className="flex justify-between items-center mb-1">
        <span className={`font-semibold ${field.status === "mature" ? "text-amber-600" : field.status === "planted" ? "text-green-600" : "text-gray-400"}`}>
          {statusLabel}
        </span>
        {field.status !== "empty" && <WaterBar water={field.water} />}
      </div>
      {field.variety && (
        <div className="text-gray-500">
          {field.variety}・{QUALITY_LABEL[field.quality]}
          {field.status === "planted" && ` ${field.growth}/${field.requiredGrowth}成長`}
          {field.fertilized && " ✨"}
          {field.growthFertilized && " 🌿"}
        </div>
      )}
      {field.status === "mature" && field.overripe > 0 && (
        <div className="text-red-500 font-bold mt-0.5">⚠ 傷み始め（早めに収穫）</div>
      )}
      {field.status === "empty" && field.tilled && (
        <div className="text-orange-600 font-semibold">🚜 耕済（次作 品質+1）</div>
      )}
      {field.status === "empty" && <WaterBar water={field.water} />}
    </div>
  );
}

function RiceDisplay({ rice }) {
  const COLORS = { 1: "text-gray-600", 2: "text-blue-600", 3: "text-purple-700" };
  const total = rice.reduce((s, r) => s + r.count, 0);
  const points = rice.reduce((s, r) => s + r.count * r.quality, 0);
  return (
    <div className="bg-amber-50 rounded-lg px-2 py-1.5 text-xs flex items-center gap-2 flex-wrap">
      <span className="font-bold text-amber-800">🌾 {total}俵（{points}pt）</span>
      {rice.map(r => r.count > 0 && (
        <span key={r.quality} className={COLORS[r.quality]}>{QUALITY_LABEL[r.quality]}×{r.count}</span>
      ))}
      {total === 0 && <span className="text-gray-400">なし</span>}
    </div>
  );
}

function PlayerBoard({ player, isActive }) {
  const totalRice   = player.rice.reduce((s, r) => s + r.count, 0);
  const ricePoints  = player.rice.reduce((s, r) => s + r.count * r.quality, 0);
  const baseScore   = ricePoints + player.reputation;
  const misuBonus   = baseScore >= 88 ? 10 : 0;
  const previewScore = baseScore + misuBonus;
  return (
    <div className={`rounded-xl border-2 p-3 ${isActive ? "border-amber-500 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-sm">{isActive && <span className="text-green-500 mr-1">▶</span>}{player.name}</h3>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{RANK_LABELS[player.rank]}</span>
          <span className="text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
            暫定{previewScore}点{misuBonus > 0 ? "🎊" : ""}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2 text-xs text-center">
        <div className="bg-amber-100 rounded-lg py-1">
          <div className="font-bold text-amber-800">{totalRice}俵</div>
          <div className="text-gray-500">{ricePoints}pt</div>
        </div>
        <div className="bg-purple-100 rounded-lg py-1">
          <div className="font-bold text-purple-800">評判{player.reputation}</div>
          <div className="text-gray-500 text-xs">
            {player.rank < RANK_COSTS.length
              ? `昇進-${Math.max(0, RANK_COSTS[player.rank] - player.reputation)}`
              : "最高位階"}
          </div>
        </div>
        <div className="bg-green-100 rounded-lg py-1">
          <div className={`font-bold ${player.workersUsed >= player.workers ? "text-red-600" : "text-green-800"}`}>
            {player.workers - player.workersUsed}/{player.workers}
          </div>
          <div className="text-gray-500">働き手</div>
        </div>
      </div>
      <RiceDisplay rice={player.rice} />
      <div className="mt-2">
        <div className="text-xs text-gray-500 mb-1">田（{player.fields.length}/{player.landLimit}枚）</div>
        <div className="grid grid-cols-2 gap-1">
          {player.fields.map(f => <FieldCard key={f.id} field={f} />)}
        </div>
      </div>
      {player.wildlands.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          荒れ地：{player.wildlands.map(w => (
            <span key={w.id} className={`ml-1 border rounded px-1 ${w.gauge >= 3 ? "bg-amber-100 border-amber-400 text-amber-700 font-bold" : "bg-yellow-50 border-yellow-200"}`}>
              {w.gauge}/3{w.gauge >= 3 ? "✓" : ""}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-400">
        {player.tools.plow && <span className="bg-gray-100 rounded px-1">道具</span>}
        {player.tools.ox   && <span className="bg-gray-100 rounded px-1">牛</span>}
        {player.tools.barn && <span className="bg-gray-100 rounded px-1">倉</span>}
        {player.seedlings > 0 && <span className="bg-emerald-100 text-emerald-600 rounded px-1">苗×{player.seedlings}</span>}
        {player.compost > 0 && <span className="bg-amber-100 text-amber-600 rounded px-1">堆肥×{player.compost}</span>}
        {player.donatedThisYear && <span className="bg-red-100 text-red-500 rounded px-1">献上済</span>}
        {player.strawworkThisYear && <span className="bg-purple-100 text-purple-500 rounded px-1">藁仕事済</span>}
      </div>
    </div>
  );
}

// アクション選択UI
function ActionSubPanel({ actor, seasonIdx, update, onDone }) {
  const [mode, setMode] = useState(null);
  const [chosenVariety, setChosenVariety] = useState(null);
  const [chosenField, setChosenField] = useState(null);

  const actorIdx = actor.id;
  const remaining = actor.workers - actor.workersUsed;
  const canAct = remaining > 0;
  const canPlantSeason = seasonIdx <= 1;   // 春・夏のみ（収穫は通年可）
  const canAutumnWinter = seasonIdx >= 2;  // 秋・冬のみ（育苗・土づくり・藁仕事）
  const emptyFields  = actor.fields.filter(f => f.status === "empty");
  const plantedFields = actor.fields.filter(f => f.status === "planted");
  const matureFields = actor.fields.filter(f => f.status === "mature");
  const reclaimable   = actor.wildlands.filter(w => w.gauge < 3);
  const reclaimBonus  = (actor.tools.plow ? 1 : 0) + (actor.tools.ox ? 1 : 0);
  const donableRice   = actor.rice.filter(r => r.quality >= 2 && r.count > 0); // 献上可能な俵
  const canDonate     = !actor.donatedThisYear && remaining >= 2 && donableRice.length > 0;

  function reset() { setMode(null); setChosenVariety(null); setChosenField(null); }
  function exec(action) { update(g => executeAction(g, actorIdx, action)); reset(); }

  // ── 植え付け：品種 ──
  if (mode === "plant_variety") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-green-700">品種を選択：</p>
        {Object.entries(VARIETIES).map(([name, def]) => {
          const ok = totalRiceCount(actor) >= def.cost;
          return (
            <button key={name} disabled={!ok}
              onClick={() => { setChosenVariety(name); setMode("plant_field"); }}
              className={`w-full text-left rounded-lg px-3 py-2 text-xs border ${ok ? "border-green-300 bg-green-50 hover:bg-green-100" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
              <span className="font-bold">{name}</span>
              <span className="ml-2 text-gray-500">{def.desc}</span>
              {!ok && <span className="ml-1 text-red-400">俵不足</span>}
            </button>
          );
        })}
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 植え付け：田選択 ──
  if (mode === "plant_field") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-green-700">{chosenVariety}を植える田を選択：</p>
        <div className="grid grid-cols-2 gap-1">
          {emptyFields.map(f => (
            <FieldCard key={f.id} field={f} selectable
              onClick={() => {
                if (actor.seedlings > 0) { setChosenField(f.id); setMode("plant_confirm"); }
                else exec({ type: "plant", fieldId: f.id, variety: chosenVariety });
              }} />
          ))}
        </div>
        {emptyFields.length === 0 && <p className="text-xs text-gray-400">空き田がありません</p>}
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 植え付け：苗を使うか確認 ──
  if (mode === "plant_confirm") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-green-700">育苗の苗を使いますか？（ストック：{actor.seedlings}）</p>
        <button onClick={() => exec({ type: "plant", fieldId: chosenField, variety: chosenVariety, useSeedling: true })}
          className="w-full rounded-lg px-3 py-2 text-xs border border-green-400 bg-green-100 hover:bg-green-200">
          🌱 苗を使って植える（成長+1で開始・残り{actor.seedlings - 1}）
        </button>
        <button onClick={() => exec({ type: "plant", fieldId: chosenField, variety: chosenVariety, useSeedling: false })}
          className="w-full rounded-lg px-3 py-2 text-xs border border-green-300 bg-green-50 hover:bg-green-100">
          そのまま植える（苗を温存）
        </button>
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 水を引く：田選択 ──
  if (mode === "irrigate_field") {
    const irrigatable = actor.fields.filter(f => f.water < 5);
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-blue-700">水を引く田（水位+2）：</p>
        <div className="grid grid-cols-2 gap-1">
          {irrigatable.map(f => (
            <FieldCard key={f.id} field={f} selectable
              onClick={() => exec({ type: "irrigate", fieldId: f.id })} />
          ))}
        </div>
        {irrigatable.length === 0 && <p className="text-xs text-gray-400">全田が水位5です</p>}
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 肥料：種類選択 ──
  if (mode === "fert_type") {
    const qFertable = plantedFields.filter(f => !f.fertilized && f.quality < (VARIETIES[f.variety]?.maxQuality ?? 3));
    const gFertable = plantedFields.filter(f => !f.growthFertilized && f.growth < f.requiredGrowth);
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-yellow-700">肥料の種類を選択（堆肥1 or 俵1・働き手1）：</p>
        {actor.compost > 0 && <p className="text-xs text-amber-600">🍂 堆肥{actor.compost}個あり：俵より優先して自動消費</p>}
        <button onClick={() => setMode("fertilize_field")}
          disabled={qFertable.length === 0 || (totalRiceCount(actor) < 1 && actor.compost <= 0)}
          className="w-full rounded-lg px-3 py-2 text-xs border border-yellow-300 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-40">
          ✨ 品質肥料（品質+1）{qFertable.length === 0 && <span className="ml-1 text-gray-400">対象なし</span>}
        </button>
        <button onClick={() => setMode("growthfert_field")}
          disabled={gFertable.length === 0 || (totalRiceCount(actor) < 1 && actor.compost <= 0)}
          className="w-full rounded-lg px-3 py-2 text-xs border border-lime-400 bg-lime-50 hover:bg-lime-100 disabled:opacity-40">
          🌿 成長肥料（成長+1）{gFertable.length === 0 && <span className="ml-1 text-gray-400">対象なし</span>}
        </button>
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 品質肥料：田選択 ──
  if (mode === "fertilize_field") {
    const fertilizable = plantedFields.filter(f => !f.fertilized && f.quality < (VARIETIES[f.variety]?.maxQuality ?? 3));
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-yellow-700">品質肥料をやる田を選択（俵1・品質+1）：</p>
        <div className="grid grid-cols-2 gap-1">
          {fertilizable.map(f => (
            <FieldCard key={f.id} field={f} selectable
              onClick={() => exec({ type: "fertilize", fieldId: f.id })} />
          ))}
        </div>
        {fertilizable.length === 0 && <p className="text-xs text-gray-400">対象なし（植付中・未施肥・品質上限未満）</p>}
        <button onClick={() => setMode("fert_type")} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 成長肥料：田選択 ──
  if (mode === "growthfert_field") {
    const gfertable = plantedFields.filter(f => !f.growthFertilized && f.growth < f.requiredGrowth);
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-lime-700">成長肥料をやる田を選択（俵1・成長+1）：</p>
        <div className="grid grid-cols-2 gap-1">
          {gfertable.map(f => (
            <FieldCard key={f.id} field={f} selectable
              onClick={() => exec({ type: "growth_fert", fieldId: f.id })} />
          ))}
        </div>
        {gfertable.length === 0 && <p className="text-xs text-gray-400">対象なし（植付中・成長肥料未使用）</p>}
        <button onClick={() => setMode("fert_type")} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── ショップ：道具/牛/倉の購入 ──
  if (mode === "shop") {
    const SHOP = [
      { item: "plow", label: "道具", emoji: "🔧", riceCost: 8,  repCost: 4, owned: actor.tools.plow, desc: "開墾+1 / 収穫+1俵" },
      { item: "ox",   label: "牛",   emoji: "🐂", riceCost: 16, repCost: 6, owned: actor.tools.ox,   desc: "開墾+1 / 植え付けコスト-1俵" },
      { item: "barn", label: "倉",   emoji: "🏠", riceCost: 6,  repCost: 3, owned: actor.tools.barn, desc: "保管リスク半減 / ネズミ被害1/4" },
    ];
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-teal-700">購入する道具を選択（働き手不要・即時取得）：</p>
        <div className="space-y-1.5">
          {SHOP.map(s => {
            const canPayRice = totalRiceCount(actor) >= s.riceCost;
            const canPayRep  = actor.reputation >= s.repCost;
            return (
              <div key={s.item} className={`rounded-lg border p-2 ${s.owned ? "border-gray-200 bg-gray-50 opacity-50" : "border-teal-300 bg-teal-50"}`}>
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-sm">{s.emoji}</span>
                  <span className="font-bold text-sm">{s.label}</span>
                  {s.owned && <span className="text-xs text-green-600 ml-1">所持済み</span>}
                  <span className="text-xs text-gray-500 ml-2">{s.desc}</span>
                </div>
                {!s.owned && (
                  <div className="flex gap-1">
                    <button onClick={() => exec({ type: "buy_tool", item: s.item, payment: "rice" })}
                      disabled={!canPayRice}
                      className="flex-1 text-xs rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 py-1 disabled:opacity-40">
                      {s.riceCost}俵で購入
                    </button>
                    <button onClick={() => exec({ type: "buy_tool", item: s.item, payment: "reputation" })}
                      disabled={!canPayRep}
                      className="flex-1 text-xs rounded border border-purple-300 bg-purple-50 hover:bg-purple-100 py-1 disabled:opacity-40">
                      評判{s.repCost}で購入
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 献上：俵選択 ──
  if (mode === "donate_select") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-red-700">献上する俵を選択（働き手2消費・年1回・評判+2）：</p>
        <div className="bg-red-50 rounded-lg p-2 text-xs text-gray-600 space-y-0.5">
          <p>・上質/特上の俵を1個、お上に納めます</p>
          <p>・今年はあと1回使えます → 献上後は年末まで使用不可</p>
        </div>
        <div className="space-y-1.5">
          {donableRice.map(r => (
            <button key={r.quality}
              onClick={() => exec({ type: "donate", quality: r.quality })}
              className="w-full text-left rounded-lg px-3 py-2 text-sm border border-red-300 bg-red-50 hover:bg-red-100">
              <span className="font-bold text-red-800">{QUALITY_LABEL[r.quality]}</span>
              <span className="text-gray-600 ml-2">の俵を1個納める（残{r.count}個）</span>
              <span className="ml-2 text-purple-600 font-bold">評判+2</span>
            </button>
          ))}
          {donableRice.length === 0 && (
            <p className="text-xs text-gray-400">上質・特上の俵がありません</p>
          )}
        </div>
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 開墾：荒れ地選択 ──
  if (mode === "reclaim_land") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-stone-700">
          開墾する荒れ地を選択（ゲージ+{1 + reclaimBonus}{reclaimBonus > 0 ? `、道具ボーナス+${reclaimBonus}` : ""}）：
        </p>
        {reclaimable.length === 0 && <p className="text-xs text-gray-400">開墾できる荒れ地がありません</p>}
        <div className="space-y-1">
          {actor.wildlands.map(w => {
            const done = w.gauge >= 3;
            return (
              <button key={w.id} disabled={done}
                onClick={() => exec({ type: "reclaim", wildlandId: w.id })}
                className={`w-full text-left rounded-lg px-3 py-2 text-xs border ${done ? "border-gray-200 bg-gray-50 text-gray-400" : "border-stone-300 bg-stone-50 hover:bg-stone-100"}`}>
                <span className="font-bold">荒れ地</span>
                <span className="ml-2">ゲージ {w.gauge}/3</span>
                {done
                  ? <span className="ml-2 text-amber-500">（完成待機中・位階昇進で変換）</span>
                  : <span className="ml-2 text-stone-500">→ 完成まで{3 - w.gauge}ゲージ</span>
                }
              </button>
            );
          })}
        </div>
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 収穫：田選択 ──
  if (mode === "harvest_field") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-amber-700">収穫する田を選択：</p>
        <div className="grid grid-cols-2 gap-1">
          {matureFields.map(f => {
            const def = VARIETIES[f.variety];
            return (
              <FieldCard key={f.id} field={f} selectable
                onClick={() => { setChosenField(f.id); setMode("harvest_workers"); }} />
            );
          })}
        </div>
        {matureFields.length === 0 && <p className="text-xs text-gray-400">収穫可能な田がありません</p>}
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 収穫：働き手数 ──
  if (mode === "harvest_workers") {
    const f = actor.fields.find(x => x.id === chosenField);
    const def = f ? VARIETIES[f.variety] : null;
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-amber-700">収穫の規模を選択：</p>
        {def && (() => {
          const pb = actor.tools.plow ? 1 : 0;
          return (
            <div className="text-xs text-gray-500 bg-amber-50 rounded p-2">
              {f.variety}（{QUALITY_LABEL[f.quality]}）{pb > 0 && <span className="text-green-600 ml-1">道具+1</span>}
              <span className="ml-2">通常{def.harvestMin + pb}俵 / 豊作{def.harvestMax + pb}俵</span>
            </div>
          );
        })()}
        <button onClick={() => exec({ type: "harvest", fieldId: chosenField, workers: 1 })}
          disabled={remaining < 1}
          className="w-full rounded-lg px-3 py-2 text-xs border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-40">
          働き手1個 → {def ? def.harvestMin + (actor.tools.plow ? 1 : 0) : "?"}俵（通常収穫）
        </button>
        <button onClick={() => exec({ type: "harvest", fieldId: chosenField, workers: 2 })}
          disabled={remaining < 2}
          className="w-full rounded-lg px-3 py-2 text-xs border border-amber-400 bg-amber-100 hover:bg-amber-200 disabled:opacity-40">
          働き手2個 → {def ? def.harvestMax + (actor.tools.plow ? 1 : 0) : "?"}俵（豊作収穫）
        </button>
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── 土づくり：田選択 ──
  if (mode === "till_field") {
    const tillable = actor.fields.filter(f => f.status === "empty" && !f.tilled);
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-orange-700">耕す田を選択（次に植える作物が品質+1で始まる）：</p>
        <div className="grid grid-cols-2 gap-1">
          {tillable.map(f => (
            <FieldCard key={f.id} field={f} selectable
              onClick={() => exec({ type: "till", fieldId: f.id })} />
          ))}
        </div>
        {tillable.length === 0 && <p className="text-xs text-gray-400">耕せる空き田がありません</p>}
        <button onClick={reset} className="text-xs text-gray-400 underline">← 戻る</button>
      </div>
    );
  }

  // ── メインメニュー ──
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        働き手 {remaining}/{actor.workers} 個残り
        {!canAct && <span className="ml-1 text-orange-500 font-bold">（全消費済み）</span>}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => setMode("plant_variety")}
          disabled={!canAct || !canPlantSeason || emptyFields.length === 0}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-green-300 bg-green-50 hover:bg-green-100 disabled:opacity-40">
          🌱 植え付け
          {!canPlantSeason && <div className="text-gray-400 font-normal text-xs">秋冬は不可</div>}
        </button>
        <button onClick={() => setMode("irrigate_field")}
          disabled={!canAct}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-40">
          💧 水を引く
        </button>
        <button onClick={() => setMode("fert_type")}
          disabled={!canAct || (totalRiceCount(actor) < 1 && actor.compost <= 0) || (plantedFields.filter(f => !f.fertilized && f.quality < (VARIETIES[f.variety]?.maxQuality ?? 3)).length === 0 && plantedFields.filter(f => !f.growthFertilized && f.growth < f.requiredGrowth).length === 0)}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-yellow-300 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-40">
          🧪 肥料
          <div className="text-gray-400 font-normal text-xs">品質/成長</div>
        </button>
        <button onClick={() => setMode("harvest_field")}
          disabled={!canAct || matureFields.length === 0}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-amber-400 bg-amber-50 hover:bg-amber-100 disabled:opacity-40">
          🌾 収穫
          {matureFields.length === 0 && <div className="text-gray-400 font-normal text-xs">成熟田なし</div>}
        </button>
        <button onClick={() => setMode("reclaim_land")}
          disabled={!canAct || actor.wildlands.length === 0}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-stone-400 bg-stone-50 hover:bg-stone-100 disabled:opacity-40">
          ⛏️ 開墾
          {reclaimBonus > 0 && <div className="text-stone-500 font-normal text-xs">道具+{reclaimBonus}</div>}
          {actor.wildlands.length === 0 && <div className="text-gray-400 font-normal text-xs">荒れ地なし</div>}
        </button>
        <button onClick={() => setMode("donate_select")}
          disabled={!canAct || !canDonate}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-red-300 bg-red-50 hover:bg-red-100 disabled:opacity-40">
          🎁 献上
          {actor.donatedThisYear
            ? <div className="text-gray-400 font-normal text-xs">今年済み</div>
            : remaining < 2
              ? <div className="text-gray-400 font-normal text-xs">働き手2必要</div>
              : donableRice.length === 0
                ? <div className="text-gray-400 font-normal text-xs">上質/特上不要</div>
                : <div className="text-red-500 font-normal text-xs">評判+2</div>
          }
        </button>
        <button onClick={() => setMode("shop")}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-teal-400 bg-teal-50 hover:bg-teal-100">
          🛒 購入
          <div className="font-normal text-teal-600 text-xs">道具/牛/倉</div>
        </button>
        <button onClick={() => exec({ type: "migrant" })}
          disabled={!canAct || !canAutumnWinter || remaining < 2}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-lime-400 bg-lime-50 hover:bg-lime-100 disabled:opacity-40">
          💪 出稼ぎ
          {!canAutumnWinter ? <div className="text-gray-400 font-normal text-xs">秋冬のみ</div>
            : remaining < 2 ? <div className="text-gray-400 font-normal text-xs">働き手2必要</div>
            : <div className="font-normal text-lime-600 text-xs">人2→並2俵</div>}
        </button>
        <button onClick={() => exec({ type: "nursery" })}
          disabled={!canAct || !canAutumnWinter}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
          🌿 育苗
          {canAutumnWinter ? <div className="text-emerald-600 font-normal text-xs">苗+1</div> : <div className="text-gray-400 font-normal text-xs">秋冬のみ</div>}
        </button>
        <button onClick={() => setMode("till_field")}
          disabled={!canAct || !canAutumnWinter || emptyFields.filter(f => !f.tilled).length === 0}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-orange-300 bg-orange-50 hover:bg-orange-100 disabled:opacity-40">
          🚜 土づくり
          {canAutumnWinter ? <div className="text-orange-600 font-normal text-xs">次作 品質+1</div> : <div className="text-gray-400 font-normal text-xs">秋冬のみ</div>}
        </button>
        <button onClick={() => exec({ type: "strawwork" })}
          disabled={!canAct || !canAutumnWinter || actor.strawworkThisYear || remaining < 2}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-purple-300 bg-purple-50 hover:bg-purple-100 disabled:opacity-40">
          🪢 藁仕事
          {actor.strawworkThisYear
            ? <div className="text-gray-400 font-normal text-xs">今年済み</div>
            : !canAutumnWinter ? <div className="text-gray-400 font-normal text-xs">秋冬のみ</div>
            : remaining < 2 ? <div className="text-gray-400 font-normal text-xs">働き手2必要</div>
            : <div className="text-purple-600 font-normal text-xs">人2→評判+1</div>}
        </button>
        <button onClick={() => exec({ type: "compost" })}
          disabled={!canAct || !canAutumnWinter}
          className="rounded-lg px-2 py-2 text-xs font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-40">
          🍂 堆肥作り
          {canAutumnWinter ? <div className="text-amber-600 font-normal text-xs">堆肥+2</div> : <div className="text-gray-400 font-normal text-xs">秋冬のみ</div>}
        </button>
      </div>
      <button onClick={onDone}
        className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-green-700">
        行動終了（次のプレイヤーへ）
      </button>
    </div>
  );
}

function ActionPanel({ game, update }) {
  const actorIdx = game.turnOrder[game.actionTurnIdx];
  const actor = game.players[actorIdx];

  if (game.phase === "weather_draw") {
    return (
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
        <h2 className="font-bold text-sky-800 mb-1">☁️ フェーズ0：天候確認</h2>
        <p className="text-xs text-gray-500 mb-3">天候カードを引き、ダイスを振ります（全員に一斉適用）</p>
        <button onClick={() => update(g => doDrawWeather(g))}
          className="bg-sky-600 text-white rounded-lg px-5 py-2 text-sm font-bold hover:bg-sky-700">
          天候カードを引く
        </button>
      </div>
    );
  }

  if (game.phase === "weather_apply") {
    const { card, effects, dice } = game.weatherDraw;
    const cardColor = (() => {
      const e = card?.effect;
      if (!e || e === "none" || e === "cloudy") return "bg-sky-50 border-sky-200";
      if (e === "typhoon" || e === "drought" || e === "cool_summer" || e === "early_frost" || e === "heavy_snow")
        return "bg-red-50 border-red-200";
      return "bg-teal-50 border-teal-200";
    })();
    return (
      <div className={`${cardColor} border rounded-xl p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-sky-800 text-base">☁️ 天候フェーズ</h2>
        </div>
        {/* カード */}
        <div className={`rounded-lg p-2.5 text-center border ${cardColor}`}>
          <div className="text-lg font-bold text-gray-800">【{card?.name}】</div>
          <div className="text-xs text-gray-600 mt-0.5">{card?.desc}</div>
        </div>
        {/* ダイス */}
        <div className="flex gap-2 justify-center">
          {effects.map((e, i) => (
            <div key={i} className="flex flex-col items-center bg-white rounded-lg border border-gray-200 px-3 py-1.5 min-w-[60px]">
              <span className="text-xl">{e.icon}</span>
              <span className="text-xs text-gray-500 mt-0.5">{e.desc}</span>
              <span className="text-xs text-gray-300">（{dice[i]}）</span>
            </div>
          ))}
        </div>
        <button onClick={() => update(g => doApplyWeather(g))}
          className="w-full bg-sky-600 text-white rounded-lg px-5 py-2 text-sm font-bold hover:bg-sky-700">
          適用して行動フェーズへ
        </button>
      </div>
    );
  }

  if (game.phase === "action") {
    if (!actor) return null;
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <h2 className="font-bold text-green-800 mb-1">🌿 フェーズ1：行動</h2>
        <p className="text-sm font-medium text-green-700 mb-2">{actor.name} の手番</p>
        <ActionSubPanel
          key={`${game.actionTurnIdx}-${actor.workersUsed}`}
          actor={actor}
          seasonIdx={game.seasonIdx}
          update={update}
          onDone={() => update(g => {
            const pid = g.turnOrder[g.actionTurnIdx];
            const pl = g.players[pid];
            addLog(g, `${pl.name} 行動終了`);
            addEvent(g, "turn_end", pid, { workersUsed: pl.workersUsed, workersTotal: pl.workers, unused: pl.workers - pl.workersUsed });
            advanceAction(g);
          })}
        />
      </div>
    );
  }

  if (game.phase === "year_end") {
    const currentP = game.players[game.yearEndPlayerIdx];

    // ── 進捗バー（共通） ──
    const progressBar = (
      <div className="flex gap-1">
        {game.players.map((p, i) => (
          <div key={i} className={`flex-1 text-center text-xs py-0.5 rounded ${i < game.yearEndPlayerIdx ? "bg-gray-300 text-gray-500" : i === game.yearEndPlayerIdx ? "bg-orange-400 text-white font-bold" : "bg-orange-100 text-orange-400"}`}>
            {p.name}
          </div>
        ))}
      </div>
    );

    // ── C. 労働力の雇用 ──
    if (game.yearEndStep === "C") {
      const rice = totalRiceCount(currentP);
      return (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-orange-800">📜 年度末 C：労働力の雇用（{game.year}年）</h2>
          {progressBar}
          <div className="bg-white rounded-lg p-2 text-xs space-y-1">
            <p className="font-bold text-gray-700">{currentP.name} の雇用フェーズ</p>
            <p className="text-gray-500">
              働き手：<span className="font-bold text-green-700">{currentP.workers}個</span>
              　俵：<span className="font-bold text-amber-700">{rice}俵</span>
            </p>
            <p className="text-gray-400">雇用コスト：1個=4俵（年度末のみ・解雇不可）</p>
          </div>
          <div className="space-y-1.5">
            <button onClick={() => update(g => doYearEndHire(g, 0))}
              className="w-full rounded-lg px-3 py-2 text-sm font-bold border border-gray-300 bg-white hover:bg-gray-50">
              雇用しない → 次へ
            </button>
            {[1, 2, 3].map(n => {
              const cost = n * 4; const ok = rice >= cost;
              return (
                <button key={n} onClick={() => update(g => doYearEndHire(g, n))} disabled={!ok}
                  className="w-full rounded-lg px-3 py-2 text-sm font-bold border border-green-400 bg-green-50 hover:bg-green-100 disabled:opacity-40">
                  {n}個雇用（-{cost}俵）→ 計{currentP.workers + n}個
                  {!ok && <span className="ml-1 text-red-400 font-normal text-xs">俵不足</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-orange-400">
            ※ 租・保管・維持費はすでに徴収済み。表示の俵はその残りです → 雇用後 E.位階昇進へ
          </p>
        </div>
      );
    }

    // ── E. 位階の昇進 ──
    if (game.yearEndStep === "E") {
      const nextRank = currentP.rank + 1;
      const maxRank = RANK_COSTS.length;
      const canAdvance = currentP.rank < maxRank;
      const cost = canAdvance ? RANK_COSTS[currentP.rank] : null;
      const canAfford = canAdvance && currentP.reputation >= cost;
      const waitingWildlands = currentP.wildlands.filter(w => w.gauge >= 3).length;
      return (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-orange-800">📜 年度末 E：位階の昇進（{game.year}年）</h2>
          {progressBar}
          <div className="bg-white rounded-lg p-2 text-xs space-y-1">
            <p className="font-bold text-gray-700">{currentP.name}</p>
            <p className="text-gray-500">
              現在：<span className="font-bold">{RANK_LABELS[currentP.rank]}</span>
              　評判：<span className="font-bold text-purple-700">{currentP.reputation}</span>
              　土地上限：<span className="font-bold">{currentP.landLimit}枚</span>
            </p>
            {waitingWildlands > 0 && (
              <p className="text-amber-600">⚠ 待機中の開墾完成地が{waitingWildlands}枚あります（昇進で自動変換）</p>
            )}
            {canAdvance && (
              <p className="text-gray-400">
                → {RANK_LABELS[nextRank]}：評判{cost}消費、土地上限+2枚、荒れ地+2枚
              </p>
            )}
            {!canAdvance && <p className="text-gray-400">（最高位階に達しています）</p>}
          </div>
          <div className="space-y-1.5">
            <button onClick={() => update(g => doYearEndRankUp(g, false))}
              className="w-full rounded-lg px-3 py-2 text-sm font-bold border border-gray-300 bg-white hover:bg-gray-50">
              昇進しない → 次へ
            </button>
            {canAdvance && (
              <button onClick={() => update(g => doYearEndRankUp(g, true))} disabled={!canAfford}
                className="w-full rounded-lg px-3 py-2 text-sm font-bold border border-purple-400 bg-purple-50 hover:bg-purple-100 disabled:opacity-40">
                {RANK_LABELS[nextRank]}へ昇進（評判-{cost}）
                {!canAfford && <span className="ml-1 text-red-400 font-normal text-xs">評判不足</span>}
              </button>
            )}
          </div>
        </div>
      );
    }
  }

  return null;
}

function logLineClass(line) {
  if (line.startsWith("==="))                          return "font-bold text-amber-700 pt-0.5";
  if (line.startsWith("───"))                          return "text-gray-400 text-xs";
  if (/台風|干ばつ|大雨|早霜|大雪|冷夏|洪水|曇り/.test(line)) return "text-sky-700";
  if (/恵みの露|豊穣の兆し|小春日和/.test(line))       return "text-teal-600";
  if (/天候カード/.test(line))                         return "text-sky-600 font-medium";
  if (/成熟/.test(line))                               return "text-green-600 font-medium";
  if (/収穫/.test(line))                               return "text-green-700";
  if (/献上/.test(line))                               return "text-red-600";
  if (/評判/.test(line))                               return "text-purple-600";
  if (/租|維持費|保管リスク/.test(line))               return "text-red-500";
  if (/年度末|昇進|雇用/.test(line))                   return "text-orange-600";
  if (/🏆/.test(line))                                 return "font-bold text-yellow-700";
  return "text-gray-600";
}

function EventLog({ log }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 6;
  const reversed = [...log].reverse();
  const displayed = expanded ? reversed : reversed.slice(0, PREVIEW);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
      <div className="flex justify-between items-center mb-1.5">
        <h3 className="text-xs font-bold text-gray-500">📋 ゲームログ</h3>
        {log.length > PREVIEW && (
          <button onClick={() => setExpanded(v => !v)}
            className="text-xs text-blue-400 hover:text-blue-600 underline">
            {expanded ? "折りたたむ" : `全て表示（${log.length}件）`}
          </button>
        )}
      </div>
      <div className={`overflow-y-auto space-y-0.5 ${expanded ? "max-h-56" : ""}`}>
        {log.length === 0
          ? <p className="text-xs text-gray-400">ログなし</p>
          : displayed.map((e, i) => (
              <p key={i} className={`text-xs leading-relaxed ${logLineClass(e)}`}>{e}</p>
            ))
        }
        {!expanded && log.length > PREVIEW && (
          <p className="text-xs text-gray-400 text-center pt-0.5">… 他{log.length - PREVIEW}件</p>
        )}
      </div>
    </div>
  );
}

function GameScreen({ game, update }) {
  const [activeTab, setActiveTab] = useState(0);
  // 行動フェーズに入ったら現在プレイヤーのタブを自動選択
  const actorIdx = game.phase === "action" ? game.turnOrder[game.actionTurnIdx] : -1;
  useEffect(() => { if (actorIdx >= 0) setActiveTab(actorIdx); }, [actorIdx]);

  return (
    <div className="min-h-screen bg-amber-50 flex flex-col">
      <Header game={game} />
      <div className="flex-1 overflow-y-auto p-3 space-y-3 pb-6">
        <div className="flex gap-0.5 border-b border-gray-200">
          {game.players.map((p, i) => {
            const isActing = game.phase === "action" && game.turnOrder[game.actionTurnIdx] === i;
            return (
              <button key={i} onClick={() => setActiveTab(i)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors
                  ${activeTab === i
                    ? "bg-white border border-b-white border-gray-200 text-amber-800 -mb-px"
                    : "text-gray-500 hover:text-amber-700"}`}>
                {isActing && <span className="mr-1 text-green-500">▶</span>}
                {p.name}
              </button>
            );
          })}
        </div>
        <PlayerBoard
          player={game.players[activeTab]}
          isActive={game.phase === "action" && game.turnOrder[game.actionTurnIdx] === activeTab}
        />
        <ActionPanel game={game} update={update} />
        <EventLog log={game.log} />
      </div>
    </div>
  );
}

function ResultScreen({ game, onRestart }) {
  const [showLog, setShowLog] = useState(false);
  const [showData, setShowData] = useState(false);
  const [copied, setCopied] = useState(false);
  const taRef = useRef(null);
  const scores = game.scores ?? [];
  const medals = ["🥇", "🥈", "🥉", "4"];
  const rankEmoji = ["", "🎌", "⛩️", "👑"];

  const jsonText = JSON.stringify(game.exportData ?? {}, null, 2);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
      return;
    } catch (_) { /* fallback below */ }
    const el = taRef.current;
    if (el) {
      el.focus(); el.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_) {}
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-amber-100 p-4">
      <div className="max-w-md mx-auto">

        {/* タイトル */}
        <div className="text-center py-6">
          <div className="text-4xl mb-1">🏆</div>
          <h1 className="text-2xl font-bold text-amber-800">6年間の決算</h1>
          <p className="text-sm text-amber-600 mt-1">豊穣の水田 改訂版</p>
        </div>

        {/* プレイヤー順位カード */}
        <div className="space-y-3 mb-5">
          {scores.map((s, i) => (
            <div key={s.id}
              className={`rounded-2xl p-4 shadow ${i === 0 ? "bg-amber-100 border-2 border-amber-400" : "bg-white border border-gray-200"}`}>
              {/* ヘッダー行 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{medals[i] ?? `${i+1}`}</span>
                  <span className="font-bold text-base">{s.name}</span>
                  <span className="text-xs text-gray-400">{["平民","小名","大名","公家"][s.rank]}{rankEmoji[s.rank]}</span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-amber-800">{s.total}</span>
                  <span className="text-sm text-gray-500 ml-1">点</span>
                </div>
              </div>

              {/* 得点内訳 */}
              <div className="bg-white bg-opacity-70 rounded-xl p-2.5 text-xs space-y-1">
                {/* 俵内訳 */}
                <div className="flex items-start gap-1">
                  <span className="text-gray-500 w-8 shrink-0">俵</span>
                  <div className="flex flex-wrap gap-1 flex-1">
                    {s.breakdown.map(r => r.count > 0 && (
                      <span key={r.quality} className={`rounded px-1.5 py-0.5 ${r.quality===3?"bg-yellow-100 text-yellow-800":r.quality===2?"bg-green-100 text-green-800":"bg-gray-100 text-gray-600"}`}>
                        {QUALITY_LABEL[r.quality]}{r.count}個×{r.quality}={r.points}pt
                      </span>
                    ))}
                    {s.breakdown.every(r => r.count === 0) && <span className="text-gray-400">なし</span>}
                  </div>
                  <span className="font-bold text-amber-700 shrink-0">{s.ricePoints}pt</span>
                </div>
                {/* 評判 */}
                <div className="flex justify-between">
                  <span className="text-gray-500">評判 {s.repPoints} × 1pt</span>
                  <span className="font-bold text-purple-700">{s.repPoints}pt</span>
                </div>
                {/* 米寿ボーナス */}
                {s.misuBonus > 0 && (
                  <div className="flex justify-between text-red-600 font-bold">
                    <span>🎊 米寿ボーナス（88点達成）</span>
                    <span>+10pt</span>
                  </div>
                )}
                {/* 合計 */}
                <div className="flex justify-between border-t border-gray-200 pt-1 font-bold">
                  <span>合計</span>
                  <span className="text-amber-800">{s.total}点</span>
                </div>
              </div>

              {/* 道具・田 */}
              <div className="flex flex-wrap gap-1 mt-2 text-xs text-gray-500">
                <span>田{s.fieldCount}枚</span>
                {s.tools.plow && <span className="bg-gray-100 rounded px-1">🔧道具</span>}
                {s.tools.ox   && <span className="bg-gray-100 rounded px-1">🐂牛</span>}
                {s.tools.barn && <span className="bg-gray-100 rounded px-1">🏠倉</span>}
              </div>
            </div>
          ))}
        </div>

        {/* イベントログ（折りたたみ） */}
        <div className="bg-white rounded-xl border border-gray-200 mb-5 overflow-hidden">
          <button onClick={() => setShowLog(v => !v)}
            className="w-full text-left px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 flex justify-between">
            <span>📜 ゲームログ</span>
            <span className="text-gray-400">{showLog ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          {showLog && (
            <div className="max-h-48 overflow-y-auto px-3 pb-3 space-y-0.5">
              {game.log.map((line, i) => (
                <div key={i} className={`text-xs ${line.startsWith("===") ? "font-bold text-amber-700 pt-1" : line.startsWith("🏆") ? "font-bold text-green-700" : "text-gray-600"}`}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* プレイデータ出力（バランス分析用） */}
        <div className="bg-white rounded-xl border border-gray-200 mb-5 overflow-hidden">
          <button onClick={() => setShowData(v => !v)}
            className="w-full text-left px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 flex justify-between">
            <span>📊 プレイデータ（JSON）</span>
            <span className="text-gray-400">{showData ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          {showData && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center gap-2">
                <button onClick={handleCopy}
                  className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-blue-700">
                  {copied ? "✓ コピーしました" : "クリップボードにコピー"}
                </button>
                <span className="text-xs text-gray-400">
                  {game.exportData ? `${game.exportData.events.length}イベント / ${game.exportData.yearSnapshots.length}年分` : ""}
                </span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                このJSONをClaudeに貼り付けると、行動傾向・資源推移・天候の偏りなどを分析できます。
                コピーできない場合は下のテキストを長押し/全選択してください。
              </p>
              <textarea ref={taRef} readOnly value={jsonText}
                onClick={e => e.target.select()}
                className="w-full h-40 text-[10px] font-mono border border-gray-200 rounded-lg p-2 bg-gray-50 text-gray-700 resize-none" />
            </div>
          )}
        </div>

        <button onClick={onRestart}
          className="w-full bg-amber-600 text-white rounded-xl py-3.5 font-bold text-base hover:bg-amber-700 shadow">
          🌾 もう一度遊ぶ
        </button>
      </div>
    </div>
  );
}

// ===== メインコンポーネント =====
export default function HojoSuiden() {
  const [game, setGame] = useState(null);
  const update = useCallback(fn => {
    setGame(prev => { const g = deepClone(prev); fn(g); return g; });
  }, []);

  if (!game) return <SetupScreen onStart={names => setGame(createGame(names))} />;
  if (game.phase === "result") return <ResultScreen game={game} onRestart={() => setGame(null)} />;
  return <GameScreen game={game} update={update} />;
}
