import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cfg } from '../config.js';
import { handleApi } from './api.js';
import { handleSse, initSse } from './sse.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function startWebServer(): void {
  initSse();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/stream') return handleSse(res);
      if (await handleApi(req, res, url)) return;

      // static
      let rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      rel = path.normalize(rel);
      if (rel.startsWith('..')) {
        res.writeHead(400).end('bad path');
        return;
      }
      const full = path.join(cfg.publicDir, rel);
      try {
        const data = await readFile(full);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end('not found');
      }
    } catch (e) {
      console.error('web error:', e);
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error');
    }
  });
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`web ui: http://127.0.0.1:${cfg.port} (https://app.${cfg.domain})`);
  });
}
