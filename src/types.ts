export type AgentStatus = 'idle' | 'running' | 'failed' | 'terminated';
export type FromType = 'user' | 'agent' | 'watcher' | 'system';
export type MessageStatus = 'pending' | 'delivering' | 'delivered';
export type TurnStatus = 'running' | 'ok' | 'error' | 'interrupted';

export interface AgentRow {
  id: string;
  name: string;
  parentId: string | null;
  sessionId: string | null;
  cwd: string;
  model: string | null;
  systemPrompt: string | null;
  status: AgentStatus;
  /** Exempt from the idle reaper — for long-lived agents that park by design. */
  standing: boolean;
  retryCount: number;
  nextAttemptAt: number | null;
  totalCostUsd: number;
  totalTurns: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InboxMessage {
  id: number;
  agentId: string;
  fromType: FromType;
  fromId: string | null;
  fromLabel: string | null;
  content: string;
  status: MessageStatus;
  turnId: number | null;
  createdAt: number;
}

export interface WatcherRow {
  id: string;
  agentId: string;
  type: string;
  name: string | null;
  config: string; // JSON
  enabled: boolean;
  state: string | null; // JSON
  lastFiredAt: number | null;
  fireCount: number;
  lastError: string | null;
  createdAt: number;
}

export interface TurnRow {
  id: number;
  agentId: string;
  status: TurnStatus;
  sessionIdAfter: string | null;
  numTurns: number | null;
  costUsd: number | null;
  usage: string | null; // JSON
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export type StopFn = () => void | Promise<void>;

export interface WatcherContext {
  watcherId: string;
  agentId: string;
  config: any;
  state: any;
  saveState(state: any): void;
  /** Deliver a message to the owning agent's inbox (wakes it if parked). */
  emit(message: string, opts?: { disableAfter?: boolean }): void;
  log(msg: string): void;
  signal: AbortSignal;
  /** Shared singletons across plugins (e.g. one discord client). */
  services: Map<string, unknown>;
  env: Record<string, string | undefined>;
}

export interface WatcherPlugin {
  type: string;
  description?: string;
  /** Return an error message, or null if the config is valid. */
  validate?(config: unknown): string | null;
  start(ctx: WatcherContext): StopFn | Promise<StopFn>;
}

/** Loaded from tools/*.mjs — extra MCP tools merged into every agent's server. */
export interface ToolPlugin {
  name: string;
  init?(services: Map<string, unknown>, env: NodeJS.ProcessEnv): Promise<void> | void;
  tools: unknown[]; // SdkMcpToolDefinition[] from the agent SDK's tool()
}
