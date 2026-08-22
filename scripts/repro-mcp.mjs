// Repro: does an in-process MCP tool with side effects run, using the daemon's exact option combo?
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const cwd = '/home/vibe10/projects/harness/workspaces/repro';
mkdirSync(cwd, { recursive: true });
const marker = cwd + '/marker.txt';

const variant = process.argv[2] ?? 'full';

function makeServer() {
  return createSdkMcpServer({
    name: 'harness',
    version: '1.0.0',
    tools: [
      tool('drop_marker', 'Writes a marker file. Call when asked.', { note: z.string() }, async (args) => {
        writeFileSync(marker, 'note=' + args.note);
        return { content: [{ type: 'text', text: `marker written: ${marker}` }] };
      }),
    ],
  });
}

const base = {
  cwd,
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  maxTurns: 5,
  mcpServers: { harness: makeServer() },
};
const options =
  variant === 'full'
    ? { ...base, systemPrompt: { type: 'preset', preset: 'claude_code', append: 'You are a test agent.' } }
    : base;

for await (const m of query({ prompt: 'Call the drop_marker tool with note "hi" and tell me exactly what it returned.', options })) {
  if (m.type === 'result') {
    console.log(`[${variant}] subtype=${m.subtype} turns=${m.num_turns}`);
    console.log(`[${variant}] text=${(m.result ?? '').slice(0, 200)}`);
    console.log(`[${variant}] marker exists=${existsSync(marker)}`);
  }
}
