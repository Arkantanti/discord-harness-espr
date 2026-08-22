// Spike 1+3: subscription auth in a clean env + in-process MCP tool.
// Run: env -i HOME=/home/vibe10 PATH=/usr/local/bin:/usr/bin:/bin node scripts/spike-auth.mjs
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';

const cwd = '/home/vibe10/projects/harness/workspaces/spike';
mkdirSync(cwd, { recursive: true });

let toolCalled = false;
const pingTool = tool(
  'ping',
  'Returns a secret word. Call this when asked to ping the harness.',
  { note: z.string().describe('any short note') },
  async (args) => {
    toolCalled = true;
    return { content: [{ type: 'text', text: `pong! secret=BANANA42 note=${args.note}` }] };
  },
);
const server = createSdkMcpServer({ name: 'harness', version: '1.0.0', tools: [pingTool] });

const t0 = Date.now();
for await (const m of query({
  prompt:
    'Remember this number: 7331. Then call the ping tool with note "hello" and tell me the secret word it returns. Reply in one short line.',
  options: {
    cwd,
    permissionMode: 'bypassPermissions',
    maxTurns: 5,
    mcpServers: { harness: server },
    allowedTools: ['mcp__harness__ping'],
  },
})) {
  if (m.type === 'system' && m.subtype === 'init') {
    console.log('init: model =', m.model, '| tools include mcp?', m.tools?.filter((t) => t.startsWith('mcp__')));
  }
  if (m.type === 'result') {
    console.log('--- RESULT ---');
    console.log('subtype:', m.subtype);
    console.log('session_id:', m.session_id);
    console.log('cost_usd:', m.total_cost_usd, '| num_turns:', m.num_turns);
    console.log('tool was called in-process:', toolCalled);
    console.log('text:', m.result?.slice(0, 300));
    console.log('elapsed_ms:', Date.now() - t0);
  }
}
