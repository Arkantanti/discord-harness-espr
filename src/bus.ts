import { EventEmitter } from 'node:events';

/**
 * Events:
 *  - 'inbox'                       → scheduler wake-up (something enqueued)
 *  - 'agent_status' {agentId, status} → UI
 *  - 'event' {agentId, event}      → UI transcript stream
 */
export const bus = new EventEmitter();
bus.setMaxListeners(200);
