import type { ChatMessage, AgentConfig } from '@hydraclaw/core';
import type { SessionStore } from '@hydraclaw/store';

export class ConversationManager {
  private sessionStore: SessionStore;
  private agentConfig: AgentConfig;

  constructor(sessionStore: SessionStore, agentConfig: AgentConfig) {
    this.sessionStore = sessionStore;
    this.agentConfig = agentConfig;
  }

  getOrCreateConversation(channelId: string, senderId: string, target: string): string {
    return this.sessionStore.getOrCreateConversation(channelId, senderId, target);
  }

  getHistory(conversationId: string): ChatMessage[] {
    return this.sessionStore.getHistory(conversationId, this.agentConfig.maxHistory);
  }

  addMessage(conversationId: string, message: ChatMessage): void {
    this.sessionStore.addMessage(conversationId, message);
  }

  buildMessages(conversationId: string, userMessage: ChatMessage): ChatMessage[] {
    const history = this.getHistory(conversationId);
    const messages: ChatMessage[] = [];

    if (this.agentConfig.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.agentConfig.systemPrompt,
      });
    }

    messages.push(...history);
    messages.push(userMessage);

    return messages;
  }

  clearHistory(conversationId: string): void {
    this.sessionStore.clearHistory(conversationId);
  }
}
