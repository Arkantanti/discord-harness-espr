import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

// dist/config.js -> project root is one level up
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const cfg = {
  rootDir,
  port: Number(process.env.HARNESS_PORT ?? 3000),
  maxConcurrent: Number(process.env.HARNESS_MAX_CONCURRENT ?? 4),
  domain: process.env.HARNESS_DOMAIN ?? '167-233-160-246.sslip.io',
  defaultModel: process.env.HARNESS_DEFAULT_MODEL || undefined,
  effort: (process.env.HARNESS_EFFORT || undefined) as
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | undefined,
  maxTurns: Number(process.env.HARNESS_MAX_TURNS ?? 100),
  /** Terminate non-standing agents idle this long with an empty inbox. 0 disables the reaper. */
  idleReapMs: Number(process.env.HARNESS_IDLE_REAP_MS ?? 60 * 60_000),
  reapSweepMs: Number(process.env.HARNESS_REAP_SWEEP_MS ?? 60_000),
  dataDir: path.join(rootDir, 'data'),
  dbPath: path.join(rootDir, 'data', 'harness.db'),
  pagesDir: path.join(rootDir, 'pages'),
  watchersDir: path.join(rootDir, 'watchers'),
  toolsDir: path.join(rootDir, 'tools'),
  workspacesDir: path.join(rootDir, 'workspaces'),
  publicDir: path.join(rootDir, 'public'),
};

export function ensureDirs(): void {
  for (const d of [cfg.dataDir, cfg.pagesDir, cfg.watchersDir, cfg.toolsDir, cfg.workspacesDir]) {
    mkdirSync(d, { recursive: true });
  }
}
