import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// boardgame.io のクライアントは Vite(ESM) で動く。
// サーバは別プロセス（npm run server）で boardgame.io/server を起動する。
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true }, // host:true で同一LAN内の別端末からもアクセス可
});
