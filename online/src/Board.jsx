import React, { useState, useEffect, useRef } from 'react';
import { SEASONS, QUALITY_LABEL, RANK_LABELS, RANK_COSTS, VARIETIES, TOOLS, HAND_CARDS } from './constants.js';

// ---- ツールチップ ----
function Tip({ text, children }) {
  return (
    <span className="tip-wrap">
      {children}
      <span className="tip-box">{text}</span>
    </span>
  );
}

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
        {isEmpty && <span className="field-badge badge--empty" title={f.tilled ? '耕済み：次に植える作物が品質+1でスタート' : '空き田：植え付けか土づくりが可能'}>{f.tilled ? '🚜耕済' : '空き'}</span>}
        {isPlanted && <span className="field-badge badge--planted" title="育成中：成長が必要ラウンド数に達すると収穫可になる">育成中</span>}
        {isMature && <span className="field-badge badge--mature" title={f.overripe > 0 ? `過熟：放置${f.overripe}Rで品質-1（並まで）。早めに収穫を` : '収穫可：働き手1=通常量・2=豊作量'}>{f.overripe > 0 ? '⚠過熟' : '収穫可'}</span>}
      </div>

      {!isEmpty && (
        <div className="field-variety">
          <span style={{ fontWeight: 'bold' }}>{f.variety}</span>
          <span className="field-quality" style={{ color: QUALITY_COLOR[f.quality] }}
            title={`品質（勝利点）：並1点・上質2点・特上3点\n品質肥料（働き手1・堆肥or俵1）で+1できる`}>
            {QUALITY_LABEL[f.quality]}
          </span>
          <span className="field-fert-icons">
            {f.fertilized && <span title="品質肥料済み（この作のみ）">✨</span>}
            {f.growthFertilized && <span title="成長肥料済み（この作のみ）">🌿</span>}
          </span>
        </div>
      )}

      {isPlanted && (
        <div className="field-growth">
          <span className="field-growth-text">成長 {f.growth}/{f.requiredGrowth}</span>
          <GrowthBar growth={f.growth} required={f.requiredGrowth} />
        </div>
      )}

      <div className="field-water-row" title="水位（0〜5）&#10;0=干ばつ・1=低水位：成長なし&#10;2〜3=最適：成長+1&#10;4=病害・5=洪水（作物消滅）&#10;毎ラウンド-1蒸発。「水を引く」で+2">
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
        <span title="俵の総数（通貨兼勝利点）&#10;並1点・上質2点・特上3点で最終計算">俵{riceTotal(p)}（{ricePts(p)}pt）</span>
        <span title="第二の通貨&#10;増：上質/特上収穫+1・献上+2・藁仕事+1&#10;減：並を1回に4俵以上出荷-1・維持費未払いで離脱-1&#10;使途：道具/牛/倉の支払い・位階昇進・最終点">評判{p.reputation}</span>
        <span title={`働き手（固定リソース）&#10;残り使用数/総数&#10;毎ターン配置して使い回す。ターン後に手元へ戻る&#10;増員：年度末のみ・1人4俵。維持費：1人1俵/年`}>働き手{p.workers - p.workersUsed}/{p.workers}</span>
      </div>
      <div className="rice" title="俵の等級内訳&#10;並1点 / 上質2点 / 特上3点（最終得点換算）">
        並{p.rice[0].count} / 上質{p.rice[1].count} / 特上{p.rice[2].count}
      </div>
      <div className="field-section-label">田（{p.fields.length}/{p.landLimit}）</div>
      <div className="field-grid">
        {p.fields.map((f, i) => <FieldCard key={f.id} f={f} idx={i} />)}
      </div>
      <div className="badges">
        荒れ地：{p.wildlands.map((w, i) => (
          <span key={w.id} className="chip" title="荒れ地の開墾ゲージ&#10;働き手1でゲージ+1（道具+1・牛+1）&#10;ゲージ3で田1枚が完成する">
            荒{i + 1}（{w.gauge}/3）
          </span>
        ))}
        {p.tools.plow && <span className="tag" title="鉄製農具（8俵/評判4で購入）&#10;効果：開墾ゲージ+1・収穫+1俵">道具</span>}
        {p.tools.ox && <span className="tag" title="牛（16俵/評判6で購入）&#10;効果：開墾ゲージ+1・植え付けコスト-1俵">牛</span>}
        {p.tools.barn && <span className="tag" title="倉（6俵/評判3で購入）&#10;効果：年度末の保管ロス半減・ネズミ被害1/4に軽減">倉</span>}
        {p.tools.canal && <span className="tag" title="水路：働き手1で2か所の田に同時に水位+2">水路</span>}
        {p.tools.tank && <span className="tag" title="水桶：水プールに追加量をストックできる">水桶🪣{p.waterReserve > 0 ? `×${p.waterReserve}` : ''}</span>}
        {p.hand && p.hand.length > 0 && <span className="tag" title="手札カード（働き手不要で使える）">🃏×{p.hand.length}</span>}
        {p.seedlings > 0 && <span className="tag" title="育苗ストック&#10;植え付け時に苗1消費 → 成長+1かつ植付コスト-1">苗×{p.seedlings}</span>}
        {p.compost > 0 && <span className="tag" title="堆肥ストック&#10;肥料使用時に俵の代わりに自動消費（堆肥優先）">堆肥×{p.compost}</span>}
        {p.donatedThisYear && <span className="tag" title="今年の献上は済み（年1回まで）">献上済</span>}
        {p.strawworkThisYear && <span className="tag" title="今年の藁仕事は済み（年1回まで）">藁済</span>}
      </div>
    </div>
  );
}

function ActionPanel({ G, me, moves, playerID, ctx }) {
  const [sel, setSel] = useState(null); // {kind, variety, fieldId}
  const remaining = me.workers - me.workersUsed;
  const canPlant = G.seasonIdx <= 1;
  const aw = G.seasonIdx >= 2; // 秋冬
  const opponents = G.players.filter((p) => String(p.id) !== String(me.id));
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
        <button onClick={() => run(() => moves.plant(sel.fieldId, sel.variety, true))}>🌱 苗を使う（成長+1・植付-1俵）</button>
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
  if (sel?.kind === 'canal1') {
    const list = me.fields.filter((f) => f.water < 5);
    return (
      <div className="act">
        <p>水路で引く — 1か所目：</p>
        {list.map((f) => (
          <button key={f.id} onClick={() => setSel({ kind: 'canal2', firstId: f.id })}>
            {fieldName(f, me.fields)}（水{f.water}）
          </button>
        ))}
        {list.length === 0 && <p>対象なし</p>}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'canal2') {
    const list = me.fields.filter((f) => f.water < 5 && f.id !== sel.firstId);
    const f1 = me.fields.find((f) => f.id === sel.firstId);
    return (
      <div className="act">
        <p>水路で引く — 2か所目（1か所目：{fieldName(f1, me.fields)}）：</p>
        {list.map((f) => (
          <button key={f.id} onClick={() => run(() => moves.irrigateTwo(sel.firstId, f.id))}>
            {fieldName(f, me.fields)}（水{f.water}）
          </button>
        ))}
        {list.length === 0 && <p>対象なし</p>}
        <button className="back" onClick={() => setSel({ kind: 'canal1' })}>← 戻る</button>
      </div>
    );
  }
  // 水の横取り：相手選択 → 相手の田 → 自分の田
  if (sel?.kind === 'waterTheft1') {
    return (
      <div className="act">
        <p>💧 水の横取り <span style={{ fontSize: 11, color: '#c0392b' }}>評判-1・夏限定</span> — 水を奪う相手：</p>
        {opponents.map((op) => (
          <button key={op.id} onClick={() => setSel({ kind: 'waterTheft2', opId: String(op.id) })}>
            {op.name}
          </button>
        ))}
        <button className="back" onClick={reset}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'waterTheft2') {
    const op = G.players.find((p) => String(p.id) === sel.opId);
    const targets = op ? op.fields.filter((f) => f.water > 0) : [];
    return (
      <div className="act">
        <p>💧 {op?.name}の田から奪う（水-2）：</p>
        {targets.map((f, idx) => (
          <button key={f.id} onClick={() => setSel({ kind: 'waterTheft3', opId: sel.opId, theirFieldId: f.id })}>
            田{idx + 1}（{f.status !== 'empty' ? f.variety : '空き'}・水{f.water}）
          </button>
        ))}
        {targets.length === 0 && <p>水のある田なし</p>}
        <button className="back" onClick={() => setSel({ kind: 'waterTheft1' })}>← 戻る</button>
      </div>
    );
  }
  if (sel?.kind === 'waterTheft3') {
    const myTargets = me.fields.filter((f) => f.water < 5);
    return (
      <div className="act">
        <p>💧 水を引き込む自分の田：</p>
        {myTargets.map((f) => (
          <button key={f.id} onClick={() => run(() => moves.waterTheft(sel.opId, sel.theirFieldId, f.id))}>
            {fieldName(f, me.fields)}（水{f.water}）
          </button>
        ))}
        {myTargets.length === 0 && <p>水位5の田しかない</p>}
        <button className="back" onClick={() => setSel({ kind: 'waterTheft2', opId: sel.opId })}>← 戻る</button>
      </div>
    );
  }

  if (sel?.kind === 'playCard_field') {
    // 成長肥料：育成中の田を選んで成長+1
    const targets = planted.filter((f) => f.growth < f.requiredGrowth);
    return (
      <div className="act">
        <p>🌿【成長肥料】効果を与える田を選ぶ：</p>
        {targets.map((f) => (
          <button key={f.id} onClick={() => run(() => moves.playCard(sel.handIdx, f.id))}>
            {fieldName(f, me.fields)}（{f.variety}・成長{f.growth}/{f.requiredGrowth}）
          </button>
        ))}
        {targets.length === 0 && <p>対象の田なし（育成中の田が必要）</p>}
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
        <Tip text={'働き手1・春夏限定\n空き田に品種を選んで植える\n苗を使う→成長+1かつ植付コスト-1\n耕済みなら品質+1でスタート\n品種コスト：野良稲0・早稲1・中稲2・晩稲2俵'}>
          <button disabled={!canPlant || empties.length === 0 || remaining < 1} onClick={() => setSel({ kind: 'plant' })}>🌱 植え付け{!canPlant ? '(春夏)' : ''}</button>
        </Tip>
        <Tip text={'働き手1・コストなし・通年\n対象の田の水位+2\n最適水位は2〜3。5で洪水（作物消滅）'}>
          <button disabled={remaining < 1} onClick={() => setSel({ kind: 'irrigate' })}>💧 水を引く</button>
        </Tip>
        {me.tools.canal && (
          <Tip text={'働き手1・水路が必要\n2か所の田に同時に水位+2できる'}>
            <button disabled={remaining < 1 || me.fields.filter((f) => f.water < 5).length < 2} onClick={() => setSel({ kind: 'canal1' })}>🌊 水路（2か所）</button>
          </Tip>
        )}
        <Tip text={'働き手1・堆肥1 or 俵1\n育成中の田の品質+1（品質上限まで）\n上質→特上にするには品質上限の高い品種が必要'}>
          <button disabled={remaining < 1 || !fertOK || planted.length === 0} onClick={() => setSel({ kind: 'fertQ' })}>✨ 品質肥料</button>
        </Tip>
        <Tip text={'働き手1・堆肥1 or 俵1\n育成中の田の成長+1（各田1回まで）\n収穫まであと少しというときに便利'}>
          <button disabled={remaining < 1 || !fertOK || planted.length === 0} onClick={() => setSel({ kind: 'fertG' })}>🌿 成長肥料</button>
        </Tip>
        <Tip text={'働き手1・通年\n荒れ地ゲージ+1（道具+1・牛+1で加速）\nゲージ3で田1枚完成。土地上限内なら即完成'}>
          <button disabled={remaining < 1 || wilds.length === 0} onClick={() => setSel({ kind: 'reclaim' })}>⛏️ 開墾</button>
        </Tip>
        <Tip text={'働き手1〜2・通年\n成熟した田から俵を得る\n働き手1=通常量、2=豊作量\n道具があれば+1俵。過熟すると品質が落ちる'}>
          <button disabled={remaining < 1 || matures.length === 0} onClick={() => setSel({ kind: 'harvest' })}>🌾 収穫</button>
        </Tip>
        <Tip text={'働き手2・年1回\n上質or特上の俵を1俵納める\n→ 評判+2\n評判を一気に稼ぐ重要な手段'}>
          <button disabled={remaining < 2 || me.donatedThisYear} onClick={() => setSel({ kind: 'donate' })}>🎁 献上</button>
        </Tip>
        <Tip text={'働き手不要・通年\n道具/牛/倉を購入する\n俵払い or 評判払いを選べる（評判払いが割安）\n道具8俵/評判4・牛16俵/評判6・倉6俵/評判3'}>
          <button onClick={() => setSel({ kind: 'buy' })}>🛒 購入</button>
        </Tip>
        <Tip text={'働き手2・秋冬限定\n並俵を2俵獲得する\n農閑期の収入源。手が詰まったときの詰み回避に'}>
          <button disabled={!aw || remaining < 2} onClick={() => run(() => moves.migrantWork())}>💪 出稼ぎ{!aw ? '(秋冬)' : ''}</button>
        </Tip>
        <Tip text={'働き手1・秋冬限定\n空き田を耕す（耕済みマークが付く）\nその田に次に植える作物が品質+1でスタート\n（1回分・植えたら効果は消える）'}>
          <button disabled={!aw || remaining < 1 || empties.filter((f) => !f.tilled).length === 0} onClick={() => setSel({ kind: 'till' })}>🚜 土づくり{!aw ? '(秋冬)' : ''}</button>
        </Tip>
        <Tip text={'働き手1・秋冬限定\nデッキからカードを1枚引いて手札に加える\nデッキ：成長肥料/豊作/慈雨/藁仕事/水枯れ\n使うと即・直接効果（働き手不要）'}>
          <button disabled={!aw || remaining < 1 || (G.cardDeck != null && G.cardDeck.length === 0 && G.cardDiscard != null && G.cardDiscard.length === 0)} onClick={() => run(() => moves.drawCard())}>📋 カードを引く{!aw ? '(秋冬)' : ''}</button>
        </Tip>
        <hr style={{ gridColumn: '1/-1', margin: '2px 0', borderColor: '#e8c8a0' }} />
        <Tip text={'働き手1・夏限定・評判-1\n相手の田の水位-2、自分の田の水位+2\n交渉・妨害の手段（評判が必要）'}>
          <button
            disabled={G.seasonIdx !== 1 || remaining < 1 || me.reputation < 1 || opponents.every((op) => op.fields.every((f) => f.water <= 0))}
            onClick={() => setSel({ kind: 'waterTheft1' })}
            style={{ background: '#e8f4fb', borderColor: '#90cce8' }}
          >💧 水の横取り{G.seasonIdx !== 1 ? '(夏)' : ''}（評判-1）</button>
        </Tip>
      </div>
      {me.hand && me.hand.length > 0 && (
        <div className="hand-section">
          <p className="hand-title">🃏 手札（{me.hand.length}枚）— 働き手不要でいつでも使える</p>
          <div className="hand-cards">
            {me.hand.map((card, i) => {
              const cardDef = HAND_CARDS.find((c) => c.id === card.id);
              const isEvent = card.type === 'event';
              const isStrawDone = card.id === 'strawwork' && me.strawworkThisYear;
              const isGrowthFert = card.id === 'growth_fert';
              const noFertTarget = isGrowthFert && planted.filter((f) => f.growth < f.requiredGrowth).length === 0;
              const noGrowthAll = card.id === 'growth_all' && planted.length === 0;
              const disabled = isStrawDone || noFertTarget || noGrowthAll;
              const disabledReason = isStrawDone ? '今年の藁仕事は済み（年1回）'
                : noFertTarget ? '育成中の田がない'
                : noGrowthAll ? '育成中の田がない' : '';
              return (
                <div key={i} className={`hand-card${isEvent ? ' hand-card--event' : ''}`}>
                  <div className="hand-card-name">{isEvent ? '⚡' : '🌿'} {card.name}</div>
                  <div className="hand-card-desc">{cardDef?.desc ?? card.desc}</div>
                  <button
                    className="hand-card-use"
                    disabled={disabled}
                    title={disabled ? disabledReason : isEvent ? '⚠ 全員に影響！自分の田も水位-1' : `${card.name}を発動`}
                    onClick={() => {
                      if (isGrowthFert) setSel({ kind: 'playCard_field', handIdx: i });
                      else moves.playCard(i);
                    }}
                  >{isEvent ? '⚡発動' : '使う'}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <Tip text={'残りの働き手を返して手番を終える\n次のプレイヤーへターンが移る'}>
        <button className="done" onClick={() => moves.doneTurn()}>行動終了（次のプレイヤーへ）</button>
      </Tip>
    </div>
  );
}

function hireCostFor(currentWorkers, n) {
  // n人雇う総コスト（逓増: 3→4: 4俵, 4→5: 5俵, 5→6: 6俵...）
  let cost = 0; for (let i = 0; i < n; i++) cost += currentWorkers + i + 1;
  return cost;
}

function YearEndPanel({ G, me, moves }) {
  const [hire, setHire] = useState(0);
  const [rank, setRank] = useState(false);
  const canRank = me.rank < RANK_COSTS.length && me.reputation >= RANK_COSTS[me.rank];
  const exp = G.lastYearEndExpenses?.expenses?.find((e) => e.name === me.name);
  return (
    <div className="act">
      <p><b>年度末の決定</b></p>

      {exp && (
        <div className="yearend-expense">
          <div className="ye-title">今年の出費</div>
          <div className="ye-row"><span>租</span><span>-{exp.rent}俵</span></div>
          {exp.storage > 0 && <div className="ye-row"><span>保管リスク</span><span>-{exp.storage}俵</span></div>}
          {exp.rats > 0 && <div className="ye-row ye-bad"><span>🐀 ネズミ</span><span>-{exp.rats}俵</span></div>}
          <div className={`ye-row${exp.departed > 0 ? ' ye-bad' : ''}`}>
            <span>維持費</span>
            <span>-{exp.maintenance}俵{exp.departed > 0 ? `（${exp.departed}人離脱）` : ''}</span>
          </div>
          <div className="ye-total">残り {riceTotal(me)}俵 ／ 評判{me.reputation}</div>
        </div>
      )}

      <div className="ye-section">雇用（現在{me.workers}人）：
        <span title="年度末のみ増員可。雇うと毎年維持費1俵/人がかかる。リストラ不可。来年の田の数に合わせて計画的に">
          {[0, 1, 2, 3].map((n) => {
            const cost = hireCostFor(me.workers, n);
            return (
              <button key={n} className={hire === n ? 'on' : ''} disabled={n > 0 && riceTotal(me) < cost}
                onClick={() => setHire(n)}>
                {n}人{n > 0 ? `(-${cost}俵)` : ''}
              </button>
            );
          })}
        </span>
      </div>
      <div className="ye-section">昇進：
        <button className={rank ? 'on' : ''} disabled={!canRank} onClick={() => setRank(!rank)}
          title={`位階を上げると土地上限+2枚・荒れ地+2枚が増える\n昇進コスト（評判）：${RANK_COSTS.join(' / ')}（逓増）\n評判を使い切るか、道具/最終点に残すかの判断`}>
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
          {G.waterPool !== undefined && (
            <div className="weather-net-row">
              <span className="net-icon">🪣</span>
              <span className="net-main">水プール <b>{G.waterPool}</b></span>
              <span className="net-detail">（先取り注意・0になると水+1に弱体）</span>
            </div>
          )}
        </div>

        <button className="weather-ok" onClick={onClose}>確認</button>
      </div>
    </div>
  );
}

export function Board({ G, ctx, moves, events, playerID, matchData }) {
  const me = playerID != null ? G.players[Number(playerID)] : null;
  const myTurn = playerID != null && ctx.currentPlayer === playerID;

  // 名前を自分の最初の手番に自動同期（matchData優先→URL params）
  const urlName = new URLSearchParams(window.location.search).get('name');
  const nameToSync = matchData?.[Number(playerID)]?.name || urlName || '';
  const namesynced = useRef(false);
  useEffect(() => {
    if (myTurn && nameToSync && !namesynced.current) {
      namesynced.current = true;
      moves.setName(nameToSync);
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
        <b>{G.year}年目/{G.totalYears}年 {SEASONS[G.seasonIdx]} R{G.roundInSeason + 1}</b>
        {G.year === G.totalYears && G.seasonIdx <= 1 && (
          <span style={{ background: '#c0392b', borderRadius: 4, padding: '0 6px', fontSize: 11 }}>
            最終年・夏終了
          </span>
        )}
        <span>{G.stage === 'yearEnd' ? '📜 年度末' : '🌿 行動'}</span>
        {G.cardDeck && <span title="手札デッキ残枚数">🃏残{G.cardDeck.length}</span>}
        <span>手番：{G.players[Number(ctx.currentPlayer)]?.name}</span>
      </header>

      {G.weather && G.stage === 'action' && (
        <div className="weather" onClick={() => setShowWeather(true)} title="クリックで再表示" style={{ cursor: 'pointer' }}>
          天候【{G.weather.card.name}】{G.weather.effects.map((e, i) => `${e.icon}${G.weather.dice[i]}`).join(' ')}
          　🪣 水プール <b style={{ color: G.waterPool === 0 ? '#e74c3c' : G.waterPool <= 1 ? '#e67e22' : '#2980b9' }}>{G.waterPool}</b>
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
            : G.stage === 'yearEnd' ? <YearEndPanel G={G} me={me} moves={moves} />
              : <ActionPanel G={G} me={me} moves={moves} playerID={playerID} ctx={ctx} />}
      </div>

      <div className="log">
        {G.log.slice(-12).reverse().map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}
