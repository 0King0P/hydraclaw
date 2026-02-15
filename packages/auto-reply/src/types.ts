export interface AutoReplyRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutoReplyTrigger;
  response: AutoReplyResponse;
  conditions?: AutoReplyCondition[];
  cooldown?: number; // ms between replies to same sender
  maxPerDay?: number;
}

export interface AutoReplyTrigger {
  type: 'keyword' | 'regex' | 'exact' | 'any';
  pattern?: string;
  caseSensitive?: boolean;
}

export interface AutoReplyResponse {
  type: 'static' | 'template' | 'ai';
  content?: string;
  template?: string;
  aiPrompt?: string;
}

export interface AutoReplyCondition {
  field: 'channelId' | 'senderId' | 'groupId' | 'isGroup' | 'time';
  operator: 'equals' | 'contains' | 'matches' | 'in' | 'between';
  value: unknown;
}

export interface PollDefinition {
  id: string;
  question: string;
  options: string[];
  channelId: string;
  createdBy: string;
  createdAt: number;
  expiresAt?: number;
  allowMultiple: boolean;
  anonymous: boolean;
}

export interface PollVote {
  pollId: string;
  senderId: string;
  optionIndex: number;
  timestamp: number;
}

export interface PollResults {
  poll: PollDefinition;
  votes: Map<number, number>; // optionIndex -> count
  totalVotes: number;
  voters: number;
}
