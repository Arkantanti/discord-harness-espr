// lib/discord.mjs — ONE gateway client shared by tools/discord.mjs and watchers/discord.mjs.
//
// All mutable state lives in the engine's services Map (key 'discord'), which survives
// watcher hot-reloads. NOTE: this file is statically imported and therefore module-cached —
// editing it requires `sudo systemctl restart harness` (unlike watchers/discord.mjs, which
// is cache-busted on reload_watchers). Keep this file dumb and stable.
import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';

const KEY = 'discord';

/**
 * Lazy singleton. Resolves to a READY client or throws a descriptive error.
 * On login failure the cache entry is evicted so a later call can retry.
 */
export function getDiscord(services, env) {
  let entry = services.get(KEY);
  if (!entry) {
    const token = env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error(
        'DISCORD_BOT_TOKEN is not set. The human must add it to ~/projects/harness/.env and run `sudo systemctl restart harness`.',
      );
    }
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
    client.setMaxListeners(0); // one listener per watcher on a shared emitter
    client.on(Events.Error, (e) => console.error('[discord] client error:', e?.message ?? e));
    const ready = new Promise((resolve, reject) => {
      client.once(Events.ClientReady, () => {
        console.error(`[discord] logged in as ${client.user.tag}`);
        resolve(client);
      });
      client.login(token).catch(reject);
    }).catch((e) => {
      services.delete(KEY);
      client.destroy();
      throw new Error(`discord login failed: ${e?.message ?? e}`);
    });
    entry = { client, ready };
    services.set(KEY, entry);
  }
  return entry.ready;
}

/** Split content into <=2000-char chunks, preferring newline then space boundaries. */
export function splitContent(content, max = 2000) {
  const chunks = [];
  let rest = String(content ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.length || !chunks.length) chunks.push(rest);
  return chunks;
}

/** Compact one-line-ish rendering for message history. */
export function formatMessage(m) {
  const ts = new Date(m.createdTimestamp).toISOString().slice(0, 16) + 'Z';
  let line = `[${ts}] ${m.author.tag} (user ${m.author.id}) msg ${m.id}: ${m.content || '(no text — embed/attachment)'}`;
  if (m.attachments?.size) line += `\n  attachments: ${[...m.attachments.values()].map((a) => a.url).join(' ')}`;
  return line;
}

/** Standard watcher-emit envelope: everything an agent needs to act on a message. */
export function formatEvent(kind, m, extra = '') {
  const inThread = typeof m.channel.isThread === 'function' && m.channel.isThread();
  return [
    `[discord ${kind}] ${m.guild?.name ?? 'DM'} #${m.channel.name}${inThread ? ` (thread in channel ${m.channel.parentId})` : ''}`,
    `channel_id: ${m.channel.id}${inThread ? `  parent_channel_id: ${m.channel.parentId}` : ''}`,
    `message_id: ${m.id}  author: ${m.author.tag} (user_id ${m.author.id})  url: ${m.url}`,
    `content: ${m.content || '(no text)'}`,
    extra,
    `→ To reply here: discord_send {channel_id: "${m.channel.id}", content: "...", reply_to_message_id: "${m.id}" (optional)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
