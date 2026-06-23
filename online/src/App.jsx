import React, { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { HojoSuiden } from './Game.js';
import { Board } from './Board.jsx';

const SERVER = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:8000`;

const HojoClient = Client({
  game: HojoSuiden,
  board: Board,
  multiplayer: SocketIO({ server: SERVER }),
  debug: false,
});

// ロビーAPI 呼び出しヘルパー
async function apiPost(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export function App() {
  const [session, setSession] = useState(null); // {matchID, playerID, credentials, name}
  const [mode, setMode] = useState('top');      // top | create | join
  const [name, setName] = useState('');
  const [numPlayers, setNumPlayers] = useState(2);
  const [matchID, setMatchIDInput] = useState('');
  const [seat, setSeat] = useState('1');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { setErr('名前を入力してください'); return; }
    setLoading(true); setErr('');
    try {
      const { matchID: mid } = await apiPost(`/games/hojo-suiden/create`, { numPlayers });
      const { playerCredentials } = await apiPost(`/games/hojo-suiden/${mid}/join`, {
        playerID: '0', playerName: name.trim(),
      });
      // Board が ?name= を読んで setName move を呼ぶための仕込み（ページリロードなし）
      const url = new URL(window.location.href);
      url.searchParams.set('name', name.trim());
      window.history.replaceState({}, '', url.toString());
      setSession({ matchID: mid, playerID: '0', credentials: playerCredentials, name: name.trim() });
    } catch (e) {
      setErr(`作成失敗: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!name.trim()) { setErr('名前を入力してください'); return; }
    if (!matchID.trim()) { setErr('部屋コードを入力してください'); return; }
    setLoading(true); setErr('');
    try {
      const { playerCredentials } = await apiPost(`/games/hojo-suiden/${matchID.trim()}/join`, {
        playerID: seat, playerName: name.trim(),
      });
      const url = new URL(window.location.href);
      url.searchParams.set('name', name.trim());
      window.history.replaceState({}, '', url.toString());
      setSession({ matchID: matchID.trim(), playerID: seat, credentials: playerCredentials, name: name.trim() });
    } catch (e) {
      setErr(`参加失敗: ${e.message}（部屋コードや席番号を確認してください）`);
    } finally {
      setLoading(false);
    }
  }

  // ゲーム画面
  if (session) {
    return (
      <div className="app">
        <HojoClient
          matchID={session.matchID}
          playerID={session.playerID}
          credentials={session.credentials}
        />
        <p className="hint">
          部屋コード: <b>{session.matchID}</b>　席: <b>{session.playerID}</b>　名前: <b>{session.name}</b>
        </p>
      </div>
    );
  }

  // トップ
  if (mode === 'top') {
    return (
      <div className="app lobby">
        <h2>🌾 豊穣の水田</h2>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="lobby-btn" onClick={() => setMode('create')}>部屋を作る（ホスト）</button>
          <button className="lobby-btn" onClick={() => setMode('join')}>部屋に入る</button>
        </div>
      </div>
    );
  }

  // 部屋作成
  if (mode === 'create') {
    return (
      <div className="app lobby">
        <h2>🌾 部屋を作る</h2>
        <label>お名前<br />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="農家1" maxLength={16} />
        </label>
        <label>人数<br />
          <select value={numPlayers} onChange={e => setNumPlayers(Number(e.target.value))}>
            <option value={2}>2人</option>
            <option value={3}>3人</option>
            <option value={4}>4人</option>
          </select>
        </label>
        {err && <p style={{ color: 'red' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="lobby-btn" onClick={handleCreate} disabled={loading}>
            {loading ? '作成中…' : '部屋を作成 →'}
          </button>
          <button className="back" onClick={() => { setMode('top'); setErr(''); }}>← 戻る</button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          作成後に表示される「部屋コード」を他のプレイヤーに共有してください。<br/>
          あなたは自動的に席0（最初の手番）になります。
        </p>
      </div>
    );
  }

  // 参加
  return (
    <div className="app lobby">
      <h2>🌾 部屋に入る</h2>
      <label>お名前<br />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="農家2" maxLength={16} />
      </label>
      <label>部屋コード<br />
        <input value={matchID} onChange={e => setMatchIDInput(e.target.value)} placeholder="ホストから受け取ったコード" />
      </label>
      <label>席番号<br />
        <select value={seat} onChange={e => setSeat(e.target.value)}>
          <option value="1">席1（2人目）</option>
          <option value="2">席2（3人目）</option>
          <option value="3">席3（4人目）</option>
        </select>
      </label>
      {err && <p style={{ color: 'red' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="lobby-btn" onClick={handleJoin} disabled={loading}>
          {loading ? '参加中…' : '参加 →'}
        </button>
        <button className="back" onClick={() => { setMode('top'); setErr(''); }}>← 戻る</button>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        席番号はホストと別々になるように選んでください。<br/>
        2人なら席0（ホスト）と席1、3人なら席0・1・2。
      </p>
    </div>
  );
}
