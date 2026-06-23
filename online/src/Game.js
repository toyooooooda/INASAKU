// ===== boardgame.io Game 定義 =====
// M1: 隠匿なし（playerView 未設定）。phases は使わず G.stage で年度末を表現。
// 明示パス（dist/cjs）：Node(server) と Vite(client) の両方で解決できる
import { INVALID_MOVE } from 'boardgame.io/dist/cjs/core.js';
import { VARIETIES, RANK_COSTS, RANK_LABELS, TOOLS, GAME_YEARS, HAND_CARDS } from './constants.js';
import {
  clamp, totalRiceCount, payRice,
  addLog, addEvent, createPlayer, createField,
  drawAndApplyWeather, endOfRound, finishYearEnd, consumeWaterSource,
} from './logic.js';

const ok = (cond) => (cond ? undefined : INVALID_MOVE);

// 肥料支払い：堆肥優先→俵。払えれば識別子を返し、ダメなら null
function payFertilizer(p) {
  if (p.compost > 0) { p.compost -= 1; return '堆肥'; }
  if (payRice(p, 1)) return '俵1';
  return null;
}

export const HojoSuiden = {
  name: 'hojo-suiden',
  minPlayers: 2,
  maxPlayers: 4,

  setup: ({ ctx }) => {
    const order = [...Array(ctx.numPlayers).keys()].map(String);
    const G = {
      stage: 'action',
      year: 1, seasonIdx: 0, roundInSeason: 0,
      totalYears: GAME_YEARS,
      weather: null, weatherDeck: [], cloudyThisRound: false, ratOutbreakDone: false,
      waterPool: 0,
      cardDeck: HAND_CARDS.flatMap(c => Array.from({ length: c.count }, () => ({ id: c.id, name: c.name, type: c.type, desc: c.desc }))),
      cardDeckShuffled: false,
      cardDiscard: [],
      roundPlayOrder: order,
      playerDone: new Array(ctx.numPlayers).fill(false),
      yearEndDone: new Array(ctx.numPlayers).fill(false),
      yearEndPlayerIdx: 0, gameOver: false, finalScores: null,
      players: [], log: ['=== 豊穣の水田（オンライン版）開始 ==='],
      events: [], yearSnapshots: [],
    };
    for (let i = 0; i < ctx.numPlayers; i++) G.players.push(createPlayer(i));
    return G;
  },

  turn: {
    endIf: ({ G, ctx }) => {
      const idx = Number(ctx.currentPlayer);
      if (G.stage === 'action') return !!(G.playerDone && G.playerDone[idx]);
      if (G.stage === 'yearEnd') return !!(G.yearEndDone && G.yearEndDone[idx]);
      return false;
    },
    order: {
      first: () => 0,
      next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.numPlayers,
      playOrder: ({ G }) => G.roundPlayOrder,
    },
    onBegin: ({ G, ctx, random }) => {
      // 手番開始時にフラグをリセット（配列がなければ初期化）
      const idx = Number(ctx.currentPlayer);
      if (!G.playerDone) G.playerDone = new Array(G.players.length).fill(false);
      if (!G.yearEndDone) G.yearEndDone = new Array(G.players.length).fill(false);
      G.playerDone[idx] = false;
      G.yearEndDone[idx] = false;

      if (G.stage !== 'action') return;
      // ラウンド先頭で天候を引いて全員に適用
      if (ctx.playOrderPos === 0) drawAndApplyWeather(G, random);
      // 手番プレイヤーの働き手をリセット
      const p = G.players[idx];
      p.workersUsed = 0;
      // 春（R1）に大雪ペナルティを消費
      if (G.seasonIdx === 0 && G.roundInSeason === 0 && p.penaltyNextSpring > 0) {
        p.workersUsed = Math.min(p.workers, p.penaltyNextSpring);
        addLog(G, `${p.name}：大雪の影響で-${p.penaltyNextSpring}行動`);
        p.penaltyNextSpring = 0;
      }
    },
    onEnd: ({ G, ctx, random }) => {
      const last = ctx.playOrderPos === ctx.numPlayers - 1;
      if (!last) return;
      if (G.stage === 'action') endOfRound(G, random);     // 成長＋進行（R8後は年度末へ）
      else if (G.stage === 'yearEnd') finishYearEnd(G);     // 翌年へ or ゲーム終了
    },
  },

  endIf: ({ G }) => (G.gameOver ? { scores: G.finalScores } : undefined),

  moves: {
    // ---- 植え付け（春夏）----
    plant: ({ G, playerID }, fieldId, variety, useSeedling) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx > 1) return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const f = p.fields.find((x) => x.id === fieldId);
      const def = VARIETIES[variety];
      if (!f || f.status !== 'empty' || !def) return INVALID_MOVE;
      const useNae = !!useSeedling && p.seedlings > 0;
      // 苗使用で植付コスト-1（牛との重複可・最低0俵）
      const seedCost = Math.max(0, def.cost - (p.tools.ox ? 1 : 0) - (useNae ? 1 : 0));
      if (totalRiceCount(p) < seedCost) return INVALID_MOVE;
      payRice(p, seedCost);
      const tilledBonus = f.tilled ? 1 : 0;
      f.status = 'planted'; f.variety = variety;
      f.growth = useNae ? 1 : 0; f.requiredGrowth = def.requiredGrowth; // 苗=成長+1で開始（コスト-1も付与）
      f.quality = clamp(def.baseQuality + tilledBonus, 1, def.maxQuality);
      f.fertilized = false; f.growthFertilized = false; f.tilled = false;
      if (useNae) p.seedlings -= 1;
      p.workersUsed += 1;
      addLog(G, `${p.name}：${variety}植付（-${seedCost}俵${useNae ? '・苗' : ''}${tilledBonus ? '・耕地' : ''}）`);
      addEvent(G, 'plant', playerID, { variety, cost: seedCost, useSeedling: useNae, tilled: !!tilledBonus });
    },

    // ---- 水を引く（通年）プール消費→+2、プール0→+1（弱体）----
    irrigate: ({ G, playerID }, fieldId) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const f = p.fields.find((x) => x.id === fieldId);
      if (!f) return INVALID_MOVE;
      const src = consumeWaterSource(G, p);
      const gain = src !== 'empty' ? 2 : 1;
      f.water = clamp(f.water + gain, 0, 5);
      p.workersUsed += 1;
      const note = src === 'pool' ? '' : src === 'tank' ? '（水桶）' : '（プール不足・+1）';
      addLog(G, `${p.name}：水を引く${note} +${gain} →水位${f.water}　プール残${G.waterPool}`);
      addEvent(G, 'irrigate', playerID, { water: f.water, src });
    },

    // ---- 水路で引く（水路ツール装備時・働き手1で2か所）----
    irrigateTwo: ({ G, playerID }, fieldId1, fieldId2) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (!p.tools.canal) return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const f1 = p.fields.find((x) => x.id === fieldId1);
      const f2 = p.fields.find((x) => x.id === fieldId2);
      if (!f1 || !f2 || fieldId1 === fieldId2) return INVALID_MOVE;
      const src1 = consumeWaterSource(G, p);
      const src2 = consumeWaterSource(G, p);
      f1.water = clamp(f1.water + (src1 !== 'empty' ? 2 : 1), 0, 5);
      f2.water = clamp(f2.water + (src2 !== 'empty' ? 2 : 1), 0, 5);
      p.workersUsed += 1;
      addLog(G, `${p.name}：水路で引く →田${p.fields.indexOf(f1)+1}水位${f1.water}・田${p.fields.indexOf(f2)+1}水位${f2.water}　プール残${G.waterPool}`);
      addEvent(G, 'irrigateTwo', playerID, {});
    },

    // ---- 品質肥料（通年）----
    fertilizeQuality: ({ G, playerID }, fieldId) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const f = p.fields.find((x) => x.id === fieldId);
      if (!f || f.status !== 'planted' || f.fertilized) return INVALID_MOVE;
      const maxQ = VARIETIES[f.variety]?.maxQuality ?? 3;
      if (f.quality >= maxQ) return INVALID_MOVE;
      const paid = payFertilizer(p); if (!paid) return INVALID_MOVE;
      f.quality = clamp(f.quality + 1, 1, maxQ); f.fertilized = true; p.workersUsed += 1;
      addLog(G, `${p.name}：品質肥料（${paid}）→品質${f.quality}`);
      addEvent(G, 'fertilize', playerID, { quality: f.quality });
    },

    // ---- 成長肥料（通年）----
    fertilizeGrowth: ({ G, playerID }, fieldId) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const f = p.fields.find((x) => x.id === fieldId);
      if (!f || f.status !== 'planted' || f.growthFertilized || f.growth >= f.requiredGrowth) return INVALID_MOVE;
      const paid = payFertilizer(p); if (!paid) return INVALID_MOVE;
      f.growth += 1; f.growthFertilized = true; p.workersUsed += 1;
      if (f.growth >= f.requiredGrowth) { f.status = 'mature'; f.overripe = 0; addLog(G, `${p.name}：成長肥料（${paid}）→${f.variety}成熟`); }
      else addLog(G, `${p.name}：成長肥料（${paid}）→成長${f.growth}/${f.requiredGrowth}`);
      addEvent(G, 'growth_fert', playerID, { growth: f.growth });
    },

    // ---- 開墾（通年）----
    reclaim: ({ G, playerID }, wildlandId) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const w = p.wildlands.find((x) => x.id === wildlandId);
      if (!w || w.gauge >= 3) return INVALID_MOVE;
      const bonus = (p.tools.plow ? 1 : 0) + (p.tools.ox ? 1 : 0);
      const before = w.gauge; w.gauge = Math.min(3, w.gauge + 1 + bonus); p.workersUsed += 1;
      addLog(G, `${p.name}：開墾 +${w.gauge - before} →${w.gauge}/3`);
      if (w.gauge >= 3) {
        if (p.fields.length < p.landLimit) {
          p.fields.push(createField(`f${p.id}_d${p.fields.length}`));
          p.wildlands = p.wildlands.filter((x) => x.id !== wildlandId);
          addLog(G, `${p.name}：開墾完了！田${p.fields.length}枚`);
        } else addLog(G, `${p.name}：開墾完了（上限のため待機）`);
      }
      addEvent(G, 'reclaim', playerID, { gauge: w.gauge });
    },

    // ---- 収穫（通年・働き手1 or 2）----
    harvest: ({ G, playerID }, fieldId, workers) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      const w = workers >= 2 ? 2 : 1;
      if (p.workersUsed + w > p.workers) return INVALID_MOVE;
      const f = p.fields.find((x) => x.id === fieldId);
      if (!f || f.status !== 'mature') return INVALID_MOVE;
      const def = VARIETIES[f.variety];
      const plowBonus = p.tools.plow ? 1 : 0;
      const count = (w >= 2 ? def.harvestMax : def.harvestMin) + plowBonus;
      const q = clamp(f.quality, 1, 3);
      p.rice[q - 1].count += count; p.workersUsed += w;
      if (q >= 2) { p.reputation += 1; addLog(G, `${p.name}：${f.variety}収穫 ${count}俵 評判+1`); }
      else {
        addLog(G, `${p.name}：${f.variety}収穫 並${count}俵`);
        if (count >= 4) { p.reputation = Math.max(0, p.reputation - 1); addLog(G, `${p.name}：並の大量収穫→評判-1`); }
      }
      const oldWater = f.water; Object.assign(f, createField(f.id)); f.water = Math.max(0, oldWater - 1);
      addEvent(G, 'harvest', playerID, { variety: def ? f.variety : null, count, quality: q, workers: w });
    },

    // ---- 献上（通年・年1回・働き手2）----
    donate: ({ G, playerID }, quality) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || p.donatedThisYear) return INVALID_MOVE;
      if (p.workersUsed + 2 > p.workers) return INVALID_MOVE;
      if (quality < 2 || quality > 3 || p.rice[quality - 1].count < 1) return INVALID_MOVE;
      const repGain = quality === 3 ? 3 : 2; // 特上+3、上質+2
      p.rice[quality - 1].count -= 1; p.reputation += repGain; p.donatedThisYear = true; p.workersUsed += 2;
      addLog(G, `${p.name}：献上（${quality === 3 ? '特上' : '上質'}）→評判+${repGain}（計${p.reputation}）`);
      addEvent(G, 'donate', playerID, { quality });
    },

    // ---- 出稼ぎ（秋冬・働き手2）----
    migrantWork: ({ G, playerID }) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
      if (p.workersUsed + 2 > p.workers) return INVALID_MOVE;
      p.rice[0].count += 2; p.workersUsed += 2;
      addLog(G, `${p.name}：出稼ぎ→並2俵`);
      addEvent(G, 'migrant', playerID, { gain: 2 });
    },

    // ---- 育苗（秋冬・働き手1）----
    raiseSeedling: ({ G, playerID }) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      p.seedlings += 1; p.workersUsed += 1;
      addLog(G, `${p.name}：育苗→苗+1（計${p.seedlings}）`);
      addEvent(G, 'nursery', playerID, { seedlings: p.seedlings });
    },

    // ---- 土づくり（秋冬・働き手1）----
    tillSoil: ({ G, playerID }, fieldId) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const f = p.fields.find((x) => x.id === fieldId);
      if (!f || f.status !== 'empty' || f.tilled) return INVALID_MOVE;
      f.tilled = true; p.workersUsed += 1;
      addLog(G, `${p.name}：土づくり（次作 品質+1）`);
      addEvent(G, 'till', playerID, {});
    },

    // ---- 藁仕事（秋冬・年1回・働き手2）----
    strawWork: ({ G, playerID }) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx < 2 || p.strawworkThisYear) return INVALID_MOVE;
      if (p.workersUsed + 2 > p.workers) return INVALID_MOVE;
      p.reputation += 1; p.strawworkThisYear = true; p.workersUsed += 2;
      addLog(G, `${p.name}：藁仕事→評判+1（計${p.reputation}）`);
      addEvent(G, 'strawwork', playerID, {});
    },

    // ---- 堆肥作り（秋冬・働き手1）----
    makeCompost: ({ G, playerID }) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      p.compost += 2; p.workersUsed += 1;
      addLog(G, `${p.name}：堆肥作り→堆肥+2（計${p.compost}）`);
      addEvent(G, 'compost', playerID, { compost: p.compost });
    },

    // ---- カードを引く（秋冬・働き手1）----
    // 全カード（アクション・イベント問わず）手札へ。使用はplayCardで。
    // random.Shuffle を使うため client:false でサーバー権威実行（クライアント楽観実行を無効化）
    drawCard: {
      client: false,
      move: ({ G, playerID, random }) => {
        const p = G.players[Number(playerID)];
        if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
        if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
        // 古いゲーム状態への防御初期化
        if (!G.cardDeck) G.cardDeck = HAND_CARDS.flatMap((c) => Array.from({ length: c.count }, () => ({ id: c.id, name: c.name, type: c.type, desc: c.desc })));
        if (!G.cardDiscard) G.cardDiscard = [];
        if (!G.cardDeckShuffled) { G.cardDeck = random.Shuffle([...G.cardDeck]); G.cardDeckShuffled = true; }
        // デッキ切れなら捨て札からシャッフルして再補充
        if (G.cardDeck.length === 0) {
          if (G.cardDiscard.length === 0) return INVALID_MOVE;
          G.cardDeck = random.Shuffle([...G.cardDiscard]);
          G.cardDiscard = [];
        }
        p.workersUsed += 1;
        if (!p.hand) p.hand = [];
        const card = G.cardDeck.pop();
        p.hand.push(card);
        // 引いたカードの中身は公開しない（手札は本人のみ把握）
        addLog(G, `${p.name}：山札からカードを1枚引いた`);
        addEvent(G, 'draw_card', playerID, { card });
      },
    },

    // ---- 手札カードを使う（コスト：俵1 または 働き手1）----
    // fieldId: 対象選択が必要なカード用 / pay: 'rice' | 'worker'
    playCard: ({ G, playerID }, handIdx, fieldId, pay) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (!p.hand || handIdx < 0 || handIdx >= p.hand.length) return INVALID_MOVE;
      if (!G.cardDiscard) G.cardDiscard = [];
      const card = p.hand[handIdx];

      // --- 効果が成立するか事前検証（成立しなければコストを取らない）---
      let target = null;
      if (card.id === 'growth_fert') {
        target = fieldId && p.fields.find((x) => x.id === fieldId);
        if (!target || target.status !== 'planted' || target.growth >= target.requiredGrowth) return INVALID_MOVE;
      } else if (card.id === 'quality_fert') {
        target = fieldId && p.fields.find((x) => x.id === fieldId);
        const maxQ = target && (VARIETIES[target.variety]?.maxQuality ?? 3);
        if (!target || target.status !== 'planted' || target.quality >= maxQ) return INVALID_MOVE;
      } else if (card.id === 'growth_all') {
        if (!p.fields.some((f) => f.status === 'planted')) return INVALID_MOVE;
      } else if (card.id === 'strawwork') {
        if (p.strawworkThisYear) return INVALID_MOVE;
      }
      // seedling_card / water_all / water_drought / flood_all / drought_all は常に成立

      // --- コスト支払い（俵1 or 働き手1）---
      if (pay === 'worker') {
        if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
        p.workersUsed += 1;
      } else if (pay === 'rice') {
        if (!payRice(p, 1)) return INVALID_MOVE;
      } else {
        return INVALID_MOVE;
      }
      const payLabel = pay === 'worker' ? '働き手1' : '俵1';

      // --- 効果適用 ---
      p.hand.splice(handIdx, 1);
      if (card.id === 'growth_fert') {
        target.growth = Math.min(target.growth + 1, target.requiredGrowth);
        if (target.growth >= target.requiredGrowth) target.status = 'mature';
        addLog(G, `${p.name}：[${card.name}](${payLabel})→田${p.fields.indexOf(target) + 1} 成長+1（${target.growth}/${target.requiredGrowth}）`);

      } else if (card.id === 'quality_fert') {
        const maxQ = VARIETIES[target.variety]?.maxQuality ?? 3;
        target.quality = Math.min(target.quality + 1, maxQ);
        addLog(G, `${p.name}：[${card.name}](${payLabel})→田${p.fields.indexOf(target) + 1} 品質+1`);

      } else if (card.id === 'seedling_card') {
        p.seedlings += 1;
        addLog(G, `${p.name}：[${card.name}](${payLabel})→苗+1（計${p.seedlings}・次の植付で成長+1/コスト-1）`);

      } else if (card.id === 'growth_all') {
        let n = 0;
        p.fields.forEach((f) => {
          if (f.status === 'planted') {
            f.growth = Math.min(f.growth + 1, f.requiredGrowth);
            if (f.growth >= f.requiredGrowth) f.status = 'mature';
            n += 1;
          }
        });
        addLog(G, `${p.name}：【${card.name}】(${payLabel})→育成中の${n}枚の田 成長+1`);

      } else if (card.id === 'water_all') {
        // 慈雨：全員の全田 水位+1
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = Math.min(5, f.water + 1); }));
        addLog(G, `${p.name}が【${card.name}】を発動！(${payLabel}) → 全員の全田 水位+1`);

      } else if (card.id === 'water_drought') {
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = Math.max(0, f.water - 1); }));
        addLog(G, `${p.name}が【${card.name}】を発動！(${payLabel}) → 全員の全田 水位-1`);

      } else if (card.id === 'flood_all') {
        // 大洪水：全員の全田を水位5（次の成長で稲が流出）
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = 5; }));
        addLog(G, `${p.name}が【${card.name}】を発動！(${payLabel}) → 全員の全田 水位5（洪水）`);

      } else if (card.id === 'drought_all') {
        // 大干ばつ：全員の全田を水位0（成長停止）
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = 0; }));
        addLog(G, `${p.name}が【${card.name}】を発動！(${payLabel}) → 全員の全田 水位0（干ばつ）`);

      } else if (card.id === 'strawwork') {
        p.reputation += 1; p.strawworkThisYear = true;
        addLog(G, `${p.name}：[${card.name}](${payLabel})→評判+1（計${p.reputation}）`);
      }

      G.cardDiscard.push(card);
      addEvent(G, 'play_card', playerID, { card: { id: card.id, fieldId, pay } });
    },

    // ---- 水の横取り（夏限定・働き手1・評判-1）相手の田-2/自分の田+2 ----
    // 夏の水争いを表現。評判を失うので多用はリスク。
    waterTheft: ({ G, playerID }, targetPlayerID, theirFieldId, myFieldId) => {
      const me = G.players[Number(playerID)];
      const them = G.players[Number(targetPlayerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (G.seasonIdx !== 1) return INVALID_MOVE; // 夏のみ
      if (targetPlayerID === playerID) return INVALID_MOVE;
      if (!them) return INVALID_MOVE;
      if (me.workersUsed + 1 > me.workers) return INVALID_MOVE;
      if (me.reputation < 1) return INVALID_MOVE; // 評判0では使えない
      const tf = them.fields.find((x) => x.id === theirFieldId);
      const mf = me.fields.find((x) => x.id === myFieldId);
      if (!tf || !mf) return INVALID_MOVE;
      if (tf.water <= 0) return INVALID_MOVE;
      const steal = Math.min(2, tf.water);
      tf.water = clamp(tf.water - steal, 0, 5);
      mf.water = clamp(mf.water + steal, 0, 5);
      me.reputation -= 1;
      me.workersUsed += 1;
      addLog(G, `💧${me.name}：${them.name}の田から水を横取り（評判-1）→${them.name}水位${tf.water}・${me.name}水位${mf.water}`);
      addEvent(G, 'water_theft', playerID, { from: targetPlayerID, steal });
    },

    // ---- 購入（通年・働き手不要）----
    buyTool: ({ G, playerID }, item, payment) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      const s = TOOLS[item];
      if (!s || p.tools[item]) return INVALID_MOVE;
      if (payment === 'rice') { if (totalRiceCount(p) < s.riceCost) return INVALID_MOVE; payRice(p, s.riceCost); }
      else { if (p.reputation < s.repCost) return INVALID_MOVE; p.reputation -= s.repCost; }
      p.tools[item] = true;
      addLog(G, `${p.name}：${s.name}を購入（${payment === 'rice' ? s.riceCost + '俵' : '評判' + s.repCost}）`);
      addEvent(G, 'buy_tool', playerID, { item, payment });
    },

    // ---- 行動終了（手番を次へ）---- events.endTurn()の代わりにフラグで通知
    doneTurn: ({ G, playerID }) => {
      if (G.stage !== 'action') return INVALID_MOVE;
      if (!G.playerDone) G.playerDone = new Array(G.players.length).fill(false);
      G.playerDone[Number(playerID)] = true;
    },

    // ---- 年度末の決定（雇用＋昇進を一括）→ 手番終了 ----
    yearEndDecision: ({ G, playerID }, hireCount, doRankUp) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'yearEnd') return INVALID_MOVE;
      const hc = clamp(hireCount | 0, 0, 3);
      if (hc > 0) {
        // 逓増：3→4人目:4俵, 4→5:5俵, 5→6:6俵... (workers+1 per person)
        let cost = 0; for (let n = 0; n < hc; n++) cost += p.workers + n + 1;
        if (totalRiceCount(p) >= cost) { payRice(p, cost); p.workers += hc; addLog(G, `雇用：${p.name} +${hc}人（-${cost}俵）`); }
      }
      if (doRankUp && p.rank < RANK_COSTS.length) {
        const cost = RANK_COSTS[p.rank];
        if (p.reputation >= cost) {
          p.reputation -= cost; p.rank += 1; p.landLimit += 2;
          const remaining = [];
          for (const w of p.wildlands) {
            if (w.gauge >= 3 && p.fields.length < p.landLimit) { p.fields.push(createField(`f${p.id}_d${p.fields.length}`)); }
            else remaining.push(w);
          }
          p.wildlands = remaining;
          const base = `w${p.id}_r${p.rank}`;
          p.wildlands.push({ id: `${base}_0`, gauge: 0 }, { id: `${base}_1`, gauge: 0 });
          addLog(G, `昇進：${p.name}→${RANK_LABELS[p.rank]}（評判-${cost}・上限${p.landLimit}）`);
        }
      }
      addEvent(G, 'year_end_decision', playerID, { hireCount: hc, rankUp: !!doRankUp });
      if (!G.yearEndDone) G.yearEndDone = new Array(G.players.length).fill(false);
      G.yearEndDone[Number(playerID)] = true;
    },

    // 名前を設定（URL の &name= から自動呼び出し）
    setName: ({ G, playerID }, name) => {
      const p = G.players[Number(playerID)];
      if (!p) return INVALID_MOVE;
      const trimmed = String(name || '').trim().slice(0, 16);
      if (trimmed) p.name = trimmed;
    },
  },
};
