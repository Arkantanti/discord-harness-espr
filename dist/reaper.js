import { cfg } from './config.js';
import * as agents from './store/agents.js';
import { appendEvent } from './store/events.js';
import { terminateAgent } from './lifecycle.js';
let interval = null;
/**
 * Idle reaper: terminates agents that have been parked with an empty inbox for longer
 * than cfg.idleReapMs. Without it, every ephemeral task agent (and its watcher) lives
 * forever once its conversation goes quiet.
 *
 * Agents marked `standing` are never reaped — that flag is for long-lived agents that
 * park by design, like the Discord dispatcher waiting on mentions. It is settable only
 * by the operator (web API), never by an agent for itself.
 */
export function startReaper() {
    if (cfg.idleReapMs <= 0) {
        console.log('idle reaper: disabled (HARNESS_IDLE_REAP_MS=0)');
        return;
    }
    interval = setInterval(() => {
        void sweep();
    }, cfg.reapSweepMs);
    console.log(`idle reaper: on — terminate after ${Math.round(cfg.idleReapMs / 60_000)}m idle, sweep every ${Math.round(cfg.reapSweepMs / 1000)}s`);
}
export function stopReaper() {
    if (interval)
        clearInterval(interval);
    interval = null;
}
export async function sweep() {
    const reaped = [];
    try {
        const cutoff = Date.now() - cfg.idleReapMs;
        for (const agent of agents.reapableAgents(cutoff)) {
            const idleMin = Math.round((Date.now() - agent.updatedAt) / 60_000);
            const reason = `idle ${idleMin}m with an empty inbox`;
            // Leave a note on the agent before it goes, so the web UI shows why it died.
            appendEvent(agent.id, null, 'system', { note: `auto-terminated by idle reaper (${reason})` });
            const done = await terminateAgent(agent.id, false, `reaper (${reason})`);
            if (done.length) {
                reaped.push(agent.name);
                console.log(`reaper: terminated ${agent.name} (${agent.id}) — ${reason}`);
            }
        }
    }
    catch (e) {
        console.error('reaper sweep failed:', e);
    }
    return reaped;
}
//# sourceMappingURL=reaper.js.map