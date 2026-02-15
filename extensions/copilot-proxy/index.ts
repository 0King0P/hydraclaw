import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface CopilotToken {
  token: string;
  expiresAt: number;
  endpoints: {
    api: string;
    proxy: string;
  };
}

interface CopilotSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

/**
 * GitHub Copilot Proxy Extension
 *
 * Provides proxy authentication for GitHub Copilot API access.
 * Handles OAuth device flow authentication, token management,
 * and transparent API proxying for Copilot completions.
 */
class CopilotProxyExtension implements Extension {
  id = 'copilot-proxy';
  name = 'GitHub Copilot Proxy';
  description = 'Proxy authentication and token management for GitHub Copilot API access';
  version = '1.0.0';
  type = 'auth' as const;

  private ctx: ExtensionContext | null = null;
  private currentToken: CopilotToken | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private clientId = 'Iv1.b507a08c87ecfe98'; // GitHub Copilot VS Code client ID

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;

    context.logger.info('Copilot Proxy extension initializing');

    if (context.config.clientId) {
      this.clientId = context.config.clientId as string;
    }

    // Try to authenticate with existing GitHub token
    const ghToken = process.env.GITHUB_COPILOT_TOKEN ?? process.env.GITHUB_TOKEN;
    if (ghToken) {
      try {
        await this.authenticateWithToken(ghToken);
        context.logger.info('Copilot Proxy authenticated with existing token');
      } catch (err) {
        context.logger.warn(`Failed to authenticate with existing token: ${err}`);
      }
    }

    // Listen for auth requests
    context.bus.on('copilot:auth:start', async () => {
      const session = await this.startDeviceFlow();
      await context.bus.emit('copilot:auth:code', session);
    });

    context.bus.on('copilot:auth:poll', async (...args: unknown[]) => {
      const [deviceCode] = args as [string];
      const token = await this.pollDeviceFlow(deviceCode);
      if (token) {
        await context.bus.emit('copilot:auth:success', token);
      }
    });

    context.bus.on('copilot:complete', async (...args: unknown[]) => {
      const [prompt, callback] = args as [string, (result: string | null) => void];
      const result = await this.getCompletion(prompt);
      callback(result);
    });

    context.logger.info('Copilot Proxy initialized');
  }

  async destroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.currentToken = null;
    this.ctx?.logger.info('Copilot Proxy destroyed');
  }

  /**
   * Authenticate using an existing GitHub token to get a Copilot API token.
   */
  async authenticateWithToken(githubToken: string): Promise<CopilotToken> {
    const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/json',
        'Editor-Version': 'HydraClaw/1.0.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Copilot token exchange failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as {
      token: string;
      expires_at: number;
      endpoints: { api: string; proxy: string };
    };

    this.currentToken = {
      token: data.token,
      expiresAt: data.expires_at * 1000,
      endpoints: data.endpoints,
    };

    // Schedule refresh before expiry
    this.scheduleRefresh(githubToken);

    return this.currentToken;
  }

  /**
   * Start the OAuth device flow for authentication.
   */
  async startDeviceFlow(): Promise<CopilotSession> {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        scope: 'copilot',
      }),
    });

    if (!response.ok) {
      throw new Error(`Device flow initiation failed: ${response.status}`);
    }

    const data = await response.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + data.expires_in * 1000,
      interval: data.interval,
    };
  }

  /**
   * Poll for device flow completion.
   */
  async pollDeviceFlow(deviceCode: string): Promise<string | null> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      access_token?: string;
      error?: string;
    };

    if (data.access_token) {
      await this.authenticateWithToken(data.access_token);
      return data.access_token;
    }

    return null;
  }

  /**
   * Get a Copilot completion for the given prompt.
   */
  async getCompletion(prompt: string): Promise<string | null> {
    if (!this.currentToken || Date.now() >= this.currentToken.expiresAt) {
      this.ctx?.logger.warn('Copilot token expired or missing');
      return null;
    }

    const response = await fetch(`${this.currentToken.endpoints.proxy}/v1/engines/copilot-codex/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.currentToken.token}`,
        'Content-Type': 'application/json',
        'Editor-Version': 'HydraClaw/1.0.0',
      },
      body: JSON.stringify({
        prompt,
        max_tokens: 500,
        temperature: 0.2,
        top_p: 0.95,
        n: 1,
        stop: ['\n\n'],
      }),
    });

    if (!response.ok) {
      this.ctx?.logger.error(`Copilot completion failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      choices: { text: string }[];
    };

    return data.choices[0]?.text ?? null;
  }

  isAuthenticated(): boolean {
    return this.currentToken !== null && Date.now() < this.currentToken.expiresAt;
  }

  private scheduleRefresh(githubToken: string): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    if (!this.currentToken) return;

    const refreshIn = Math.max(0, this.currentToken.expiresAt - Date.now() - 5 * 60 * 1000);

    this.refreshTimer = setTimeout(async () => {
      try {
        await this.authenticateWithToken(githubToken);
        this.ctx?.logger.debug('Copilot token refreshed');
      } catch (err) {
        this.ctx?.logger.error(`Copilot token refresh failed: ${err}`);
      }
    }, refreshIn);
  }
}

export default new CopilotProxyExtension();
