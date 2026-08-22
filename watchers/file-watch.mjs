import { stat } from 'node:fs/promises';

export default {
  type: 'file-watch',
  description: 'Watches a file path for mtime changes and emits a message when it changes',
  validate(config) {
    if (!config || typeof config.path !== 'string' || !config.path) return 'config.path (string) required';
    if (typeof config.interval_ms !== 'number' || config.interval_ms < 2000) return 'config.interval_ms (number >= 2000) required';
    if (typeof config.message !== 'string' || !config.message) return 'config.message (string) required';
    return null;
  },
  start(ctx) {
    const { path, interval_ms, message } = ctx.config;
    // Baseline from persisted state so a daemon restart doesn't re-fire on an unchanged file.
    let lastMtime = ctx.state?.lastMtime ?? null;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const s = await stat(path);
        const mtime = s.mtimeMs;
        if (lastMtime === null) {
          lastMtime = mtime;
          ctx.saveState({ lastMtime });
        } else if (mtime !== lastMtime) {
          lastMtime = mtime;
          ctx.saveState({ lastMtime });
          ctx.emit(message);
        }
      } catch (err) {
        // Missing file is not an error condition; treat deletion-then-recreation as a change.
        if (err.code !== 'ENOENT') ctx.log(`file-watch stat error for ${path}: ${err.message}`);
      } finally {
        checking = false;
      }
    };

    check();
    const t = setInterval(check, interval_ms);
    ctx.signal.addEventListener('abort', () => clearInterval(t));
    return () => clearInterval(t);
  },
};
