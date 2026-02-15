import type { Logger, MessageBus } from '@hydraclaw/core';

export interface Extension {
  id: string;
  name: string;
  description: string;
  version: string;
  type: string;
  init(context: { config: Record<string, unknown>; logger: Logger; bus: MessageBus }): Promise<void>;
  destroy?(): Promise<void>;
}

const extension: Extension = {
  id: 'nostr',
  name: 'Nostr',
  description: 'Nostr protocol integration - send and receive messages via Nostr relays',
  version: '1.0.0',
  type: 'channel',

  async init(ctx) {
    const logger = ctx.logger.child({ extension: 'nostr' });
    const relays = (ctx.config.relays as string[]) ?? ['wss://relay.damus.io'];
    const privateKey = ctx.config.privateKey as string | undefined;

    if (!privateKey) {
      logger.warn('Nostr extension requires a private key to operate');
      return;
    }

    logger.info('Nostr extension initialized with %d relays', relays.length);

    for (const relay of relays) {
      logger.debug('Configured relay: %s', relay);
    }
  },

  async destroy() {},
};

export default extension;
