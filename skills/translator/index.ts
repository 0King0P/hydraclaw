import type { Skill } from '@hydraclaw/skills';

/** Common language codes mapped to full names. */
const LANGUAGE_MAP: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech',
  el: 'Greek', he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  ms: 'Malay', uk: 'Ukrainian', ro: 'Romanian', hu: 'Hungarian', bg: 'Bulgarian',
  hr: 'Croatian', sk: 'Slovak', sl: 'Slovenian', lt: 'Lithuanian', lv: 'Latvian',
  et: 'Estonian', ga: 'Irish', cy: 'Welsh', mt: 'Maltese', sw: 'Swahili',
  bn: 'Bengali', ta: 'Tamil', te: 'Telugu', ur: 'Urdu', fa: 'Persian',
};

function getLanguageName(code: string): string {
  return LANGUAGE_MAP[code.toLowerCase()] ?? code;
}

const translatorSkill: Skill = {
  id: 'translator',
  name: 'Translator',
  description: 'Translate text between languages using multiple translation APIs',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/translate', description: 'Translate text' },
    { type: 'command', pattern: '/tr', description: 'Translate shorthand' },
    { type: 'keyword', pattern: 'translate,translation,translate to,in english,in spanish,in french', description: 'Translation keywords' },
    { type: 'regex', pattern: 'translate\\s+.+\\s+(to|into)\\s+\\w+', description: 'Translate request patterns' },
  ],

  tools: [
    {
      name: 'translate_text',
      description: 'Translate text from one language to another',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to translate' },
          from: { type: 'string', description: 'Source language code (e.g., "en", "es"). "auto" for detection.' },
          to: { type: 'string', description: 'Target language code (e.g., "fr", "de")' },
          provider: { type: 'string', enum: ['deepl', 'google', 'libre'], description: 'Translation provider' },
        },
        required: ['text', 'to'],
      },
      async handler(args) {
        const { text, from, to, provider } = args as {
          text: string; from?: string; to: string; provider?: string;
        };

        const selectedProvider = provider ?? detectTranslationProvider();
        const sourceLabel = from ? getLanguageName(from) : 'auto-detect';
        const targetLabel = getLanguageName(to);

        switch (selectedProvider) {
          case 'deepl':
            return translateDeepL(text, from ?? '', to);
          case 'google':
            return translateGoogle(text, from ?? 'auto', to);
          case 'libre':
            return translateLibre(text, from ?? 'auto', to);
          default:
            return `No translation provider available. Set DEEPL_API_KEY, GOOGLE_TRANSLATE_KEY, or LIBRE_TRANSLATE_URL.\n\nRequested: "${text}" from ${sourceLabel} to ${targetLabel}`;
        }
      },
    },
    {
      name: 'detect_language',
      description: 'Detect the language of a text',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to detect language for' },
        },
        required: ['text'],
      },
      async handler(args) {
        const { text } = args as { text: string };

        // Try DeepL detection first
        const deeplKey = process.env.DEEPL_API_KEY;
        if (deeplKey) {
          const host = deeplKey.endsWith(':fx')
            ? 'api-free.deepl.com'
            : 'api.deepl.com';

          const response = await fetch(`https://${host}/v2/translate`, {
            method: 'POST',
            headers: {
              'Authorization': `DeepL-Auth-Key ${deeplKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: [text.slice(0, 200)], target_lang: 'EN' }),
          });

          if (response.ok) {
            const data = await response.json() as {
              translations: { detected_source_language: string }[];
            };
            const detected = data.translations[0]?.detected_source_language?.toLowerCase() ?? 'unknown';
            return `Detected language: ${getLanguageName(detected)} (${detected})`;
          }
        }

        // Fallback: basic heuristic detection based on character ranges
        const detected = heuristicDetect(text);
        return `Detected language (heuristic): ${getLanguageName(detected)} (${detected})`;
      },
    },
    {
      name: 'list_languages',
      description: 'List available languages for translation',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Filter languages by name or code' },
        },
      },
      async handler(args) {
        const { filter } = args as { filter?: string };

        let entries = Object.entries(LANGUAGE_MAP);
        if (filter) {
          const lower = filter.toLowerCase();
          entries = entries.filter(([code, name]) =>
            code.includes(lower) || name.toLowerCase().includes(lower)
          );
        }

        if (entries.length === 0) return 'No languages found matching the filter.';

        return entries
          .sort(([, a], [, b]) => a.localeCompare(b))
          .map(([code, name]) => `${code}: ${name}`)
          .join('\n');
      },
    },
  ],

  systemPromptAddition: 'You can translate text between 45+ languages, detect languages, and list supported languages using the Translator skill tools.',

  async init() {
    const provider = detectTranslationProvider();
    if (provider === 'none') {
      console.warn('[translator-skill] No translation API keys found. Set DEEPL_API_KEY, GOOGLE_TRANSLATE_KEY, or LIBRE_TRANSLATE_URL.');
    }
  },
};

function detectTranslationProvider(): string {
  if (process.env.DEEPL_API_KEY) return 'deepl';
  if (process.env.GOOGLE_TRANSLATE_KEY) return 'google';
  if (process.env.LIBRE_TRANSLATE_URL) return 'libre';
  return 'none';
}

async function translateDeepL(text: string, from: string, to: string): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY!;
  const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';

  const body: Record<string, unknown> = {
    text: [text],
    target_lang: to.toUpperCase(),
  };
  if (from && from !== 'auto') body.source_lang = from.toUpperCase();

  const response = await fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return `DeepL error: ${response.status} ${await response.text()}`;

  const data = await response.json() as {
    translations: { text: string; detected_source_language: string }[];
  };

  const translation = data.translations[0]!;
  const sourceLang = getLanguageName(translation.detected_source_language.toLowerCase());
  const targetLang = getLanguageName(to);

  return `[${sourceLang} -> ${targetLang}]\n${translation.text}`;
}

async function translateGoogle(text: string, from: string, to: string): Promise<string> {
  const apiKey = process.env.GOOGLE_TRANSLATE_KEY!;

  const params = new URLSearchParams({
    q: text,
    target: to,
    source: from === 'auto' ? '' : from,
    key: apiKey,
  });

  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?${params}`, {
    method: 'POST',
  });

  if (!response.ok) return `Google Translate error: ${response.status} ${await response.text()}`;

  const data = await response.json() as {
    data: { translations: { translatedText: string; detectedSourceLanguage?: string }[] };
  };

  const translation = data.data.translations[0]!;
  const sourceLang = getLanguageName(translation.detectedSourceLanguage ?? from);
  const targetLang = getLanguageName(to);

  return `[${sourceLang} -> ${targetLang}]\n${translation.translatedText}`;
}

async function translateLibre(text: string, from: string, to: string): Promise<string> {
  const baseUrl = process.env.LIBRE_TRANSLATE_URL!;

  const response = await fetch(`${baseUrl}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: from, target: to }),
  });

  if (!response.ok) return `LibreTranslate error: ${response.status} ${await response.text()}`;

  const data = await response.json() as { translatedText: string; detectedLanguage?: { language: string } };
  const sourceLang = getLanguageName(data.detectedLanguage?.language ?? from);
  const targetLang = getLanguageName(to);

  return `[${sourceLang} -> ${targetLang}]\n${data.translatedText}`;
}

function heuristicDetect(text: string): string {
  const sample = text.slice(0, 500);

  if (/[\u4e00-\u9fff]/.test(sample)) return 'zh';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) return 'ja';
  if (/[\uac00-\ud7af]/.test(sample)) return 'ko';
  if (/[\u0600-\u06ff]/.test(sample)) return 'ar';
  if (/[\u0900-\u097f]/.test(sample)) return 'hi';
  if (/[\u0400-\u04ff]/.test(sample)) return 'ru';
  if (/[\u0e00-\u0e7f]/.test(sample)) return 'th';

  // Latin-script heuristics
  if (/\b(the|and|is|are|was|were|have|has|will|would|could|should)\b/i.test(sample)) return 'en';
  if (/\b(el|la|los|las|es|son|tiene|puede|pero|como)\b/i.test(sample)) return 'es';
  if (/\b(le|la|les|est|sont|avoir|être|mais|dans|avec)\b/i.test(sample)) return 'fr';
  if (/\b(der|die|das|ist|sind|haben|werden|aber|und|mit)\b/i.test(sample)) return 'de';
  if (/\b(il|la|le|è|sono|avere|essere|ma|con|che)\b/i.test(sample)) return 'it';
  if (/\b(o|a|os|as|é|são|ter|ser|mas|com|que)\b/i.test(sample)) return 'pt';

  return 'unknown';
}

export default translatorSkill;
