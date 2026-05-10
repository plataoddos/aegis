import { WebSocketServer, WebSocket } from 'ws';
import { onEvent } from './bots.js';
import type { Server } from 'node:http';

export function attachWS(server: Server, apiToken: string) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (token !== apiToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 25_000);
    ws.on('close', () => clearInterval(ping));
  });

  onEvent((evt) => {
    const payload = JSON.stringify({ type: 'event', data: evt });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  return wss;
}
