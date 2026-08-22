# harness — multi-agent Claude Code orchestrator

Agents are **SQLite rows, not processes**. Each agent maps to a persisted Claude Code
session (`~/.claude/projects/<munged-cwd>/<session-id>.jsonl`); an idle agent costs
nothing. Messages (from the user, other agents, or watchers) land in an **inbox
table**; the scheduler batches them into a turn via the Agent SDK's `resume`, capped
at `HARNESS_MAX_CONCURRENT` parallel turns. When a turn ends the agent parks until
something new arrives.

## URLs
- Web UI: https://app.167-233-160-246.sslip.io (basic auth, user `vibe10`, password in `.web-password`)
- Published pages: https://pages.167-233-160-246.sslip.io/<agent-name>/... (same auth)

## The three primitives
1. **spawn** — `mcp__harness__spawn_agent {name, prompt, model?, system_prompt?}`; children know their parent and message it back.
2. **message** — `mcp__harness__send_message {to, content}`; fire-and-forget, replies arrive as future inbox messages.
3. **watchers** — `set_watcher/list_watchers/update_watcher/remove_watcher`; when a watcher fires, its message wakes the owning agent.
   - Built-ins: `timer {delay_ms|at, message}`, `cron {schedule, message, timezone?}`, `poll {command, interval_ms, mode, message_prefix?}`.
   - **New types**: drop an ES module in `watchers/*.mjs` (export `{type, validate?, start(ctx) => stopFn}`, or an array of those), then call `mcp__harness__reload_watchers`. Agents can do this themselves.

Also: `publish_page {path, content}` → served under pages.* behind auth.

## Discord (phase 2)
Bot `harness#8629`, token in `.env` (`DISCORD_BOT_TOKEN`; changes need `systemctl restart harness`).
- Tools (every agent): `discord_send` (auto-splits >2000 chars; `file_paths` attaches files up to ~10MB — bigger belongs on publish_page), `discord_create_thread` (thread id == starter message id), `discord_get_messages`, `discord_react`, `discord_list_channels`.
- Watcher types: `discord-mentions` (user OR bot-role pings — the wake-on-ping default), `discord-thread`, `discord-channel`, `discord-user`, `discord-watchword`, `discord-reactions`. Broad types are rate-capped 30 emits/min by default (`max_per_minute`, 0 = off). Bot's own messages never trigger watchers (loop prevention).
- `lib/discord.mjs` holds the shared gateway client (lives in engine services, survives watcher hot-reloads; editing lib/ needs a daemon restart, watchers/ only needs `reload_watchers`).
- The standing `discord-dispatcher` agent watches #general for pings → 👀 → thread → spawns a `discord-task-*` handler that converses in-thread and terminates itself when done. Pure agent behavior — re-spawn/edit it via the web UI.

## Layout
- `src/runner.ts` — the only file touching the Agent SDK (query/resume/stream → events)
- `src/scheduler.ts` — turn loop, concurrency cap, retry/backoff, crash recovery
- `src/harness/tools.ts` — the in-process MCP server (per-turn, closes over caller id)
- `src/watchers/engine.ts` — watcher lifecycle, hot reload, error isolation
- `src/web/` + `public/` — REST + SSE + vanilla-JS UI
- `tools/*.mjs` — extra MCP tool plugins (`{name, init?, tools}`), loaded at boot. Phase-2 hook: discord_send lands here.
- `data/harness.db` — agents, messages (inbox), watchers, turns, events

## Models
Per-agent resolution, checked fresh every turn:
1. the agent's own `model` (set at spawn — web UI field, API `model`, or `spawn_agent {model}`); fixed for the agent's lifetime (no edit endpoint yet)
2. `HARNESS_DEFAULT_MODEL` in `.env` (currently **`claude-opus-4-8`**) + restart to change
3. the Claude Code CLI default (whatever `/model` last set in `~/.claude/settings.json`)

So today every agent runs on `claude-opus-4-8` at `HARNESS_EFFORT=high` unless spawned
with an explicit model. Reasoning effort is global (`HARNESS_EFFORT`, one of
`low|medium|high|xhigh|max`), passed to the SDK as `options.effort`.
Useful ids: `claude-haiku-4-5` (cheap mechanical work), `claude-sonnet-5` (good handler
default), `claude-opus-5` / `claude-fable-5` (hard tasks, dispatcher judgment). The
dispatcher can be given a standing spawn-model policy with a plain message.

## Agent lifetime (idle reaper)
`src/reaper.ts` sweeps every `HARNESS_REAP_SWEEP_MS` (60s) and terminates any agent that is
`idle` or `failed`, has an **empty inbox**, and has not been touched for
`HARNESS_IDLE_REAP_MS` (60m). Set `HARNESS_IDLE_REAP_MS=0` to disable. Without this,
every finished task agent and its watcher lives forever once its thread goes quiet.

The empty-inbox condition is the safety property: a queued message means work is imminent,
so an agent is never reaped out from under a watcher event that just fired.

Agents with `standing = 1` are exempt — for agents that park by design, like
`discord-dispatcher` waiting on mentions. Set it at creation (`POST /api/agents
{standing: true}`) or later (`POST /api/agents/:id/standing {standing: true|false}`).
It is deliberately **not** an MCP tool, so an agent cannot make itself immortal.
Force a sweep now with `POST /api/reap` (returns the names it reaped). Every agent's
system-prompt brief states its own lifetime rule, so handlers know to self-terminate.

## Ops
```bash
npm run build                      # tsc → dist/
sudo systemctl restart harness     # run as vibe10 with HOME set (subscription OAuth)
journalctl -u harness -f
```

Config via `.env` (see `.env.example`). Crash recovery on boot: interrupted turns are
marked, `delivering` messages requeue and re-deliver — the inbox is the source of truth.

## Gotchas
- An agent's `cwd` is immutable: session resume is keyed on it (wrong cwd = "No conversation found").
- Never resume the same session concurrently — the scheduler serializes turns per agent.
- Watcher plugins run in-process: no `process.exit()`, no sync busy-loops.
- Agents run with `bypassPermissions` as vibe10 — they can do anything you can.
