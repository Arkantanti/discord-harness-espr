import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
const MIN_INTERVAL = 5_000;
const OUTPUT_CAP = 4_000;
/**
 * Runs a bash command on an interval.
 * Config: {command, interval_ms (>=5000), mode: 'on-change'|'on-output'|'always', message_prefix?}
 */
export const pollPlugin = {
    type: 'poll',
    description: 'Runs a bash command periodically; fires with the output on-change / on-output / always.',
    validate(config) {
        if (!config || typeof config !== 'object')
            return 'config must be an object';
        if (typeof config.command !== 'string' || !config.command)
            return 'config.command (string) required';
        if (typeof config.interval_ms !== 'number' || config.interval_ms < MIN_INTERVAL)
            return `config.interval_ms (number >= ${MIN_INTERVAL}) required`;
        if (!['on-change', 'on-output', 'always'].includes(config.mode))
            return "config.mode must be 'on-change' | 'on-output' | 'always'";
        return null;
    },
    start(ctx) {
        let busy = false;
        const tick = () => {
            if (busy || ctx.signal.aborted)
                return;
            busy = true;
            execFile('bash', ['-c', ctx.config.command], { timeout: Math.min(ctx.config.interval_ms, 60_000), maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
                busy = false;
                try {
                    if (err && err.killed) {
                        ctx.log(`poll command timed out: ${ctx.config.command}`);
                        return;
                    }
                    const out = (stdout ?? '').toString();
                    const hash = createHash('sha256').update(out).digest('hex');
                    const prev = ctx.state?.hash;
                    ctx.saveState({ ...(ctx.state ?? {}), hash });
                    ctx.state = { ...(ctx.state ?? {}), hash };
                    const mode = ctx.config.mode;
                    const shouldFire = mode === 'always' ||
                        (mode === 'on-output' && out.trim().length > 0) ||
                        (mode === 'on-change' && prev !== undefined && prev !== hash);
                    if (shouldFire) {
                        const prefix = ctx.config.message_prefix ? `${ctx.config.message_prefix}\n` : '';
                        const body = out.length > OUTPUT_CAP ? out.slice(0, OUTPUT_CAP) + `\n…(truncated, ${out.length} chars total)` : out;
                        const errNote = err ? `\n(exit error: ${String(err).slice(0, 200)}${stderr ? `; stderr: ${String(stderr).slice(0, 200)}` : ''})` : '';
                        ctx.emit(`${prefix}${body}${errNote}`);
                    }
                }
                catch (e) {
                    ctx.log(`poll handler error: ${String(e)}`);
                }
            });
        };
        const t = setInterval(tick, ctx.config.interval_ms);
        tick();
        ctx.signal.addEventListener('abort', () => clearInterval(t));
        return () => clearInterval(t);
    },
};
//# sourceMappingURL=poll.js.map