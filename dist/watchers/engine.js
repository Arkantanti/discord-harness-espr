import * as watchers from '../store/watchers.js';
import * as messages from '../store/messages.js';
import { appendEvent } from '../store/events.js';
import { loadRegistry } from './loader.js';
const START_RETRY_BASE_MS = 5_000;
const START_RETRY_MAX_MS = 300_000;
class WatcherEngine {
    registry = new Map();
    running = new Map();
    services = new Map();
    lastLoadErrors = [];
    /** Pending start-retry timers, keyed by watcher id. */
    retryTimers = new Map();
    async init() {
        await this.reloadRegistry();
        for (const w of watchers.listEnabledWatchers()) {
            await this.startWatcher(w);
        }
    }
    async reloadRegistry() {
        const res = await loadRegistry();
        this.registry = res.registry;
        this.lastLoadErrors = res.errors;
        return res;
    }
    /** Full reload: stop everything, re-import plugin modules, restart enabled watchers. */
    async reloadAll() {
        for (const id of [...this.running.keys()])
            await this.stopWatcher(id);
        const res = await this.reloadRegistry();
        for (const w of watchers.listEnabledWatchers()) {
            await this.startWatcher(w);
        }
        return { types: [...res.registry.keys()], errors: res.errors };
    }
    validate(type, config) {
        const plugin = this.registry.get(type);
        if (!plugin)
            return `unknown watcher type "${type}" (known: ${[...this.registry.keys()].join(', ')})`;
        try {
            return plugin.validate?.(config) ?? null;
        }
        catch (e) {
            return `validate() threw: ${String(e)}`;
        }
    }
    async startWatcher(row, attempt = 0) {
        this.cancelRetry(row.id);
        if (this.running.has(row.id))
            return;
        const plugin = this.registry.get(row.type);
        if (!plugin) {
            watchers.recordWatcherError(row.id, `no plugin for type "${row.type}"`);
            return;
        }
        const ac = new AbortController();
        const entry = { ac, stop: null };
        this.running.set(row.id, entry);
        const ctx = {
            watcherId: row.id,
            agentId: row.agentId,
            config: safeParse(row.config) ?? {},
            state: safeParse(row.state),
            saveState: (state) => {
                try {
                    watchers.saveWatcherState(row.id, state);
                }
                catch (e) {
                    console.error(`watcher ${row.id} saveState failed:`, e);
                }
            },
            emit: (message, opts) => {
                try {
                    const cur = watchers.getWatcher(row.id);
                    if (!cur || !cur.enabled)
                        return; // stale timer after disable
                    messages.enqueue({
                        agentId: row.agentId,
                        fromType: 'watcher',
                        fromId: row.id,
                        fromLabel: cur.name ?? cur.type,
                        content: message,
                    });
                    watchers.recordFire(row.id);
                    appendEvent(row.agentId, null, 'watcher_fired', { watcherId: row.id, type: row.type, name: cur.name });
                    if (opts?.disableAfter) {
                        watchers.updateWatcher(row.id, { enabled: false });
                        void this.stopWatcher(row.id);
                    }
                }
                catch (e) {
                    console.error(`watcher ${row.id} emit failed:`, e);
                }
            },
            log: (msg) => appendEvent(row.agentId, null, 'watcher_log', { watcherId: row.id, msg: String(msg).slice(0, 2000) }),
            signal: ac.signal,
            services: this.services,
            env: process.env,
        };
        try {
            entry.stop = await plugin.start(ctx);
        }
        catch (e) {
            this.running.delete(row.id);
            const err = String(e);
            watchers.recordWatcherError(row.id, err);
            appendEvent(row.agentId, null, 'watcher_error', { watcherId: row.id, type: row.type, error: err.slice(0, 1000) });
            this.scheduleRetry(row, attempt, err);
        }
    }
    /**
     * A watcher whose start() failed is retried with backoff. Without this, a transient failure
     * at boot (DNS not up yet → discord gateway login fails with EAI_AGAIN) leaves the watcher
     * silently dead while the daemon reports itself up, until a human restarts it. Logged to
     * stderr so the journal shows the outage, not just a DB event nobody reads.
     */
    scheduleRetry(row, attempt, err) {
        const delay = Math.min(START_RETRY_BASE_MS * 2 ** attempt, START_RETRY_MAX_MS);
        console.error(`watcher ${row.id} (${row.type}) start failed: ${err} — retrying in ${Math.round(delay / 1000)}s`);
        const timer = setTimeout(() => {
            this.retryTimers.delete(row.id);
            const cur = watchers.getWatcher(row.id);
            if (!cur || !cur.enabled)
                return; // disabled or removed while we waited
            void this.startWatcher(cur, attempt + 1);
        }, delay);
        timer.unref?.();
        this.retryTimers.set(row.id, timer);
    }
    cancelRetry(id) {
        const timer = this.retryTimers.get(id);
        if (!timer)
            return;
        clearTimeout(timer);
        this.retryTimers.delete(id);
    }
    async stopWatcher(id) {
        this.cancelRetry(id);
        const entry = this.running.get(id);
        if (!entry)
            return;
        this.running.delete(id);
        entry.ac.abort();
        try {
            await entry.stop?.();
        }
        catch (e) {
            console.error(`watcher ${id} stop failed:`, e);
        }
    }
    /** Create + start (validates first; throws Error with reason on bad config). */
    async addWatcher(opts) {
        const err = this.validate(opts.type, opts.config);
        if (err)
            throw new Error(err);
        const row = watchers.createWatcher(opts);
        await this.startWatcher(row);
        return row;
    }
    async updateWatcher(id, patch) {
        const cur = watchers.getWatcher(id);
        if (!cur)
            throw new Error(`no watcher ${id}`);
        if (patch.config !== undefined) {
            const err = this.validate(cur.type, patch.config);
            if (err)
                throw new Error(err);
        }
        await this.stopWatcher(id);
        const updated = watchers.updateWatcher(id, patch);
        if (updated.enabled)
            await this.startWatcher(updated);
        return updated;
    }
    async removeWatcher(id) {
        await this.stopWatcher(id);
        watchers.removeWatcher(id);
    }
}
function safeParse(s) {
    if (!s)
        return null;
    try {
        return JSON.parse(s);
    }
    catch {
        return null;
    }
}
export const engine = new WatcherEngine();
//# sourceMappingURL=engine.js.map