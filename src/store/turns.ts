import { db, now } from '../db.js';
import type { TurnStatus } from '../types.js';

export function startTurn(agentId: string): number {
  const res = db
    .prepare(`INSERT INTO turns (agent_id, status, started_at) VALUES (?, 'running', ?)`)
    .run(agentId, now());
  return Number(res.lastInsertRowid);
}

export function finishTurn(
  turnId: number,
  status: TurnStatus,
  data: { sessionId?: string | null; numTurns?: number | null; costUsd?: number | null; usage?: unknown; error?: string | null },
): void {
  db.prepare(
    `UPDATE turns SET status = ?, session_id_after = ?, num_turns = ?, cost_usd = ?, usage = ?, error = ?, finished_at = ? WHERE id = ?`,
  ).run(
    status,
    data.sessionId ?? null,
    data.numTurns ?? null,
    data.costUsd ?? null,
    data.usage ? JSON.stringify(data.usage) : null,
    data.error?.slice(0, 2000) ?? null,
    now(),
    turnId,
  );
}

export function listTurns(agentId: string, limit = 50): any[] {
  return db.prepare('SELECT * FROM turns WHERE agent_id = ? ORDER BY id DESC LIMIT ?').all(agentId, limit) as any[];
}

/** Boot-time crash recovery. */
export function recoverRunningTurns(): number {
  const r = db
    .prepare(`UPDATE turns SET status = 'interrupted', finished_at = ? WHERE status = 'running'`)
    .run(now());
  return Number(r.changes);
}
