// watchers/discord.mjs — Discord watcher types. Hot-reloadable via reload_watchers.
// The gateway client lives in ctx.services (lib/discord.mjs) and survives reloads;
// each watcher attaches its own event listener and removes it on ctx.signal abort.
import { Events } from 'discord.js';
import { getDiscord, formatEvent } from '../lib/discord.mjs';

const DEFAULT_MAX_PER_MINUTE = 30;

/** Per-watcher rate gate. Returns true if the event may emit; emits one catch-up note when the cap first hits. */
function makeRateGate(ctx) {
  const cap = typeof ctx.config.max_per_minute === 'number' ? ctx.config.max_per_minute : DEFAULT_MAX_PER_MINUTE;
  let windowStart = Date.now();
  let count = 0;
  let skipped = 0;
  return (channelIdForHint) => {
    if (cap === 0) return true;
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      if (skipped > 0) ctx.log(`rate window cleared; ${skipped} events were skipped`);
      windowStart = now;
      count = 0;
      skipped = 0;
    }
    count++;
    if (count <= cap) return true;
    skipped++;
    if (count === cap + 1) {
      ctx.emit(
        `[discord] rate cap hit (${cap}/min) on this watcher — suppressing further events until traffic drops. ` +
          `Use discord_get_messages {channel_id: "${channelIdForHint}"} to catch up, or raise max_per_minute in the watcher config.`,
      );
    }
    return false;
  };
}

function idString(v) {
  return typeof v === 'string' && /^\d{5,}$/.test(v);
}

/** Common scaffold for messageCreate-based watchers. */
async function startMessageWatcher(ctx, kind, matchFn) {
  const client = await getDiscord(ctx.services, ctx.env);
  const allow = makeRateGate(ctx);
  const handler = (m) => {
    try {
      if (!m.author || m.author.id === client.user.id) return; // never react to our own bot (loop prevention)
      if (!matchFn(m)) return;
      if (!allow(m.channel.id)) return;
      ctx.emit(formatEvent(kind, m));
    } catch (e) {
      ctx.log(`${kind} handler error: ${e?.message ?? e}`);
    }
  };
  client.on(Events.MessageCreate, handler);
  const off = () => client.off(Events.MessageCreate, handler);
  ctx.signal.addEventListener('abort', off);
  return off;
}

/** channel match helper: direct channel or (optionally) a thread under it */
function inChannelScope(m, channelId, includeThreads) {
  if (m.channel.id === channelId) return true;
  if (includeThreads && m.channel.isThread?.() && m.channel.parentId === channelId) return true;
  return false;
}

export default [
  {
    type: 'discord-channel',
    description:
      'Every message in a Discord channel. Config: {channel_id, ignore_bots?=true, include_threads?=false, max_per_minute?=30}. BROAD — prefer discord-mentions/discord-thread when possible.',
    validate(c) {
      if (!c || !idString(c.channel_id)) return 'config.channel_id (numeric string) required';
      return null;
    },
    start(ctx) {
      const { channel_id, ignore_bots = true, include_threads = false } = ctx.config;
      return startMessageWatcher(ctx, 'channel message', (m) => {
        if (ignore_bots && m.author.bot) return false;
        return inChannelScope(m, channel_id, include_threads);
      });
    },
  },
  {
    type: 'discord-thread',
    description: 'Every message in one Discord thread. Config: {thread_id, max_per_minute?=30}. The natural watcher for conversing in a task thread.',
    validate(c) {
      if (!c || !idString(c.thread_id)) return 'config.thread_id (numeric string) required';
      return null;
    },
    start(ctx) {
      return startMessageWatcher(ctx, 'thread message', (m) => m.channel.id === ctx.config.thread_id);
    },
  },
  {
    type: 'discord-mentions',
    description:
      'Messages that @-mention the bot (default) or a given user. Config: {channel_id? (scope to a channel + its threads; omit = server-wide), user_id?}. The standard "wake me when pinged" watcher.',
    validate(c) {
      if (c?.channel_id !== undefined && !idString(c.channel_id)) return 'config.channel_id must be a numeric string';
      if (c?.user_id !== undefined && !idString(c.user_id)) return 'config.user_id must be a numeric string';
      return null;
    },
    async start(ctx) {
      const client = await getDiscord(ctx.services, ctx.env);
      const target = ctx.config.user_id ?? client.user.id;
      return startMessageWatcher(ctx, 'mention', (m) => {
        // direct @user mention, or a mention of the bot's managed role (what "@botname" often resolves to)
        const direct = m.mentions?.users?.has(target);
        const viaRole = m.mentions?.roles?.some((r) => r.tags?.botId === target);
        if (!direct && !viaRole) return false;
        if (ctx.config.channel_id) return inChannelScope(m, ctx.config.channel_id, true);
        return true;
      });
    },
  },
  {
    type: 'discord-user',
    description: 'Every message from a specific user. Config: {user_id, channel_id?, max_per_minute?=30}.',
    validate(c) {
      if (!c || !idString(c.user_id)) return 'config.user_id (numeric string) required';
      if (c.channel_id !== undefined && !idString(c.channel_id)) return 'config.channel_id must be a numeric string';
      return null;
    },
    start(ctx) {
      return startMessageWatcher(ctx, 'user message', (m) => {
        if (m.author.id !== ctx.config.user_id) return false;
        if (ctx.config.channel_id) return inChannelScope(m, ctx.config.channel_id, true);
        return true;
      });
    },
  },
  {
    type: 'discord-watchword',
    description:
      'Messages matching a regex. Config: {pattern (regex string), flags?="i", channel_id?, ignore_bots?=true, max_per_minute?=30}.',
    validate(c) {
      if (!c || typeof c.pattern !== 'string' || !c.pattern) return 'config.pattern (regex string) required';
      try {
        new RegExp(c.pattern, c.flags ?? 'i');
      } catch (e) {
        return `invalid regex: ${e.message}`;
      }
      if (c.channel_id !== undefined && !idString(c.channel_id)) return 'config.channel_id must be a numeric string';
      return null;
    },
    start(ctx) {
      const re = new RegExp(ctx.config.pattern, ctx.config.flags ?? 'i');
      const { ignore_bots = true } = ctx.config;
      return startMessageWatcher(ctx, `watchword /${ctx.config.pattern}/`, (m) => {
        if (ignore_bots && m.author.bot) return false;
        if (ctx.config.channel_id && !inChannelScope(m, ctx.config.channel_id, true)) return false;
        return re.test(m.content ?? '');
      });
    },
  },
  {
    type: 'discord-reactions',
    description:
      'Emoji reactions added to messages. Config: {channel_id?, message_id?, emoji? (unicode or custom name), ignore_bots?=true}. At least one filter recommended.',
    validate(c) {
      if (c?.channel_id !== undefined && !idString(c.channel_id)) return 'config.channel_id must be a numeric string';
      if (c?.message_id !== undefined && !idString(c.message_id)) return 'config.message_id must be a numeric string';
      return null;
    },
    async start(ctx) {
      const client = await getDiscord(ctx.services, ctx.env);
      const allow = makeRateGate(ctx);
      const handler = async (reaction, user) => {
        try {
          if (user.id === client.user.id) return;
          if (ctx.config.ignore_bots !== false && user.bot) return;
          if (reaction.partial) reaction = await reaction.fetch();
          let msg = reaction.message;
          if (msg.partial) msg = await msg.fetch();
          if (ctx.config.message_id && msg.id !== ctx.config.message_id) return;
          if (ctx.config.channel_id && !inChannelScope(msg, ctx.config.channel_id, true)) return;
          if (ctx.config.emoji && reaction.emoji.name !== ctx.config.emoji && reaction.emoji.id !== ctx.config.emoji) return;
          if (!allow(msg.channel.id)) return;
          ctx.emit(
            formatEvent('reaction', msg, `reaction: ${reaction.emoji.toString()} by ${user.tag} (user_id ${user.id})`),
          );
        } catch (e) {
          ctx.log(`reaction handler error: ${e?.message ?? e}`);
        }
      };
      client.on(Events.MessageReactionAdd, handler);
      const off = () => client.off(Events.MessageReactionAdd, handler);
      ctx.signal.addEventListener('abort', off);
      return off;
    },
  },
];
