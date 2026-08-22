import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { db, now } from '../db.js';
import { cfg } from '../config.js';
import { bus } from '../bus.js';
function rowToAgent(r) {
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
export function createAgent(opts) {
    const base = (opts.name || 'agent').replace(SLUG, '-').slice(0, 48) || 'agent';
    let name = base;
    for (let i = 2; getAgentByName(name); i++)
        name = `${base}-${i}`;
    const id = 'a_' + randomBytes(4).toString('hex');
    const cwd = path.join(cfg.workspacesDir, name);
    mkdirSync(cwd, { recursive: true });
    const t = now();
    db.prepare(`INSERT INTO agents (id, name, parent_id, cwd, model, system_prompt, status, standing, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`).run(id, name, opts.parentId ?? null, cwd, opts.model ?? null, opts.systemPrompt ?? null, opts.standing ? 1 : 0, t, t);
    const agent = getAgent(id);
    bus.emit('agent_status', { agentId: id, status: 'idle', created: true });
    return agent;
}
export function getAgent(id) {
    const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    return r ? rowToAgent(r) : undefined;
}
export function getAgentByName(name) {
    const r = db.prepare('SELECT * FROM agents WHERE name = ?').get(name);
    return r ? rowToAgent(r) : undefined;
}
/** Resolve by id or unique name. */
export function resolveAgent(ref) {
    return getAgent(ref) ?? getAgentByName(ref);
}
export function listAgents() {
    return db.prepare('SELECT * FROM agents ORDER BY created_at').all().map(rowToAgent);
}
export function setStatus(id, status, lastError) {
    db.prepare('UPDATE agents SET status = ?, last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?').run(status, lastError ?? null, now(), id);
    bus.emit('agent_status', { agentId: id, status });
}
export function countRunning() {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM agents WHERE status = 'running'`).get();
    return r.n;
}
/** Idle agents with pending messages whose backoff window has passed, oldest pending message first. */
export function runnableAgents() {
    const rows = db
        .prepare(`SELECT a.*, MIN(m.id) AS oldest
       FROM agents a JOIN messages m ON m.agent_id = a.id AND m.status = 'pending'
       WHERE a.status = 'idle' AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= ?)
       GROUP BY a.id ORDER BY oldest`)
        .all(now());
    return rows.map(rowToAgent);
}
/**
 * Agents the idle reaper may terminate: parked (or permanently failed), not standing,
 * with an EMPTY inbox, untouched since `cutoff`. The empty-inbox condition is what makes
 * this safe against the race where a watcher fires just as the sweep runs — a queued
 * message means work is imminent, so the agent is not idle regardless of `updated_at`.
 */
export function reapableAgents(cutoff) {
    const rows = db
        .prepare(`SELECT a.* FROM agents a
       WHERE a.status IN ('idle', 'failed')
         AND a.standing = 0
         AND a.updated_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.agent_id = a.id AND m.status IN ('pending', 'delivering')
         )
       ORDER BY a.updated_at`)
        .all(cutoff);
    return rows.map(rowToAgent);
}
export function setStanding(id, standing) {
    db.prepare('UPDATE agents SET standing = ?, updated_at = ? WHERE id = ?').run(standing ? 1 : 0, now(), id);
}
export function recordTurnSuccess(id, sessionId, costUsd) {
    db.prepare(`UPDATE agents SET session_id = ?, total_cost_usd = total_cost_usd + ?, total_turns = total_turns + 1,
     retry_count = 0, next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`).run(sessionId, costUsd, now(), id);
}
const BACKOFF_MS = [5_000, 30_000, 120_000];
/** Returns the new status after a failed turn ('idle' → will retry, or 'failed'). */
export function recordTurnFailure(id, error) {
    const agent = getAgent(id);
    if (!agent)
        return 'failed';
    const retry = agent.retryCount + 1;
    const status = retry > BACKOFF_MS.length ? 'failed' : 'idle';
    const backoff = BACKOFF_MS[Math.min(retry - 1, BACKOFF_MS.length - 1)];
    db.prepare('UPDATE agents SET retry_count = ?, next_attempt_at = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?').run(retry, now() + backoff, error.slice(0, 2000), status, now(), id);
    bus.emit('agent_status', { agentId: id, status });
    return status;
}
export function resetForRetry(id) {
    db.prepare(`UPDATE agents SET status = 'idle', retry_count = 0, next_attempt_at = NULL, updated_at = ? WHERE id = ?`).run(now(), id);
    bus.emit('agent_status', { agentId: id, status: 'idle' });
}
/** All descendants of an agent (children, grandchildren, ...). */
export function descendants(id) {
    const out = [];
    const queue = [id];
    while (queue.length) {
        const cur = queue.shift();
        const kids = db.prepare('SELECT * FROM agents WHERE parent_id = ?').all(cur).map(rowToAgent);
        out.push(...kids);
        queue.push(...kids.map((k) => k.id));
    }
    return out;
}
export function isSelfOrDescendant(callerId, targetId) {
    if (callerId === targetId)
        return true;
    let cur = getAgent(targetId);
    while (cur?.parentId) {
        if (cur.parentId === callerId)
            return true;
        cur = getAgent(cur.parentId);
    }
    return false;
}
/** Boot-time crash recovery: any agent stuck 'running' goes back to idle. */
export function recoverRunning() {
    const stuck = db.prepare(`SELECT id FROM agents WHERE status = 'running'`).all().map((r) => r.id);
    db.prepare(`UPDATE agents SET status = 'idle', updated_at = ? WHERE status = 'running'`).run(now());
    return stuck;
}
//# sourceMappingURL=agents.js.map