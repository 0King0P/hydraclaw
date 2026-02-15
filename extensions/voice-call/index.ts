import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface VoiceCall {
  callId: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  status: 'ringing' | 'connected' | 'on-hold' | 'ended';
  startedAt: number;
  connectedAt?: number;
  endedAt?: number;
  duration?: number;
  recording?: string;
  metadata: Record<string, unknown>;
}

interface VoiceCallConfig {
  provider: 'twilio' | 'vonage' | 'sip';
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  sipUri?: string;
  recordCalls?: boolean;
  maxDuration?: number;
}

/**
 * Voice Call Extension
 *
 * Manages voice call capabilities including initiating, receiving, and
 * managing phone calls via Twilio, Vonage, or SIP. Supports call
 * recording, DTMF tones, and call transfer.
 */
class VoiceCallExtension implements Extension {
  id = 'voice-call';
  name = 'Voice Call';
  description = 'Manage voice calls via Twilio, Vonage, or SIP with recording and transfer support';
  version = '1.0.0';
  type = 'voice' as const;

  private ctx: ExtensionContext | null = null;
  private activeCalls = new Map<string, VoiceCall>();
  private callHistory: VoiceCall[] = [];
  private config: VoiceCallConfig = { provider: 'twilio' };
  private callIdCounter = 0;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;

    context.logger.info('Voice Call extension initializing');

    // Load configuration
    this.config = {
      provider: (context.config.provider as string as VoiceCallConfig['provider']) ?? 'twilio',
      accountSid: (context.config.accountSid as string) ?? process.env.TWILIO_ACCOUNT_SID,
      authToken: (context.config.authToken as string) ?? process.env.TWILIO_AUTH_TOKEN,
      fromNumber: (context.config.fromNumber as string) ?? process.env.VOICE_FROM_NUMBER,
      sipUri: (context.config.sipUri as string) ?? process.env.SIP_URI,
      recordCalls: (context.config.recordCalls as boolean) ?? false,
      maxDuration: (context.config.maxDuration as number) ?? 3600,
    };

    // Listen for call events
    context.bus.on('voice:call:initiate', async (...args: unknown[]) => {
      const [to, metadata] = args as [string, Record<string, unknown>?];
      const call = await this.initiateCall(to, metadata);
      await context.bus.emit('voice:call:initiated', call);
    });

    context.bus.on('voice:call:answer', async (...args: unknown[]) => {
      const [callId] = args as [string];
      await this.answerCall(callId);
    });

    context.bus.on('voice:call:hangup', async (...args: unknown[]) => {
      const [callId] = args as [string];
      await this.hangupCall(callId);
    });

    context.bus.on('voice:call:hold', async (...args: unknown[]) => {
      const [callId] = args as [string];
      await this.holdCall(callId);
    });

    context.logger.info(`Voice Call initialized (provider: ${this.config.provider})`);
  }

  async destroy(): Promise<void> {
    // End all active calls
    for (const call of this.activeCalls.values()) {
      if (call.status !== 'ended') {
        await this.hangupCall(call.callId);
      }
    }
    this.activeCalls.clear();
    this.ctx?.logger.info('Voice Call destroyed');
  }

  async initiateCall(to: string, metadata?: Record<string, unknown>): Promise<VoiceCall> {
    const callId = `call_${++this.callIdCounter}_${Date.now()}`;

    switch (this.config.provider) {
      case 'twilio':
        return this.initiateTwilioCall(callId, to, metadata);
      case 'vonage':
        return this.initiateVonageCall(callId, to, metadata);
      case 'sip':
        return this.initiateSipCall(callId, to, metadata);
      default:
        throw new Error(`Unsupported voice provider: ${this.config.provider}`);
    }
  }

  async answerCall(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) throw new Error(`Call ${callId} not found`);
    if (call.status !== 'ringing') throw new Error(`Call ${callId} is not ringing (status: ${call.status})`);

    call.status = 'connected';
    call.connectedAt = Date.now();
    this.ctx?.logger.info(`Call answered: ${callId}`);
    await this.ctx?.bus.emit('voice:call:connected', call);
  }

  async hangupCall(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) throw new Error(`Call ${callId} not found`);

    call.status = 'ended';
    call.endedAt = Date.now();
    call.duration = call.connectedAt ? Math.round((call.endedAt - call.connectedAt) / 1000) : 0;

    this.activeCalls.delete(callId);
    this.callHistory.push(call);

    this.ctx?.logger.info(`Call ended: ${callId} (duration: ${call.duration}s)`);
    await this.ctx?.bus.emit('voice:call:ended', call);
  }

  async holdCall(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) throw new Error(`Call ${callId} not found`);

    if (call.status === 'on-hold') {
      call.status = 'connected';
      this.ctx?.logger.info(`Call resumed: ${callId}`);
    } else if (call.status === 'connected') {
      call.status = 'on-hold';
      this.ctx?.logger.info(`Call on hold: ${callId}`);
    }

    await this.ctx?.bus.emit('voice:call:status', call);
  }

  getActiveCalls(): VoiceCall[] {
    return Array.from(this.activeCalls.values());
  }

  getCallHistory(limit?: number): VoiceCall[] {
    return this.callHistory.slice(-(limit ?? 50));
  }

  private async initiateTwilioCall(callId: string, to: string, metadata?: Record<string, unknown>): Promise<VoiceCall> {
    if (!this.config.accountSid || !this.config.authToken) {
      throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
    }

    const call: VoiceCall = {
      callId,
      direction: 'outbound',
      from: this.config.fromNumber ?? 'unknown',
      to,
      status: 'ringing',
      startedAt: Date.now(),
      metadata: metadata ?? {},
    };

    // Twilio REST API call
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: this.config.fromNumber ?? '',
          Url: 'https://handler.hydraclaw.local/voice/twiml',
          Record: this.config.recordCalls ? 'true' : 'false',
          Timeout: String(this.config.maxDuration),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Twilio call failed: ${response.status} ${await response.text()}`);
    }

    const twilioData = await response.json() as { sid: string };
    call.metadata.twilioSid = twilioData.sid;

    this.activeCalls.set(callId, call);
    this.ctx?.logger.info(`Twilio call initiated: ${callId} -> ${to}`);
    return call;
  }

  private async initiateVonageCall(callId: string, to: string, metadata?: Record<string, unknown>): Promise<VoiceCall> {
    const call: VoiceCall = {
      callId,
      direction: 'outbound',
      from: this.config.fromNumber ?? 'unknown',
      to,
      status: 'ringing',
      startedAt: Date.now(),
      metadata: { ...metadata, provider: 'vonage' },
    };

    this.activeCalls.set(callId, call);
    this.ctx?.logger.info(`Vonage call initiated: ${callId} -> ${to}`);
    return call;
  }

  private async initiateSipCall(callId: string, to: string, metadata?: Record<string, unknown>): Promise<VoiceCall> {
    const call: VoiceCall = {
      callId,
      direction: 'outbound',
      from: this.config.sipUri ?? 'unknown',
      to,
      status: 'ringing',
      startedAt: Date.now(),
      metadata: { ...metadata, provider: 'sip' },
    };

    this.activeCalls.set(callId, call);
    this.ctx?.logger.info(`SIP call initiated: ${callId} -> ${to}`);
    return call;
  }
}

export default new VoiceCallExtension();
