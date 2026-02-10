import type { SecurityDetection, MessageScanResult } from '../types.js';
import { INJECTION_PATTERNS, type InjectionPattern } from './patterns.js';

export class PromptInjectionDetector {
  private patterns: InjectionPattern[];

  constructor(customPatterns?: string[]) {
    this.patterns = [...INJECTION_PATTERNS];

    if (customPatterns) {
      for (const p of customPatterns) {
        this.patterns.push({
          id: `custom_${this.patterns.length}`,
          name: 'Custom Pattern',
          severity: 'medium',
          pattern: new RegExp(p, 'i'),
          description: `User-defined pattern: ${p}`,
        });
      }
    }
  }

  scan(text: string, source: SecurityDetection['source']): MessageScanResult {
    const detections: SecurityDetection[] = [];

    for (const pattern of this.patterns) {
      if (pattern.pattern.test(text)) {
        detections.push({
          type: 'prompt_injection',
          severity: pattern.severity,
          description: pattern.description,
          matchedPattern: pattern.id,
          source,
        });
      }
    }

    return {
      safe: detections.length === 0,
      detections,
    };
  }

  scanToolResult(content: string): MessageScanResult {
    return this.scan(content, 'tool_result');
  }

  scanMessage(content: string): MessageScanResult {
    return this.scan(content, 'user_message');
  }
}
