import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  Channel,
  ChannelCapabilities,
  InboundMessage,
  OutboundMessage,
  PluginContext,
  Logger,
  MessageBus,
} from '@hydraclaw/core';
import { Events } from '@hydraclaw/core';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class SignalChannel implements Channel {
  readonly id = 'signal';
  readonly name = 'Signal';
  readonly version = '1.0.0';
  readonly type = 'channel' as const;

  readonly capabilities: ChannelCapabilities = {
    text: true,
    images: true,
    audio: false,
    video: false,
    files: true,
    reactions: true,
    threads: false,
    editing: false,
    groups: true,
    streaming: false,
  };

  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private logger!: Logger;
  private bus!: MessageBus;
  private config!: Record<string, unknown>;
  private rpcId = 0;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private account!: string;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'signal' });
    this.bus = ctx.bus;
    this.config = ctx.config;

    this.account = this.config.account as string;
    if (!this.account) {
      throw new Error('Signal account phone number is required (config.account)');
    }

    // Validate signal-cli is installed
    const signalCliPath = (this.config.signalCliPath as string) ?? 'signal-cli';
    try {
      const { execSync } = await import('node:child_process');
      execSync(`${signalCliPath} --version`, { stdio: 'pipe' });
    } catch {
      throw new Error(
        'signal-cli is not installed or not found in PATH. ' +
        'Install it from https://github.com/AsamK/signal-cli',
      );
    }

    this.logger.info('Signal channel initialized');
  }

  async start(): Promise<void> {
    const signalCliPath = (this.config.signalCliPath as string) ?? 'signal-cli';
    const configPath = this.config.configPath as string | undefined;

    const args = ['-a', this.account, 'jsonRpc'];
    if (configPath) {
      args.unshift('--config', configPath);
    }

    this.logger.info('Starting signal-cli JSON-RPC daemon...');

    this.process = spawn(signalCliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to start signal-cli process');
    }

    this.readline = createInterface({ input: this.process.stdout });

    this.readline.on('line', (line: string) => {
      try {
        const msg: JsonRpcMessage = JSON.parse(line);
        this.handleJsonRpc(msg);
      } catch (err) {
        this.logger.debug(`Non-JSON output from signal-cli: ${line}`);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.logger.debug(`signal-cli stderr: ${text}`);
      }
    });

    this.process.on('exit', (code) => {
      this.logger.warn(`signal-cli process exited with code ${code}`);
    });

    this.process.on('error', (err) => {
      this.logger.error(`signal-cli process error: ${err}`);
    });

    this.logger.info('Signal channel started');
  }

  async stop(): Promise<void> {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.process) {
      this.logger.info('Stopping signal-cli daemon...');
      this.process.kill('SIGTERM');
      this.process = null;
      this.logger.info('Signal channel stopped');
    }
  }

  async send(target: string, message: OutboundMessage): Promise<void> {
    const params: Record<string, unknown> = {
      recipient: [target],
      message: message.content ?? '',
    };

    // Send attachments if present
    const attachmentPaths: string[] = [];

    if (message.images && message.images.length > 0) {
      for (const image of message.images) {
        const tmpPath = path.join('/tmp', `signal-img-${randomUUID()}.${image.mimeType.split('/')[1] ?? 'png'}`);
        fs.writeFileSync(tmpPath, image.data);
        attachmentPaths.push(tmpPath);
      }
    }

    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        const tmpPath = path.join('/tmp', `signal-file-${randomUUID()}-${file.filename}`);
        fs.writeFileSync(tmpPath, file.data);
        attachmentPaths.push(tmpPath);
      }
    }

    if (attachmentPaths.length > 0) {
      params.attachments = attachmentPaths;
    }

    try {
      await this.sendRpc('send', params);
    } finally {
      // Clean up temp files
      for (const p of attachmentPaths) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private handleJsonRpc(msg: JsonRpcMessage): void {
    // Handle response to our requests
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(`signal-cli RPC error: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Handle incoming notifications (messages)
    if (msg.method === 'receive') {
      this.handleIncomingMessage(msg.params ?? {});
    }
  }

  private async handleIncomingMessage(params: Record<string, unknown>): Promise<void> {
    try {
      const envelope = params.envelope as Record<string, unknown> | undefined;
      if (!envelope) return;

      const dataMessage = envelope.dataMessage as Record<string, unknown> | undefined;
      if (!dataMessage) return;

      const source = envelope.source as string | undefined;
      const sourceName = envelope.sourceName as string | undefined;
      const timestamp = envelope.timestamp as number | undefined;
      const groupInfo = dataMessage.groupInfo as Record<string, unknown> | undefined;
      const isGroup = !!groupInfo;

      const content = (dataMessage.message as string) ?? '';

      if (!content) return;

      const inbound: InboundMessage = {
        id: randomUUID(),
        channelId: 'signal',
        channelMessageId: timestamp ? String(timestamp) : undefined,
        senderId: source ?? 'unknown',
        senderName: sourceName ?? source ?? 'unknown',
        target: isGroup ? (groupInfo!.groupId as string) : (source ?? ''),
        content,
        isGroup,
        groupId: isGroup ? (groupInfo!.groupId as string) : undefined,
        groupName: isGroup ? (groupInfo!.groupName as string | undefined) : undefined,
        timestamp: timestamp ?? Date.now(),
        raw: params,
      };

      await this.bus.emit(Events.MESSAGE_INBOUND, inbound);
    } catch (err) {
      this.logger.error(`Error handling Signal message: ${err}`);
    }
  }

  private sendRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('signal-cli process not running'));
        return;
      }

      const id = ++this.rpcId;
      const request: JsonRpcMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`signal-cli RPC timeout for method: ${method}`));
        }
      }, 30_000);
    });
  }
}

export default SignalChannel;
