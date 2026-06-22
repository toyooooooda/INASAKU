// ===== ゲーム定数（純ロジック・React非依存） =====

export const SEASONS = ['春', '夏', '秋', '冬'];
export const QUALITY_LABEL = ['', '並', '上質', '特上'];
export const RANK_LABELS = ['平民', '小名', '大名', '公家'];
// 位階昇進コスト（評判）: 0→1=3, 1→2=6, 2→3=10
export const RANK_COSTS = [3, 6, 10];
// ネズミ大発生: 2年目以降・各年20%・ゲーム1回まで
export const RAT_OUTBREAK_CHANCE = 0.2;

export const VARIETIES = {
  野良稲: { requiredGrowth: 3, baseQuality: 1, maxQuality: 1, cost: 0, harvestMin: 2, harvestMax: 2, desc: '3R・並どまり・無料・収穫2' },
  早稲:   { requiredGrowth: 2, baseQuality: 1, maxQuality: 1, cost: 1, harvestMin: 3, harvestMax: 4, desc: '2R・並どまり・1俵・収穫3〜4' },
  中稲:   { requiredGrowth: 3, baseQuality: 1, maxQuality: 2, cost: 2, harvestMin: 3, harvestMax: 4, desc: '3R・並〜上質・2俵・収穫3〜4' },
  晩稲:   { requiredGrowth: 4, baseQuality: 2, maxQuality: 3, cost: 2, harvestMin: 2, harvestMax: 3, desc: '4R・上質〜特上・2俵・収穫2〜3' },
};

export const TOOLS = {
  plow: { name: '道具', riceCost: 8,  repCost: 4, desc: '開墾+1 / 収穫+1俵' },
  ox:   { name: '牛',   riceCost: 16, repCost: 6, desc: '開墾+1 / 植付-1俵' },
  barn: { name: '倉',   riceCost: 6,  repCost: 3, desc: '保管半減 / ネズミ被害1/4' },
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

// ダイス目 → 効果（☀️1-2 / 💧3-4 / 🌬️5 / ✨6）
export function diceEffect(d) {
  if (d <= 2) return { type: 'sun',  icon: '☀️', desc: '水位-1' };
  if (d <= 4) return { type: 'rain', icon: '💧', desc: '水位+1' };
  if (d === 5) return { type: 'wind', icon: '🌬️', desc: '風' };
  return             { type: 'star', icon: '✨', desc: '成長+1' };
}
