import type { IncomingMessage, ServerResponse } from 'node:http';
import * as agents from '../store/agents.js';
import * as messages from '../store/messages.js';
import * as turns from '../store/turns.js';
import { listEvents, tailEvents } from '../store/events.js';
import { listWatchers, getWatcher } from '../store/watchers.js';
import { engine } from '../watchers/engine.js';
import { terminateAgent } from '../lifecycle.js';
import { kick } from '../scheduler.js';
import { sweep } from '../reaper.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function agentSummary(a: ReturnType<typeof agents.listAgents>[number]) {
  return {
    ...a,
    pendingMessages: messages.pendingCount(a.id),
    watcherCount: listWatchers(a.id).filter((w) => w.enabled).length,
  };
}

/** Returns true if the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (parts[0] !== 'api') return false;
  const method = req.method ?? 'GET';

  try {
    // /api/agents
    if (parts.length === 2 && parts[1] === 'agents') {
      if (method === 'GET') return json(res, 200, agents.listAgents().map(agentSummary)), true;
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body.name || !body.prompt) return json(res, 400, { error: 'name and prompt required' }), true;
        const agent = agents.createAgent({
          name: body.name,
          model: body.model || null,
          systemPrompt: body.systemPrompt || null,
          standing: !!body.standing,
        });
        messages.enqueue({ agentId: agent.id, fromType: 'user', content: body.prompt });
        return json(res, 201, agentSummary(agents.getAgent(agent.id)!)), true;
      }
    }

    // /api/agents/:id[/...]
    if (parts.length >= 3 && parts[1] === 'agents') {
      const agent = agents.resolveAgent(parts[2]);
      if (!agent) return json(res, 404, { error: 'no such agent' }), true;
      const sub = parts[3];

      if (!sub && method === 'GET') {
        return json(res, 200, { ...agentSummary(agent), watchers: listWatchers(agent.id), turns: turns.listTurns(agent.id, 20) }), true;
      }
      if (sub === 'events' && method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 1000);
        const evs = after > 0 ? listEvents(agent.id, after, limit) : tailEvents(agent.id, limit);
        return json(res, 200, evs), true;
      }
      if (sub === 'message' && method === 'POST') {
        const body = await readBody(req);
        if (!body.content) return json(res, 400, { error: 'content required' }), true;
        if (agent.status === 'terminated') return json(res, 409, { error: 'agent is terminated' }), true;
        messages.enqueue({ agentId: agent.id, fromType: 'user', content: body.content });
        return json(res, 200, { ok: true }), true;
      }
      if (sub === 'terminate' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const done = await terminateAgent(agent.id, !!body.recursive, 'user (web ui)');
        return json(res, 200, { terminated: done }), true;
      }
      if (sub === 'retry' && method === 'POST') {
        agents.resetForRetry(agent.id);
        kick();
        return json(res, 200, { ok: true }), true;
      }
      // Operator-only reaper exemption. Deliberately not an MCP tool: an agent must not
      // be able to make itself immortal.
      if (sub === 'standing' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const standing = body.standing !== false;
        agents.setStanding(agent.id, standing);
        return json(res, 200, { id: agent.id, name: agent.name, standing }), true;
      }
      if (sub === 'watchers') {
        if (method === 'GET') return json(res, 200, listWatchers(agent.id)), true;
        if (method === 'POST') {
          const body = await readBody(req);
          try {
            const row = await engine.addWatcher({ agentId: agent.id, type: body.type, name: body.name ?? null, config: body.config ?? {} });
            return json(res, 201, row), true;
          } catch (e: any) {
            return json(res, 400, { error: e.message ?? String(e) }), true;
          }
        }
        const wid = parts[4];
        if (wid) {
          const w = getWatcher(wid);
          if (!w || w.agentId !== agent.id) return json(res, 404, { error: 'no such watcher' }), true;
          if (method === 'PATCH') {
            const body = await readBody(req);
            try {
              const updated = await engine.updateWatcher(wid, { enabled: body.enabled, config: body.config, name: body.name });
              return json(res, 200, updated), true;
            } catch (e: any) {
              return json(res, 400, { error: e.message ?? String(e) }), true;
            }
          }
          if (method === 'DELETE') {
            await engine.removeWatcher(wid);
            return json(res, 200, { ok: true }), true;
          }
        }
      }
    }

    // /api/reap — run an idle sweep now instead of waiting for the next tick
    if (parts.length === 2 && parts[1] === 'reap' && method === 'POST') {
      return json(res, 200, { reaped: await sweep() }), true;
    }

    // /api/watcher-types
    if (parts.length === 2 && parts[1] === 'watcher-types' && method === 'GET') {
      const types = [...engine.registry.values()].map((p) => ({ type: p.type, description: p.description ?? '' }));
      return json(res, 200, { types, loadErrors: engine.lastLoadErrors }), true;
    }

    json(res, 404, { error: 'not found' });
    return true;
  } catch (e: any) {
    json(res, 500, { error: e.message ?? String(e) });
    return true;
  }
}
