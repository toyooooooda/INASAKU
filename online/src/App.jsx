import React from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { HojoSuiden } from './Game.js';
import { Board } from './Board.jsx';

// URL パラメータで席と部屋を指定:
//   ?players=2&match=room1&seat=0   （1台目／タブ1）
//   ?players=2&match=room1&seat=1   （2台目／タブ2）
const params = new URLSearchParams(window.location.search);
const numPlayers = Math.max(2, Math.min(4, parseInt(params.get('players') || '2', 10)));
const matchID = params.get('match') || 'default';
const playerID = params.get('seat') ?? '0';

// VITE_SERVER_URL を設定すれば本番サーバへ接続。未設定はローカル:8000
const SERVER = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:8000`;

const HojoClient = Client({
  game: HojoSuiden,
  board: Board,
  numPlayers,
  multiplayer: SocketIO({ server: SERVER }),
  debug: true,
});

export function App() {
  return (
    <div className="app">
      <HojoClient matchID={matchID} playerID={playerID} />
      <p className="hint">
        部屋: <b>{matchID}</b> ／ あなたの席: <b>{playerID}</b> ／ 人数: <b>{numPlayers}</b><br />
        別の席は URL の <code>?seat=1</code> のように開いてください（例:
        <code>?players=2&match=room1&seat=1</code>）。
      </p>
    </div>
  );
}
