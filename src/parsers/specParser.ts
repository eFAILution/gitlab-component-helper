import { Logger } from '../utils/logger';
import { ParseError } from '../errors/types';
import type { ParameterDefault } from '../types/git-component';
import { readSpecInputs } from './specInputs';

const logger = Logger.getInstance();

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
        const spec = readSpecInputs(specSection);
        if (spec.kind === 'invalid') {
          logger.debug(`${logPrefix} Spec section is not valid YAML (${spec.reason}); no inputs extracted`, 'SpecParser');
        } else if (spec.kind === 'spec' && spec.inputs) {
          logger.debug(`${logPrefix} Found spec inputs section`, 'SpecParser');
          extractedVariables = spec.inputs;
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
          default: defaultValue ? defaultValue.replace(/^["']|["']$/g, '').trim() : undefined
        };
      });

    logger.debug(`${logPrefix} Extracted ${extractedVariables.length} variables from fallback parsing`, 'SpecParser');
    return extractedVariables;
  }
}
