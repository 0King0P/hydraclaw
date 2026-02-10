import type { ToolCall } from '@hydraclaw/core';
import type { SecurityConfig } from '../config.js';
import type { PolicyViolation, SecurityVerdict } from '../types.js';
import { resolve, normalize } from 'node:path';

export class ToolPolicyEngine {
  private policies: SecurityConfig['toolPolicies'];

  constructor(policies: SecurityConfig['toolPolicies']) {
    this.policies = policies;
  }

  validate(call: ToolCall): SecurityVerdict {
    const violations: PolicyViolation[] = [];

    if (call.name.startsWith('shell_')) {
      violations.push(...this.checkShell(call));
    } else if (call.name.startsWith('fs_')) {
      violations.push(...this.checkFilesystem(call));
    } else if (call.name.startsWith('browser_')) {
      violations.push(...this.checkBrowser(call));
    } else if (call.name.startsWith('code_run_')) {
      violations.push(...this.checkCodeRunner(call));
    } else if (call.name.startsWith('db_')) {
      violations.push(...this.checkDatabase(call));
    }

    if (violations.length === 0) {
      return { action: 'allow' };
    }

    return {
      action: 'block',
      reason: violations.map(v => v.description).join('; '),
      policyViolations: violations,
    };
  }

  private checkShell(call: ToolCall): PolicyViolation[] {
    const policy = this.policies.shell;
    if (!policy) return [];

    const violations: PolicyViolation[] = [];
    const args = call.arguments as { command?: string; cwd?: string };
    const command = args.command ?? '';

    for (const blocked of policy.blockedCommands) {
      if (command.includes(blocked)) {
        violations.push({
          toolName: call.name,
          rule: 'blockedCommands',
          description: `Command contains blocked pattern: "${blocked}"`,
          blockedValue: command,
        });
      }
    }

    if (policy.blockedPatterns) {
      for (const pattern of policy.blockedPatterns) {
        if (new RegExp(pattern, 'i').test(command)) {
          violations.push({
            toolName: call.name,
            rule: 'blockedPatterns',
            description: `Command matches blocked pattern: ${pattern}`,
            blockedValue: command,
          });
        }
      }
    }

    if (policy.allowedPaths && args.cwd) {
      const normalizedCwd = normalize(resolve(args.cwd));
      const allowed = policy.allowedPaths.some(p =>
        normalizedCwd.startsWith(normalize(resolve(p)))
      );
      if (!allowed) {
        violations.push({
          toolName: call.name,
          rule: 'allowedPaths',
          description: `Working directory "${args.cwd}" is not in allowed paths`,
          blockedValue: args.cwd,
        });
      }
    }

    return violations;
  }

  private checkFilesystem(call: ToolCall): PolicyViolation[] {
    const policy = this.policies.filesystem;
    if (!policy) return [];

    const violations: PolicyViolation[] = [];
    const args = call.arguments as { path?: string; src?: string; dest?: string };
    const paths = [args.path, args.src, args.dest].filter(Boolean) as string[];

    const writeOps = ['fs_write', 'fs_delete', 'fs_mkdir', 'fs_copy', 'fs_move'];
    if (policy.readOnly && writeOps.includes(call.name)) {
      violations.push({
        toolName: call.name,
        rule: 'readOnly',
        description: `Write operation "${call.name}" blocked: filesystem is in read-only mode`,
      });
    }

    for (const p of paths) {
      const normalizedPath = normalize(resolve(p));

      for (const blocked of policy.blockedPaths) {
        const normalizedBlocked = normalize(resolve(blocked));
        if (normalizedPath.startsWith(normalizedBlocked) || normalizedPath === normalizedBlocked) {
          violations.push({
            toolName: call.name,
            rule: 'blockedPaths',
            description: `Path "${p}" is in blocked paths list`,
            blockedValue: p,
          });
        }
      }

      if (policy.allowedPaths.length > 0) {
        const allowed = policy.allowedPaths.some(ap =>
          normalizedPath.startsWith(normalize(resolve(ap)))
        );
        if (!allowed) {
          violations.push({
            toolName: call.name,
            rule: 'allowedPaths',
            description: `Path "${p}" is not in allowed paths list`,
            blockedValue: p,
          });
        }
      }
    }

    return violations;
  }

  private checkBrowser(call: ToolCall): PolicyViolation[] {
    const policy = this.policies.browser;
    if (!policy) return [];

    const violations: PolicyViolation[] = [];

    if (call.name === 'browser_navigate') {
      const args = call.arguments as { url?: string };
      const url = args.url ?? '';

      for (const blocked of policy.blockedUrls) {
        if (url.toLowerCase().startsWith(blocked.toLowerCase())) {
          violations.push({
            toolName: call.name,
            rule: 'blockedUrls',
            description: `URL matches blocked prefix: "${blocked}"`,
            blockedValue: url,
          });
        }
      }

      if (policy.allowedUrls && policy.allowedUrls.length > 0) {
        const allowed = policy.allowedUrls.some(a =>
          url.toLowerCase().startsWith(a.toLowerCase())
        );
        if (!allowed) {
          violations.push({
            toolName: call.name,
            rule: 'allowedUrls',
            description: `URL "${url}" is not in allowed URLs list`,
            blockedValue: url,
          });
        }
      }
    }

    return violations;
  }

  private checkCodeRunner(call: ToolCall): PolicyViolation[] {
    const policy = this.policies.codeRunner;
    if (!policy) return [];

    const violations: PolicyViolation[] = [];
    const languageMap: Record<string, string> = {
      code_run_python: 'python',
      code_run_node: 'node',
      code_run_bash: 'bash',
    };

    const language = languageMap[call.name];
    if (language && !policy.allowedLanguages.includes(language)) {
      violations.push({
        toolName: call.name,
        rule: 'allowedLanguages',
        description: `Language "${language}" is not in allowed languages list`,
        blockedValue: language,
      });
    }

    return violations;
  }

  private checkDatabase(call: ToolCall): PolicyViolation[] {
    const policy = this.policies.database;
    if (!policy) return [];

    const violations: PolicyViolation[] = [];
    const args = call.arguments as { query?: string };
    const query = args.query ?? '';

    if (policy.readOnly && call.name === 'db_execute') {
      violations.push({
        toolName: call.name,
        rule: 'readOnly',
        description: `Write operation "${call.name}" blocked: database is in read-only mode`,
      });
    }

    if (policy.blockedStatements) {
      const upperQuery = query.toUpperCase().trim();
      for (const stmt of policy.blockedStatements) {
        const upper = stmt.toUpperCase();
        if (upperQuery.startsWith(upper) || upperQuery.includes(` ${upper} `) || upperQuery.includes(` ${upper};`)) {
          violations.push({
            toolName: call.name,
            rule: 'blockedStatements',
            description: `SQL statement contains blocked keyword: "${stmt}"`,
            blockedValue: query,
          });
        }
      }
    }

    return violations;
  }
}
