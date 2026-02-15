import type { Skill } from '@hydraclaw/skills';

const summarizeSkill: Skill = {
  id: 'summarize',
  name: 'Summarize',
  description: 'Summarize text, URLs, and documents into concise overviews',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/summarize', description: 'Summarize content' },
    { type: 'command', pattern: '/tldr', description: 'Quick summary shorthand' },
    { type: 'keyword', pattern: 'summarize,summary,tldr,tl;dr,recap', description: 'Summary-related keywords' },
    { type: 'regex', pattern: 'summarize\\s+(this|that|the)', description: 'Summarize request pattern' },
  ],

  tools: [
    {
      name: 'summarize_text',
      description: 'Summarize a block of text into key points',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text content to summarize' },
          maxLength: { type: 'number', description: 'Maximum summary length in words' },
          style: { type: 'string', enum: ['bullets', 'paragraph', 'headline'], description: 'Output format style' },
        },
        required: ['text'],
      },
      async handler(args) {
        const { text, maxLength, style } = args as { text: string; maxLength?: number; style?: string };
        const limit = maxLength ?? 150;
        const format = style ?? 'bullets';

        // Extract sentences, rank by position and length heuristics
        const sentences = text
          .replace(/\n+/g, ' ')
          .split(/(?<=[.!?])\s+/)
          .filter(s => s.trim().length > 10);

        if (sentences.length === 0) {
          return 'The provided text is too short to summarize.';
        }

        // Score sentences: higher for first/last, penalize very long ones
        const scored = sentences.map((sentence, index) => {
          let score = 1.0;
          if (index === 0) score += 2.0;
          if (index === sentences.length - 1) score += 1.0;
          if (index < sentences.length * 0.3) score += 0.5;
          const words = sentence.split(/\s+/).length;
          if (words > 40) score -= 0.5;
          if (words < 5) score -= 1.0;
          return { sentence: sentence.trim(), score };
        });

        scored.sort((a, b) => b.score - a.score);

        // Pick top sentences up to word limit
        const selected: string[] = [];
        let wordCount = 0;
        for (const item of scored) {
          const words = item.sentence.split(/\s+/).length;
          if (wordCount + words > limit) break;
          selected.push(item.sentence);
          wordCount += words;
        }

        // Restore original order
        selected.sort((a, b) => {
          const idxA = sentences.indexOf(a);
          const idxB = sentences.indexOf(b);
          return idxA - idxB;
        });

        switch (format) {
          case 'bullets':
            return selected.map(s => `- ${s}`).join('\n');
          case 'headline':
            return selected[0] ?? 'No summary available.';
          case 'paragraph':
          default:
            return selected.join(' ');
        }
      },
    },
    {
      name: 'summarize_url',
      description: 'Fetch a URL and summarize its text content',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch and summarize' },
          maxLength: { type: 'number', description: 'Maximum summary length in words' },
        },
        required: ['url'],
      },
      async handler(args) {
        const { url, maxLength } = args as { url: string; maxLength?: number };

        const response = await fetch(url, {
          headers: { 'User-Agent': 'HydraClaw-Summarizer/1.0' },
        });

        if (!response.ok) {
          return `Error fetching URL: ${response.status} ${response.statusText}`;
        }

        const html = await response.text();

        // Strip HTML tags to extract plain text
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

        if (text.length < 50) {
          return 'The URL content is too short or could not be extracted.';
        }

        // Reuse the text summarization logic
        const textTool = summarizeSkill.tools?.find(t => t.name === 'summarize_text');
        if (textTool) {
          return textTool.handler({ text, maxLength: maxLength ?? 200, style: 'bullets' });
        }

        return text.slice(0, 500) + '...';
      },
    },
  ],

  systemPromptAddition: 'You can summarize long text, web pages, and documents using the Summarize skill. Use /summarize or /tldr commands.',

  async init() {
    // No external dependencies required for basic summarization
  },
};

export default summarizeSkill;
