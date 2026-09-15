import { SPEC_INPUTS_SECTION_REGEX } from '../constants/regex';
import { Logger } from '../utils/logger';
// Import direct from errors/types (not the barrel) so this module can load from plain Node — the barrel re-exports
// from errors/handler.ts which imports `vscode` at module load. Required for the Mocha unit suite.
import { ParseError } from '../errors/types';
import type { ParameterDefault } from '../types/git-component';
import { isParameterDefault } from './parameterDefaultShape';
import * as yaml from 'js-yaml';
import { isYamlNode, GITLAB_CI_SCHEMA } from '../utils/yamlParser';

const logger = Logger.getInstance();

/** An input's own keys, which are never input names however the spec happens to be indented. */
const INPUT_FIELD_KEYS = new Set(['description', 'default', 'type', 'options', 'regex']);

/**
 * Resolve one already-trimmed scalar to the value YAML reads it as.
 *
 * @param trimmed - A single scalar's text, surrounding whitespace already removed.
 * @returns The parsed value, or the text with surrounding quotes stripped when it isn't a parseable YAML scalar.
 */
function parseScalar(trimmed: string): ParameterDefault {
  try {
    // `yaml.load` directly rather than `parseYaml`: these probes are one-off strings, so memoising them only evicts
    // the document parses sharing that cache.
    const parsed = yaml.load(`probe: ${trimmed}`, { schema: GITLAB_CI_SCHEMA });
    if (isYamlNode(parsed) && isParameterDefault(parsed.probe)) {
      return parsed.probe;
    }
  } catch {
    // Not valid YAML on its own (an unquoted `*`, a stray `{`, …) — fall back to the literal text.
  }
  return trimmed.replace(/^["']|["']$/g, '').trim();
}

/**
 * Parse the text after `default:` into the value the input's type says it is.
 *
 * This parser reads the spec line-by-line rather than as a document, so a `default:` value arrives as raw text. Left
 * as text, `default: false` on a `type: boolean` input becomes the string `"false"`, which downstream renders back
 * as a quoted `"false"` — a string where GitLab expects a boolean.
 *
 * A `string` input's default is text by declaration, so it is never sent through YAML: `default: 1.0` stays `"1.0"`
 * and `0755` keeps its leading zero. That covers an omitted `type:` as well — GitLab resolves an untyped input as
 * `StringInput` (its `matches?` accepts a spec with no `:type` key) and coerces the default with `to_s`, so an
 * untyped default is a string no matter what it looks like.
 *
 * @param rawValue - The text following `default:` on the line, e.g. `false`, `"0"`, `[a, b]`.
 * @param inputType - The input's resolved `type:`; `'string'` when the spec omits it.
 * @returns The parsed value, or the trimmed raw text when it doesn't parse as a YAML scalar.
 */
function parseDefaultValue(rawValue: string, inputType: string): ParameterDefault {
  const trimmed = rawValue.trim();
  // An empty `default:` is an explicit empty string, not an absent default — absent inputs are marked required.
  if (trimmed.length === 0) {
    return '';
  }
  if (inputType === 'string') {
    return trimmed.replace(/^["']|["']$/g, '').trim();
  }
  return parseScalar(trimmed);
}

/**
 * Parse one `options:` entry into the value YAML says it is.
 *
 * Kept in step with {@link parseDefaultValue}: an entry and a default that read the same in the spec must produce
 * the same value, or a `default: false` never matches the `false` in `options: [true, false]` and fails to
 * pre-select. A `string` input — declared or by omission — keeps entries literal for the same reason defaults do.
 *
 * @param entry - One option's raw text, quotes and surrounding whitespace included.
 * @param inputType - The input's resolved `type:`; `'string'` when the spec omits it.
 * @returns The entry as a string, number, or boolean.
 */
function parseOptionEntry(entry: string, inputType: string): string | number | boolean {
  const trimmed = entry.trim();
  if (inputType === 'string') {
    return trimmed.replace(/^["']|["']$/g, '').trim();
  }
  const parsed = parseScalar(trimmed);
  // `options:` entries are scalars; a null or nested-array entry isn't meaningful, so keep those as their text.
  return parsed === null || Array.isArray(parsed) ? trimmed.replace(/^["']|["']$/g, '').trim() : parsed;
}

export interface ComponentVariable {
  name: string;
  description: string;
  required: boolean;
  type: string;
  /**
   * The input's `default:`, as the value YAML says it is — `default: false` is the boolean `false`, not `"false"`.
   * Consumers render it back to YAML by type, so a string default here must be a genuine string.
   */
  default?: ParameterDefault;
  /**
   * Allowed values from the input's `options:` list, in declaration order; absent when no `options:` is given.
   * Entries carry their YAML types, so they compare equal to a `default` that names one of them.
   */
  options?: Array<string | number | boolean>;
}

export interface ParsedSpec {
  description?: string;
  variables: ComponentVariable[];
  isValidComponent: boolean;
}

/**
 * Parse the inline form of an `options:` value (`options: [a, "b", c]`).
 *
 * Returns an empty array for the expanded form (`options:` with the values on following `- item` lines), which the
 * caller then fills in as it reads those lines. Surrounding brackets are stripped and blank entries (e.g. a trailing
 * comma) are dropped, but each entry stays raw text — {@link parseOptionEntry} types it once the input's `type:` is
 * known, which may be declared after `options:`.
 *
 * @param rawValue - The text after `options:` on the same line, e.g. `[a, "b", c]` (or empty for the expanded form).
 * @returns The raw option entries, or an empty array when the value isn't an inline `[...]` list.
 */
function parseInlineOptions(rawValue: string): string[] {
  if (!rawValue.startsWith('[')) {
    return [];
  }
  return rawValue
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/**
 * Unified parser for GitLab CI/CD component specs
 * Handles both new format (spec.inputs) and legacy format (spec.variables)
 */
export class GitLabSpecParser {
  /**
   * Parse GitLab component spec from template content
   * @param content Full template content (YAML)
   * @param fileName Optional filename for logging purposes
   * @returns Parsed spec with description, variables, and validity flag
   * @throws ParseError if content is invalid or parsing fails
   */
  static parse(content: string, fileName?: string): ParsedSpec {
    const logPrefix = fileName ? `[SpecParser] Template ${fileName}:` : '[SpecParser]';

    try {
      // Validate input
      if (typeof content !== 'string') {
        throw new ParseError('Content must be a string', {
          yaml: String(content).substring(0, 100)
        });
      }

      if (content.trim().length === 0) {
        throw new ParseError('Content is empty', { yaml: content });
      }

      let extractedDescription = '';
      let extractedVariables: ComponentVariable[] = [];

      // Split content by the GitLab component spec separator '---'
      // Everything before '---' is the spec section, everything after is the CI/CD job definitions
      const parts = content.split(/^---\s*$/m);
      const specSection = parts[0] || '';

      logger.debug(`${logPrefix} Found ${parts.length} sections (spec + jobs)`, 'SpecParser');
      logger.debug(`${logPrefix} Spec section length: ${specSection.length} chars`, 'SpecParser');

      // Check if this file has a valid spec section - required for GitLab CI/CD components
      // Files without a spec section are not components (e.g., YAML anchors/fragments)
      const hasSpecSection = specSection.match(/^spec:\s*$/m) !== null;

      // Extract description from comment at top of file
      // Note: GitLab component specs don't have spec.description field
      const commentMatch = specSection.match(/^#\s*(.+?)$/m);
      if (commentMatch && !commentMatch[1].toLowerCase().includes('gitlab') && !commentMatch[1].toLowerCase().includes('ci')) {
        extractedDescription = commentMatch[1].trim();
        logger.debug(`${logPrefix} Found comment description: ${extractedDescription}`, 'SpecParser');
      }

      // Extract variables from GitLab CI/CD component spec format - ONLY from spec section
      try {
        const specMatches = specSection.match(SPEC_INPUTS_SECTION_REGEX);
        if (specMatches) {
          logger.debug(`${logPrefix} Found spec inputs section`, 'SpecParser');
          extractedVariables = this.parseInputsSection(specMatches[1], logPrefix);
        } else {
          logger.debug(`${logPrefix} No spec inputs found, trying fallback parsing`, 'SpecParser');
          extractedVariables = this.parseLegacyVariablesSection(specSection, logPrefix);
        }
      } catch (error) {
        throw new ParseError('Failed to parse spec inputs/variables', {
          cause: error as Error,
          yaml: specSection.substring(0, 500)
        });
      }

      // Determine if this is a valid component - must have a spec section
      // Files that only contain YAML anchors (like .options or .common templates) are not components
      const isValidComponent = hasSpecSection;
      logger.debug(`${logPrefix} isValidComponent=${isValidComponent} (hasSpecSection=${hasSpecSection})`, 'SpecParser');

      return {
        description: extractedDescription,
        variables: extractedVariables,
        isValidComponent
      };
    } catch (error) {
      // If already a ParseError, re-throw
      if (error instanceof ParseError) {
        throw error;
      }

      // Wrap unknown errors
      throw new ParseError(
        `Failed to parse GitLab component spec: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error as Error,
          yaml: content.substring(0, 500)
        }
      );
    }
  }

  /**
   * Parse the new spec.inputs format
   */
  private static parseInputsSection(inputsSection: string, logPrefix: string): ComponentVariable[] {
    const extractedVariables: ComponentVariable[] = [];
    const inputLines = inputsSection.split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'));

    let currentInput: ComponentVariable | null = null;
    // The `default:` text for `currentInput`, held until the input ends so the declared `type:` can steer the parse.
    let rawDefault: string | null = null;
    // Raw `options:` entries for `currentInput`, typed by `finalizeInput` for the same reason as `rawDefault`.
    let rawOptions: string[] | null = null;

    /**
     * Resolve the pending `default:` and `options:` against the declared type and mark a defaultless input
     * required. Deferred to here because `type:` may be declared after either of them.
     */
    const finalizeInput = (input: ComponentVariable): ComponentVariable => {
      // An omitted `type:` is `string` to GitLab, and `input.type` already holds that fallback.
      if (rawDefault !== null) {
        input.default = parseDefaultValue(rawDefault, input.type);
      } else {
        // GitLab CI/CD component behavior: an input with no default is required.
        input.required = true;
      }
      if (rawOptions !== null) {
        // Typed against the input's type so an entry matches a `default` naming the same value.
        input.options = rawOptions.map(entry => parseOptionEntry(entry, input.type));
      }
      rawDefault = null;
      rawOptions = null;
      return input;
    };

    for (const line of inputLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Stop if we hit a top-level key (indicating we've left the inputs section)
      if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) {
        logger.debug(`${logPrefix} Stopping at top-level key: ${trimmedLine}`, 'SpecParser');
        break;
      }

      // New input parameter (indented under inputs) - handle both 2-space and 4-space indentation.
      // Match lines like "    name:" where the input name ends with ":" and has only whitespace after.
      // The name class includes `-`: GitLab input names are commonly hyphenated (e.g. `job-name`). Without
      // it, a hyphenated key isn't recognised as a new input, so its `description:`/`default:` lines bleed
      // onto the previous (non-hyphenated) input and mis-map every field after it (issue #211).
      // An input's own keys are excluded by name: on a spec indented `inputs:` at 0, they sit at 4 and would
      // otherwise match, so a valueless `default:` would open a phantom input and swallow the real one's value.
      if (line.match(/^\s{2,4}[a-zA-Z_][a-zA-Z0-9_-]*:\s*$/) && !INPUT_FIELD_KEYS.has(trimmedLine.slice(0, -1))) {
        // If we have a current input, finalize it before starting a new one
        if (currentInput) {
          extractedVariables.push(finalizeInput(currentInput));
        }
        const inputName = trimmedLine.split(':')[0];
        currentInput = {
          name: inputName,
          description: `Parameter: ${inputName}`,
          required: false, // Will be updated to true if no default found
          type: 'string',
          default: undefined
        };
        logger.debug(`${logPrefix} Found input parameter: ${inputName}`, 'SpecParser');
      }
      // Property of current input (more deeply indented) - handle 4+ spaces of indentation
      else if (currentInput && line.match(/^\s{4,}/)) {
        if (trimmedLine.startsWith('description:')) {
          currentInput.description = trimmedLine.substring(12).replace(/^["']|["']$/g, '').trim();
        } else if (trimmedLine.startsWith('default:')) {
          // Kept as text until the input is complete: `type:` may follow `default:`, and the declared type decides
          // whether the value is parsed as YAML or kept literal. Resolved by `finalizeInput`.
          rawDefault = trimmedLine.substring(8);
        } else if (trimmedLine.startsWith('type:')) {
          currentInput.type = trimmedLine.substring(5).replace(/^["']|["']$/g, '').trim();
        } else if (trimmedLine.startsWith('options:')) {
          // Open the options list. An inline form (`options: [a, b]`) carries its values on the same line;
          // the expanded form leaves them for the `- item` lines below.
          rawOptions = parseInlineOptions(trimmedLine.substring(8).trim());
        } else if (trimmedLine.startsWith('- ') && rawOptions) {
          // Expanded list item belonging to the open `options:` block.
          rawOptions.push(trimmedLine.substring(2).trim());
        }
      }
    }

    // Add the last input
    if (currentInput) {
      extractedVariables.push(finalizeInput(currentInput));
    }

    logger.debug(`${logPrefix} Extracted ${extractedVariables.length} input parameters from spec`, 'SpecParser');
    return extractedVariables;
  }

  /**
   * Safe parse that returns either the result or error without throwing
   * Useful for batch operations where one failure shouldn't stop processing
   * @param content Full template content (YAML)
   * @param fileName Optional filename for logging purposes
   * @returns Object with either parsed data or error
   */
  static safeParse(
    content: string,
    fileName?: string
  ): { success: true; data: ParsedSpec } | { success: false; error: ParseError } {
    try {
      const data = this.parse(content, fileName);
      return { success: true, data };
    } catch (error) {
      const parseError = error instanceof ParseError
        ? error
        : new ParseError(
            error instanceof Error ? error.message : String(error),
            { cause: error as Error, yaml: content.substring(0, 500) }
          );

      return { success: false, error: parseError };
    }
  }

  /**
   * Parse the legacy spec.variables format
   */
  private static parseLegacyVariablesSection(specSection: string, logPrefix: string): ComponentVariable[] {
    // Fallback to old format for backward compatibility - also only in spec section
    // Look for variables section that's ONLY within the spec section
    const variableMatches = specSection.match(/spec:\s*[\s\S]*?variables:([\s\S]*?)(?=\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/);
    if (!variableMatches) {
      logger.debug(`${logPrefix} No variables found in fallback parsing`, 'SpecParser');
      return [];
    }

    const variableSection = variableMatches[1];
    const varLines = variableSection.split('\n');

    const extractedVariables = varLines
      .filter(line => {
        const trimmed = line.trim();
        // Only include properly indented variable definitions
        return trimmed &&
               line.match(/^\s{2,}/) && // Must be indented
               trimmed.includes(':') &&
               !trimmed.startsWith('#') &&
               !line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/); // Not a top-level key
      })
      .map(line => {
        const parts = line.trim().split(':');
        const varName = parts[0].trim();
        const defaultValue = parts.slice(1).join(':').trim();

        return {
          name: varName,
          description: `Parameter: ${varName}`,
          required: false,
          type: 'string',
          // The legacy format declares no per-variable type, so values stay the text they appear as.
          default: defaultValue ? parseDefaultValue(defaultValue, 'string') : undefined
        };
      });

    logger.debug(`${logPrefix} Extracted ${extractedVariables.length} variables from fallback parsing`, 'SpecParser');
    return extractedVariables;
  }
}
