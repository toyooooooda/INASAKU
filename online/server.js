// boardgame.io サーバ（Node・別プロセスで起動: npm run server）
// 注意: ここは React を一切 import しない純ロジックのみ（Game.js / logic.js / constants.js）。
// boardgame.io 0.50 は package "exports" 未定義のため、Node(ESM)では明示的に dist/cjs を指す。
import { Server, Origins } from 'boardgame.io/dist/cjs/server.js';
import { HojoSuiden } from './src/Game.js';

// FRONTEND_URL: 本番フロントのURL（例 https://hojo-suiden.vercel.app）
// PORT: Render が自動設定。ローカルは 8000
const FRONTEND_URL = process.env.FRONTEND_URL;
const PORT = process.env.PORT || 8000;

const server = Server({
  games: [HojoSuiden],
  origins: [
    Origins.LOCALHOST,
    'http://localhost:5173',
    ...(FRONTEND_URL ? [FRONTEND_URL] : []),
  ],
  authenticateCredentials: () => true,
});

server.run(PORT, () => {
  console.log(`boardgame.io server: port ${PORT}`);
});
