// Repro 2: two sequential queries in ONE process, fresh same-named MCP server instance each, second resumes.
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const cwd = '/home/vibe10/projects/harness/workspaces/repro2';
mkdirSync(cwd, { recursive: true });

function makeServer(tag) {
  return createSdkMcpServer({
    name: 'harness',
    version: '1.0.0',
    tools: [
      tool('drop_marker', 'Writes a marker file. Call when asked.', { note: z.string() }, async (args) => {
        const marker = `${cwd}/marker-${tag}.txt`;
        writeFileSync(marker, 'note=' + args.note);
        return { content: [{ type: 'text', text: `marker ${tag} written` }] };
      }),
    ],
  });
}

async function run(tag, resume) {
  rmSync(`${cwd}/marker-${tag}.txt`, { force: true });
  let sessionId = null;
  for await (const m of query({
    prompt: `Call the drop_marker tool with note "${tag}" and repeat its return value verbatim.`,
    options: {
      cwd,
      resume,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 5,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'You are a test agent.' },
      mcpServers: { harness: makeServer(tag) },
      abortController: new AbortController(),
    },
  })) {
    if (m.type === 'result') {
      sessionId = m.session_id;
      console.log(`[${tag}] subtype=${m.subtype} marker=${existsSync(`${cwd}/marker-${tag}.txt`)} text=${(m.result ?? '').slice(0, 120).replace(/\n/g, ' ')}`);
    }
  }
  return sessionId;
}

const sid = await run('one');
await run('two', sid ?? undefined);
