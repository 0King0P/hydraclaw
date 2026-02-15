import type { Skill } from '@hydraclaw/skills';

/** Unit conversion factors to a common base unit within each category. */
const UNIT_CONVERSIONS: Record<string, Record<string, { base: string; factor: number }>> = {
  length: {
    mm: { base: 'm', factor: 0.001 },
    cm: { base: 'm', factor: 0.01 },
    m: { base: 'm', factor: 1 },
    km: { base: 'm', factor: 1000 },
    in: { base: 'm', factor: 0.0254 },
    ft: { base: 'm', factor: 0.3048 },
    yd: { base: 'm', factor: 0.9144 },
    mi: { base: 'm', factor: 1609.344 },
    nmi: { base: 'm', factor: 1852 },
  },
  weight: {
    mg: { base: 'kg', factor: 0.000001 },
    g: { base: 'kg', factor: 0.001 },
    kg: { base: 'kg', factor: 1 },
    t: { base: 'kg', factor: 1000 },
    oz: { base: 'kg', factor: 0.0283495 },
    lb: { base: 'kg', factor: 0.453592 },
    st: { base: 'kg', factor: 6.35029 },
  },
  temperature: {
    c: { base: 'c', factor: 1 },
    f: { base: 'c', factor: 1 },
    k: { base: 'c', factor: 1 },
  },
  volume: {
    ml: { base: 'l', factor: 0.001 },
    l: { base: 'l', factor: 1 },
    gal: { base: 'l', factor: 3.78541 },
    qt: { base: 'l', factor: 0.946353 },
    pt: { base: 'l', factor: 0.473176 },
    cup: { base: 'l', factor: 0.236588 },
    floz: { base: 'l', factor: 0.0295735 },
    tbsp: { base: 'l', factor: 0.0147868 },
    tsp: { base: 'l', factor: 0.00492892 },
  },
  area: {
    sqmm: { base: 'sqm', factor: 0.000001 },
    sqcm: { base: 'sqm', factor: 0.0001 },
    sqm: { base: 'sqm', factor: 1 },
    sqkm: { base: 'sqm', factor: 1000000 },
    sqft: { base: 'sqm', factor: 0.092903 },
    sqyd: { base: 'sqm', factor: 0.836127 },
    sqmi: { base: 'sqm', factor: 2589988 },
    acre: { base: 'sqm', factor: 4046.86 },
    hectare: { base: 'sqm', factor: 10000 },
  },
  speed: {
    mps: { base: 'mps', factor: 1 },
    kph: { base: 'mps', factor: 0.277778 },
    mph: { base: 'mps', factor: 0.44704 },
    knot: { base: 'mps', factor: 0.514444 },
  },
  data: {
    b: { base: 'b', factor: 1 },
    kb: { base: 'b', factor: 1024 },
    mb: { base: 'b', factor: 1048576 },
    gb: { base: 'b', factor: 1073741824 },
    tb: { base: 'b', factor: 1099511627776 },
    pb: { base: 'b', factor: 1125899906842624 },
  },
};

function convertTemperature(value: number, from: string, to: string): number {
  // Convert to Celsius first
  let celsius: number;
  switch (from) {
    case 'f': celsius = (value - 32) * 5 / 9; break;
    case 'k': celsius = value - 273.15; break;
    default: celsius = value;
  }

  // Convert from Celsius to target
  switch (to) {
    case 'f': return celsius * 9 / 5 + 32;
    case 'k': return celsius + 273.15;
    default: return celsius;
  }
}

function findUnitCategory(unit: string): string | null {
  const lower = unit.toLowerCase();
  for (const [category, units] of Object.entries(UNIT_CONVERSIONS)) {
    if (lower in units) return category;
  }
  return null;
}

function safeEval(expression: string): number {
  // Sanitize: only allow digits, operators, parens, decimals, and whitespace
  const sanitized = expression.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().,%^e]+$/i.test(sanitized)) {
    throw new Error('Invalid characters in expression');
  }

  // Replace ^ with ** for exponentiation
  const transformed = sanitized.replace(/\^/g, '**');

  // Use Function constructor with a restricted scope (no access to globals)
  const fn = new Function(`"use strict"; return (${transformed});`) as () => number;
  const result = fn();

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Result is not a finite number');
  }

  return result;
}

const calculatorSkill: Skill = {
  id: 'calculator',
  name: 'Calculator',
  description: 'Perform mathematical calculations and unit conversions',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/calc', description: 'Calculate expression' },
    { type: 'command', pattern: '/convert', description: 'Convert units' },
    { type: 'keyword', pattern: 'calculate,calculator,convert units', description: 'Math keywords' },
    { type: 'regex', pattern: '^\\d+[\\s]*[+\\-*/^]', description: 'Math expression starting with number' },
  ],

  tools: [
    {
      name: 'calculate',
      description: 'Evaluate a mathematical expression',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to evaluate (e.g., "2 + 3 * 4")' },
          precision: { type: 'number', description: 'Decimal places for result (default 10)' },
        },
        required: ['expression'],
      },
      async handler(args) {
        const { expression, precision } = args as { expression: string; precision?: number };

        try {
          const result = safeEval(expression);
          const formatted = Number(result.toFixed(precision ?? 10));
          return `${expression} = ${formatted}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'convert_units',
      description: 'Convert between measurement units',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'number', description: 'Value to convert' },
          from: { type: 'string', description: 'Source unit (e.g., "km", "lb", "f")' },
          to: { type: 'string', description: 'Target unit (e.g., "mi", "kg", "c")' },
        },
        required: ['value', 'from', 'to'],
      },
      async handler(args) {
        const { value, from, to } = args as { value: number; from: string; to: string };

        const fromLower = from.toLowerCase();
        const toLower = to.toLowerCase();

        const fromCategory = findUnitCategory(fromLower);
        const toCategory = findUnitCategory(toLower);

        if (!fromCategory) return `Unknown unit: "${from}"`;
        if (!toCategory) return `Unknown unit: "${to}"`;
        if (fromCategory !== toCategory) {
          return `Cannot convert between ${fromCategory} ("${from}") and ${toCategory} ("${to}")`;
        }

        // Special handling for temperature
        if (fromCategory === 'temperature') {
          const result = convertTemperature(value, fromLower, toLower);
          return `${value} ${from} = ${Number(result.toFixed(4))} ${to}`;
        }

        const fromInfo = UNIT_CONVERSIONS[fromCategory]![fromLower]!;
        const toInfo = UNIT_CONVERSIONS[fromCategory]![toLower]!;

        const baseValue = value * fromInfo.factor;
        const result = baseValue / toInfo.factor;

        return `${value} ${from} = ${Number(result.toFixed(6))} ${to}`;
      },
    },
    {
      name: 'calculate_percentage',
      description: 'Calculate percentages, percentage change, or percentage of a value',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['of', 'change', 'increase', 'decrease'],
            description: 'Percentage operation type',
          },
          value1: { type: 'number', description: 'First value (percentage for "of", original for "change")' },
          value2: { type: 'number', description: 'Second value (total for "of", new value for "change")' },
        },
        required: ['operation', 'value1', 'value2'],
      },
      async handler(args) {
        const { operation, value1, value2 } = args as { operation: string; value1: number; value2: number };

        switch (operation) {
          case 'of':
            return `${value1}% of ${value2} = ${Number((value1 / 100 * value2).toFixed(6))}`;
          case 'change': {
            if (value1 === 0) return 'Cannot calculate percentage change from 0';
            const change = ((value2 - value1) / Math.abs(value1)) * 100;
            return `Percentage change from ${value1} to ${value2} = ${Number(change.toFixed(4))}%`;
          }
          case 'increase':
            return `${value1} increased by ${value2}% = ${Number((value1 * (1 + value2 / 100)).toFixed(6))}`;
          case 'decrease':
            return `${value1} decreased by ${value2}% = ${Number((value1 * (1 - value2 / 100)).toFixed(6))}`;
          default:
            return `Unknown operation: ${operation}`;
        }
      },
    },
  ],

  systemPromptAddition: 'You can perform math calculations, unit conversions, and percentage operations using the Calculator skill tools.',

  async init() {
    // No external dependencies required
  },
};

export default calculatorSkill;
