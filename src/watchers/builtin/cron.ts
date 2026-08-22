import { Cron } from 'croner';
import type { WatcherPlugin } from '../../types.js';

/** Recurring schedule. Config: {schedule: string, message: string, timezone?: string}. */
export const cronPlugin: WatcherPlugin = {
  type: 'cron',
  description: 'Fires a message on a cron schedule, e.g. "*/15 * * * *".',
  validate(config: any) {
    if (!config || typeof config !== 'object') return 'config must be an object';
    if (typeof config.message !== 'string' || !config.message) return 'config.message (string) required';
    if (typeof config.schedule !== 'string') return 'config.schedule (cron expression string) required';
    try {
      new Cron(config.schedule, { paused: true, timezone: config.timezone }).stop();
    } catch (e) {
      return `invalid cron schedule: ${String(e)}`;
    }
    return null;
  },
  start(ctx) {
    const job = new Cron(ctx.config.schedule, { timezone: ctx.config.timezone }, () => {
      ctx.emit(ctx.config.message);
    });
    ctx.signal.addEventListener('abort', () => job.stop());
    return () => job.stop();
  },
};
