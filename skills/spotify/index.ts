import type { Skill } from '@hydraclaw/skills';

interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokens: SpotifyTokens | null = null;

async function spotifyFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  if (!tokens) {
    throw new Error('Spotify is not authenticated. Set SPOTIFY_ACCESS_TOKEN and SPOTIFY_REFRESH_TOKEN.');
  }

  // Auto-refresh if expired
  if (Date.now() >= tokens.expiresAt) {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required for token refresh');
    }

    const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    });

    if (!refreshResponse.ok) {
      throw new Error(`Token refresh failed: ${refreshResponse.status}`);
    }

    const refreshData = await refreshResponse.json() as { access_token: string; expires_in: number };
    tokens.accessToken = refreshData.access_token;
    tokens.expiresAt = Date.now() + refreshData.expires_in * 1000;
  }

  return fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

const spotifySkill: Skill = {
  id: 'spotify',
  name: 'Spotify',
  description: 'Control Spotify playback, search music, manage playlists',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/spotify', description: 'Spotify control' },
    { type: 'command', pattern: '/play', description: 'Play music' },
    { type: 'command', pattern: '/pause', description: 'Pause music' },
    { type: 'command', pattern: '/skip', description: 'Skip track' },
    { type: 'keyword', pattern: 'spotify,play music,song,playlist,album,artist,track', description: 'Music keywords' },
  ],

  tools: [
    {
      name: 'spotify_search',
      description: 'Search for tracks, albums, artists, or playlists on Spotify',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          type: { type: 'string', enum: ['track', 'album', 'artist', 'playlist'], description: 'Search type' },
          limit: { type: 'number', description: 'Number of results (1-50)' },
        },
        required: ['query'],
      },
      async handler(args) {
        const { query, type, limit } = args as { query: string; type?: string; limit?: number };
        const searchType = type ?? 'track';
        const searchLimit = Math.min(limit ?? 10, 50);

        const params = new URLSearchParams({
          q: query,
          type: searchType,
          limit: searchLimit.toString(),
        });

        const response = await spotifyFetch(`/search?${params}`);
        if (!response.ok) {
          return `Error searching Spotify: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as Record<string, { items: { name: string; artists?: { name: string }[]; uri: string; id: string }[] }>;
        const results = data[`${searchType}s`]?.items ?? [];

        if (results.length === 0) return `No ${searchType}s found for "${query}"`;

        return results.map((item, i) => {
          const artist = item.artists?.[0]?.name ?? '';
          const artistStr = artist ? ` by ${artist}` : '';
          return `${i + 1}. ${item.name}${artistStr} (${item.uri})`;
        }).join('\n');
      },
    },
    {
      name: 'spotify_play',
      description: 'Start or resume playback, or play a specific track/album/playlist',
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Spotify URI to play (e.g., spotify:track:...)' },
          deviceId: { type: 'string', description: 'Target device ID' },
        },
      },
      async handler(args) {
        const { uri, deviceId } = args as { uri?: string; deviceId?: string };
        const params = deviceId ? `?device_id=${deviceId}` : '';
        const body = uri ? JSON.stringify({ uris: [uri] }) : undefined;

        const response = await spotifyFetch(`/me/player/play${params}`, {
          method: 'PUT',
          body,
        });

        if (response.status === 204) {
          return uri ? `Now playing: ${uri}` : 'Playback resumed';
        }
        return `Error: ${response.status} ${await response.text()}`;
      },
    },
    {
      name: 'spotify_pause',
      description: 'Pause the current playback',
      parameters: { type: 'object', properties: {} },
      async handler() {
        const response = await spotifyFetch('/me/player/pause', { method: 'PUT' });
        if (response.status === 204) return 'Playback paused';
        return `Error: ${response.status} ${await response.text()}`;
      },
    },
    {
      name: 'spotify_skip',
      description: 'Skip to the next track',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['next', 'previous'], description: 'Skip direction' },
        },
      },
      async handler(args) {
        const { direction } = args as { direction?: string };
        const endpoint = direction === 'previous' ? '/me/player/previous' : '/me/player/next';
        const response = await spotifyFetch(endpoint, { method: 'POST' });
        if (response.status === 204) return `Skipped to ${direction ?? 'next'} track`;
        return `Error: ${response.status} ${await response.text()}`;
      },
    },
    {
      name: 'spotify_now_playing',
      description: 'Get the currently playing track',
      parameters: { type: 'object', properties: {} },
      async handler() {
        const response = await spotifyFetch('/me/player/currently-playing');
        if (response.status === 204) return 'Nothing is currently playing.';
        if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

        const data = await response.json() as {
          is_playing: boolean;
          item: { name: string; artists: { name: string }[]; album: { name: string }; duration_ms: number };
          progress_ms: number;
        };

        const artists = data.item.artists.map(a => a.name).join(', ');
        const progress = formatDuration(data.progress_ms);
        const duration = formatDuration(data.item.duration_ms);

        return [
          `Now ${data.is_playing ? 'playing' : 'paused'}:`,
          `  Track: ${data.item.name}`,
          `  Artist: ${artists}`,
          `  Album: ${data.item.album.name}`,
          `  Progress: ${progress} / ${duration}`,
        ].join('\n');
      },
    },
  ],

  systemPromptAddition: 'You can control Spotify playback, search for music, and view what is currently playing using the Spotify skill tools.',

  async init(config) {
    const accessToken = (config.accessToken as string) ?? process.env.SPOTIFY_ACCESS_TOKEN;
    const refreshToken = (config.refreshToken as string) ?? process.env.SPOTIFY_REFRESH_TOKEN;

    if (accessToken && refreshToken) {
      tokens = {
        accessToken,
        refreshToken,
        expiresAt: Date.now() + 3600 * 1000, // Assume 1 hour validity
      };
    } else {
      console.warn('[spotify-skill] No Spotify tokens found. Authentication required before use.');
    }
  },

  async destroy() {
    tokens = null;
  },
};

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default spotifySkill;
