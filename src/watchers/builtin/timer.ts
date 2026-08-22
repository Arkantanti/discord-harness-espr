import type { WatcherPlugin } from '../../types.js';

/** One-shot reminder. Config: {delay_ms?: number, at?: ISO string, message: string}. */
export const timerPlugin: WatcherPlugin = {
  type: 'timer',
  description: 'Fires a message once after a delay (delay_ms) or at a time (at), then disables itself.',
  validate(config: any) {
    if (!config || typeof config !== 'object') return 'config must be an object';
    if (typeof config.message !== 'string' || !config.message) return 'config.message (string) required';
    const hasDelay = typeof config.delay_ms === 'number' && config.delay_ms >= 0;
    const hasAt = typeof config.at === 'string' && !Number.isNaN(Date.parse(config.at));
    if (!hasDelay && !hasAt) return 'config needs delay_ms (number) or at (ISO-8601 string)';
    return null;
  },
  start(ctx) {
    // Persist the absolute fire time so restarts don't lose the reminder.
    let fireAt: number = ctx.state?.fire_at;
    if (typeof fireAt !== 'number') {
      fireAt = typeof ctx.config.delay_ms === 'number' ? Date.now() + ctx.config.delay_ms : Date.parse(ctx.config.at);
      ctx.saveState({ fire_at: fireAt });
    }
    const remaining = fireAt - Date.now();
    const fire = () => {
      const lateMs = Date.now() - fireAt;
      const note = lateMs > 30_000 ? ` (late by ${Math.round(lateMs / 1000)}s — daemon was down)` : '';
      ctx.emit(`${ctx.config.message}${note}`, { disableAfter: true });
    };
    const t = setTimeout(fire, Math.max(0, remaining));
    ctx.signal.addEventListener('abort', () => clearTimeout(t));
    return () => clearTimeout(t);
  },
};
