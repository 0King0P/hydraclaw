import type { Skill } from '@hydraclaw/skills';

const VT_API_BASE = 'https://www.virustotal.com/api/v3';

function getApiKey(): string | null {
  return process.env.VIRUSTOTAL_API_KEY ?? null;
}

function headers(): Record<string, string> {
  return {
    'x-apikey': getApiKey()!,
    'Accept': 'application/json',
  };
}

interface VtStats {
  malicious: number;
  suspicious: number;
  undetected: number;
  harmless: number;
  timeout?: number;
}

interface VtEngineResult {
  engine_name: string;
  category: string;
  result: string | null;
}

function formatStats(stats: VtStats): string {
  const total = stats.malicious + stats.suspicious + stats.undetected + stats.harmless + (stats.timeout ?? 0);
  const lines = [
    `  Malicious:  ${stats.malicious}/${total}`,
    `  Suspicious: ${stats.suspicious}/${total}`,
    `  Harmless:   ${stats.harmless}/${total}`,
    `  Undetected: ${stats.undetected}/${total}`,
  ];
  if (stats.timeout) lines.push(`  Timeout:    ${stats.timeout}/${total}`);
  return lines.join('\n');
}

function formatDetections(results: Record<string, VtEngineResult>, limit: number): string {
  const detections = Object.values(results)
    .filter(r => r.category === 'malicious' || r.category === 'suspicious')
    .sort((a, b) => a.engine_name.localeCompare(b.engine_name));

  if (detections.length === 0) return '  No detections found.';

  return detections
    .slice(0, limit)
    .map(d => `  ${d.engine_name}: ${d.result ?? d.category}`)
    .join('\n') + (detections.length > limit ? `\n  ... and ${detections.length - limit} more` : '');
}

function threatLabel(stats: VtStats): string {
  if (stats.malicious >= 5) return 'MALICIOUS';
  if (stats.malicious >= 1 || stats.suspicious >= 3) return 'SUSPICIOUS';
  return 'CLEAN';
}

async function vtGet(path: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'VIRUSTOTAL_API_KEY environment variable is not set.' };

  const response = await fetch(`${VT_API_BASE}${path}`, { headers: headers() });

  if (response.status === 404) return { ok: false, error: 'Resource not found on VirusTotal.' };
  if (response.status === 429) return { ok: false, error: 'Rate limit exceeded. Please wait and try again.' };
  if (!response.ok) return { ok: false, error: `VirusTotal API error: ${response.status} ${response.statusText}` };

  const json = await response.json();
  return { ok: true, data: json.data };
}

async function vtPost(path: string, body: Record<string, string>): Promise<{ ok: boolean; data?: any; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'VIRUSTOTAL_API_KEY environment variable is not set.' };

  const form = new URLSearchParams(body);
  const response = await fetch(`${VT_API_BASE}${path}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (response.status === 429) return { ok: false, error: 'Rate limit exceeded. Please wait and try again.' };
  if (!response.ok) return { ok: false, error: `VirusTotal API error: ${response.status} ${response.statusText}` };

  const json = await response.json();
  return { ok: true, data: json.data };
}

const virustotalSkill: Skill = {
  id: 'virustotal',
  name: 'VirusTotal',
  description: 'Scan files, URLs, IPs, and domains for malware and threats using the VirusTotal API',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/virustotal', description: 'VirusTotal scan' },
    { type: 'command', pattern: '/vt', description: 'VirusTotal shorthand' },
    { type: 'command', pattern: '/scan', description: 'Scan for threats' },
    { type: 'keyword', pattern: 'virustotal,malware scan,threat scan,virus scan,check hash,check ip reputation', description: 'VirusTotal keywords' },
    { type: 'regex', pattern: '(scan|check|analyze)\\s+(file|url|ip|domain|hash)\\s+', description: 'Scan request patterns' },
  ],

  tools: [
    {
      name: 'vt_scan_hash',
      description: 'Look up a file hash (SHA-256, SHA-1, or MD5) on VirusTotal to check if it is known malware',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'File hash (SHA-256, SHA-1, or MD5)' },
          show_detections: { type: 'boolean', description: 'Show individual engine detections (default false)' },
          detection_limit: { type: 'number', description: 'Max number of detections to show (default 20)' },
        },
        required: ['hash'],
      },
      async handler(args) {
        const { hash, show_detections, detection_limit } = args as {
          hash: string; show_detections?: boolean; detection_limit?: number;
        };

        const cleaned = hash.trim().toLowerCase();
        if (!/^[a-f0-9]{32,64}$/.test(cleaned)) {
          return 'Error: Invalid hash. Provide a valid MD5 (32), SHA-1 (40), or SHA-256 (64) hex string.';
        }

        const result = await vtGet(`/files/${cleaned}`);
        if (!result.ok) return `Error: ${result.error}`;

        const attrs = result.data.attributes;
        const stats: VtStats = attrs.last_analysis_stats;
        const label = threatLabel(stats);
        const names = attrs.names?.slice(0, 5).join(', ') ?? 'N/A';
        const fileType = attrs.type_description ?? attrs.magic ?? 'Unknown';
        const size = attrs.size ? `${(attrs.size / 1024).toFixed(1)} KB` : 'Unknown';
        const lastAnalysis = attrs.last_analysis_date
          ? new Date(attrs.last_analysis_date * 1000).toISOString()
          : 'N/A';

        const lines = [
          `[${label}] File Report`,
          ``,
          `  SHA-256:       ${attrs.sha256 ?? 'N/A'}`,
          `  SHA-1:         ${attrs.sha1 ?? 'N/A'}`,
          `  MD5:           ${attrs.md5 ?? 'N/A'}`,
          `  File type:     ${fileType}`,
          `  Size:          ${size}`,
          `  Known names:   ${names}`,
          `  Last analysis: ${lastAnalysis}`,
          ``,
          `Detection summary:`,
          formatStats(stats),
        ];

        if (show_detections && attrs.last_analysis_results) {
          lines.push('', 'Detections:', formatDetections(attrs.last_analysis_results, detection_limit ?? 20));
        }

        return lines.join('\n');
      },
    },
    {
      name: 'vt_scan_url',
      description: 'Submit a URL to VirusTotal for scanning and retrieve the analysis report',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to scan' },
          show_detections: { type: 'boolean', description: 'Show individual engine detections (default false)' },
        },
        required: ['url'],
      },
      async handler(args) {
        const { url, show_detections } = args as { url: string; show_detections?: boolean };

        // Submit URL for scanning
        const submitResult = await vtPost('/urls', { url });
        if (!submitResult.ok) return `Error submitting URL: ${submitResult.error}`;

        const analysisId = submitResult.data.id;

        // Poll for completion (up to 60s)
        let attempts = 0;
        while (attempts < 12) {
          const analysisResult = await vtGet(`/analyses/${analysisId}`);
          if (!analysisResult.ok) return `Error fetching analysis: ${analysisResult.error}`;

          if (analysisResult.data.attributes.status === 'completed') {
            const attrs = analysisResult.data.attributes;
            const stats: VtStats = attrs.stats;
            const label = threatLabel(stats);

            const lines = [
              `[${label}] URL Scan Report`,
              ``,
              `  URL: ${url}`,
              ``,
              `Detection summary:`,
              formatStats(stats),
            ];

            if (show_detections && attrs.results) {
              lines.push('', 'Detections:', formatDetections(attrs.results, 20));
            }

            return lines.join('\n');
          }

          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
        }

        return `Analysis still in progress after 60s. Use the analysis ID to check later: ${analysisId}`;
      },
    },
    {
      name: 'vt_scan_ip',
      description: 'Get a threat intelligence report for an IP address from VirusTotal',
      parameters: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'IP address to look up' },
          show_detections: { type: 'boolean', description: 'Show individual engine detections (default false)' },
        },
        required: ['ip'],
      },
      async handler(args) {
        const { ip, show_detections } = args as { ip: string; show_detections?: boolean };

        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.includes(':')) {
          return 'Error: Invalid IP address format.';
        }

        const result = await vtGet(`/ip_addresses/${ip}`);
        if (!result.ok) return `Error: ${result.error}`;

        const attrs = result.data.attributes;
        const stats: VtStats = attrs.last_analysis_stats ?? { malicious: 0, suspicious: 0, undetected: 0, harmless: 0 };
        const label = threatLabel(stats);
        const owner = attrs.as_owner ?? 'Unknown';
        const asn = attrs.asn ?? 'N/A';
        const country = attrs.country ?? 'N/A';
        const reputation = attrs.reputation ?? 0;

        const lines = [
          `[${label}] IP Report: ${ip}`,
          ``,
          `  Owner:      ${owner}`,
          `  ASN:        ${asn}`,
          `  Country:    ${country}`,
          `  Reputation: ${reputation}`,
          ``,
          `Detection summary:`,
          formatStats(stats),
        ];

        if (show_detections && attrs.last_analysis_results) {
          lines.push('', 'Detections:', formatDetections(attrs.last_analysis_results, 20));
        }

        return lines.join('\n');
      },
    },
    {
      name: 'vt_scan_domain',
      description: 'Get a threat intelligence report for a domain from VirusTotal',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Domain name to look up' },
          show_detections: { type: 'boolean', description: 'Show individual engine detections (default false)' },
        },
        required: ['domain'],
      },
      async handler(args) {
        const { domain, show_detections } = args as { domain: string; show_detections?: boolean };

        const result = await vtGet(`/domains/${domain}`);
        if (!result.ok) return `Error: ${result.error}`;

        const attrs = result.data.attributes;
        const stats: VtStats = attrs.last_analysis_stats ?? { malicious: 0, suspicious: 0, undetected: 0, harmless: 0 };
        const label = threatLabel(stats);
        const registrar = attrs.registrar ?? 'Unknown';
        const creation = attrs.creation_date
          ? new Date(attrs.creation_date * 1000).toISOString().split('T')[0]
          : 'N/A';
        const reputation = attrs.reputation ?? 0;
        const categories = attrs.categories
          ? Object.values(attrs.categories as Record<string, string>).slice(0, 5).join(', ')
          : 'N/A';

        const lines = [
          `[${label}] Domain Report: ${domain}`,
          ``,
          `  Registrar:   ${registrar}`,
          `  Created:     ${creation}`,
          `  Reputation:  ${reputation}`,
          `  Categories:  ${categories}`,
          ``,
          `Detection summary:`,
          formatStats(stats),
        ];

        if (show_detections && attrs.last_analysis_results) {
          lines.push('', 'Detections:', formatDetections(attrs.last_analysis_results, 20));
        }

        return lines.join('\n');
      },
    },
    {
      name: 'vt_search',
      description: 'Search VirusTotal intelligence for files, URLs, domains, or IPs matching a query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'VT Intelligence search query (e.g., "type:peexe size:5MB+ positives:10+")' },
          limit: { type: 'number', description: 'Number of results to return (default 10, max 20)' },
        },
        required: ['query'],
      },
      async handler(args) {
        const { query, limit } = args as { query: string; limit?: number };
        const count = Math.min(limit ?? 10, 20);

        const params = new URLSearchParams({ query, limit: count.toString() });
        const result = await vtGet(`/intelligence/search?${params}`);
        if (!result.ok) return `Error: ${result.error}`;

        const items = result.data as any[];
        if (!items || items.length === 0) return 'No results found.';

        return items.map((item: any, i: number) => {
          const attrs = item.attributes;
          const stats: VtStats = attrs.last_analysis_stats ?? {};
          const detections = stats.malicious ?? 0;
          const name = attrs.meaningful_name ?? attrs.sha256 ?? item.id ?? 'Unknown';
          const type = item.type ?? 'unknown';
          return `${i + 1}. [${type}] ${name}\n   Detections: ${detections} | ID: ${item.id ?? 'N/A'}`;
        }).join('\n\n');
      },
    },
  ],

  systemPromptAddition: [
    'You can scan files, URLs, IPs, and domains for malware and threats using the VirusTotal skill.',
    'Use /vt or /scan to invoke scans. Commands:',
    '  /vt hash <sha256|sha1|md5> - Look up a file hash',
    '  /vt url <url>              - Scan a URL',
    '  /vt ip <address>           - Check IP reputation',
    '  /vt domain <domain>        - Check domain reputation',
    '  /vt search <query>         - Search VT Intelligence',
    'Requires VIRUSTOTAL_API_KEY environment variable.',
  ].join('\n'),

  async init() {
    if (!getApiKey()) {
      console.warn('[virustotal-skill] VIRUSTOTAL_API_KEY not set. Skill will not function without it.');
    }
  },

  async destroy() {
    // No cleanup needed
  },
};

export default virustotalSkill;
