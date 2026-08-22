// Spike 2: resume with same cwd (context retained?) vs different cwd (silently fresh?)
// Run: node scripts/spike-resume.mjs <sessionId>
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';

const sessionId = process.argv[2];
const sameCwd = '/home/vibe10/projects/harness/workspaces/spike';
const otherCwd = '/home/vibe10/projects/harness/workspaces/spike-other';
mkdirSync(otherCwd, { recursive: true });

async function ask(cwd, label) {
  try {
    for await (const m of query({
      prompt: 'What number did I ask you to remember earlier? Answer with just the number, or NONE if no number was mentioned.',
      options: { cwd, resume: sessionId, permissionMode: 'bypassPermissions', maxTurns: 2 },
    })) {
      if (m.type === 'result') {
        console.log(`[${label}] subtype=${m.subtype} session=${m.session_id} answer=${(m.result ?? m.error ?? '').slice(0, 120)}`);
      }
    }
  } catch (e) {
    console.log(`[${label}] THREW: ${String(e).slice(0, 200)}`);
  }
}

await ask(sameCwd, 'same-cwd');
await ask(otherCwd, 'other-cwd');
