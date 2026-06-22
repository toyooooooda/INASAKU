// ===== ゲームエンジン（純ロジック・React非依存） =====
// boardgame.io の move/hook 内（immer ドラフト）で G を直接ミューテートして使う。
import {
  SEASONS, QUALITY_LABEL, RANK_COSTS, RAT_OUTBREAK_CHANCE,
  VARIETIES, WEATHER_CARDS, diceEffect,
} from './constants.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const totalRiceCount = (p) => p.rice.reduce((s, r) => s + r.count, 0);
export const ricePoints = (p) => p.rice.reduce((s, r) => s + r.count * r.quality, 0);

// 俵を amount 枚支払う（並→上質→特上の順）。足りなければ false
export function payRice(p, amount) {
  let rem = amount;
  for (let i = 0; i < 3 && rem > 0; i++) {
    const t = Math.min(rem, p.rice[i].count);
    p.rice[i].count -= t;
    rem -= t;
  }
  return rem === 0;
}

// 水位 → 成長修正（-99=洪水流出）
export function waterMod(water) {
  if (water <= 1) return 0;   // 干ばつ/低水位：成長なし
  if (water <= 3) return 1;   // 最適
  if (water === 4) return 0;  // 病害：成長なし
  return -99;                 // 洪水：流出
}

function totalRound(G) {
  return (G.year - 1) * 8 + G.seasonIdx * 2 + G.roundInSeason + 1;
}

export function addLog(G, msg) {
  G.log.push(`[${G.year}年 ${SEASONS[G.seasonIdx]}R${G.roundInSeason + 1}] ${msg}`);
  if (G.log.length > 200) G.log.shift();
}

export function addEvent(G, type, playerID, data = {}) {
  G.events.push({
    seq: G.events.length, round: totalRound(G), year: G.year,
    season: SEASONS[G.seasonIdx], r: G.roundInSeason + 1, stage: G.stage,
    player: playerID == null ? null : Number(playerID), type, ...data,
  });
}

export function createField(id) {
  return {
    id, status: 'empty', variety: null, growth: 0, requiredGrowth: 0,
    quality: 1, water: 2, fertilized: false, growthFertilized: false,
    overripe: 0, tilled: false,
  };
}

export function createPlayer(i, name) {
  return {
    id: i, name: name || `農家${i + 1}`,
    rice: [{ quality: 1, count: 8 }, { quality: 2, count: 0 }, { quality: 3, count: 0 }],
    reputation: 0, rank: 0, landLimit: 4,
    workers: 3, workersUsed: 0,
    tools: { plow: false, ox: false, barn: false, canal: false, tank: false },
    seedlings: 0, compost: 0,
    waterReserve: 0,
    donatedThisYear: false, strawworkThisYear: false,
    penaltyNextSpring: 0,
    fields: [createField(`f${i}_0`), createField(`f${i}_1`)],
    wildlands: [
      { id: `w${i}_0`, gauge: 0 }, { id: `w${i}_1`, gauge: 0 },
      { id: `w${i}_2`, gauge: 0 }, { id: `w${i}_3`, gauge: 0 },
    ],
  };
}

// ===== 天候 =====
function applyDie(G, type) {
  G.players.forEach((p) => p.fields.forEach((f) => {
    if (type === 'sun') f.water = clamp(f.water - 1, 0, 5);
    else if (type === 'rain') f.water = clamp(f.water + 1, 0, 5);
    else if (type === 'star') { if (f.status === 'planted') f.growth += 1; }
    // wind: M1では効果なし
  }));
}

function applyCardEffect(G, card) {
  const all = (fn) => G.players.forEach((p) => p.fields.forEach(fn));
  switch (card.effect) {
    case 'typhoon':
      all((f) => { if ((f.status === 'planted' || f.status === 'mature') && f.quality > 1) f.quality -= 1; });
      addLog(G, '台風：全田 品質-1'); break;
    case 'cool_summer':
      if (G.seasonIdx === 1) { all((f) => { if (f.status === 'planted') f.growth = Math.max(0, f.growth - 1); }); addLog(G, '冷夏：全田 成長-1'); }
      break;
    case 'early_frost':
      if (G.seasonIdx === 2) { all((f) => { if (f.variety === '晩稲' && f.status === 'planted') f.growth = Math.max(0, f.growth - 2); }); addLog(G, '早霜：晩稲 成長-2'); }
      break;
    case 'heavy_snow':
      if (G.seasonIdx === 3) { G.players.forEach((p) => { p.penaltyNextSpring = (p.penaltyNextSpring || 0) + 1; }); addLog(G, '大雪：次の春 各-1行動'); }
      break;
    case 'mild_day':
      G.players.forEach((p) => { p.rice[0].count += 2; }); addLog(G, '小春日和：全員 並俵+2'); break;
    case 'heavy_rain':
      all((f) => { f.water = clamp(f.water + 2, 0, 5); }); addLog(G, '大雨：全田 水位+2'); break;
    case 'gentle_rain':
      all((f) => { f.water = clamp(f.water + 1, 0, 5); }); addLog(G, '恵みの露：全田 水位+1'); break;
    case 'drought':
      all((f) => { f.water = clamp(f.water - 2, 0, 5); }); addLog(G, '干ばつ：全田 水位-2'); break;
    case 'bountiful':
      all((f) => { if (f.status === 'planted') f.growth += 1; }); addLog(G, '豊穣の兆し：全田 成長+1'); break;
    case 'cloudy':
      G.cloudyThisRound = true; addLog(G, '曇り：このラウンドは蒸発なし'); break;
    default: break;
  }
}

// 天候による成長増加で即成熟するケースを処理（doGrowthPhase を待たずに反映）
function sweepMaturity(G) {
  G.players.forEach((p) => p.fields.forEach((f) => {
    if (f.status === 'planted' && f.growth >= f.requiredGrowth) {
      f.status = 'mature'; f.overripe = 0;
      addLog(G, `${p.name}の${f.variety}が成熟！（${QUALITY_LABEL[f.quality]}）`);
    }
  }));
}

// 天候・ダイスから水プールの補正を計算
function calcWaterPool(numPlayers, card, effects) {
  const base = numPlayers + 1;
  let bonus = 0;
  effects.forEach((e) => {
    if (e.type === 'rain') bonus += 1;
    else if (e.type === 'sun') bonus -= 1;
  });
  const cardBonus = { heavy_rain: 3, gentle_rain: 1, drought: -2 }[card.effect] ?? 0;
  return Math.max(0, base + bonus + cardBonus);
}

export function drawAndApplyWeather(G, random) {
  G.cloudyThisRound = false;
  if (!G.weatherDeck || G.weatherDeck.length === 0) G.weatherDeck = random.Shuffle([...WEATHER_CARDS]);
  const card = G.weatherDeck.pop();
  const dice = [random.Die(6), random.Die(6)];
  const effects = dice.map(diceEffect);
  G.weather = { card, dice, effects };

  // 水プールを設定
  G.waterPool = calcWaterPool(G.players.length, card, effects);

  // 水桶を持つプレイヤーの蓄積に+2補充（上限6）
  G.players.forEach((p) => {
    if (p.tools.tank) p.waterReserve = Math.min((p.waterReserve || 0) + 2, 6);
  });

  addLog(G, `天候【${card.name}】${card.desc} ／ ${effects.map((e, i) => `${e.icon}(${dice[i]})`).join(' ')} ／ 水プール${G.waterPool}`);
  effects.forEach((e) => applyDie(G, e.type));
  applyCardEffect(G, card);
  sweepMaturity(G);
  addEvent(G, 'weather', null, { card: card.name, effect: card.effect, dice: [...dice], waterPool: G.waterPool });
}

// 水を引く際の水源を決定してプール/水桶を消費。戻り値: 'pool'|'tank'|'empty'
export function consumeWaterSource(G, p) {
  if (G.waterPool > 0) { G.waterPool -= 1; return 'pool'; }
  if (p.waterReserve > 0) { p.waterReserve -= 1; return 'tank'; }
  return 'empty';
}

// ===== 成長フェーズ =====
export function doGrowthPhase(G) {
  const evap = G.cloudyThisRound ? 0 : 1;
  G.players.forEach((p) => p.fields.forEach((f) => {
    if (f.status === 'empty') { f.water = clamp(f.water - evap, 0, 5); return; }
    if (f.status === 'mature') {
      f.water = clamp(f.water - evap, 0, 5);
      f.overripe = (f.overripe || 0) + 1;
      if (f.overripe >= 2 && f.quality > 1) {
        f.quality -= 1; f.overripe = 0;
        addLog(G, `${p.name}の${f.variety}が傷んで品質低下（→${QUALITY_LABEL[f.quality]}）`);
      }
      return;
    }
    // planted
    const mod = waterMod(f.water);
    f.water = clamp(f.water - evap, 0, 5);
    if (mod === -99) {
      addLog(G, `${p.name}の${f.variety}が洪水で流出！`);
      Object.assign(f, createField(f.id)); f.water = 0; return;
    }
    f.growth += mod;
    if (f.growth >= f.requiredGrowth) { f.status = 'mature'; f.overripe = 0; addLog(G, `${p.name}の${f.variety}が成熟！（${QUALITY_LABEL[f.quality]}）`); }
  }));
  G.cloudyThisRound = false;
}

// ===== ラウンド進行（最終プレイヤーの手番終了時に呼ぶ）=====
// 成長 → 季節/ラウンド進行。年が終われば年度末の自動処理を実行し stage='yearEnd'。
export function endOfRound(G, random) {
  doGrowthPhase(G);
  // 毎ラウンド先頭プレイヤーをローテーション
  if (G.roundPlayOrder) {
    G.roundPlayOrder = [...G.roundPlayOrder.slice(1), G.roundPlayOrder[0]];
  }
  if (G.roundInSeason === 0) {
    G.roundInSeason = 1;
  } else {
    G.roundInSeason = 0;
    if (G.seasonIdx < 3) {
      G.seasonIdx += 1;
    } else {
      runYearEndAuto(G, random);
      G.stage = 'yearEnd';
      G.yearEndPlayerIdx = 0;
    }
  }
}

// ===== 年度末の自動処理（対話の前に出費を済ませる）=====
function runYearEndAuto(G, random) {
  addLog(G, `=== ${G.year}年度末 ===`);
  const expenses = G.players.map((p) => ({ name: p.name, rent: 0, storage: 0, rats: 0, maintenance: 0, departed: 0 }));
  // 1. 租
  G.players.forEach((p, i) => {
    const rent = p.fields.length; const before = totalRiceCount(p);
    payRice(p, rent); expenses[i].rent = before - totalRiceCount(p);
    addLog(G, `租：${p.name} -${expenses[i].rent}俵（田${p.fields.length}）`);
  });
  // 2. 保管リスク（軽め・倉で半減）
  G.players.forEach((p, i) => {
    const total = totalRiceCount(p);
    const raw = total <= 10 ? 0 : total <= 20 ? 1 : total <= 30 ? 2 : 3;
    if (raw === 0) return;
    const loss = p.tools.barn ? Math.ceil(raw / 2) : raw;
    const before = totalRiceCount(p); payRice(p, loss);
    expenses[i].storage = before - totalRiceCount(p);
    addLog(G, `保管リスク：${p.name} -${expenses[i].storage}俵（保管${total}${p.tools.barn ? '・倉' : ''}）`);
  });
  // 3. ネズミの大量発生（レア・甚大・ゲーム1回）
  if (!G.ratOutbreakDone && G.year >= 2 && random.Number() < RAT_OUTBREAK_CHANCE) {
    G.ratOutbreakDone = true;
    addLog(G, '🐀🐀 ネズミの大量発生！');
    G.players.forEach((p, i) => {
      const total = totalRiceCount(p); if (total === 0) return;
      const loss = Math.ceil(total * (p.tools.barn ? 0.25 : 0.5));
      const before = totalRiceCount(p); payRice(p, loss);
      expenses[i].rats = before - totalRiceCount(p);
      addLog(G, `🐀 ${p.name} -${expenses[i].rats}俵（保管${total}${p.tools.barn ? '・倉で軽減' : ''}）`);
    });
  }
  // 4. 維持費（払えない分だけ離脱＋評判減）
  G.players.forEach((p, i) => {
    const cost = p.workers; const before = totalRiceCount(p);
    payRice(p, cost); const paid = before - totalRiceCount(p); const unpaid = cost - paid;
    expenses[i].maintenance = paid;
    if (unpaid > 0) {
      expenses[i].departed = unpaid;
      p.workers = Math.max(0, p.workers - unpaid);
      p.reputation = Math.max(0, p.reputation - unpaid);
      addLog(G, `維持費：${p.name} ${paid}俵のみ→労働者${unpaid}人離脱・評判-${unpaid}（働き手${p.workers}）`);
    } else {
      addLog(G, `維持費：${p.name} -${paid}俵`);
    }
  });
  G.lastYearEndExpenses = { year: G.year, expenses };
}

// ===== 年度末の対話完了後（最終プレイヤーの手番終了時に呼ぶ）=====
export function finishYearEnd(G) {
  G.players.forEach((p) => { p.donatedThisYear = false; p.strawworkThisYear = false; p.workersUsed = 0; });
  takeYearSnapshot(G);
  if (G.year >= 6) {
    G.finalScores = computeScores(G);
    G.gameOver = true;
    addLog(G, `=== 終了 🏆 ${G.finalScores[0].name}（${G.finalScores[0].total}点） ===`);
    return;
  }
  G.year += 1; G.seasonIdx = 0; G.roundInSeason = 0; G.stage = 'action';
  G.yearEndPlayerIdx = 0;
  addLog(G, `=== ${G.year}年目 開始 ===`);
}

export function computeScores(G) {
  return G.players.map((p) => {
    const rice = ricePoints(p);
    const base = rice + p.reputation;
    const misu = base >= 88 ? 10 : 0;
    return { id: p.id, name: p.name, ricePoints: rice, reputation: p.reputation, misuBonus: misu, total: base + misu, rank: p.rank };
  }).sort((a, b) => b.total - a.total);
}

export function takeYearSnapshot(G) {
  G.yearSnapshots.push({
    year: G.year,
    players: G.players.map((p) => ({
      id: p.id, name: p.name, totalRice: totalRiceCount(p), ricePoints: ricePoints(p),
      reputation: p.reputation, rank: p.rank, workers: p.workers, fields: p.fields.length,
      seedlings: p.seedlings, compost: p.compost, tools: { ...p.tools },
    })),
  });
}
