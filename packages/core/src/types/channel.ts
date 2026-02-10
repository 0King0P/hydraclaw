import type { Plugin } from './plugin.js';
import type { InboundMessage, OutboundMessage } from './message.js';

export interface Channel extends Plugin {
  type: 'channel';
  capabilities: ChannelCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(target: string, message: OutboundMessage): Promise<void>;
  onMessage?(handler: (message: InboundMessage) => void): void;
}

export interface ChannelCapabilities {
  text: boolean;
  images: boolean;
  audio: boolean;
  video: boolean;
  files: boolean;
  reactions: boolean;
  threads: boolean;
  editing: boolean;
  groups: boolean;
  streaming: boolean;
}

export const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  text: true,
  images: false,
  audio: false,
  video: false,
  files: false,
  reactions: false,
  threads: false,
  editing: false,
  groups: false,
  streaming: false,
};
