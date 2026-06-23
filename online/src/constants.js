// ===== ゲーム定数（純ロジック・React非依存） =====

export const SEASONS = ['春', '夏', '秋', '冬'];
export const QUALITY_LABEL = ['', '並', '上質', '特上'];
export const RANK_LABELS = ['平民', '小名', '大名', '公家'];
// 位階昇進コスト（評判）: 0→1=3, 1→2=6, 2→3=10
export const RANK_COSTS = [3, 6, 10];
// ネズミ大発生: 2年目以降・各年20%・ゲーム1回まで
export const RAT_OUTBREAK_CHANCE = 0.2;
// ゲーム年数（最終年の秋冬はスキップして夏終了）
export const GAME_YEARS = 5;

// unlockYear: この年から植え付け可能（省略=1年目から）。後半に上級品種を解禁。
// repBonus: 収穫1回ごとの追加評判（上質以上のとき加算）。
export const VARIETIES = {
  野良稲: { requiredGrowth: 3, baseQuality: 1, maxQuality: 1, cost: 0, harvestMin: 2, harvestMax: 2, unlockYear: 1, desc: '3R・並どまり・無料・収穫2' },
  早稲:   { requiredGrowth: 2, baseQuality: 1, maxQuality: 1, cost: 1, harvestMin: 3, harvestMax: 4, unlockYear: 1, desc: '2R・並どまり・1俵・収穫3〜4' },
  中稲:   { requiredGrowth: 3, baseQuality: 1, maxQuality: 2, cost: 2, harvestMin: 3, harvestMax: 4, unlockYear: 1, desc: '3R・並〜上質・2俵・収穫3〜4' },
  晩稲:   { requiredGrowth: 4, baseQuality: 2, maxQuality: 3, cost: 2, harvestMin: 2, harvestMax: 3, unlockYear: 1, desc: '4R・上質〜特上・2俵・収穫2〜3' },
  // ---- 上級品種（後半に解禁）----
  赤米:   { requiredGrowth: 3, baseQuality: 2, maxQuality: 3, cost: 3, harvestMin: 2, harvestMax: 3, repBonus: 1, unlockYear: 3, desc: '3R・上質〜特上・3俵・収穫2〜3・収穫で評判+1' },
  餅米:   { requiredGrowth: 4, baseQuality: 2, maxQuality: 3, cost: 3, harvestMin: 4, harvestMax: 5, unlockYear: 3, desc: '4R・上質〜特上・3俵・収穫4〜5（高収量）' },
  献上米: { requiredGrowth: 4, baseQuality: 3, maxQuality: 3, cost: 4, harvestMin: 2, harvestMax: 3, repBonus: 1, unlockYear: 4, desc: '4R・特上スタート・4俵・収穫2〜3・収穫で評判+1' },
};

// ===== 上級ルール =====
// 家系（非対称スタート能力）。上級ルール時、席順に配られる。
export const CLANS = [
  { id: 'pioneer',  name: '開墾の民',   desc: '開墾ゲージ +1（毎回）' },
  { id: 'water',    name: '水利の一族', desc: '「水を引く」が +1 多い' },
  { id: 'merchant', name: '商いの家',   desc: '道具・牛・倉が -2俵' },
  { id: 'noble',    name: '名門',       desc: '初期評判 +2／昇進コスト -1' },
];

export const TOOLS = {
  plow:  { name: '道具', riceCost: 8,  repCost: 4, desc: '開墾+1 / 収穫+1俵' },
  ox:    { name: '牛',   riceCost: 16, repCost: 6, desc: '開墾+1 / 植付-1俵' },
  barn:  { name: '倉',   riceCost: 6,  repCost: 3, desc: '保管半減 / ネズミ被害1/4' },
  canal: { name: '水路', riceCost: 10, repCost: 4, desc: '働き手1で2か所同時に水を引く' },
  tank:  { name: '水桶', riceCost: 4,  repCost: 2, desc: '毎R水+2蓄積（上限6）/ プール不足時でも水+2' },
};

export const WEATHER_CARDS = [
  { name: '晴れ',       effect: 'none',        desc: '通常の天気' },
  { name: '晴れ',       effect: 'none',        desc: '通常の天気' },
  { name: '晴れ',       effect: 'none',        desc: '通常の天気' },
  { name: '曇り',       effect: 'cloudy',      desc: '全田：蒸発なし' },
  { name: '台風',       effect: 'typhoon',     desc: '全田：品質-1' },
  { name: '冷夏',       effect: 'cool_summer', desc: '夏のみ：全田 成長-1' },
  { name: '早霜',       effect: 'early_frost', desc: '秋のみ：晩稲 成長-2' },
  { name: '大雪',       effect: 'heavy_snow',  desc: '冬のみ：次の春 -1行動' },
  { name: '小春日和',   effect: 'mild_day',    desc: '全員：並俵+2' },
  { name: '小春日和',   effect: 'mild_day',    desc: '全員：並俵+2' },
  { name: '大雨',       effect: 'heavy_rain',  desc: '全田：水位+2' },
  { name: '恵みの露',   effect: 'gentle_rain', desc: '全田：水位+1' },
  { name: '干ばつ',     effect: 'drought',     desc: '全田：水位-2' },
  { name: '豊穣の兆し', effect: 'bountiful',   desc: '全田：成長+1' },
  { name: '豊穣の兆し', effect: 'bountiful',   desc: '全田：成長+1' },
];

// ---- 手札カードデッキ ----
// type: 'action' → 手札に加え、後で使用
// type: 'event'  → 引いた瞬間に全プレイヤーへ即発動
// needsTarget: true → 使用時にフィールド選択が必要
// type: 'event' → 使うと全員に影響（警告付き）
// 全員共通の1つの山札から引く。すべて「使えば即・直接効果」型。
// 山札の大部分は 成長肥料・品質肥料・苗。
// 枚数はゲーム全体で枯渇しないよう多め（計70枚・割合は 3:3:3:1:1:2:1 を維持）。
export const HAND_CARDS = [
  { id: 'growth_fert',   name: '成長肥料', type: 'action', needsTarget: true,  desc: '育成中の田1枚を選んで成長+1',        count: 15 },
  { id: 'quality_fert',  name: '品質肥料', type: 'action', needsTarget: true,  desc: '育成中の田1枚を選んで品質+1',        count: 15 },
  { id: 'seedling_card', name: '苗',       type: 'action', needsTarget: false, desc: '苗+1（次の植付が成長+1・コスト-1）', count: 15 },
  { id: 'growth_all',    name: '豊作',     type: 'action', needsTarget: false, desc: '自分の育成中の全田：成長+1',         count: 5 },
  { id: 'water_all',     name: '慈雨',     type: 'event',  needsTarget: false, desc: '⚡全員の全田：水位+1',               count: 5 },
  { id: 'strawwork',     name: '藁仕事',   type: 'action', needsTarget: false, desc: '評判+1（年1回制限あり）',            count: 10 },
  { id: 'water_drought', name: '水枯れ',   type: 'event',  needsTarget: false, desc: '⚡全員の全田：水位-1（自分も含む）', count: 5 },
  // 強力な災害イベント（各1枚だけ）
  { id: 'flood_all',     name: '大洪水',   type: 'event',  needsTarget: false, desc: '⚡全員の全田：水位5（稲が流出）',     count: 1 },
  { id: 'drought_all',   name: '大干ばつ', type: 'event',  needsTarget: false, desc: '⚡全員の全田：水位0（成長停止）',     count: 1 },
];

// ダイス目 → 効果（☀️1-2 / 💧3-4 / 🌬️5 / ✨6）
export function diceEffect(d) {
  if (d <= 2) return { type: 'sun',  icon: '☀️', desc: '水位-1' };
  if (d <= 4) return { type: 'rain', icon: '💧', desc: '水位+1' };
  if (d === 5) return { type: 'wind', icon: '🌬️', desc: '風' };
  return             { type: 'star', icon: '✨', desc: '成長+1' };
}
