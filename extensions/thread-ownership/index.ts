import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface ThreadRecord {
  threadId: string;
  ownerId: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  metadata: Record<string, unknown>;
}

/**
 * Thread Ownership Extension
 *
 * Tracks conversation thread ownership across channels, enabling
 * ownership assignment, transfer, and lifecycle management. Threads
 * can be claimed by agents or users and reassigned as needed.
 */
class ThreadOwnershipExtension implements Extension {
  id = 'thread-ownership';
  name = 'Thread Ownership';
  description = 'Track and manage conversation thread ownership across channels and agents';
  version = '1.0.0';
  type = 'channel' as const;

  private threads = new Map<string, ThreadRecord>();
  private ctx: ExtensionContext | null = null;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;

    context.logger.info('Thread Ownership extension initializing');

    context.bus.on('thread:claim', async (...args: unknown[]) => {
      const [threadId, ownerId, channelId, metadata] = args as [string, string, string, Record<string, unknown>?];
      const record = this.claimThread(threadId, ownerId, channelId, metadata);
      await context.bus.emit('thread:claimed', record);
    });

    context.bus.on('thread:release', async (...args: unknown[]) => {
      const [threadId] = args as [string];
      this.releaseThread(threadId);
      await context.bus.emit('thread:released', threadId);
    });

    context.bus.on('thread:transfer', async (...args: unknown[]) => {
      const [threadId, newOwnerId] = args as [string, string];
      const record = this.transferThread(threadId, newOwnerId);
      if (record) {
        await context.bus.emit('thread:transferred', record);
      }
    });

    context.bus.on('thread:message', async (...args: unknown[]) => {
      const [threadId] = args as [string];
      this.recordMessage(threadId);
    });

    context.bus.on('thread:query', async (...args: unknown[]) => {
      const [ownerId, callback] = args as [string, (threads: ThreadRecord[]) => void];
      callback(this.getThreadsByOwner(ownerId));
    });

    context.logger.info('Thread Ownership initialized');
  }

  async destroy(): Promise<void> {
    this.threads.clear();
    this.ctx?.logger.info('Thread Ownership destroyed');
  }

  claimThread(threadId: string, ownerId: string, channelId: string, metadata?: Record<string, unknown>): ThreadRecord {
    const existing = this.threads.get(threadId);
    if (existing) {
      this.ctx?.logger.warn(`Thread ${threadId} already claimed by ${existing.ownerId}, overwriting`);
    }

    const now = Date.now();
    const record: ThreadRecord = {
      threadId,
      ownerId,
      channelId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messageCount: existing?.messageCount ?? 0,
      metadata: metadata ?? {},
    };

    this.threads.set(threadId, record);
    this.ctx?.logger.info(`Thread ${threadId} claimed by ${ownerId} in channel ${channelId}`);
    return record;
  }

  releaseThread(threadId: string): boolean {
    const deleted = this.threads.delete(threadId);
    if (deleted) {
      this.ctx?.logger.info(`Thread ${threadId} released`);
    }
    return deleted;
  }

  transferThread(threadId: string, newOwnerId: string): ThreadRecord | null {
    const record = this.threads.get(threadId);
    if (!record) {
      this.ctx?.logger.warn(`Cannot transfer thread ${threadId}: not found`);
      return null;
    }

    const previousOwner = record.ownerId;
    record.ownerId = newOwnerId;
    record.updatedAt = Date.now();

    this.ctx?.logger.info(`Thread ${threadId} transferred from ${previousOwner} to ${newOwnerId}`);
    return record;
  }

  recordMessage(threadId: string): void {
    const record = this.threads.get(threadId);
    if (record) {
      record.messageCount++;
      record.updatedAt = Date.now();
    }
  }

  getThread(threadId: string): ThreadRecord | undefined {
    return this.threads.get(threadId);
  }

  getThreadsByOwner(ownerId: string): ThreadRecord[] {
    return Array.from(this.threads.values()).filter(t => t.ownerId === ownerId);
  }

  getThreadsByChannel(channelId: string): ThreadRecord[] {
    return Array.from(this.threads.values()).filter(t => t.channelId === channelId);
  }

  getAllThreads(): ThreadRecord[] {
    return Array.from(this.threads.values());
  }
}

export default new ThreadOwnershipExtension();
