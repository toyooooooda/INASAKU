// ===== boardgame.io Game 定義 =====
// M1: 隠匿なし（playerView 未設定）。phases は使わず G.stage で年度末を表現。
// 明示パス（dist/cjs）：Node(server) と Vite(client) の両方で解決できる
import { INVALID_MOVE } from 'boardgame.io/dist/cjs/core.js';
import { VARIETIES, RANK_COSTS, RANK_LABELS, TOOLS, GAME_YEARS, HAND_CARDS, CLANS, makeTerritoryMap, territoryCorners, PROJECT_MAX, PROJECT_MILESTONES, LINEAGE_GOALS, EDICTS } from './constants.js';
import {
  clamp, totalRiceCount, payRice,
  addLog, addEvent, createPlayer, createField, resetField,
  drawAndApplyWeather, endOfRound, finishYearEnd, consumeWaterSource, countAct,
} from './logic.js';

const ok = (cond) => (cond ? undefined : INVALID_MOVE);

// 手番の席を返す：ラウンドごとに先頭を1つずつ進める（毎ラウンド手番順が変わる）
// turnCount=0,1,2(=1巡目) → 3,4,5(2巡目は+1ずれ) ...
function seatOf(turnCount, n) {
  return (Math.floor(turnCount / n) + (turnCount % n)) % n;
}

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

  setup: ({ ctx }, setupData) => {
    const advanced = !!(setupData && setupData.advanced);
    const mode = (setupData && setupData.mode) === 'territory' ? 'territory' : 'normal';
    const order = [...Array(ctx.numPlayers).keys()].map(String);
    const G = {
      stage: 'action',
      year: 1, seasonIdx: 0, roundInSeason: 0,
      totalYears: GAME_YEARS,
      mode,                                      // 'normal' | 'territory'
      map: null,                                 // 領地モードの共有盤面
      advanced,                                  // 上級ルール ON/OFF
      hiddenTribute: advanced && ctx.numPlayers >= 3, // 隠し献上（3人以上）
      needClanDeal: advanced,                    // 初回 onBegin で家系をランダム配布
      needGoalDeal: true,                        // 初回 onBegin で系譜（隠し目標）と勅命を配布
      edicts: null,                              // 公開レース目標（2枚）
      turnCount: 0,                              // 通算手番数（手番順ローテーションに使用）
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
    if (advanced) addLog(G, `上級ルール ON（家系${G.hiddenTribute ? '＋隠し献上' : ''}）`);

    // 領地モード：共有盤面を作り、各自を隅に1マス配置（私有の田/荒れ地は使わない）
    if (mode === 'territory') {
      G.map = makeTerritoryMap(ctx.numPlayers);
      const corners = territoryCorners(G.map.side, ctx.numPlayers);
      G.players.forEach((p, i) => {
        p.fields = []; p.wildlands = [];
        const [r, c] = corners[i];
        const tile = G.map.tiles.find((t) => t.row === r && t.col === c);
        tile.owner = i;
        const f = createField(`${tile.id}_p${i}`);
        f.fertile = tile.fertile;
        tile.field = f;
        p.fields.push(f);
      });
      addLog(G, `領地モード（${G.map.side}×${G.map.side}・肥沃地あり）`);
    }
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
      // 席は turnCount から計算。毎ラウンド先頭が1つずつずれる。
      first: ({ G, ctx }) => seatOf(G.turnCount || 0, ctx.numPlayers),
      next: ({ G, ctx }) => seatOf(G.turnCount || 0, ctx.numPlayers),
      playOrder: ({ G }) => G.roundPlayOrder,
    },
    onBegin: ({ G, ctx, random }) => {
      // 手番開始時にフラグをリセット（配列がなければ初期化）
      const idx = Number(ctx.currentPlayer);
      if (!G.playerDone) G.playerDone = new Array(G.players.length).fill(false);
      if (!G.yearEndDone) G.yearEndDone = new Array(G.players.length).fill(false);
      G.playerDone[idx] = false;
      G.yearEndDone[idx] = false;

      // 初回：系譜（隠し目標）を各自に1枚、勅命（公開レース）を2枚配布
      if (G.needGoalDeal) {
        const goals = random.Shuffle([...LINEAGE_GOALS]);
        G.players.forEach((p, i) => { p.goalId = goals[i % goals.length].id; });
        const picked = random.Shuffle([...EDICTS]).slice(0, 2);
        G.edicts = picked.map((e) => ({ id: e.id, name: e.name, desc: e.desc, reward: e.reward, claimedBy: null }));
        G.needGoalDeal = false;
        addLog(G, `📜 勅命公開：【${picked[0].name}】${picked[0].desc} ／【${picked[1].name}】${picked[1].desc}`);
        addLog(G, '🎴 各家に系譜（秘密の家訓）が配られた');
      }

      // 初回：家系をランダム配布（上級ルール・乱数が使える onBegin で実行）
      if (G.advanced && G.needClanDeal) {
        const shuffled = random.Shuffle([...CLANS]);
        G.players.forEach((p, i) => {
          const clan = shuffled[i % shuffled.length];
          p.clan = clan.id;
          if (clan.id === 'noble') p.reputation += 2; // 名門：初期評判+2
        });
        G.needClanDeal = false;
        addLog(G, '家系をランダムに配布しました');
      }

      if (G.stage !== 'action') return;
      // ラウンド先頭（巡の最初）で天候を引いて全員に適用
      if ((G.turnCount % ctx.numPlayers) === 0) drawAndApplyWeather(G, random);
      // 手番プレイヤーの働き手をリセット
      const p = G.players[idx];
      p.workersUsed = 0;
      p.builtThisTurn = false; // 大事業の造営は1手番1回
      if (!p.project) p.project = { gauge: 0, score: 0, claimed: 0 };
      // 春（R1）に大雪ペナルティを消費
      if (G.seasonIdx === 0 && G.roundInSeason === 0 && p.penaltyNextSpring > 0) {
        p.workersUsed = Math.min(p.workers, p.penaltyNextSpring);
        addLog(G, `${p.name}：大雪の影響で-${p.penaltyNextSpring}行動`);
        p.penaltyNextSpring = 0;
      }
    },
    onEnd: ({ G, ctx, random }) => {
      const n = ctx.numPlayers;
      const endedTurn = G.turnCount || 0;   // 今終わった手番の通算番号
      G.turnCount = endedTurn + 1;          // 次の手番へ（next() が参照）
      const isRoundEnd = (endedTurn % n) === (n - 1);
      if (!isRoundEnd) return;
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
      if (G.year < (def.unlockYear || 1)) return INVALID_MOVE; // 上級品種は解禁年から
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
      if (!p.plantedVarieties) p.plantedVarieties = [];
      if (!p.plantedVarieties.includes(variety)) p.plantedVarieties.push(variety); // 系譜「品種の匠」用
      countAct(p, 'plant'); // 系譜「早乙女の家」用
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
      const isWaterClan = G.advanced && p.clan === 'water'; // 水利の一族：枯渇でも+2（弱体化なし）
      const gain = (src !== 'empty' || isWaterClan) ? 2 : 1;
      f.water = clamp(f.water + gain, 0, 5);
      p.workersUsed += 1;
      countAct(p, 'irrigate'); // 系譜「水番の家」用
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
      countAct(p, 'irrigate'); // 系譜「水番の家」用（水路も1回と数える）
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

    // ---- 開墾（通年・通常モード）----
    reclaim: ({ G, playerID }, wildlandId) => {
      const p = G.players[Number(playerID)];
      if (G.mode === 'territory') return INVALID_MOVE; // 領地モードは claimTile を使う
      if (G.stage !== 'action') return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const w = p.wildlands.find((x) => x.id === wildlandId);
      if (!w || w.gauge >= 3) return INVALID_MOVE;
      const clanP = (G.advanced && p.clan === 'pioneer') ? 1 : 0; // 開墾の民
      const bonus = (p.tools.plow ? 1 : 0) + (p.tools.ox ? 1 : 0) + clanP;
      const before = w.gauge; w.gauge = Math.min(3, w.gauge + 1 + bonus); p.workersUsed += 1;
      countAct(p, 'reclaim'); // 系譜「開墾の血」用
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

    // ---- 大事業の造営（通年・働き手2・俵不要・1手番1回）----
    // 働き手2＝3人中2人を投じる重い選択（片手間では無理）。俵は使わないので
    // 少ない田で食いつなぎ労働を事業に注ぐ専業ルートになる。1手番1回＝終盤の一括投入は不可。
    buildProject: ({ G, playerID }) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (!p.project) p.project = { gauge: 0, score: 0, claimed: 0 };
      if (p.builtThisTurn) return INVALID_MOVE;                 // 1手番1回
      if (p.project.gauge >= PROJECT_MAX) return INVALID_MOVE;  // 完成済み
      if (p.workersUsed + 2 > p.workers) return INVALID_MOVE;   // 働き手2
      p.workersUsed += 2; p.builtThisTurn = true;
      p.project.gauge += 1;
      addLog(G, `${p.name}：大事業を造営（${p.project.gauge}/${PROJECT_MAX}）`);
      // 段階達成ボーナス（逐次）
      while (p.project.claimed < PROJECT_MILESTONES.length
        && p.project.gauge >= PROJECT_MILESTONES[p.project.claimed].gauge) {
        const m = PROJECT_MILESTONES[p.project.claimed];
        p.project.score += m.reward; p.project.claimed += 1;
        addLog(G, `🏛️ ${p.name}：大事業 段階達成！ +${m.reward}点（事業 累計+${p.project.score}）`);
      }
      addEvent(G, 'build_project', playerID, { gauge: p.project.gauge, score: p.project.score });
    },

    // ---- 領地モードの開拓（ゲージ式競争・働き手1）----
    // 自分の領地に隣接する原野にだけ投資でき、先に gauge3 にした人が取得。
    claimTile: ({ G, playerID }, tileId) => {
      const p = G.players[Number(playerID)];
      const idx = Number(playerID);
      if (G.mode !== 'territory' || !G.map) return INVALID_MOVE;
      if (G.stage !== 'action') return INVALID_MOVE;
      if (p.workersUsed + 1 > p.workers) return INVALID_MOVE;
      const tile = G.map.tiles.find((t) => t.id === tileId);
      if (!tile || tile.owner !== null) return INVALID_MOVE;
      // 隣接（自分の領地マスに上下左右で接する）
      const adj = G.map.tiles.some((t) => t.owner === idx
        && Math.abs(t.row - tile.row) + Math.abs(t.col - tile.col) === 1);
      if (!adj) return INVALID_MOVE;
      p.workersUsed += 1;
      countAct(p, 'reclaim'); // 系譜「開墾の血」用（開拓も1回と数える）
      const clanP = (G.advanced && p.clan === 'pioneer') ? 1 : 0;
      const inc = 1 + (p.tools.plow ? 1 : 0) + (p.tools.ox ? 1 : 0) + clanP;
      tile.gauge[idx] = (tile.gauge[idx] || 0) + inc;
      addLog(G, `${p.name}：開拓 (${tile.row + 1},${tile.col + 1}) ゲージ+${inc}→${tile.gauge[idx]}/3${tile.fertile ? '（肥沃地）' : ''}`);
      if (tile.gauge[idx] >= 3) {
        tile.owner = idx;
        const f = createField(`${tile.id}_p${idx}`);
        f.fertile = tile.fertile;
        tile.field = f;
        p.fields.push(f);
        tile.gauge = {}; // 競争相手の投資もリセット
        addLog(G, `${p.name}：マス(${tile.row + 1},${tile.col + 1})を獲得！${tile.fertile ? '★肥沃地' : ''}（計${p.fields.length}マス）`);
      }
      addEvent(G, 'claim_tile', playerID, { tileId, gauge: tile.gauge[idx] || 0, owned: tile.owner === idx });
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
      const fertileBonus = f.fertile ? 1 : 0; // 肥沃地（領地モード中央）
      const count = (w >= 2 ? def.harvestMax : def.harvestMin) + plowBonus + fertileBonus;
      const q = clamp(f.quality, 1, 3);
      const repBonus = (def && def.repBonus) || 0;
      p.rice[q - 1].count += count; p.workersUsed += w;
      countAct(p, 'harvest'); // 系譜「刈り入れの名手」用
      if (q >= 2) { const gain = 1 + repBonus; p.reputation += gain; addLog(G, `${p.name}：${f.variety}収穫 ${count}俵 評判+${gain}`); }
      else {
        addLog(G, `${p.name}：${f.variety}収穫 並${count}俵`);
        if (count >= 4) { p.reputation = Math.max(0, p.reputation - 1); addLog(G, `${p.name}：並の大量収穫→評判-1`); }
      }
      const oldWater = f.water; resetField(f); f.water = Math.max(0, oldWater - 1);
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
      p.donateCount = (p.donateCount || 0) + 1; // 系譜「献上の一族」用
      addLog(G, `${p.name}：献上（${quality === 3 ? '特上' : '上質'}）→評判+${repGain}（計${p.reputation}）`);
      addEvent(G, 'donate', playerID, { quality });
    },

    // ---- 出稼ぎ（秋冬・働き手2）----
    migrantWork: ({ G, playerID }) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
      if (p.workersUsed + 2 > p.workers) return INVALID_MOVE;
      p.rice[0].count += 2; p.workersUsed += 2;
      countAct(p, 'migrant'); // 系譜「出稼ぎの一族」用
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

    // ---- カードを引く（秋冬・働き手2）----
    // コストは「引くとき」に集約（使用は無料）。全カード手札へ。
    // random.Shuffle を使うため client:false でサーバー権威実行（クライアント楽観実行を無効化）
    drawCard: {
      client: false,
      move: ({ G, playerID, random }) => {
        const p = G.players[Number(playerID)];
        if (G.stage !== 'action' || G.seasonIdx < 2) return INVALID_MOVE;
        if (p.workersUsed + 2 > p.workers) return INVALID_MOVE;
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
        p.workersUsed += 2;
        countAct(p, 'draw'); // 系譜「札読みの家」用
        if (!p.hand) p.hand = [];
        const card = G.cardDeck.pop();
        p.hand.push(card);
        // 引いたカードの中身は公開しない（手札は本人のみ把握）
        addLog(G, `${p.name}：山札からカードを1枚引いた（働き手2）`);
        addEvent(G, 'draw_card', playerID, { card });
      },
    },

    // ---- 手札カードを使う（コスト無料・引くときに労働力2を支払い済み）----
    // fieldId: 対象選択が必要なカード用
    playCard: ({ G, playerID }, handIdx, fieldId) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'action') return INVALID_MOVE;
      if (!p.hand || handIdx < 0 || handIdx >= p.hand.length) return INVALID_MOVE;
      if (!G.cardDiscard) G.cardDiscard = [];
      const card = p.hand[handIdx];

      // --- 効果が成立するか事前検証 ---
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

      // --- 効果適用（使用は無料）---
      p.hand.splice(handIdx, 1);
      if (card.id === 'growth_fert') {
        target.growth = Math.min(target.growth + 1, target.requiredGrowth);
        if (target.growth >= target.requiredGrowth) target.status = 'mature';
        addLog(G, `${p.name}：[${card.name}]→田${p.fields.indexOf(target) + 1} 成長+1（${target.growth}/${target.requiredGrowth}）`);

      } else if (card.id === 'quality_fert') {
        const maxQ = VARIETIES[target.variety]?.maxQuality ?? 3;
        target.quality = Math.min(target.quality + 1, maxQ);
        addLog(G, `${p.name}：[${card.name}]→田${p.fields.indexOf(target) + 1} 品質+1`);

      } else if (card.id === 'seedling_card') {
        p.seedlings += 1;
        addLog(G, `${p.name}：[${card.name}]→苗+1（計${p.seedlings}・次の植付で成長+1/コスト-1）`);

      } else if (card.id === 'growth_all') {
        let n = 0;
        p.fields.forEach((f) => {
          if (f.status === 'planted') {
            f.growth = Math.min(f.growth + 1, f.requiredGrowth);
            if (f.growth >= f.requiredGrowth) f.status = 'mature';
            n += 1;
          }
        });
        addLog(G, `${p.name}：【${card.name}】→育成中の${n}枚の田 成長+1`);

      } else if (card.id === 'water_all') {
        // 慈雨：全員の全田 水位+1
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = Math.min(5, f.water + 1); }));
        addLog(G, `${p.name}が【${card.name}】を発動！ → 全員の全田 水位+1`);

      } else if (card.id === 'water_drought') {
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = Math.max(0, f.water - 1); }));
        addLog(G, `${p.name}が【${card.name}】を発動！ → 全員の全田 水位-1`);

      } else if (card.id === 'flood_all') {
        // 大洪水：全員の全田を水位5（次の成長で稲が流出）
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = 5; }));
        addLog(G, `${p.name}が【${card.name}】を発動！ → 全員の全田 水位5（洪水）`);

      } else if (card.id === 'drought_all') {
        // 大干ばつ：全員の全田を水位0（成長停止）
        G.players.forEach((pl) => pl.fields.forEach((f) => { f.water = 0; }));
        addLog(G, `${p.name}が【${card.name}】を発動！ → 全員の全田 水位0（干ばつ）`);

      } else if (card.id === 'strawwork') {
        p.reputation += 1; p.strawworkThisYear = true;
        addLog(G, `${p.name}：[${card.name}]→評判+1（計${p.reputation}）`);
      }

      G.cardDiscard.push(card);
      addEvent(G, 'play_card', playerID, { card: { id: card.id, fieldId } });
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
      const riceCost = Math.max(0, s.riceCost - ((G.advanced && p.clan === 'merchant') ? 2 : 0)); // 商いの家
      if (payment === 'rice') { if (totalRiceCount(p) < riceCost) return INVALID_MOVE; payRice(p, riceCost); }
      else { if (p.reputation < s.repCost) return INVALID_MOVE; p.reputation -= s.repCost; }
      p.tools[item] = true;
      addLog(G, `${p.name}：${s.name}を購入（${payment === 'rice' ? riceCost + '俵' : '評判' + s.repCost}）`);
      addEvent(G, 'buy_tool', playerID, { item, payment });
    },

    // ---- 行動終了（手番を次へ）---- events.endTurn()の代わりにフラグで通知
    doneTurn: ({ G, playerID }) => {
      if (G.stage !== 'action') return INVALID_MOVE;
      if (!G.playerDone) G.playerDone = new Array(G.players.length).fill(false);
      G.playerDone[Number(playerID)] = true;
    },

    // ---- 年度末の決定（雇用＋昇進＋隠し献上の予約）→ 手番終了 ----
    yearEndDecision: ({ G, playerID }, hireCount, doRankUp, tribute) => {
      const p = G.players[Number(playerID)];
      if (G.stage !== 'yearEnd') return INVALID_MOVE;
      const hc = clamp(hireCount | 0, 0, 3);
      if (hc > 0) {
        // 逓増：3→4人目:4俵, 4→5:5俵, 5→6:6俵... (workers+1 per person)
        let cost = 0; for (let n = 0; n < hc; n++) cost += p.workers + n + 1;
        if (totalRiceCount(p) >= cost) { payRice(p, cost); p.workers += hc; addLog(G, `雇用：${p.name} +${hc}人（-${cost}俵）`); }
      }
      if (doRankUp && p.rank < RANK_COSTS.length) {
        const cost = Math.max(0, RANK_COSTS[p.rank] - ((G.advanced && p.clan === 'noble') ? 1 : 0)); // 名門：昇進-1
        if (p.reputation >= cost) {
          p.reputation -= cost; p.rank += 1; p.landLimit += 2;
          // 領地モードは盤面が上限なので荒れ地処理はしない（昇進は租減免と評判消費のみ）
          if (G.mode !== 'territory') {
            const remaining = [];
            for (const w of p.wildlands) {
              if (w.gauge >= 3 && p.fields.length < p.landLimit) { p.fields.push(createField(`f${p.id}_d${p.fields.length}`)); }
              else remaining.push(w);
            }
            p.wildlands = remaining;
            const base = `w${p.id}_r${p.rank}`;
            p.wildlands.push({ id: `${base}_0`, gauge: 0 }, { id: `${base}_1`, gauge: 0 });
          }
          addLog(G, `昇進：${p.name}→${RANK_LABELS[p.rank]}（評判-${cost}）`);
        }
      }
      // 隠し献上（上級・3人以上）：俵を伏せて予約。この場では引かない＝俵数で悟られない。
      if (G.hiddenTribute) {
        const t = clamp((tribute | 0), 0, totalRiceCount(p));
        p.tributeCommit = t;
        if (t > 0) addLog(G, `${p.name}：献上を予約した（額は非公開）`);
      }
      addEvent(G, 'year_end_decision', playerID, { hireCount: hc, rankUp: !!doRankUp, tribute: G.hiddenTribute ? (tribute | 0) : 0 });
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
