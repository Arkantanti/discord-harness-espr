import type { ServerResponse } from 'node:http';
import { bus } from '../bus.js';

const clients = new Set<ServerResponse>();

export function handleSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(type: string, data: unknown): void {
  const line = `data: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

export function initSse(): void {
  bus.on('event', (ev) => broadcast('event', { event: ev }));
  bus.on('agent_status', (s) => broadcast('agent_status', s));
  setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, 25_000).unref();
}
