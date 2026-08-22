import { cfg, ensureDirs } from './config.js';
import { initDb } from './db.js';
import { engine } from './watchers/engine.js';
import { loadToolPlugins, toolPluginErrors } from './harness/toolPlugins.js';
import { recoverFromCrash, startScheduler } from './scheduler.js';
import { startReaper } from './reaper.js';
import { startWebServer } from './web/server.js';
async function main() {
    ensureDirs();
    initDb();
    recoverFromCrash();
    await loadToolPlugins();
    if (toolPluginErrors.length)
        console.error('tool plugin errors:', toolPluginErrors);
    await engine.init();
    if (engine.lastLoadErrors.length)
        console.error('watcher plugin errors:', engine.lastLoadErrors);
    startScheduler();
    startReaper();
    startWebServer();
    console.log(`harness up. max concurrent turns: ${cfg.maxConcurrent}, default model: ${cfg.defaultModel ?? '(claude code default)'}`);
}
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
main().catch((e) => {
    console.error('fatal boot error:', e);
    process.exit(1);
});
//# sourceMappingURL=index.js.map