import { db, now } from '../db.js';
import { bus } from '../bus.js';

export interface EventRecord {
  id: number;
  agentId: string | null;
  turnId: number | null;
  kind: string;
  payload: any;
  createdAt: number;
}

export function appendEvent(agentId: string | null, turnId: number | null, kind: string, payload: unknown): EventRecord {
  const res = db
    .prepare('INSERT INTO events (agent_id, turn_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(agentId, turnId, kind, JSON.stringify(payload), now());
  const ev: EventRecord = {
    id: Number(res.lastInsertRowid),
    agentId,
    turnId,
    kind,
    payload,
    createdAt: now(),
  };
  bus.emit('event', ev);
  return ev;
}

export function listEvents(agentId: string, afterId = 0, limit = 200): EventRecord[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE agent_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(agentId, afterId, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    turnId: r.turn_id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    createdAt: r.created_at,
  }));
}

/** Most recent events for an agent (returned in ascending id order). */
export function tailEvents(agentId: string, limit = 200): EventRecord[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE agent_id = ? ORDER BY id DESC LIMIT ?')
    .all(agentId, limit) as any[];
  return rows.reverse().map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    turnId: r.turn_id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    createdAt: r.created_at,
  }));
}
