import type { Skill } from '@hydraclaw/skills';

const weatherSkill: Skill = {
  id: 'weather',
  name: 'Weather',
  description: 'Get current weather conditions and forecasts for any location',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/weather', description: 'Get weather forecast' },
    { type: 'keyword', pattern: 'weather,forecast,temperature,rain,snow,humid', description: 'Weather-related keywords' },
    { type: 'regex', pattern: 'what.*weather.*in|how.*hot|how.*cold|will it rain', description: 'Weather question patterns' },
  ],

  tools: [
    {
      name: 'weather_current',
      description: 'Get current weather conditions for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name or coordinates (lat,lon)' },
          units: { type: 'string', enum: ['metric', 'imperial'], description: 'Temperature units' },
        },
        required: ['location'],
      },
      async handler(args) {
        const { location, units } = args as { location: string; units?: string };
        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) return 'Error: OPENWEATHER_API_KEY environment variable is not set';

        const unitParam = units ?? 'metric';
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${unitParam}&appid=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
          return `Error fetching weather: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as {
          name: string;
          main: { temp: number; feels_like: number; humidity: number; pressure: number };
          weather: { main: string; description: string }[];
          wind: { speed: number };
          visibility: number;
        };

        const unitLabel = unitParam === 'metric' ? 'C' : 'F';
        const speedLabel = unitParam === 'metric' ? 'm/s' : 'mph';

        return [
          `Weather in ${data.name}:`,
          `  Conditions: ${data.weather[0]?.description ?? 'unknown'}`,
          `  Temperature: ${data.main.temp}°${unitLabel} (feels like ${data.main.feels_like}°${unitLabel})`,
          `  Humidity: ${data.main.humidity}%`,
          `  Wind: ${data.wind.speed} ${speedLabel}`,
          `  Pressure: ${data.main.pressure} hPa`,
          `  Visibility: ${(data.visibility / 1000).toFixed(1)} km`,
        ].join('\n');
      },
    },
    {
      name: 'weather_forecast',
      description: 'Get a 5-day weather forecast for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name or coordinates (lat,lon)' },
          units: { type: 'string', enum: ['metric', 'imperial'], description: 'Temperature units' },
          days: { type: 'number', description: 'Number of days (1-5)' },
        },
        required: ['location'],
      },
      async handler(args) {
        const { location, units, days } = args as { location: string; units?: string; days?: number };
        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) return 'Error: OPENWEATHER_API_KEY environment variable is not set';

        const unitParam = units ?? 'metric';
        const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&units=${unitParam}&appid=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
          return `Error fetching forecast: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as {
          city: { name: string };
          list: {
            dt_txt: string;
            main: { temp: number; humidity: number };
            weather: { description: string }[];
            wind: { speed: number };
          }[];
        };

        const unitLabel = unitParam === 'metric' ? 'C' : 'F';
        const maxEntries = (days ?? 5) * 8; // API returns 3-hour intervals
        const entries = data.list.slice(0, maxEntries);

        // Group by date and pick one midday entry per day
        const dailyMap = new Map<string, typeof entries[0]>();
        for (const entry of entries) {
          const date = entry.dt_txt.split(' ')[0]!;
          const hour = parseInt(entry.dt_txt.split(' ')[1]!.split(':')[0]!, 10);
          if (!dailyMap.has(date) || Math.abs(hour - 12) < Math.abs(parseInt(dailyMap.get(date)!.dt_txt.split(' ')[1]!.split(':')[0]!, 10) - 12)) {
            dailyMap.set(date, entry);
          }
        }

        const lines = [`${days ?? 5}-day forecast for ${data.city.name}:`];
        for (const [date, entry] of dailyMap) {
          lines.push(`  ${date}: ${entry.weather[0]?.description ?? 'unknown'}, ${entry.main.temp}°${unitLabel}, humidity ${entry.main.humidity}%`);
        }

        return lines.join('\n');
      },
    },
  ],

  systemPromptAddition: 'You can check current weather conditions and multi-day forecasts for any city using the Weather skill tools.',

  async init(config) {
    if (!process.env.OPENWEATHER_API_KEY && !config.apiKey) {
      console.warn('[weather-skill] No OPENWEATHER_API_KEY found. Weather operations will fail until one is provided.');
    }
  },
};

export default weatherSkill;
