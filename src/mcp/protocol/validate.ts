/**
 * Validate tool arguments against the small JSON Schema subset our tools declare. Unknown properties are rejected
 * when the schema sets `additionalProperties: false`.
 */

import type { JsonSchema } from './types';

function typeMatches(schema: JsonSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === schema.type;
  }
}

/**
 * @returns The first problem found, as a message naming the argument, or `undefined` when `value` is valid.
 */
export function validateValue(schema: JsonSchema, value: unknown, at = 'arguments'): string | undefined {
  if (!typeMatches(schema, value)) {
    return `${at} must be ${schema.type === 'array' || schema.type === 'object' ? 'an' : 'a'} ${schema.type}`;
  }
  if (schema.enum && !schema.enum.includes(value as string)) {
    return `${at} must be one of: ${schema.enum.join(', ')}`;
  }
  if (schema.type === 'array' && schema.items) {
    const items = value as unknown[];
    for (let index = 0; index < items.length; index++) {
      const problem = validateValue(schema.items, items[index], `${at}[${index}]`);
      if (problem) return problem;
    }
  }
  if (schema.type !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  const missing = (schema.required ?? []).find((name) => record[name] === undefined);
  if (missing) return `${at}.${missing} is required`;
  for (const [name, propertyValue] of Object.entries(record)) {
    const propertySchema = schema.properties?.[name];
    if (!propertySchema) {
      if (schema.additionalProperties === false) return `${at}.${name} is not a known argument`;
      continue;
    }
    const problem = validateValue(propertySchema, propertyValue, `${at}.${name}`);
    if (problem) return problem;
  }
  return undefined;
}
