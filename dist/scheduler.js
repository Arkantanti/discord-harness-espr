import { cfg } from './config.js';
import { bus } from './bus.js';
import * as agents from './store/agents.js';
import * as messages from './store/messages.js';
import * as turns from './store/turns.js';
import { appendEvent } from './store/events.js';
import { runTurn } from './runner.js';
import { inflight } from './lifecycle.js';
let ticking = false;
let interval = null;
export function startScheduler() {
    bus.on('inbox', kick);
    interval = setInterval(kick, 1000); // backstop for backoff expiry / missed events
    kick();
}
export function stopScheduler() {
    if (interval)
        clearInterval(interval);
    bus.off('inbox', kick);
}
export function kick() {
    if (ticking)
        return;
    ticking = true;
    queueMicrotask(() => {
        ticking = false;
        try {
            tick();
        }
        catch (e) {
            console.error('scheduler tick failed:', e);
        }
    });
}
function tick() {
    const slots = cfg.maxConcurrent - agents.countRunning();
    if (slots <= 0)
        return;
    for (const agent of agents.runnableAgents().slice(0, slots)) {
        void executeTurn(agent.id);
    }
}
async function executeTurn(agentId) {
    const agent = agents.getAgent(agentId);
    if (!agent || agent.status !== 'idle')
        return;
    const msgs = messages.claimPending(agentId);
    if (!msgs.length)
        return;
    agents.setStatus(agentId, 'running');
    const turnId = turns.startTurn(agentId);
    const ac = new AbortController();
    inflight.set(agentId, ac);
    try {
        const result = await runTurn(agent, msgs, turnId, ac);
        turns.finishTurn(turnId, 'ok', {
            sessionId: result.sessionId,
            numTurns: result.numTurns,
            costUsd: result.costUsd,
            usage: result.usage,
        });
        agents.recordTurnSuccess(agentId, result.sessionId, result.costUsd);
        messages.markDelivered(msgs.map((m) => m.id), turnId);
        // Only flip back to idle if nothing terminated us mid-turn.
        if (agents.getAgent(agentId)?.status === 'running')
            agents.setStatus(agentId, 'idle');
    }
    catch (e) {
        const error = String(e).slice(0, 2000);
        const aborted = ac.signal.aborted;
        turns.finishTurn(turnId, aborted ? 'interrupted' : 'error', { error });
        messages.requeue(msgs.map((m) => m.id));
        const current = agents.getAgent(agentId);
        if (current?.status === 'terminated') {
            // terminated mid-turn — leave it terminated, messages stay pending for the audit trail
        }
        else if (aborted) {
            agents.setStatus(agentId, 'idle');
        }
        else {
            const status = agents.recordTurnFailure(agentId, error);
            appendEvent(agentId, turnId, 'error', { error, willRetry: status === 'idle' });
        }
    }
    finally {
        inflight.delete(agentId);
        kick(); // messages may have arrived mid-turn, or a slot just freed up
    }
}
/** Boot-time crash recovery: run BEFORE startScheduler(). */
export function recoverFromCrash() {
    const interruptedTurns = turns.recoverRunningTurns();
    const requeued = messages.recoverDelivering();
    const stuckAgents = agents.recoverRunning();
    if (interruptedTurns || requeued || stuckAgents.length) {
        console.log(`recovery: ${interruptedTurns} turns interrupted, ${requeued} messages requeued, agents reset: ${stuckAgents.join(', ') || 'none'}`);
        for (const id of stuckAgents) {
            appendEvent(id, null, 'system', { note: 'daemon restarted mid-turn; your pending messages will be re-delivered' });
        }
    }
}
//# sourceMappingURL=scheduler.js.map