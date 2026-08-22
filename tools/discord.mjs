// tools/discord.mjs — ToolPlugin adding discord_* MCP tools to every agent.
// Loaded at daemon boot only: after editing, `sudo systemctl restart harness`.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { getDiscord, splitContent, formatMessage } from '../lib/discord.mjs';

let services, env;

const text = (s) => ({ content: [{ type: 'text', text: s }] });

async function fetchTextChannel(id) {
  const client = await getDiscord(services, env);
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch) throw new Error(`no channel with id ${id} (is the bot in that server?)`);
  if (!ch.isTextBased()) throw new Error(`channel ${id} is not text-based`);
  return ch;
}

export default {
  name: 'discord',
  init(s, e) {
    services = s;
    env = e;
    if (!e.DISCORD_BOT_TOKEN) console.error('[discord tools] DISCORD_BOT_TOKEN unset — discord tools will error until it is configured');
  },
  tools: [
    tool(
      'discord_send',
      'Send a Discord message to a channel or thread (thread ids ARE channel ids). Long content is split into multiple messages automatically. Can attach files from disk (generated CSVs, images, reports — ~10MB/file limit). Returns the sent message id(s).',
      {
        channel_id: z.string().describe('channel or thread id'),
        content: z.string().optional().describe('message text; optional when attaching files'),
        reply_to_message_id: z.string().optional().describe('make the first message a reply to this message id'),
        file_paths: z.array(z.string()).max(10).optional().describe('absolute paths of files to attach (max 10)'),
      },
      async (args) => {
        if (!args.content && !args.file_paths?.length) throw new Error('provide content and/or file_paths');
        const files = (args.file_paths ?? []).map((p) => {
          let st;
          try {
            st = statSync(p);
          } catch {
            throw new Error(`file not found: ${p}`);
          }
          if (!st.isFile()) throw new Error(`not a file: ${p}`);
          if (st.size > 10 * 1024 * 1024)
            throw new Error(`${p} is ${(st.size / 1e6).toFixed(1)}MB — over Discord's ~10MB limit; publish_page is a better fit for large files`);
          return { attachment: p, name: basename(p) };
        });
        const ch = await fetchTextChannel(args.channel_id);
        const chunks = splitContent(args.content ?? '');
        const ids = [];
        for (let i = 0; i < chunks.length; i++) {
          const payload = {
            reply: i === 0 && args.reply_to_message_id
              ? { messageReference: args.reply_to_message_id, failIfNotExists: false }
              : undefined,
            files: i === chunks.length - 1 && files.length ? files : undefined, // attach on the last chunk
          };
          if (chunks[i]) payload.content = chunks[i];
          if (!payload.content && !payload.files) continue;
          const msg = await ch.send(payload);
          ids.push(msg.id);
        }
        return text(
          `sent ${ids.length} message(s) in channel ${args.channel_id}: ${ids.join(', ')}` +
            (files.length ? ` with ${files.length} attachment(s): ${files.map((f) => f.name).join(', ')}` : ''),
        );
      },
    ),
    tool(
      'discord_create_thread',
      'Create a Discord thread — from an existing message (message_id) or standalone in a channel. Returns the thread id; use discord_send with that id to post in it.',
      {
        channel_id: z.string(),
        name: z.string().max(100).describe('thread title, max 100 chars'),
        message_id: z.string().optional().describe('start the thread from this message'),
      },
      async (args) => {
        const ch = await fetchTextChannel(args.channel_id);
        if (args.message_id) {
          const msg = await ch.messages.fetch(args.message_id);
          if (msg.hasThread) return text(`message already has a thread: thread_id ${msg.thread.id} — use discord_send with channel_id=${msg.thread.id}`);
          const thread = await msg.startThread({ name: args.name, autoArchiveDuration: 1440 });
          return text(`thread "${args.name}" created: thread_id ${thread.id} — use discord_send with channel_id=${thread.id} to talk in it`);
        }
        if (!ch.threads) throw new Error(`channel ${args.channel_id} does not support standalone threads`);
        const thread = await ch.threads.create({ name: args.name, autoArchiveDuration: 1440 });
        return text(`thread "${args.name}" created: thread_id ${thread.id} — use discord_send with channel_id=${thread.id} to talk in it`);
      },
    ),
    tool(
      'discord_get_messages',
      'Fetch recent messages from a Discord channel or thread (oldest first). Use to read context before replying.',
      {
        channel_id: z.string(),
        limit: z.number().int().min(1).max(100).optional().describe('default 25'),
        before: z.string().optional().describe('fetch messages older than this message id'),
      },
      async (args) => {
        const ch = await fetchTextChannel(args.channel_id);
        const coll = await ch.messages.fetch({ limit: args.limit ?? 25, before: args.before });
        if (!coll.size) return text('(no messages)');
        const msgs = [...coll.values()].reverse();
        const lines = msgs.map(formatMessage);
        lines.push(`(older: pass before=${msgs[0].id})`);
        return text(lines.join('\n'));
      },
    ),
    tool(
      'discord_react',
      'Add an emoji reaction to a Discord message. Unicode emoji like "👀" or custom emoji as "name:id".',
      {
        channel_id: z.string(),
        message_id: z.string(),
        emoji: z.string(),
      },
      async (args) => {
        const ch = await fetchTextChannel(args.channel_id);
        const msg = await ch.messages.fetch(args.message_id);
        await msg.react(args.emoji);
        return text(`reacted ${args.emoji} on message ${args.message_id}`);
      },
    ),
    tool(
      'discord_list_channels',
      'List servers and text channels the bot can see, with their ids. Use to discover channel ids.',
      {
        guild_id: z.string().optional().describe('server id; omit if the bot is in a single server'),
      },
      async (args) => {
        const client = await getDiscord(services, env);
        const guilds = await client.guilds.fetch();
        if (!guilds.size) return text('the bot is not in any server yet — the human must invite it first');
        let guildId = args.guild_id;
        if (!guildId) {
          if (guilds.size > 1) {
            return text(
              'bot is in multiple servers, pass guild_id:\n' + [...guilds.values()].map((g) => `${g.name}  guild_id: ${g.id}`).join('\n'),
            );
          }
          guildId = guilds.first().id;
        }
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        const lines = [`server "${guild.name}" (guild_id ${guild.id}):`];
        for (const ch of channels.values()) {
          if (ch && ch.isTextBased() && !ch.isThread()) {
            lines.push(`  #${ch.name}  channel_id: ${ch.id}${ch.parent ? `  (category: ${ch.parent.name})` : ''}`);
          }
        }
        try {
          const active = await guild.channels.fetchActiveThreads();
          for (const t of active.threads.values()) lines.push(`  ↳ thread "${t.name}"  thread_id: ${t.id} (in channel ${t.parentId})`);
        } catch {
          // active-threads listing is a nice-to-have
        }
        return text(lines.join('\n'));
      },
    ),
  ],
};
