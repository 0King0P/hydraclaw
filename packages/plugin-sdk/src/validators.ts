/**
 * Validation helpers for plugin structures, manifests, tool definitions,
 * and configuration schemas.
 */

import type {
  Plugin,
  PluginManifest,
  ToolDefinition,
  JSONSchema,
} from '@hydraclaw/core';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function result(errors: string[]): ValidationResult {
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Plugin Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a plugin object has all required fields and correct types.
 */
export function validatePlugin(plugin: unknown): ValidationResult {
  const errors: string[] = [];

  if (plugin === null || typeof plugin !== 'object') {
    return result(['Plugin must be a non-null object']);
  }

  const p = plugin as Record<string, unknown>;

  if (typeof p.id !== 'string' || p.id.length === 0) {
    errors.push('Plugin must have a non-empty string "id"');
  }

  if (typeof p.name !== 'string' || p.name.length === 0) {
    errors.push('Plugin must have a non-empty string "name"');
  }

  if (typeof p.version !== 'string' || p.version.length === 0) {
    errors.push('Plugin must have a non-empty string "version"');
  }

  const validTypes = ['provider', 'channel', 'tool'];
  if (typeof p.type !== 'string' || !validTypes.includes(p.type)) {
    errors.push(`Plugin "type" must be one of: ${validTypes.join(', ')}`);
  }

  if (typeof p.init !== 'function') {
    errors.push('Plugin must have an "init" method');
  }

  // Type-specific validations
  if (p.type === 'provider') {
    if (typeof p.models !== 'function') {
      errors.push('Provider plugin must have a "models" method');
    }
    if (typeof p.complete !== 'function') {
      errors.push('Provider plugin must have a "complete" method');
    }
    if (typeof p.stream !== 'function') {
      errors.push('Provider plugin must have a "stream" method');
    }
  }

  if (p.type === 'channel') {
    if (typeof p.start !== 'function') {
      errors.push('Channel plugin must have a "start" method');
    }
    if (typeof p.stop !== 'function') {
      errors.push('Channel plugin must have a "stop" method');
    }
    if (typeof p.send !== 'function') {
      errors.push('Channel plugin must have a "send" method');
    }
    if (p.capabilities === null || typeof p.capabilities !== 'object') {
      errors.push('Channel plugin must have a "capabilities" object');
    }
  }

  if (p.type === 'tool') {
    if (typeof p.definitions !== 'function') {
      errors.push('Tool plugin must have a "definitions" method');
    }
    if (typeof p.execute !== 'function') {
      errors.push('Tool plugin must have an "execute" method');
    }
  }

  return result(errors);
}

// ---------------------------------------------------------------------------
// Manifest Validation
// ---------------------------------------------------------------------------

/**
 * Validate a plugin manifest object.
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];

  if (manifest === null || typeof manifest !== 'object') {
    return result(['Manifest must be a non-null object']);
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.id !== 'string' || m.id.length === 0) {
    errors.push('Manifest must have a non-empty string "id"');
  } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(m.id)) {
    errors.push('Manifest "id" must match pattern [a-z0-9][a-z0-9._-]*');
  }

  if (typeof m.name !== 'string' || m.name.length === 0) {
    errors.push('Manifest must have a non-empty string "name"');
  }

  if (typeof m.version !== 'string' || m.version.length === 0) {
    errors.push('Manifest must have a non-empty string "version"');
  } else if (!/^\d+\.\d+\.\d+/.test(m.version)) {
    errors.push('Manifest "version" must be a semver string (e.g. "1.0.0")');
  }

  const validTypes = ['provider', 'channel', 'tool'];
  if (typeof m.type !== 'string' || !validTypes.includes(m.type)) {
    errors.push(`Manifest "type" must be one of: ${validTypes.join(', ')}`);
  }

  if (m.configSchema !== undefined) {
    if (m.configSchema === null || typeof m.configSchema !== 'object') {
      errors.push('Manifest "configSchema" must be an object if provided');
    }
  }

  return result(errors);
}

// ---------------------------------------------------------------------------
// ToolDefinition Validation
// ---------------------------------------------------------------------------

/**
 * Validate a tool definition including its JSON schema.
 */
export function validateToolDefinition(def: unknown): ValidationResult {
  const errors: string[] = [];

  if (def === null || typeof def !== 'object') {
    return result(['ToolDefinition must be a non-null object']);
  }

  const d = def as Record<string, unknown>;

  if (typeof d.name !== 'string' || d.name.length === 0) {
    errors.push('ToolDefinition must have a non-empty string "name"');
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(d.name)) {
    errors.push('ToolDefinition "name" must be a valid identifier (letters, digits, underscores)');
  }

  if (typeof d.description !== 'string' || d.description.length === 0) {
    errors.push('ToolDefinition must have a non-empty string "description"');
  }

  if (d.parameters === null || typeof d.parameters !== 'object') {
    errors.push('ToolDefinition must have a "parameters" object');
  } else {
    const schemaResult = validateJsonSchema(d.parameters as Record<string, unknown>, 'parameters');
    errors.push(...schemaResult.errors);
  }

  return result(errors);
}

/**
 * Basic JSON Schema validation (validates structure, not data).
 */
function validateJsonSchema(
  schema: Record<string, unknown>,
  path: string,
): ValidationResult {
  const errors: string[] = [];

  const validTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
  if (typeof schema.type !== 'string' || !validTypes.includes(schema.type)) {
    errors.push(`${path}.type must be one of: ${validTypes.join(', ')}`);
  }

  if (schema.type === 'object' && schema.properties !== undefined) {
    if (typeof schema.properties !== 'object' || schema.properties === null) {
      errors.push(`${path}.properties must be an object`);
    } else {
      for (const [key, value] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) {
          errors.push(`${path}.properties.${key} must be an object`);
        }
      }
    }

    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required)) {
        errors.push(`${path}.required must be an array`);
      } else {
        for (const item of schema.required) {
          if (typeof item !== 'string') {
            errors.push(`${path}.required entries must be strings`);
            break;
          }
        }
      }
    }
  }

  if (schema.type === 'array' && schema.items !== undefined) {
    if (typeof schema.items !== 'object' || schema.items === null) {
      errors.push(`${path}.items must be an object`);
    }
  }

  return result(errors);
}

// ---------------------------------------------------------------------------
// Config Validation
// ---------------------------------------------------------------------------

/**
 * Validate a configuration object against a JSON-schema-like definition.
 * Supports type checking, required fields, and enum validation.
 */
export function validateConfig(
  config: Record<string, unknown>,
  schema: JSONSchema,
): ValidationResult {
  const errors: string[] = [];

  if (schema.type !== 'object') {
    return result(['Config schema root must be type "object"']);
  }

  // Check required fields
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (!(field in config)) {
        errors.push(`Missing required config field: "${field}"`);
      }
    }
  }

  // Check property types
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = config[key];
      if (value === undefined) continue;

      const expectedType = propSchema.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;

      if (expectedType && actualType !== expectedType) {
        errors.push(
          `Config field "${key}" expected type "${expectedType}", got "${actualType}"`,
        );
        continue;
      }

      // Enum validation
      if (propSchema.enum && Array.isArray(propSchema.enum)) {
        if (!propSchema.enum.includes(value)) {
          errors.push(
            `Config field "${key}" must be one of: ${propSchema.enum.map(String).join(', ')}`,
          );
        }
      }
    }
  }

  return result(errors);
}
