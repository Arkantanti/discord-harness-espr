import { db, now } from '../db.js';
export function startTurn(agentId) {
    const res = db
        .prepare(`INSERT INTO turns (agent_id, status, started_at) VALUES (?, 'running', ?)`)
        .run(agentId, now());
    return Number(res.lastInsertRowid);
}
export function finishTurn(turnId, status, data) {
    db.prepare(`UPDATE turns SET status = ?, session_id_after = ?, num_turns = ?, cost_usd = ?, usage = ?, error = ?, finished_at = ? WHERE id = ?`).run(status, data.sessionId ?? null, data.numTurns ?? null, data.costUsd ?? null, data.usage ? JSON.stringify(data.usage) : null, data.error?.slice(0, 2000) ?? null, now(), turnId);
}
export function listTurns(agentId, limit = 50) {
    return db.prepare('SELECT * FROM turns WHERE agent_id = ? ORDER BY id DESC LIMIT ?').all(agentId, limit);
}
/** Boot-time crash recovery. */
export function recoverRunningTurns() {
    const r = db
        .prepare(`UPDATE turns SET status = 'interrupted', finished_at = ? WHERE status = 'running'`)
        .run(now());
    return Number(r.changes);
}
//# sourceMappingURL=turns.js.map