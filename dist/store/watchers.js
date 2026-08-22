import { randomBytes } from 'node:crypto';
import { db, now } from '../db.js';
function rowToWatcher(r) {
    return {
        id: r.id,
        agentId: r.agent_id,
        type: r.type,
        name: r.name,
        config: r.config,
        enabled: !!r.enabled,
        state: r.state,
        lastFiredAt: r.last_fired_at,
        fireCount: r.fire_count,
        lastError: r.last_error,
        createdAt: r.created_at,
    };
}
export function createWatcher(opts) {
    const id = 'w_' + randomBytes(4).toString('hex');
    db.prepare('INSERT INTO watchers (id, agent_id, type, name, config, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(id, opts.agentId, opts.type, opts.name ?? null, JSON.stringify(opts.config ?? {}), now());
    return getWatcher(id);
}
export function getWatcher(id) {
    const r = db.prepare('SELECT * FROM watchers WHERE id = ?').get(id);
    return r ? rowToWatcher(r) : undefined;
}
export function listWatchers(agentId) {
    const rows = agentId
        ? db.prepare('SELECT * FROM watchers WHERE agent_id = ? ORDER BY created_at').all(agentId)
        : db.prepare('SELECT * FROM watchers ORDER BY created_at').all();
    return rows.map(rowToWatcher);
}
export function listEnabledWatchers() {
    return db.prepare('SELECT * FROM watchers WHERE enabled = 1').all().map(rowToWatcher);
}
export function updateWatcher(id, patch) {
    const cur = getWatcher(id);
    if (!cur)
        return undefined;
    db.prepare('UPDATE watchers SET enabled = ?, config = ?, name = ? WHERE id = ?').run(patch.enabled === undefined ? (cur.enabled ? 1 : 0) : patch.enabled ? 1 : 0, patch.config === undefined ? cur.config : JSON.stringify(patch.config), patch.name === undefined ? cur.name : patch.name, id);
    return getWatcher(id);
}
export function removeWatcher(id) {
    db.prepare('DELETE FROM watchers WHERE id = ?').run(id);
}
export function saveWatcherState(id, state) {
    db.prepare('UPDATE watchers SET state = ? WHERE id = ?').run(JSON.stringify(state ?? null), id);
}
export function recordFire(id) {
    db.prepare('UPDATE watchers SET last_fired_at = ?, fire_count = fire_count + 1, last_error = NULL WHERE id = ?').run(now(), id);
}
export function recordWatcherError(id, err) {
    db.prepare('UPDATE watchers SET last_error = ? WHERE id = ?').run(err.slice(0, 1000), id);
}
//# sourceMappingURL=watchers.js.map