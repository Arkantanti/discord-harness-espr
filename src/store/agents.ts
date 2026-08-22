import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { db, now } from '../db.js';
import { cfg } from '../config.js';
import { bus } from '../bus.js';
import type { AgentRow, AgentStatus } from '../types.js';

function rowToAgent(r: any): AgentRow {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    sessionId: r.session_id,
    cwd: r.cwd,
    model: r.model,
    systemPrompt: r.system_prompt,
    status: r.status,
    standing: !!r.standing,
    retryCount: r.retry_count,
    nextAttemptAt: r.next_attempt_at,
    totalCostUsd: r.total_cost_usd,
    totalTurns: r.total_turns,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SLUG = /[^a-zA-Z0-9_-]/g;

export function createAgent(opts: {
  name: string;
  parentId?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  /** Operator-only: exempt from the idle reaper. Agents cannot set this for themselves. */
  standing?: boolean;
}): AgentRow {
  const base = (opts.name || 'agent').replace(SLUG, '-').slice(0, 48) || 'agent';
  let name = base;
  for (let i = 2; getAgentByName(name); i++) name = `${base}-${i}`;
  const id = 'a_' + randomBytes(4).toString('hex');
  const cwd = path.join(cfg.workspacesDir, name);
  mkdirSync(cwd, { recursive: true });
  const t = now();
  db.prepare(
    `INSERT INTO agents (id, name, parent_id, cwd, model, system_prompt, status, standing, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`,
  ).run(id, name, opts.parentId ?? null, cwd, opts.model ?? null, opts.systemPrompt ?? null, opts.standing ? 1 : 0, t, t);
  const agent = getAgent(id)!;
  bus.emit('agent_status', { agentId: id, status: 'idle', created: true });
  return agent;
}

export function getAgent(id: string): AgentRow | undefined {
  const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  return r ? rowToAgent(r) : undefined;
}

export function getAgentByName(name: string): AgentRow | undefined {
  const r = db.prepare('SELECT * FROM agents WHERE name = ?').get(name);
  return r ? rowToAgent(r) : undefined;
}

/** Resolve by id or unique name. */
export function resolveAgent(ref: string): AgentRow | undefined {
  return getAgent(ref) ?? getAgentByName(ref);
}

export function listAgents(): AgentRow[] {
  return (db.prepare('SELECT * FROM agents ORDER BY created_at').all() as any[]).map(rowToAgent);
}

export function setStatus(id: string, status: AgentStatus, lastError?: string | null): void {
  db.prepare('UPDATE agents SET status = ?, last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?').run(
    status,
    lastError ?? null,
    now(),
    id,
  );
  bus.emit('agent_status', { agentId: id, status });
}

export function countRunning(): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM agents WHERE status = 'running'`).get() as any;
  return r.n as number;
}

/** Idle agents with pending messages whose backoff window has passed, oldest pending message first. */
export function runnableAgents(): AgentRow[] {
  const rows = db
    .prepare(
      `SELECT a.*, MIN(m.id) AS oldest
       FROM agents a JOIN messages m ON m.agent_id = a.id AND m.status = 'pending'
       WHERE a.status = 'idle' AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= ?)
       GROUP BY a.id ORDER BY oldest`,
    )
    .all(now()) as any[];
  return rows.map(rowToAgent);
}

/**
 * Agents the idle reaper may terminate: parked (or permanently failed), not standing,
 * with an EMPTY inbox, untouched since `cutoff`. The empty-inbox condition is what makes
 * this safe against the race where a watcher fires just as the sweep runs — a queued
 * message means work is imminent, so the agent is not idle regardless of `updated_at`.
 */
export function reapableAgents(cutoff: number): AgentRow[] {
  const rows = db
    .prepare(
      `SELECT a.* FROM agents a
       WHERE a.status IN ('idle', 'failed')
         AND a.standing = 0
         AND a.updated_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.agent_id = a.id AND m.status IN ('pending', 'delivering')
         )
       ORDER BY a.updated_at`,
    )
    .all(cutoff) as any[];
  return rows.map(rowToAgent);
}

export function setStanding(id: string, standing: boolean): void {
  db.prepare('UPDATE agents SET standing = ?, updated_at = ? WHERE id = ?').run(standing ? 1 : 0, now(), id);
}

export function recordTurnSuccess(id: string, sessionId: string, costUsd: number, ): void {
  db.prepare(
    `UPDATE agents SET session_id = ?, total_cost_usd = total_cost_usd + ?, total_turns = total_turns + 1,
     retry_count = 0, next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`,
  ).run(sessionId, costUsd, now(), id);
}

const BACKOFF_MS = [5_000, 30_000, 120_000];

/** Returns the new status after a failed turn ('idle' → will retry, or 'failed'). */
export function recordTurnFailure(id: string, error: string): AgentStatus {
  const agent = getAgent(id);
  if (!agent) return 'failed';
  const retry = agent.retryCount + 1;
  const status: AgentStatus = retry > BACKOFF_MS.length ? 'failed' : 'idle';
  const backoff = BACKOFF_MS[Math.min(retry - 1, BACKOFF_MS.length - 1)];
  db.prepare(
    'UPDATE agents SET retry_count = ?, next_attempt_at = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?',
  ).run(retry, now() + backoff, error.slice(0, 2000), status, now(), id);
  bus.emit('agent_status', { agentId: id, status });
  return status;
}

export function resetForRetry(id: string): void {
  db.prepare(
    `UPDATE agents SET status = 'idle', retry_count = 0, next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
  ).run(now(), id);
  bus.emit('agent_status', { agentId: id, status: 'idle' });
}

/** All descendants of an agent (children, grandchildren, ...). */
export function descendants(id: string): AgentRow[] {
  const out: AgentRow[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    const kids = (db.prepare('SELECT * FROM agents WHERE parent_id = ?').all(cur) as any[]).map(rowToAgent);
    out.push(...kids);
    queue.push(...kids.map((k) => k.id));
  }
  return out;
}

export function isSelfOrDescendant(callerId: string, targetId: string): boolean {
  if (callerId === targetId) return true;
  let cur = getAgent(targetId);
  while (cur?.parentId) {
    if (cur.parentId === callerId) return true;
    cur = getAgent(cur.parentId);
  }
  return false;
}

/** Boot-time crash recovery: any agent stuck 'running' goes back to idle. */
export function recoverRunning(): string[] {
  const stuck = (db.prepare(`SELECT id FROM agents WHERE status = 'running'`).all() as any[]).map((r) => r.id as string);
  db.prepare(`UPDATE agents SET status = 'idle', updated_at = ? WHERE status = 'running'`).run(now());
  return stuck;
}
