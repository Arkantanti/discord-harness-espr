import { query } from '@anthropic-ai/claude-agent-sdk';
import { cfg } from './config.js';
import { renderEnvelope } from './envelope.js';
import { appendEvent } from './store/events.js';
import { buildHarnessServer } from './harness/tools.js';
import { harnessBrief } from './harness/systemPrompt.js';
const TRUNC = 4_000;
const clip = (s) => {
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    return str && str.length > TRUNC ? str.slice(0, TRUNC) + `…(${str.length} chars)` : (str ?? '');
};
/**
 * Run one harness turn for an agent: batched inbox messages in, SDK stream out.
 * Throws on abort or SDK error — caller (scheduler) handles requeue/backoff.
 * This is the ONLY module that talks to the Claude Agent SDK.
 */
export async function runTurn(agent, msgs, turnId, ac) {
    const prompt = renderEnvelope(msgs);
    let result = null;
    const stream = query({
        prompt,
        options: {
            cwd: agent.cwd, // must be identical every turn — resume lookup is keyed on it
            resume: agent.sessionId ?? undefined,
            model: agent.model ?? cfg.defaultModel,
            effort: cfg.effort,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            maxTurns: cfg.maxTurns,
            systemPrompt: { type: 'preset', preset: 'claude_code', append: harnessBrief(agent) },
            mcpServers: { harness: buildHarnessServer(agent.id) },
            abortController: ac,
        },
    });
    for await (const m of stream) {
        switch (m.type) {
            case 'assistant': {
                for (const block of m.message?.content ?? []) {
                    if (block.type === 'text' && block.text?.trim()) {
                        appendEvent(agent.id, turnId, 'assistant_text', { text: block.text });
                    }
                    else if (block.type === 'tool_use') {
                        appendEvent(agent.id, turnId, 'tool_use', { name: block.name, input: clip(block.input) });
                    }
                }
                break;
            }
            case 'user': {
                for (const block of m.message?.content ?? []) {
                    if (block?.type === 'tool_result') {
                        const content = Array.isArray(block.content)
                            ? block.content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
                            : block.content;
                        appendEvent(agent.id, turnId, 'tool_result', { content: clip(content), isError: !!block.is_error });
                    }
                }
                break;
            }
            case 'result': {
                result = {
                    sessionId: m.session_id,
                    costUsd: m.total_cost_usd ?? 0,
                    numTurns: m.num_turns ?? 0,
                    usage: m.usage ?? null,
                    resultText: m.result ?? null,
                    subtype: m.subtype,
                };
                appendEvent(agent.id, turnId, 'result', {
                    subtype: m.subtype,
                    costUsd: result.costUsd,
                    numTurns: result.numTurns,
                });
                break;
            }
            default:
                break; // status/progress messages — not persisted
        }
    }
    if (!result)
        throw new Error('turn ended without a result message');
    return result;
}
//# sourceMappingURL=runner.js.map