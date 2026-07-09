// ソークテスト：ランダムに行動しながら doneTurn/yearEndDecision で全ゲーム完走できるか。
// 手番が進まなくなったら（ctx.turn が増えない）状態をダンプして異常終了。
import { Client } from 'boardgame.io/dist/cjs/client.js';
import { HojoSuiden } from './src/Game.js';

function soak({ numPlayers, mode, advanced, seed }) {
  const game = { ...HojoSuiden, seed };
  const client = Client({ game, numPlayers, setupData: { advanced, mode } });
  client.start();
  let steps = 0;
  for (; steps < 3000; steps++) {
    const st = client.getState();
    if (!st) throw new Error('state is null');
    if (st.ctx.gameover) return { ok: true, steps, turns: st.ctx.turn };
    const cur = st.ctx.currentPlayer;
    const turnBefore = st.ctx.turn;
    const G = st.G;
    const p = G.players[Number(cur)];

    if (G.stage === 'yearEnd') {
      client.moves.yearEndDecision(Math.random() < 0.3 ? 1 : 0, Math.random() < 0.3, 0);
    } else {
      // ランダムに数手行動してから終了
      const r = Math.random();
      if (r < 0.25 && p.fields[0]) client.moves.irrigate(p.fields[0].id);
      else if (r < 0.4 && G.seasonIdx <= 1 && p.fields.find(f => f.status === 'empty')) {
        client.moves.plant(p.fields.find(f => f.status === 'empty').id, '野良稲', false);
      } else if (r < 0.5 && G.seasonIdx >= 2) client.moves.drawCard();
      else if (r < 0.6 && G.mode !== 'territory' && p.wildlands[0]) client.moves.reclaim(p.wildlands[0].id);
      else if (r < 0.65) client.moves.buildProject();
      else if (r < 0.7 && p.fields.find(f => f.status === 'mature')) {
        client.moves.harvest(p.fields.find(f => f.status === 'mature').id, 1);
      }
      client.moves.doneTurn();
    }

    const st2 = client.getState();
    if (st2.ctx.gameover) return { ok: true, steps, turns: st2.ctx.turn };
    if (st2.ctx.turn === turnBefore) {
      // 手番が進んでいない＝スタック
      return {
        ok: false, steps,
        dump: {
          turn: st2.ctx.turn, currentPlayer: st2.ctx.currentPlayer,
          stage: st2.G.stage, year: st2.G.year, seasonIdx: st2.G.seasonIdx,
          roundInSeason: st2.G.roundInSeason, turnCount: st2.G.turnCount,
          playerDone: st2.G.playerDone, yearEndDone: st2.G.yearEndDone,
          log: st2.G.log.slice(-6),
        },
      };
    }
  }
  return { ok: false, steps, dump: 'step limit reached without gameover' };
}

let fail = 0;
for (const numPlayers of [2, 3, 4]) {
  for (const mode of ['normal', 'territory']) {
    for (const advanced of [false, true]) {
      for (let seed = 1; seed <= 5; seed++) {
        const label = `${numPlayers}p ${mode} adv=${advanced} seed=${seed}`;
        try {
          const res = soak({ numPlayers, mode, advanced, seed: `s${seed}` });
          if (res.ok) console.log(`OK   ${label} (steps=${res.steps} turns=${res.turns})`);
          else { fail++; console.log(`STUCK ${label}`, JSON.stringify(res.dump, null, 1)); }
        } catch (e) {
          fail++; console.log(`THROW ${label}: ${e.message}`);
        }
      }
    }
  }
}
console.log(fail === 0 ? '=== ALL PASS ===' : `=== ${fail} FAILURES ===`);
process.exit(fail === 0 ? 0 : 1);
