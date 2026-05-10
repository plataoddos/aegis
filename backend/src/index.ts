import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { loadFromDB } from './bots.js';
import { buildApi } from './api.js';
import { attachWS } from './ws.js';

const PORT             = parseInt(process.env.PORT || '8787', 10);
const API_TOKEN        = process.env.API_TOKEN || '';
const ALLOWED_ORIGINS  = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim());

if (!API_TOKEN) {
  console.error('FATAL: API_TOKEN is required in .env');
  process.exit(1);
}

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
app.use(express.json({ limit: '256kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', buildApi(API_TOKEN));

attachWS(server, API_TOKEN);

server.listen(PORT, () => {
  console.log(`[netx-watcher] listening on http://localhost:${PORT}`);
  console.log(`[netx-watcher] WebSocket ws://localhost:${PORT}/ws?token=...`);
});

await loadFromDB();
