import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface VoiceSession {
  sessionId: string;
  userId: string;
  language: string;
  active: boolean;
  startedAt: number;
  lastActivityAt: number;
  transcriptions: TranscriptionEntry[];
}

interface TranscriptionEntry {
  text: string;
  confidence: number;
  timestamp: number;
  isFinal: boolean;
}

/**
 * Talk Voice Extension
 *
 * Provides voice interaction capabilities for conversational AI,
 * including speech-to-text session management, transcription
 * streaming, and voice activity detection.
 */
class TalkVoiceExtension implements Extension {
  id = 'talk-voice';
  name = 'Talk Voice';
  description = 'Voice interaction and speech-to-text for conversational AI interfaces';
  version = '1.0.0';
  type = 'voice' as const;

  private sessions = new Map<string, VoiceSession>();
  private ctx: ExtensionContext | null = null;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;

    context.logger.info('Talk Voice extension initializing');

    context.bus.on('talk:start', async (...args: unknown[]) => {
      const [sessionId, userId, language] = args as [string, string, string?];
      const session = this.startSession(sessionId, userId, language);
      await context.bus.emit('talk:started', session);
    });

    context.bus.on('talk:stop', async (...args: unknown[]) => {
      const [sessionId] = args as [string];
      const session = this.stopSession(sessionId);
      if (session) {
        await context.bus.emit('talk:stopped', session);
      }
    });

    context.bus.on('talk:transcription', async (...args: unknown[]) => {
      const [sessionId, text, confidence, isFinal] = args as [string, string, number, boolean];
      this.addTranscription(sessionId, text, confidence, isFinal);
      if (isFinal) {
        await context.bus.emit('talk:final-transcription', sessionId, text);
      }
    });

    context.bus.on('talk:sessions', async (...args: unknown[]) => {
      const [callback] = args as [(sessions: VoiceSession[]) => void];
      callback(this.getActiveSessions());
    });

    context.logger.info('Talk Voice initialized');
  }

  async destroy(): Promise<void> {
    this.sessions.clear();
    this.ctx?.logger.info('Talk Voice destroyed');
  }

  startSession(sessionId: string, userId: string, language?: string): VoiceSession {
    const now = Date.now();
    const session: VoiceSession = {
      sessionId,
      userId,
      language: language ?? 'en-US',
      active: true,
      startedAt: now,
      lastActivityAt: now,
      transcriptions: [],
    };

    this.sessions.set(sessionId, session);
    this.ctx?.logger.info(`Voice session started: ${sessionId} (user: ${userId}, lang: ${session.language})`);
    return session;
  }

  stopSession(sessionId: string): VoiceSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.active = false;
    this.ctx?.logger.info(`Voice session stopped: ${sessionId} (${session.transcriptions.length} transcriptions)`);
    return session;
  }

  addTranscription(sessionId: string, text: string, confidence: number, isFinal: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return;

    session.lastActivityAt = Date.now();
    session.transcriptions.push({
      text,
      confidence,
      timestamp: Date.now(),
      isFinal,
    });
  }

  getSession(sessionId: string): VoiceSession | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSessions(): VoiceSession[] {
    return Array.from(this.sessions.values()).filter(s => s.active);
  }

  getTranscript(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';

    return session.transcriptions
      .filter(t => t.isFinal)
      .map(t => t.text)
      .join(' ');
  }
}

export default new TalkVoiceExtension();
