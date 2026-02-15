import type { Skill } from '@hydraclaw/skills';

const codingAgentSkill: Skill = {
  id: 'coding-agent',
  name: 'Coding Agent',
  description: 'Write, review, debug, and refactor code across multiple languages',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/code', description: 'Code writing and editing' },
    { type: 'command', pattern: '/review', description: 'Code review' },
    { type: 'command', pattern: '/debug', description: 'Debug code' },
    { type: 'command', pattern: '/refactor', description: 'Refactor code' },
    { type: 'keyword', pattern: 'code,debug,refactor,review code,lint,syntax error,compile', description: 'Coding keywords' },
  ],

  tools: [
    {
      name: 'code_write',
      description: 'Generate code based on a description and language',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What the code should do' },
          language: { type: 'string', description: 'Programming language (e.g., typescript, python, rust)' },
          context: { type: 'string', description: 'Existing code context or file contents' },
          style: { type: 'string', enum: ['concise', 'documented', 'production'], description: 'Code style preference' },
        },
        required: ['description', 'language'],
      },
      async handler(args) {
        const { description, language, context, style } = args as {
          description: string; language: string; context?: string; style?: string;
        };

        const codeStyle = style ?? 'production';
        const lines: string[] = [];

        lines.push(`// Language: ${language}`);
        lines.push(`// Description: ${description}`);
        lines.push(`// Style: ${codeStyle}`);

        if (context) {
          lines.push(`// Context provided: ${context.length} characters`);
        }

        lines.push('');
        lines.push(`// [Code generation requires an LLM provider. This tool prepares the prompt]`);
        lines.push(`// The coding agent will use the active AI provider to generate ${language} code`);
        lines.push(`// matching the "${codeStyle}" style for: ${description}`);

        return lines.join('\n');
      },
    },
    {
      name: 'code_review',
      description: 'Review code for bugs, security issues, and best practices',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to review' },
          language: { type: 'string', description: 'Programming language' },
          focus: {
            type: 'array',
            items: { type: 'string', enum: ['bugs', 'security', 'performance', 'style', 'all'] },
            description: 'Review focus areas',
          },
        },
        required: ['code'],
      },
      async handler(args) {
        const { code, language, focus } = args as {
          code: string; language?: string; focus?: string[];
        };

        const areas = focus ?? ['all'];
        const issues: string[] = [];

        // Static analysis heuristics
        const lines = code.split('\n');

        // Check for common issues
        if (code.includes('eval(')) {
          issues.push('[SECURITY] Use of eval() detected - potential code injection risk');
        }
        if (code.includes('TODO') || code.includes('FIXME') || code.includes('HACK')) {
          const todoCount = (code.match(/TODO|FIXME|HACK/g) ?? []).length;
          issues.push(`[STYLE] ${todoCount} TODO/FIXME/HACK comment(s) found`);
        }
        if (lines.some(l => l.length > 120)) {
          issues.push('[STYLE] Lines exceeding 120 characters detected');
        }
        if (code.includes('console.log') && language?.toLowerCase() !== 'javascript') {
          issues.push('[STYLE] console.log statements found - consider using a proper logger');
        }
        if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(code)) {
          issues.push('[BUGS] Empty catch block detected - errors are silently swallowed');
        }
        if (/password|secret|api_key|apikey/i.test(code) && /['"]\w{8,}['"]/.test(code)) {
          issues.push('[SECURITY] Possible hardcoded secret or credential detected');
        }
        if (code.includes('any') && language?.toLowerCase() === 'typescript') {
          const anyCount = (code.match(/:\s*any\b/g) ?? []).length;
          if (anyCount > 0) {
            issues.push(`[STYLE] ${anyCount} usage(s) of "any" type - consider using specific types`);
          }
        }

        if (issues.length === 0) {
          return `Code review complete (${language ?? 'unknown language'}, focus: ${areas.join(', ')}). No issues found by static analysis. Consider running the full review through the AI provider for deeper analysis.`;
        }

        return [
          `Code review (${language ?? 'unknown language'}, focus: ${areas.join(', ')}):`,
          '',
          ...issues.map((issue, i) => `${i + 1}. ${issue}`),
          '',
          `${issues.length} issue(s) found. For comprehensive review, the AI provider will perform deeper semantic analysis.`,
        ].join('\n');
      },
    },
    {
      name: 'code_debug',
      description: 'Analyze code and error messages to identify and suggest fixes for bugs',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code containing the bug' },
          error: { type: 'string', description: 'Error message or stack trace' },
          language: { type: 'string', description: 'Programming language' },
        },
        required: ['code'],
      },
      async handler(args) {
        const { code, error, language } = args as { code: string; error?: string; language?: string };

        const analysis: string[] = [`Debug analysis (${language ?? 'unknown language'}):`];

        if (error) {
          analysis.push(`\nError: ${error}`);

          // Parse common error patterns
          if (error.includes('TypeError')) {
            analysis.push('Type: TypeError - A value is not of the expected type');
            analysis.push('Common causes: null/undefined access, wrong argument types, missing imports');
          } else if (error.includes('ReferenceError')) {
            analysis.push('Type: ReferenceError - A variable is used but not declared');
            analysis.push('Common causes: typos, missing imports, scoping issues');
          } else if (error.includes('SyntaxError')) {
            analysis.push('Type: SyntaxError - Code cannot be parsed');
            analysis.push('Common causes: missing brackets, invalid syntax, encoding issues');
          } else if (error.includes('RangeError')) {
            analysis.push('Type: RangeError - A value is out of expected range');
            analysis.push('Common causes: infinite recursion, invalid array length, stack overflow');
          }

          // Extract line number from stack trace
          const lineMatch = error.match(/:(\d+):\d+/);
          if (lineMatch) {
            const line = parseInt(lineMatch[1]!, 10);
            const codeLines = code.split('\n');
            if (line > 0 && line <= codeLines.length) {
              analysis.push(`\nRelevant code (line ${line}):`);
              const start = Math.max(0, line - 3);
              const end = Math.min(codeLines.length, line + 2);
              for (let i = start; i < end; i++) {
                const marker = i === line - 1 ? '>>>' : '   ';
                analysis.push(`  ${marker} ${i + 1}: ${codeLines[i]}`);
              }
            }
          }
        }

        analysis.push('\nFor detailed debugging with fix suggestions, the AI provider will analyze the code semantically.');

        return analysis.join('\n');
      },
    },
    {
      name: 'code_refactor',
      description: 'Suggest refactoring improvements for code',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to refactor' },
          language: { type: 'string', description: 'Programming language' },
          goals: {
            type: 'array',
            items: { type: 'string', enum: ['readability', 'performance', 'testability', 'dry', 'simplify'] },
            description: 'Refactoring goals',
          },
        },
        required: ['code'],
      },
      async handler(args) {
        const { code, language, goals } = args as { code: string; language?: string; goals?: string[] };

        const refactorGoals = goals ?? ['readability', 'dry'];
        const suggestions: string[] = [];
        const lines = code.split('\n');

        // Detect long functions
        let braceDepth = 0;
        let functionStart = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/function\s|=>\s*\{|class\s/.test(lines[i]!)) {
            functionStart = i;
          }
          braceDepth += (lines[i]!.match(/\{/g) ?? []).length;
          braceDepth -= (lines[i]!.match(/\}/g) ?? []).length;
          if (braceDepth === 0 && functionStart >= 0) {
            const length = i - functionStart;
            if (length > 50) {
              suggestions.push(`Long function/block (${length} lines) starting at line ${functionStart + 1}. Consider extracting smaller functions.`);
            }
            functionStart = -1;
          }
        }

        // Detect code duplication (simple substring matching)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!.trim();
          if (line.length < 20) continue;
          let dupeCount = 0;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j]!.trim() === line) dupeCount++;
          }
          if (dupeCount >= 2) {
            suggestions.push(`Duplicated code at line ${i + 1} appears ${dupeCount + 1} times. Consider extracting to a shared function.`);
          }
        }

        // Check nesting depth
        let maxNesting = 0;
        let currentNesting = 0;
        for (const line of lines) {
          currentNesting += (line.match(/\{/g) ?? []).length;
          currentNesting -= (line.match(/\}/g) ?? []).length;
          maxNesting = Math.max(maxNesting, currentNesting);
        }
        if (maxNesting > 4) {
          suggestions.push(`Deep nesting detected (${maxNesting} levels). Consider early returns, guard clauses, or extracting logic.`);
        }

        if (suggestions.length === 0) {
          return `Refactoring analysis (${language ?? 'unknown'}, goals: ${refactorGoals.join(', ')}): No obvious structural issues found. The AI provider can perform deeper semantic refactoring.`;
        }

        return [
          `Refactoring suggestions (${language ?? 'unknown'}, goals: ${refactorGoals.join(', ')}):`,
          '',
          ...suggestions.map((s, i) => `${i + 1}. ${s}`),
          '',
          'For complete refactoring with rewritten code, the AI provider will perform semantic analysis.',
        ].join('\n');
      },
    },
  ],

  systemPromptAddition: 'You have access to coding tools for writing, reviewing, debugging, and refactoring code. Use /code, /review, /debug, or /refactor commands.',

  async init() {
    // No external dependencies required
  },
};

export default codingAgentSkill;
