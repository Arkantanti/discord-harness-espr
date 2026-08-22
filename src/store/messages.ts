import { db, now } from '../db.js';
import { bus } from '../bus.js';
import { appendEvent } from './events.js';
import type { FromType, InboxMessage } from '../types.js';

function rowToMsg(r: any): InboxMessage {
  return {
    id: r.id,
    agentId: r.agent_id,
    fromType: r.from_type,
    fromId: r.from_id,
    fromLabel: r.from_label,
    content: r.content,
    status: r.status,
    turnId: r.turn_id,
    createdAt: r.created_at,
  };
}

export function enqueue(msg: {
  agentId: string;
  fromType: FromType;
  fromId?: string | null;
  fromLabel?: string | null;
  content: string;
}): InboxMessage {
  const res = db
    .prepare(
      `INSERT INTO messages (agent_id, from_type, from_id, from_label, content, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(msg.agentId, msg.fromType, msg.fromId ?? null, msg.fromLabel ?? null, msg.content, now());
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(res.lastInsertRowid as number);
  const m = rowToMsg(row);
  appendEvent(msg.agentId, null, 'inbox', {
    fromType: m.fromType,
    fromId: m.fromId,
    fromLabel: m.fromLabel,
    content: m.content,
  });
  bus.emit('inbox');
  return m;
}

/** Atomically claim all pending messages for an agent (pending → delivering). */
export function claimPending(agentId: string): InboxMessage[] {
  const rows = db
    .prepare(`SELECT * FROM messages WHERE agent_id = ? AND status = 'pending' ORDER BY id`)
    .all(agentId) as any[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  db.prepare(`UPDATE messages SET status = 'delivering' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return rows.map(rowToMsg);
}

export function markDelivered(ids: number[], turnId: number): void {
  if (!ids.length) return;
  db.prepare(`UPDATE messages SET status = 'delivered', turn_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(
    turnId,
    ...ids,
  );
}

export function requeue(ids: number[]): void {
  if (!ids.length) return;
  db.prepare(`UPDATE messages SET status = 'pending', turn_id = NULL WHERE id IN (${ids.map(() => '?').join(',')})`).run(
    ...ids,
  );
}

export function pendingCount(agentId: string): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE agent_id = ? AND status = 'pending'`).get(agentId) as any;
  return r.n as number;
}

/** Boot-time crash recovery: delivering → pending (they will be re-delivered). */
export function recoverDelivering(): number {
  const r = db.prepare(`UPDATE messages SET status = 'pending', turn_id = NULL WHERE status = 'delivering'`).run();
  return Number(r.changes);
}
