export interface SecurityConfig {
  enabled: boolean;
  promptInjection: {
    enabled: boolean;
    action: 'warn' | 'block';
    customPatterns?: string[];
  };
  toolPolicies: {
    shell?: ShellPolicy;
    filesystem?: FilesystemPolicy;
    browser?: BrowserPolicy;
    codeRunner?: CodeRunnerPolicy;
    database?: DatabasePolicy;
  };
  audit: {
    enabled: boolean;
    logFile: string;
  };
}

export interface ShellPolicy {
  blockedCommands: string[];
  allowedPaths?: string[];
  blockedPatterns?: string[];
}

export interface FilesystemPolicy {
  allowedPaths: string[];
  blockedPaths: string[];
  readOnly: boolean;
}

export interface BrowserPolicy {
  blockedUrls: string[];
  allowedUrls?: string[];
}

export interface CodeRunnerPolicy {
  allowedLanguages: string[];
  maxTimeout: number;
}

export interface DatabasePolicy {
  readOnly: boolean;
  blockedStatements?: string[];
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enabled: false,
  promptInjection: {
    enabled: false,
    action: 'warn',
  },
  toolPolicies: {},
  audit: {
    enabled: false,
    logFile: './data/security-audit.log',
  },
};
