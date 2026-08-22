import type { InboxMessage } from './types.js';

function header(m: InboxMessage): string {
  const ts = new Date(m.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  switch (m.fromType) {
    case 'user':
      return `[from user (web ui) at ${ts}]`;
    case 'agent':
      return `[from agent "${m.fromLabel ?? m.fromId}" (id ${m.fromId}) at ${ts}]`;
    case 'watcher':
      return `[from watcher "${m.fromLabel ?? m.fromId}" (id ${m.fromId}) at ${ts}]`;
    default:
      return `[from system at ${ts}]`;
  }
}

export function renderEnvelope(msgs: InboxMessage[]): string {
  if (msgs.length === 1) {
    return `${header(msgs[0])}\n${msgs[0].content}`;
  }
  const parts = [`You have ${msgs.length} new messages.`];
  msgs.forEach((m, i) => {
    parts.push(`--- message ${i + 1} ---\n${header(m)}\n${m.content}`);
  });
  return parts.join('\n\n');
}
