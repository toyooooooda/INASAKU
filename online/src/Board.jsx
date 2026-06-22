import React, { useState, useEffect, useRef } from 'react';
import { SEASONS, QUALITY_LABEL, RANK_LABELS, RANK_COSTS, VARIETIES, TOOLS } from './constants.js';

const riceTotal = (p) => p.rice.reduce((s, r) => s + r.count, 0);
const ricePts = (p) => p.rice.reduce((s, r) => s + r.count * r.quality, 0);
const fieldName = (f, fields) => `田${fields.findIndex((x) => x.id === f.id) + 1}`;
const wildName = (w, wilds) => `荒れ地${wilds.findIndex((x) => x.id === w.id) + 1}`;

const WATER_COLOR = ['#e74c3c','#e67e22','#4caf50','#4caf50','#e67e22','#e74c3c'];
const WATER_LABEL = ['干ばつ','低水位','最適','最適','病害','洪水'];
const QUALITY_COLOR = { 1: '#888', 2: '#4a90d9', 3: '#c0a030' };

function WaterBar({ level }) {
  return (
    <div className="water-bar-wrap">
      {[0,1,2,3,4,5].map((i) => (
        <div key={i} className="water-pip" style={{
          background: i <= level ? WATER_COLOR[level] : '#ddd',
          opacity: i <= level ? 1 : 0.5,
        }} />
      ))}
      <span className="water-label" style={{ color: WATER_COLOR[level] }}>{WATER_LABEL[level]}</span>
    </div>
  );
}

function GrowthBar({ growth, required }) {
  return (
    <div className="growth-bar-wrap">
      {Array.from({ length: required }, (_, i) => (
        <div key={i} className="growth-pip" style={{ background: i < growth ? '#4a8a4a' : '#ddd' }} />
      ))}
    </div>
  );
}

function FieldCard({ f, idx }) {
  const isEmpty = f.status === 'empty';
  const isMature = f.status === 'mature';
  const isPlanted = f.status === 'planted';
  return (
    <div className={`field-card field-card--${f.status}${f.overripe > 0 ? ' overripe' : ''}`}>
      <div className="field-card-header">
        <span className="field-card-num">田{idx + 1}</span>
        {isEmpty && <span className="field-badge badge--empty">{f.tilled ? '🚜耕済' : '空き'}</span>}
        {isPlanted && <span className="field-badge badge--planted">育成中</span>}
        {isMature && <span className="field-badge badge--mature">{f.overripe > 0 ? '⚠過熟' : '収穫可'}</span>}
      </div>

      {!isEmpty && (
        <div className="field-variety">
          <span style={{ fontWeight: 'bold' }}>{f.variety}</span>
          <span className="field-quality" style={{ color: QUALITY_COLOR[f.quality] }}>
            {QUALITY_LABEL[f.quality]}
          </span>
          <span className="field-fert-icons">
            {f.fertilized && '✨'}{f.growthFertilized && '🌿'}
          </span>
        </div>
      )}

      {isPlanted && (
        <div className="field-growth">
          <span className="field-growth-text">成長 {f.growth}/{f.requiredGrowth}</span>
          <GrowthBar growth={f.growth} required={f.requiredGrowth} />
        </div>
      )}

      <div className="field-water-row">
        <span className="field-water-num">💧{f.water}</span>
        <WaterBar level={f.water} />
      </div>
    </div>
  );
}

function PlayerPanel({ p, isCurrent, isMe }) {
  return (
    <div className={`panel ${isCurrent ? 'current' : ''} ${isMe ? 'me' : ''}`}>
      <div className="phead">
        <b>{isCurrent ? '▶ ' : ''}{p.name}{isMe ? '（あなた）' : ''}</b>
        <span className="rank">{RANK_LABELS[p.rank]}</span>
      </div>
      <div className="stats">
        <span>俵{riceTotal(p)}（{ricePts(p)}pt）</span>
        <span>評判{p.reputation}</span>
        <span>働き手{p.workers - p.workersUsed}/{p.workers}</span>
      </div>
      <div className="rice">
        並{p.rice[0].count} / 上質{p.rice[1].count} / 特上{p.rice[2].count}
      </div>
      <div className="field-section-label">田（{p.fields.length}/{p.landLimit}）</div>
      <div className="field-grid">
        {p.fields.map((f, i) => <FieldCard key={f.id} f={f} idx={i} />)}
      </div>
      <div className="badges">
        荒れ地：{p.wildlands.map((w, i) => (
          <span key={w.id} className="chip">
            荒{i + 1}（{w.gauge}/3）
          </span>
        ))}
        {p.tools.plow && <span className="tag">道具</span>}
        {p.tools.ox && <span className="tag">牛</span>}
        {p.tools.barn && <span className="tag">倉</span>}
        {p.seedlings > 0 && <span className="tag">苗×{p.seedlings}</span>}
        {p.compost > 0 && <span className="tag">堆肥×{p.compost}</span>}
        {p.donatedThisYear && <span className="tag">献上済</span>}
        {p.strawworkThisYear && <span className="tag">藁済</span>}
      </div>
    </div>
  );
}

function ActionPanel({ G, me, moves, events }) {
  const [sel, setSel] = useState(null); // {kind, variety, fieldId}
  const remaining = me.workers - me.workersUsed;
  const canPlant = G.seasonIdx <= 1;
  const aw = G.seasonIdx >= 2; // 秋冬
  const empties = me.fields.filter((f) => f.status === 'empty');
  const planted = me.fields.filter((f) => f.status === 'planted');
  const matures = me.fields.filter((f) => f.status === 'mature');
  const wilds = me.wildlands.filter((w) => w.gauge < 3);
  const reset = () => setSel(null);
  const run = (fn) => { fn(); reset(); };

  // --- サブ選択画面 ---
  if (sel?.kind === 'plant') {
    return (
      <div className="act">
        <p>品種を選択：</p>
        {Object.entries(VARIETIES).map(([name, def]) => (
          <button key={name} disabled={riceTotal(me) < def.cost}
            onClick={() => setSel({ kind: 'plantField', variety: name })}>
            {name}（{def.desc}）
          </button>
        ))}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'plantField') {
    return (
      <div className="act">
        <p>{sel.variety} を植える田：</p>
        {empties.map((f) => (
          <button key={f.id} onClick={() => {
            if (me.seedlings > 0) setSel({ kind: 'plantSeed', variety: sel.variety, fieldId: f.id });
            else run(() => moves.plant(f.id, sel.variety, false));
          }}>{fieldName(f, me.fields)}（水{f.water}{f.tilled ? '・耕済' : ''}）</button>
        ))}
        {empties.length === 0 && <p>空き田なし</p>}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'plantSeed') {
    return (
      <div className="act">
        <p>苗を使う？（ストック{me.seedlings}）</p>
        <button onClick={() => run(() => moves.plant(sel.fieldId, sel.variety, true))}>🌱 苗を使う（成長+1）</button>
        <button onClick={() => run(() => moves.plant(sel.fieldId, sel.variety, false))}>そのまま植える</button>
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'irrigate' || sel?.kind === 'fertQ' || sel?.kind === 'fertG' || sel?.kind === 'till') {
    const list = sel.kind === 'irrigate' ? me.fields.filter((f) => f.water < 5)
      : sel.kind === 'fertQ' ? planted.filter((f) => !f.fertilized && f.quality < (VARIETIES[f.variety]?.maxQuality ?? 3))
        : sel.kind === 'fertG' ? planted.filter((f) => !f.growthFertilized && f.growth < f.requiredGrowth)
          : empties.filter((f) => !f.tilled);
    const label = { irrigate: '水を引く田', fertQ: '品質肥料の田', fertG: '成長肥料の田', till: '耕す田' }[sel.kind];
    const call = {
      irrigate: (id) => moves.irrigate(id), fertQ: (id) => moves.fertilizeQuality(id),
      fertG: (id) => moves.fertilizeGrowth(id), till: (id) => moves.tillSoil(id),
    }[sel.kind];
    return (
      <div className="act">
        <p>{label}：</p>
        {list.map((f) => (
          <button key={f.id} onClick={() => run(() => call(f.id))}>
            {fieldName(f, me.fields)}（水{f.water}{f.status !== 'empty' ? `・${f.variety}${QUALITY_LABEL[f.quality]}` : f.tilled ? '・耕済' : ''}）
          </button>
        ))}
        {list.length === 0 && <p>対象なし</p>}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'reclaim') {
    return (
      <div className="act">
        <p>開墾する荒れ地：</p>
        {wilds.map((w) => <button key={w.id} onClick={() => run(() => moves.reclaim(w.id))}>{wildName(w, me.wildlands)}（ゲージ{w.gauge}/3）</button>)}
        {wilds.length === 0 && <p>対象なし</p>}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'harvest') {
    return (
      <div className="act">
        <p>収穫する田：</p>
        {matures.map((f) => <button key={f.id} onClick={() => setSel({ kind: 'harvestW', fieldId: f.id })}>{fieldName(f, me.fields)}（{f.variety}・{QUALITY_LABEL[f.quality]}{f.overripe > 0 ? '・過熟⚠' : ''}）</button>)}
        {matures.length === 0 && <p>成熟田なし</p>}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'harvestW') {
    const f = me.fields.find((x) => x.id === sel.fieldId);
    const def = f && VARIETIES[f.variety]; const pb = me.tools.plow ? 1 : 0;
    return (
      <div className="act">
        <p>収穫の規模：</p>
        <button disabled={remaining < 1} onClick={() => run(() => moves.harvest(sel.fieldId, 1))}>働き手1 → {def ? def.harvestMin + pb : '?'}俵</button>
        <button disabled={remaining < 2} onClick={() => run(() => moves.harvest(sel.fieldId, 2))}>働き手2 → {def ? def.harvestMax + pb : '?'}俵</button>
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'donate') {
    return (
      <div className="act">
        <p>献上する俵（評判+2・働き手2）：</p>
        {[2, 3].map((q) => <button key={q} disabled={me.rice[q - 1].count < 1} onClick={() => run(() => moves.donate(q))}>{QUALITY_LABEL[q]}を納める（残{me.rice[q - 1].count}）</button>)}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'buy') {
    return (
      <div className="act">
        <p>購入する道具：</p>
        {Object.entries(TOOLS).map(([item, s]) => me.tools[item] ? null : (
          <div key={item} className="buyrow">
            <span>{s.name}（{s.desc}）</span>
            <button disabled={riceTotal(me) < s.riceCost} onClick={() => run(() => moves.buyTool(item, 'rice'))}>{s.riceCost}俵</button>
            <button disabled={me.reputation < s.repCost} onClick={() => run(() => moves.buyTool(item, 'reputation'))}>評判{s.repCost}</button>
          </div>
        ))}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }

  // --- メインメニュー ---
  const fertOK = riceTotal(me) >= 1 || me.compost > 0;
  return (
    <div className="act">
      <p>働き手 残り {remaining}/{me.workers}</p>
      <div className="menu">
        <button disabled={!canPlant || empties.length === 0 || remaining < 1} onClick={() => setSel({ kind: 'plant' })}>🌱 植え付け{!canPlant ? '(春夏)' : ''}</button>
        <button disabled={remaining < 1} onClick={() => setSel({ kind: 'irrigate' })}>💧 水を引く</button>
        <button disabled={remaining < 1 || !fertOK || planted.length === 0} onClick={() => setSel({ kind: 'fertQ' })}>✨ 品質肥料</button>
        <button disabled={remaining < 1 || !fertOK || planted.length === 0} onClick={() => setSel({ kind: 'fertG' })}>🌿 成長肥料</button>
        <button disabled={remaining < 1 || wilds.length === 0} onClick={() => setSel({ kind: 'reclaim' })}>⛏️ 開墾</button>
        <button disabled={remaining < 1 || matures.length === 0} onClick={() => setSel({ kind: 'harvest' })}>🌾 収穫</button>
        <button disabled={remaining < 2 || me.donatedThisYear} onClick={() => setSel({ kind: 'donate' })}>🎁 献上</button>
        <button onClick={() => setSel({ kind: 'buy' })}>🛒 購入</button>
        <button disabled={!aw || remaining < 2} onClick={() => run(() => moves.migrantWork())}>💪 出稼ぎ{!aw ? '(秋冬)' : ''}</button>
        <button disabled={!aw || remaining < 1} onClick={() => run(() => moves.raiseSeedling())}>🌿 育苗{!aw ? '(秋冬)' : ''}</button>
        <button disabled={!aw || remaining < 1 || empties.filter((f) => !f.tilled).length === 0} onClick={() => setSel({ kind: 'till' })}>🚜 土づくり{!aw ? '(秋冬)' : ''}</button>
        <button disabled={!aw || remaining < 2 || me.strawworkThisYear} onClick={() => run(() => moves.strawWork())}>🪢 藁仕事{!aw ? '(秋冬)' : ''}</button>
        <button disabled={!aw || remaining < 1} onClick={() => run(() => moves.makeCompost())}>🍂 堆肥作り{!aw ? '(秋冬)' : ''}</button>
      </div>
      <button className="done" onClick={() => events.endTurn()}>行動終了（次のプレイヤーへ）</button>
    </div>
  );
}

function YearEndPanel({ me, moves }) {
  const [hire, setHire] = useState(0);
  const [rank, setRank] = useState(false);
  const canRank = me.rank < RANK_COSTS.length && me.reputation >= RANK_COSTS[me.rank];
  return (
    <div className="act">
      <p><b>年度末の決定</b>（租・保管・維持費は徴収済み）</p>
      <p>俵{riceTotal(me)} ／ 評判{me.reputation} ／ 働き手{me.workers}</p>
      <div>雇用：
        {[0, 1, 2, 3].map((n) => (
          <button key={n} className={hire === n ? 'on' : ''} disabled={riceTotal(me) < n * 4} onClick={() => setHire(n)}>{n}人</button>
        ))}
        <span>（1人=4俵）</span>
      </div>
      <div>昇進：
        <button className={rank ? 'on' : ''} disabled={!canRank} onClick={() => setRank(!rank)}>
          {canRank ? `${RANK_LABELS[me.rank + 1]}へ（評判-${RANK_COSTS[me.rank]}）` : '不可'}
        </button>
      </div>
      <button className="done" onClick={() => moves.yearEndDecision(hire, rank)}>決定して次へ</button>
    </div>
  );
}

function computeNetEffect(card, effects) {
  let diceWater = 0, diceGrowth = 0, hasWind = false;
  effects.forEach((e) => {
    if (e.type === 'sun') diceWater -= 1;
    else if (e.type === 'rain') diceWater += 1;
    else if (e.type === 'star') diceGrowth += 1;
    else if (e.type === 'wind') hasWind = true;
  });
  const cardWaterMap = { heavy_rain: 2, gentle_rain: 1, drought: -2 };
  const cardWater = cardWaterMap[card.effect] ?? 0;
  const cardGrowth = card.effect === 'bountiful' ? 1 : 0;
  const totalWater = diceWater + cardWater;
  const totalGrowth = diceGrowth + cardGrowth;

  const rows = [];
  if (totalWater !== 0 || diceWater !== 0 || cardWater !== 0) {
    const parts = [];
    if (cardWater) parts.push(`カード${cardWater > 0 ? '+' : ''}${cardWater}`);
    if (diceWater) parts.push(`ダイス${diceWater > 0 ? '+' : ''}${diceWater}`);
    rows.push({ icon: totalWater >= 0 ? '💧' : '🏜️', main: `全田 水位 ${totalWater >= 0 ? '+' : ''}${totalWater}`, detail: parts.join(' ＋ ') });
  }
  if (totalGrowth > 0) {
    const parts = [];
    if (cardGrowth) parts.push(`カード+${cardGrowth}`);
    if (diceGrowth) parts.push(`ダイス+${diceGrowth}`);
    rows.push({ icon: '🌿', main: `植付中 成長 +${totalGrowth}`, detail: parts.join(' ＋ ') });
  }
  const SPECIALS = {
    typhoon:     { icon: '🌀', main: '全植付・成熟田：品質 -1', detail: '' },
    cool_summer: { icon: '❄️', main: '夏のみ：全植付 成長 -1', detail: '' },
    early_frost: { icon: '🌨️', main: '秋のみ：晩稲 成長 -2', detail: '' },
    heavy_snow:  { icon: '❄️', main: '冬のみ：次の春 -1行動', detail: '' },
    mild_day:    { icon: '🌞', main: '全員：並俵 +2', detail: '' },
    cloudy:      { icon: '☁️', main: 'このラウンドは蒸発なし', detail: '' },
  };
  if (SPECIALS[card.effect]) rows.push(SPECIALS[card.effect]);
  if (hasWind) rows.push({ icon: '🌬️', main: '風（追加天候・M1では効果なし）', detail: '' });
  if (rows.length === 0) rows.push({ icon: '☀️', main: '特別な効果なし', detail: '' });
  return rows;
}

function WeatherOverlay({ G, onClose }) {
  if (!G.weather) return null;
  const { card, dice, effects } = G.weather;
  const netEffects = computeNetEffect(card, effects);
  return (
    <div className="weather-overlay">
      <div className="weather-modal">
        <div className="weather-season">{G.year}年目 {SEASONS[G.seasonIdx]} R{G.roundInSeason + 1} — 天候発表</div>
        <div className="weather-card-name">【{card.name}】</div>

        <div className="weather-dice">
          {dice.map((d, i) => (
            <span key={i} className="die">{effects[i]?.icon ?? '？'} {d}</span>
          ))}
        </div>

        <div className="weather-net-label">今ラウンドの効果</div>
        <div className="weather-net">
          {netEffects.map((row, i) => (
            <div key={i} className="weather-net-row">
              <span className="net-icon">{row.icon}</span>
              <span className="net-main">{row.main}</span>
              {row.detail && <span className="net-detail">（{row.detail}）</span>}
            </div>
          ))}
        </div>

        <button className="weather-ok" onClick={onClose}>確認</button>
      </div>
    </div>
  );
}

export function Board({ G, ctx, moves, events, playerID }) {
  const me = playerID != null ? G.players[Number(playerID)] : null;
  const myTurn = playerID != null && ctx.currentPlayer === playerID;

  // URL の &name= を自分の最初の手番に自動同期
  const urlName = new URLSearchParams(window.location.search).get('name');
  const namesynced = useRef(false);
  useEffect(() => {
    if (myTurn && urlName && !namesynced.current) {
      namesynced.current = true;
      moves.setName(urlName);
    }
  }, [myTurn]);

  // ラウンドキーが変わるたびに天候オーバーレイを表示（クライアント個別・サーバ通信なし）
  const roundKey = `${G.year}-${G.seasonIdx}-${G.roundInSeason}`;
  const prevRoundKey = useRef(null);
  const [showWeather, setShowWeather] = useState(false);
  useEffect(() => {
    if (G.weather && roundKey !== prevRoundKey.current) {
      prevRoundKey.current = roundKey;
      setShowWeather(true);
    }
  }, [roundKey, G.weather]);

  if (ctx.gameover) {
    const scores = ctx.gameover.scores || G.finalScores || [];
    return (
      <div className="wrap">
        <h1>🏆 ゲーム終了</h1>
        <ol>
          {scores.map((s) => (
            <li key={s.id}>{s.name}：<b>{s.total}点</b>（俵{s.ricePoints}＋評判{s.reputation}{s.misuBonus ? '＋米寿10' : ''}）</li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="wrap">
      {showWeather && <WeatherOverlay G={G} onClose={() => setShowWeather(false)} />}
      <header>
        <b>{G.year}年目 {SEASONS[G.seasonIdx]} R{G.roundInSeason + 1}</b>
        <span>{G.stage === 'yearEnd' ? '📜 年度末' : '🌿 行動'}</span>
        <span>手番：{G.players[Number(ctx.currentPlayer)]?.name}</span>
      </header>

      {G.weather && G.stage === 'action' && (
        <div className="weather" onClick={() => setShowWeather(true)} title="クリックで再表示" style={{ cursor: 'pointer' }}>
          天候【{G.weather.card.name}】{G.weather.effects.map((e, i) => `${e.icon}${G.weather.dice[i]}`).join(' ')}
        </div>
      )}

      <div className="players">
        {G.players.map((p, i) => (
          <PlayerPanel key={p.id} p={p} isCurrent={Number(ctx.currentPlayer) === i} isMe={Number(playerID) === i} />
        ))}
      </div>

      <div className="control">
        {!me ? <p>観戦中（席が割り当てられていません）</p>
          : !myTurn ? <p>他のプレイヤーの手番です…</p>
            : G.stage === 'yearEnd' ? <YearEndPanel me={me} moves={moves} />
              : <ActionPanel G={G} me={me} moves={moves} events={events} />}
      </div>

      <div className="log">
        {G.log.slice(-12).reverse().map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}
