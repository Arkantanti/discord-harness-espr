import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfg } from '../config.js';
import type { WatcherPlugin } from '../types.js';
import { timerPlugin } from './builtin/timer.js';
import { cronPlugin } from './builtin/cron.js';
import { pollPlugin } from './builtin/poll.js';

export interface LoadResult {
  registry: Map<string, WatcherPlugin>;
  errors: string[];
}

function isPlugin(p: any): p is WatcherPlugin {
  return p && typeof p.type === 'string' && typeof p.start === 'function';
}

/** Built-ins + dynamic import of watchers/*.mjs (cache-busted so edits take effect on reload). */
export async function loadRegistry(): Promise<LoadResult> {
  const registry = new Map<string, WatcherPlugin>();
  const errors: string[] = [];
  for (const p of [timerPlugin, cronPlugin, pollPlugin]) registry.set(p.type, p);

  let files: string[] = [];
  try {
    files = readdirSync(cfg.watchersDir).filter((f) => f.endsWith('.mjs'));
  } catch {
    return { registry, errors };
  }
  for (const f of files) {
    const full = path.join(cfg.watchersDir, f);
    try {
      const url = pathToFileURL(full).href + '?v=' + statSync(full).mtimeMs;
      const mod = await import(url);
      const exported = mod.default;
      const plugins = Array.isArray(exported) ? exported : [exported];
      for (const p of plugins) {
        if (!isPlugin(p)) {
          errors.push(`${f}: default export is not a WatcherPlugin ({type, start})`);
          continue;
        }
        if (registry.has(p.type)) errors.push(`${f}: type "${p.type}" overrides an existing plugin`);
        registry.set(p.type, p);
      }
    } catch (e) {
      errors.push(`${f}: import failed: ${String(e).slice(0, 500)}`);
    }
  }
  return { registry, errors };
}
