/**
 * Make text that came from a component spec, a YAML file, or GitLab safe to hand to an agent: strip control and
 * bidi-override characters and cap the length. Such text is returned only in data fields, never in `message`.
 */

import type { ParameterDefault } from '../../types/git-component';

export const MAX_NAME_LENGTH = 200;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_PATH_LENGTH = 1024;
const MAX_LIST_ITEMS = 200;
const ELLIPSIS = '…';

// C0/C1 controls except tab and newline; the Arabic letter mark; zero-width, direction-mark, line/paragraph separator,
// and bidi embedding/override/isolate characters; word joiner and invisible operators; BOM; and Unicode tag characters.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

export function cleanText(value: unknown, maxLength: number = MAX_TEXT_LENGTH): string {
  const text = String(value ?? '').replace(UNSAFE_CHARS, '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}${ELLIPSIS}` : text;
}

/** A file path for output: cleaned, on one line, and capped. */
export function cleanPath(value: unknown): string {
  return cleanText(value, MAX_PATH_LENGTH).replace(/[\n\t]/g, ' ');
}

export function cleanName(value: unknown): string {
  return cleanText(value, MAX_NAME_LENGTH).replace(/[\n\t]/g, ' ');
}

type Primitive = string | number | boolean;

function cleanPrimitive(value: Primitive): Primitive {
  return typeof value === 'string' ? cleanText(value) : value;
}

/** A spec default or option list, with strings cleaned and lists capped. */
export function cleanDefault(value: ParameterDefault | undefined): ParameterDefault | undefined {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_LIST_ITEMS).map(cleanPrimitive);
  return cleanPrimitive(value);
}

export function cleanList(values: readonly Primitive[] | undefined): Primitive[] | undefined {
  return values?.slice(0, MAX_LIST_ITEMS).map(cleanPrimitive);
}

export function cleanNames(values: readonly string[]): string[] {
  return values.slice(0, MAX_LIST_ITEMS).map(cleanName);
}
