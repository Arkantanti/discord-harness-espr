import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfg } from '../config.js';
import { engine } from '../watchers/engine.js';
let loaded = [];
export const toolPluginErrors = [];
/** Load tools/*.mjs at boot. Each exports a ToolPlugin {name, init?, tools}. Phase-2 hook (discord_send etc.). */
export async function loadToolPlugins() {
    loaded = [];
    toolPluginErrors.length = 0;
    let files = [];
    try {
        files = readdirSync(cfg.toolsDir).filter((f) => f.endsWith('.mjs'));
    }
    catch {
        return;
    }
    for (const f of files) {
        const full = path.join(cfg.toolsDir, f);
        try {
            const url = pathToFileURL(full).href + '?v=' + statSync(full).mtimeMs;
            const mod = await import(url);
            const plugin = mod.default;
            if (!plugin || typeof plugin.name !== 'string' || !Array.isArray(plugin.tools)) {
                toolPluginErrors.push(`${f}: default export is not a ToolPlugin ({name, tools[]})`);
                continue;
            }
            await plugin.init?.(engine.services, process.env);
            loaded.push(plugin);
        }
        catch (e) {
            toolPluginErrors.push(`${f}: ${String(e).slice(0, 500)}`);
        }
    }
}
export function pluginTools() {
    return loaded.flatMap((p) => p.tools);
}
//# sourceMappingURL=toolPlugins.js.map