import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cfg } from '../config.js';
import * as agents from '../store/agents.js';
import * as messages from '../store/messages.js';
import { listWatchers, getWatcher } from '../store/watchers.js';
import { appendEvent } from '../store/events.js';
import { engine } from '../watchers/engine.js';
import { terminateAgent } from '../lifecycle.js';
import { sanitizePagePath } from './policy.js';
import { pluginTools } from './toolPlugins.js';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const err = (s: string) => ({ content: [{ type: 'text' as const, text: `ERROR: ${s}` }], isError: true });

/** Wrap tool handlers with logging so silent MCP failures show up in the journal. */
function withLogging(tools: any[]): any[] {
  for (const t of tools) {
    const orig = t.handler;
    t.handler = async (args: any, extra: unknown) => {
      try {
        const res = await orig(args, extra);
        console.error(`[tool ${t.name}] ok: ${JSON.stringify(res?.content?.[0]?.text ?? '').slice(0, 160)}`);
        return res;
      } catch (e) {
        console.error(`[tool ${t.name}] threw:`, e);
        return err(String(e).slice(0, 500));
      }
    };
  }
  return tools;
}

/**
 * Build the per-turn MCP server. Every handler closes over the calling agent's id —
 * that's how tools know who is calling.
 */
export function buildHarnessServer(callerId: string) {
  const me = () => agents.getAgent(callerId)!;

  const tools: any[] = [
    tool(
      'spawn_agent',
      'Create a new child agent. The prompt becomes its first inbox message (from you). Returns its id and name. Replies from it will arrive in your inbox.',
      {
        name: z.string().describe('short kebab-case name, e.g. "researcher-1"'),
        prompt: z.string().describe('the task/context for the new agent — it has NO other context'),
        model: z.string().optional().describe('model override (default: harness default)'),
        system_prompt: z.string().optional().describe('extra standing instructions appended to its system prompt'),
      },
      async (args: any) => {
        const child = agents.createAgent({
          name: args.name,
          parentId: callerId,
          model: args.model ?? null,
          systemPrompt: args.system_prompt ?? null,
        });
        appendEvent(callerId, null, 'spawn', { childId: child.id, childName: child.name });
        messages.enqueue({
          agentId: child.id,
          fromType: 'agent',
          fromId: callerId,
          fromLabel: me().name + ' (your parent)',
          content: args.prompt,
        });
        return text(`spawned agent "${child.name}" (id ${child.id}). It will start working shortly; replies arrive in your inbox.`);
      },
    ),
    tool(
      'send_message',
      'Send a message to another agent (fire-and-forget). Replies arrive as FUTURE inbox messages — end your turn instead of waiting.',
      {
        to: z.string().describe('recipient agent id or name'),
        content: z.string(),
      },
      async (args: any) => {
        const target = agents.resolveAgent(args.to);
        if (!target) return err(`no agent "${args.to}"`);
        if (target.status === 'terminated') return err(`agent "${target.name}" is terminated`);
        messages.enqueue({
          agentId: target.id,
          fromType: 'agent',
          fromId: callerId,
          fromLabel: me().name,
          content: args.content,
        });
        return text(`queued for "${target.name}" (id ${target.id}). Any reply will arrive in your inbox as a future message.`);
      },
    ),
    tool('list_agents', 'List all agents in the harness.', {}, async () => {
      const rows = agents.listAgents().map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        parent_id: a.parentId,
        model: a.model,
        pending_messages: messages.pendingCount(a.id),
        total_turns: a.totalTurns,
        total_cost_usd: Number(a.totalCostUsd.toFixed(4)),
      }));
      return text(JSON.stringify(rows, null, 2));
    }),
    tool(
      'get_agent_info',
      'Details for one agent: row, watchers, recent activity.',
      { agent_id: z.string().describe('agent id or name') },
      async (args: any) => {
        const a = agents.resolveAgent(args.agent_id);
        if (!a) return err(`no agent "${args.agent_id}"`);
        const ws = listWatchers(a.id).map((w) => ({ id: w.id, type: w.type, name: w.name, enabled: w.enabled, fire_count: w.fireCount }));
        return text(JSON.stringify({ ...a, watchers: ws, pending_messages: messages.pendingCount(a.id) }, null, 2));
      },
    ),
    tool(
      'terminate_agent',
      'Terminate yourself or one of your descendant agents (recursive=true also terminates its children).',
      {
        agent_id: z.string(),
        recursive: z.boolean().optional(),
      },
      async (args: any) => {
        const target = agents.resolveAgent(args.agent_id);
        if (!target) return err(`no agent "${args.agent_id}"`);
        if (!agents.isSelfOrDescendant(callerId, target.id))
          return err(`you may only terminate yourself or your own descendants (${target.name} is neither)`);
        const done = await terminateAgent(target.id, args.recursive ?? false, `agent ${me().name}`);
        return text(`terminated: ${done.join(', ') || '(none — already terminated)'}`);
      },
    ),
    tool(
      'set_watcher',
      'Create a watcher for yourself. When it fires, its message lands in YOUR inbox and wakes you. Built-ins: timer {delay_ms|at, message}, cron {schedule, message, timezone?}, poll {command, interval_ms>=5000, mode: on-change|on-output|always, message_prefix?}.',
      {
        type: z.string(),
        config: z.record(z.string(), z.any()).describe('type-specific config object'),
        name: z.string().optional().describe('label shown on inbox messages from this watcher'),
      },
      async (args: any) => {
        try {
          const row = await engine.addWatcher({ agentId: callerId, type: args.type, name: args.name ?? null, config: args.config });
          return text(`watcher "${row.name ?? row.type}" (id ${row.id}, type ${row.type}) is live.`);
        } catch (e: any) {
          return err(e.message ?? String(e));
        }
      },
    ),
    tool('list_watchers', 'List your own watchers.', {}, async () => {
      const rows = listWatchers(callerId).map((w) => ({
        id: w.id,
        type: w.type,
        name: w.name,
        enabled: w.enabled,
        config: JSON.parse(w.config),
        fire_count: w.fireCount,
        last_error: w.lastError,
      }));
      return text(JSON.stringify(rows, null, 2));
    }),
    tool(
      'update_watcher',
      'Enable/disable or reconfigure one of your watchers.',
      {
        watcher_id: z.string(),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.any()).optional(),
        name: z.string().optional(),
      },
      async (args: any) => {
        const w = getWatcher(args.watcher_id);
        if (!w || w.agentId !== callerId) return err(`no watcher ${args.watcher_id} owned by you`);
        try {
          const updated = await engine.updateWatcher(args.watcher_id, { enabled: args.enabled, config: args.config, name: args.name });
          return text(`watcher ${updated.id}: enabled=${updated.enabled}`);
        } catch (e: any) {
          return err(e.message ?? String(e));
        }
      },
    ),
    tool('remove_watcher', 'Delete one of your watchers.', { watcher_id: z.string() }, async (args: any) => {
      const w = getWatcher(args.watcher_id);
      if (!w || w.agentId !== callerId) return err(`no watcher ${args.watcher_id} owned by you`);
      await engine.removeWatcher(args.watcher_id);
      return text(`watcher ${args.watcher_id} removed.`);
    }),
    tool(
      'reload_watchers',
      `Rescan ${cfg.watchersDir}/*.mjs and reload all watcher plugins. Call this after writing a new watcher type module.`,
      {},
      async () => {
        const res = await engine.reloadAll();
        return text(
          `loaded watcher types: ${res.types.join(', ')}` + (res.errors.length ? `\nerrors:\n- ${res.errors.join('\n- ')}` : ''),
        );
      },
    ),
    tool(
      'publish_page',
      `Publish a web page (HTML or any text). Written under your namespace and served at https://pages.${cfg.domain}/<your-name>/<path> (basic-auth protected).`,
      {
        path: z.string().describe('relative path, e.g. "index.html" or "reports/week1.html"'),
        content: z.string(),
      },
      async (args: any) => {
        const rel = sanitizePagePath(args.path);
        if (!rel) return err('invalid path (must be relative, no "..")');
        const dir = path.join(cfg.pagesDir, me().name);
        const full = path.join(dir, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, args.content);
        return text(`published: https://pages.${cfg.domain}/${me().name}/${rel.split(path.sep).join('/')}`);
      },
    ),
    ...pluginTools(),
  ];

  return createSdkMcpServer({ name: 'harness', version: '1.0.0', tools: withLogging(tools) });
}
