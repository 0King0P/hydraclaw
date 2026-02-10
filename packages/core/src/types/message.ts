export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallMessage[];
  images?: ImageInput[];
  timestamp?: number;
}

export interface ToolCallMessage {
  id: string;
  name: string;
  arguments: string;
}

export interface ImageInput {
  type: 'url' | 'base64';
  data: string;
  mimeType?: string;
}

export interface InboundMessage {
  id: string;
  channelId: string;
  channelMessageId?: string;
  senderId: string;
  senderName?: string;
  target: string;
  content: string;
  images?: ImageInput[];
  files?: FileAttachment[];
  replyToId?: string;
  threadId?: string;
  groupId?: string;
  groupName?: string;
  isGroup: boolean;
  timestamp: number;
  raw?: unknown;
}

export interface OutboundMessage {
  content: string;
  images?: Array<{ data: Buffer; mimeType: string; filename?: string }>;
  files?: Array<{ data: Buffer; mimeType: string; filename: string }>;
  replyToId?: string;
  threadId?: string;
}

export interface FileAttachment {
  url?: string;
  data?: Buffer;
  mimeType: string;
  filename: string;
  size?: number;
}

export type MessageEvent = {
  type: 'message:inbound';
  message: InboundMessage;
} | {
  type: 'message:outbound';
  channelId: string;
  target: string;
  message: OutboundMessage;
};
