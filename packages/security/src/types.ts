export type SecurityAction = 'allow' | 'warn' | 'block';

export interface SecurityVerdict {
  action: SecurityAction;
  reason?: string;
  detections?: SecurityDetection[];
  policyViolations?: PolicyViolation[];
}

export interface SecurityDetection {
  type: 'prompt_injection' | 'policy_violation' | 'suspicious_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  matchedPattern?: string;
  source: 'user_message' | 'tool_result' | 'tool_call';
}

export interface PolicyViolation {
  toolName: string;
  rule: string;
  description: string;
  blockedValue?: string;
}

export interface AuditEvent {
  timestamp: number;
  type:
    | 'tool_call_blocked'
    | 'tool_call_warned'
    | 'tool_call_allowed'
    | 'injection_detected'
    | 'injection_blocked'
    | 'message_scanned'
    | 'scanner_report';
  details: Record<string, unknown>;
}

export interface ScanFinding {
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  recommendation: string;
}

export interface ScanReport {
  timestamp: number;
  findings: ScanFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

export interface MessageScanResult {
  safe: boolean;
  detections: SecurityDetection[];
}
