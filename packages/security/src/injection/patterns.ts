export interface InjectionPattern {
  id: string;
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern: RegExp;
  description: string;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  // ── Role Confusion / Instruction Override ──
  {
    id: 'ignore_instructions',
    name: 'Ignore Previous Instructions',
    severity: 'high',
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions|directives|rules|prompts)/i,
    description: 'Attempts to override system prompt by telling the AI to ignore previous instructions',
  },
  {
    id: 'new_identity',
    name: 'Identity Reassignment',
    severity: 'high',
    pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,
    description: 'Attempts to reassign the AI identity',
  },
  {
    id: 'act_as',
    name: 'Role Play Injection',
    severity: 'medium',
    pattern: /(act|behave|respond|pretend|roleplay)\s+(as|like)\s+(a|an|the|if\s+you\s+were)\s+/i,
    description: 'Attempts to make the AI adopt a different persona',
  },
  {
    id: 'system_prompt_override',
    name: 'System Prompt Override',
    severity: 'critical',
    pattern: /\[?(system|SYSTEM)\]?\s*:?\s*(prompt|message|instruction)/i,
    description: 'Attempts to inject a fake system message',
  },
  {
    id: 'jailbreak_dan',
    name: 'DAN-style Jailbreak',
    severity: 'high',
    pattern: /(do\s+anything\s+now|DAN\s+mode|jailbreak\s+mode|developer\s+mode|sudo\s+mode)/i,
    description: 'Common jailbreak prompt patterns',
  },
  {
    id: 'forget_rules',
    name: 'Forget Rules Attack',
    severity: 'high',
    pattern: /(forget|disregard|discard|abandon|drop)\s+(all\s+)?(your\s+)?(rules|guidelines|restrictions|safety|constraints)/i,
    description: 'Attempts to make the AI forget its rules',
  },

  // ── Encoding / Obfuscation Tricks ──
  {
    id: 'unicode_hidden',
    name: 'Hidden Unicode Characters',
    severity: 'medium',
    pattern: /[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/,
    description: 'Hidden unicode characters that may conceal injected text',
  },
  {
    id: 'base64_decode',
    name: 'Base64 Decode Instruction',
    severity: 'medium',
    pattern: /(?:decode|base64|atob)\s*\(\s*['"][A-Za-z0-9+/]+=*['"]\s*\)/i,
    description: 'Attempts to hide instructions via base64 encoding',
  },

  // ── Delimiter Manipulation ──
  {
    id: 'xml_tag_injection',
    name: 'XML/Prompt Tag Injection',
    severity: 'high',
    pattern: /<\/?(?:system|instruction|prompt|human|assistant|tool_result|function_call|tool_use)>/i,
    description: 'Attempts to inject fake XML tags that mimic prompt structure',
  },
  {
    id: 'markdown_system_block',
    name: 'Markdown System Block',
    severity: 'medium',
    pattern: /```(?:system|instruction|admin)[\s\S]*?```/i,
    description: 'Attempts to use markdown code blocks to inject system-level content',
  },

  // ── Data Exfiltration ──
  {
    id: 'exfiltrate_prompt',
    name: 'System Prompt Exfiltration',
    severity: 'high',
    pattern: /(repeat|output|print|return|show|display|echo|reveal|tell\s+me)\s+(the\s+)?(system\s+prompt|system\s+message|initial\s+instructions|your\s+instructions|your\s+rules)/i,
    description: 'Attempts to extract the system prompt',
  },

  // ── Tool Result Injection ──
  {
    id: 'tool_result_override',
    name: 'Tool Result Command Injection',
    severity: 'critical',
    pattern: /(?:IMPORTANT|URGENT|OVERRIDE|INSTRUCTION|NOTE\s+TO\s+AI|ATTENTION\s+AI):\s*(?:ignore|disregard|forget|override|you\s+must|execute|run)/i,
    description: 'Tool results containing injected instructions for the AI',
  },
  {
    id: 'fake_error_redirect',
    name: 'Fake Error Redirect',
    severity: 'high',
    pattern: /(?:ERROR|CRITICAL|WARNING):\s*(?:you\s+must|please\s+execute|run\s+the\s+following|instead\s+do|new\s+instructions)/i,
    description: 'Fake error messages containing injected instructions',
  },
];
