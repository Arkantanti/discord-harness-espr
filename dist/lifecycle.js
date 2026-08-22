import * as agents from './store/agents.js';
import { appendEvent } from './store/events.js';
import { engine } from './watchers/engine.js';
import { listWatchers } from './store/watchers.js';
/** AbortControllers for in-flight turns, keyed by agent id. Shared by scheduler + tools + web. */
export const inflight = new Map();
export async function terminateAgent(id, recursive = false, by = 'user') {
    const targets = [id, ...(recursive ? agents.descendants(id).map((a) => a.id) : [])];
    const terminated = [];
    for (const t of targets) {
        const a = agents.getAgent(t);
        if (!a || a.status === 'terminated')
            continue;
        agents.setStatus(t, 'terminated');
        inflight.get(t)?.abort();
        for (const w of listWatchers(t))
            await engine.removeWatcher(w.id);
        appendEvent(t, null, 'terminate', { by });
        terminated.push(t);
    }
    return terminated;
}
//# sourceMappingURL=lifecycle.js.map