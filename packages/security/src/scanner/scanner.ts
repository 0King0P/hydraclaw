import type { HydraClawConfig } from '@hydraclaw/core';
import type { ScanReport, ScanFinding } from '../types.js';

export class VulnerabilityScanner {
  scan(config: HydraClawConfig): ScanReport {
    const findings: ScanFinding[] = [];

    findings.push(...this.checkTools(config));
    findings.push(...this.checkGateway(config));
    findings.push(...this.checkProviders(config));
    findings.push(...this.checkAgent(config));
    findings.push(...this.checkSecurity(config));

    const summary = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    };

    return { timestamp: Date.now(), findings, summary };
  }

  private checkTools(config: HydraClawConfig): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const tools = config.tools;

    if (Object.keys(tools).length === 0) {
      findings.push({
        severity: 'critical',
        category: 'tools',
        title: 'No tools configured - all tools auto-loaded',
        description: 'When no tools are specified in config, ALL available tools are auto-loaded without restrictions.',
        recommendation: 'Explicitly list the tools you need and disable those you do not.',
      });
    }

    if (tools.shell?.enabled !== false) {
      findings.push({
        severity: 'critical',
        category: 'tools',
        title: 'Unrestricted shell access enabled',
        description: 'The shell tool allows execution of arbitrary system commands without any restrictions.',
        recommendation: 'Enable security.toolPolicies.shell with blockedCommands and allowedPaths, or disable the shell tool.',
      });
    }

    if (tools.filesystem?.enabled !== false) {
      findings.push({
        severity: 'high',
        category: 'tools',
        title: 'Unrestricted filesystem access enabled',
        description: 'The filesystem tool allows reading, writing, and deleting any file on the system.',
        recommendation: 'Enable security.toolPolicies.filesystem with allowedPaths and blockedPaths restrictions.',
      });
    }

    if (tools.browser?.enabled !== false) {
      findings.push({
        severity: 'medium',
        category: 'tools',
        title: 'Unrestricted browser access enabled',
        description: 'The browser tool can navigate to any URL including file:// and local resources.',
        recommendation: 'Enable security.toolPolicies.browser with blockedUrls to block file://, chrome://, and dangerous protocols.',
      });
    }

    if (tools['code-runner']?.enabled !== false) {
      findings.push({
        severity: 'critical',
        category: 'tools',
        title: 'Unrestricted code execution enabled',
        description: 'The code runner can execute arbitrary Python, Node.js, and Bash code without restrictions.',
        recommendation: 'Enable security.toolPolicies.codeRunner with allowedLanguages and maxTimeout.',
      });
    }

    if (tools.database?.enabled !== false) {
      findings.push({
        severity: 'high',
        category: 'tools',
        title: 'Unrestricted database access enabled',
        description: 'The database tool allows execution of any SQL statement including DROP and TRUNCATE.',
        recommendation: 'Enable security.toolPolicies.database with readOnly mode or blockedStatements.',
      });
    }

    if (tools.docker?.enabled !== false) {
      findings.push({
        severity: 'high',
        category: 'tools',
        title: 'Docker access enabled',
        description: 'The docker tool allows container management which may enable privilege escalation.',
        recommendation: 'Disable docker tool unless specifically needed.',
      });
    }

    return findings;
  }

  private checkGateway(config: HydraClawConfig): ScanFinding[] {
    const findings: ScanFinding[] = [];

    if (config.gateway.host === '0.0.0.0') {
      findings.push({
        severity: 'medium',
        category: 'gateway',
        title: 'Gateway bound to all interfaces',
        description: 'The gateway is listening on 0.0.0.0, exposing it to all network interfaces.',
        recommendation: 'Bind to 127.0.0.1 if only local access is needed, or use a reverse proxy with authentication.',
      });
    }

    return findings;
  }

  private checkProviders(config: HydraClawConfig): ScanFinding[] {
    const findings: ScanFinding[] = [];

    for (const [id, providerConfig] of Object.entries(config.providers)) {
      const provider = providerConfig as any;
      if (provider.apiKey && !provider.apiKey.startsWith('${')) {
        findings.push({
          severity: 'high',
          category: 'providers',
          title: `API key hardcoded for provider: ${id}`,
          description: `The API key for "${id}" is hardcoded in the config file instead of using environment variable interpolation.`,
          recommendation: 'Use environment variable interpolation: apiKey: "${PROVIDER_API_KEY}"',
        });
      }
    }

    return findings;
  }

  private checkAgent(config: HydraClawConfig): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const prompt = config.agent.systemPrompt.toLowerCase();

    if (prompt.includes('unrestricted') || prompt.includes('no content filter') || prompt.includes('no limitation')) {
      findings.push({
        severity: 'medium',
        category: 'agent',
        title: 'System prompt declares no restrictions',
        description: 'The system prompt explicitly tells the AI it has no content filters or limitations.',
        recommendation: 'Consider adding security-focused instructions to the system prompt when security mode is enabled.',
      });
    }

    if (config.agent.maxHistory > 200) {
      findings.push({
        severity: 'low',
        category: 'agent',
        title: 'Large conversation history window',
        description: `maxHistory is set to ${config.agent.maxHistory}, which increases context window usage and potential attack surface.`,
        recommendation: 'Consider reducing maxHistory to 50-100 for most use cases.',
      });
    }

    return findings;
  }

  private checkSecurity(config: HydraClawConfig): ScanFinding[] {
    const findings: ScanFinding[] = [];

    const sec = config.security as Record<string, unknown> | undefined;
    if (!sec || !sec.enabled) {
      findings.push({
        severity: 'info',
        category: 'security',
        title: 'Security module not enabled',
        description: 'The security module is not configured. All tool calls execute without validation.',
        recommendation: 'Add a "security:" section to your config.yaml and set enabled: true.',
      });
    } else {
      const pi = sec.promptInjection as Record<string, unknown> | undefined;
      if (!pi || !pi.enabled) {
        findings.push({
          severity: 'low',
          category: 'security',
          title: 'Prompt injection detection disabled',
          description: 'Security is enabled but prompt injection detection is turned off.',
          recommendation: 'Set security.promptInjection.enabled: true to detect injection attempts.',
        });
      }

      const audit = sec.audit as Record<string, unknown> | undefined;
      if (!audit || !audit.enabled) {
        findings.push({
          severity: 'low',
          category: 'security',
          title: 'Audit logging disabled',
          description: 'Security is enabled but audit logging is off. Security events are not being recorded.',
          recommendation: 'Set security.audit.enabled: true with a logFile path.',
        });
      }
    }

    return findings;
  }
}
