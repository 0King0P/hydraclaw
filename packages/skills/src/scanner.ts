import type { Logger } from '@hydraclaw/core';
import type { Skill } from './types.js';

export interface ScanResult {
  skillId: string;
  passed: boolean;
  warnings: string[];
  errors: string[];
}

export interface PermissionCheckResult {
  skillId: string;
  allowed: boolean;
  requestedPermissions: string[];
  deniedPermissions: string[];
}

/** Patterns that indicate potentially dangerous code in skill handlers. */
const DANGEROUS_PATTERNS: { pattern: RegExp; description: string; severity: 'warning' | 'error' }[] = [
  {
    pattern: /\beval\s*\(/,
    description: 'Use of eval() is a code injection risk',
    severity: 'error',
  },
  {
    pattern: /new\s+Function\s*\(/,
    description: 'Dynamic Function constructor can execute arbitrary code',
    severity: 'error',
  },
  {
    pattern: /child_process/,
    description: 'Access to child_process can execute system commands',
    severity: 'warning',
  },
  {
    pattern: /process\.env/,
    description: 'Direct access to environment variables may leak secrets',
    severity: 'warning',
  },
  {
    pattern: /require\s*\(\s*['"`]fs['"`]\s*\)/,
    description: 'Direct filesystem access via require("fs")',
    severity: 'warning',
  },
  {
    pattern: /import\s*\(\s*['"`]fs['"`]\s*\)/,
    description: 'Direct filesystem access via dynamic import("fs")',
    severity: 'warning',
  },
  {
    pattern: /process\.exit/,
    description: 'Calling process.exit() can terminate the host process',
    severity: 'error',
  },
  {
    pattern: /global\s*\.\s*\w+\s*=/,
    description: 'Modification of global scope can affect other skills',
    severity: 'warning',
  },
  {
    pattern: /crypto\.createCipher\b/,
    description: 'Use of deprecated crypto.createCipher (use createCipheriv)',
    severity: 'warning',
  },
  {
    pattern: /\.exec\s*\(/,
    description: 'exec() calls may run shell commands',
    severity: 'warning',
  },
];

/** Allowed permissions that a skill can request. */
const VALID_PERMISSIONS = new Set([
  'network',
  'filesystem:read',
  'filesystem:write',
  'env:read',
  'shell:exec',
  'database:read',
  'database:write',
  'clipboard',
  'notifications',
  'media:audio',
  'media:video',
  'camera',
  'location',
]);

export class SkillScanner {
  private logger: Logger;
  private allowedPermissions: Set<string>;

  constructor(logger: Logger, allowedPermissions?: string[]) {
    this.logger = logger;
    this.allowedPermissions = new Set(allowedPermissions ?? [...VALID_PERMISSIONS]);
  }

  /**
   * Scan a skill for potentially dangerous patterns. Inspects all tool handler
   * function bodies and the systemPromptAddition for suspicious content.
   */
  scan(skill: Skill): ScanResult {
    const result: ScanResult = {
      skillId: skill.id,
      passed: true,
      warnings: [],
      errors: [],
    };

    this.logger.debug(`Scanning skill "${skill.id}" for security issues`);

    // Scan tool handler function bodies
    if (skill.tools) {
      for (const tool of skill.tools) {
        const handlerSource = tool.handler.toString();
        this.scanSource(handlerSource, `tool "${tool.name}"`, result);
      }
    }

    // Scan system prompt addition for injection attempts
    if (skill.systemPromptAddition) {
      this.scanPromptInjection(skill.systemPromptAddition, result);
    }

    // Scan init and destroy methods if present
    if (skill.init) {
      this.scanSource(skill.init.toString(), 'init()', result);
    }
    if (skill.destroy) {
      this.scanSource(skill.destroy.toString(), 'destroy()', result);
    }

    result.passed = result.errors.length === 0;

    if (result.passed) {
      this.logger.info(`Skill "${skill.id}" passed security scan with ${result.warnings.length} warning(s)`);
    } else {
      this.logger.warn(`Skill "${skill.id}" FAILED security scan: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    }

    return result;
  }

  /**
   * Validate that the permissions requested by a skill are within the allowed set.
   */
  validatePermissions(skill: Skill): PermissionCheckResult {
    const requestedPermissions = this.inferPermissions(skill);
    const deniedPermissions = requestedPermissions.filter(p => !this.allowedPermissions.has(p));

    const checkResult: PermissionCheckResult = {
      skillId: skill.id,
      allowed: deniedPermissions.length === 0,
      requestedPermissions,
      deniedPermissions,
    };

    if (!checkResult.allowed) {
      this.logger.warn(
        `Skill "${skill.id}" requests denied permissions: ${deniedPermissions.join(', ')}`
      );
    }

    return checkResult;
  }

  /**
   * Scan a source code string against known dangerous patterns.
   */
  private scanSource(source: string, context: string, result: ScanResult): void {
    for (const check of DANGEROUS_PATTERNS) {
      if (check.pattern.test(source)) {
        const message = `[${context}] ${check.description}`;
        if (check.severity === 'error') {
          result.errors.push(message);
        } else {
          result.warnings.push(message);
        }
      }
    }
  }

  /**
   * Scan a system prompt addition for common prompt injection patterns.
   */
  private scanPromptInjection(prompt: string, result: ScanResult): void {
    const injectionPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /forget\s+(all\s+)?previous\s+(instructions|context)/i,
      /you\s+are\s+now\s+/i,
      /new\s+instructions?\s*:/i,
      /system\s*:\s*override/i,
      /disregard\s+(all\s+)?(prior|previous)/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(prompt)) {
        result.errors.push(`Potential prompt injection detected in systemPromptAddition: matches ${pattern.source}`);
      }
    }
  }

  /**
   * Infer what permissions a skill needs based on its tool handlers and code patterns.
   */
  private inferPermissions(skill: Skill): string[] {
    const permissions = new Set<string>();
    const sources: string[] = [];

    if (skill.tools) {
      for (const tool of skill.tools) {
        sources.push(tool.handler.toString());
      }
    }
    if (skill.init) sources.push(skill.init.toString());
    if (skill.destroy) sources.push(skill.destroy.toString());

    const combined = sources.join('\n');

    if (/fetch\s*\(|https?:|axios|got\b|request\s*\(/.test(combined)) {
      permissions.add('network');
    }
    if (/readFile|readdir|createReadStream|fs\.read/.test(combined)) {
      permissions.add('filesystem:read');
    }
    if (/writeFile|mkdir|createWriteStream|fs\.write|appendFile/.test(combined)) {
      permissions.add('filesystem:write');
    }
    if (/process\.env/.test(combined)) {
      permissions.add('env:read');
    }
    if (/child_process|exec\s*\(|spawn\s*\(|execSync/.test(combined)) {
      permissions.add('shell:exec');
    }
    if (/clipboard/.test(combined)) {
      permissions.add('clipboard');
    }
    if (/notification|Notification/.test(combined)) {
      permissions.add('notifications');
    }

    return Array.from(permissions);
  }
}
