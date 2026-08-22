// Spike 4+5: abort mid-turn, and two parallel queries under subscription auth.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';

const cwdA = '/home/vibe10/projects/harness/workspaces/spike-a';
const cwdB = '/home/vibe10/projects/harness/workspaces/spike-b';
mkdirSync(cwdA, { recursive: true });
mkdirSync(cwdB, { recursive: true });

// --- abort test ---
const ac = new AbortController();
setTimeout(() => { console.log('[abort] firing abort()'); ac.abort(); }, 5000);
try {
  for await (const m of query({
    prompt: 'Count slowly from 1 to 50, running `sleep 1` between each number using bash.',
    options: { cwd: cwdA, permissionMode: 'bypassPermissions', maxTurns: 60, abortController: ac },
  })) {
    if (m.type === 'result') console.log('[abort] result subtype:', m.subtype);
  }
  console.log('[abort] generator ended without throwing');
} catch (e) {
  console.log('[abort] threw (expected):', String(e).slice(0, 150));
}

// --- parallel test ---
async function one(cwd, label) {
  const t0 = Date.now();
  try {
    for await (const m of query({
      prompt: `Say "${label} ok" and nothing else.`,
      options: { cwd, permissionMode: 'bypassPermissions', maxTurns: 2 },
    })) {
      if (m.type === 'result') {
        console.log(`[${label}] subtype=${m.subtype} ms=${Date.now() - t0} text=${(m.result ?? '').slice(0, 60)}`);
      }
    }
  } catch (e) {
    console.log(`[${label}] THREW: ${String(e).slice(0, 200)}`);
  }
}
await Promise.all([one(cwdA, 'par-A'), one(cwdB, 'par-B')]);
console.log('done');
