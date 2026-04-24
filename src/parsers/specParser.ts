import { SPEC_INPUTS_SECTION_REGEX } from '../constants/regex';
import { Logger } from '../utils/logger';
import { ParseError, ErrorCode, getErrorHandler } from '../errors';

const logger = Logger.getInstance();
const errorHandler = getErrorHandler();

export interface ComponentVariable {
  name: string;
  description: string;
  required: boolean;
  type: string;
  default?: string;
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

    let currentInput: any = null;

    for (const line of inputLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Stop if we hit a top-level key (indicating we've left the inputs section)
      if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) {
        logger.debug(`${logPrefix} Stopping at top-level key: ${trimmedLine}`, 'SpecParser');
        break;
      }

      // New input parameter (indented under inputs) - handle both 2-space and 4-space indentation
      // Match lines like "    name:" where the input name ends with ":" and has only whitespace after
      if (line.match(/^\s{2,4}[a-zA-Z_][a-zA-Z0-9_]*:\s*$/)) {
        // If we have a current input, finalize it before starting a new one
        if (currentInput) {
          // Mark as required if no default was specified (GitLab CI/CD component behavior)
          if (currentInput.default === undefined) {
            currentInput.required = true;
          }
          extractedVariables.push(currentInput);
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
          currentInput.default = trimmedLine.substring(8).replace(/^["']|["']$/g, '').trim();
        } else if (trimmedLine.startsWith('type:')) {
          currentInput.type = trimmedLine.substring(5).replace(/^["']|["']$/g, '').trim();
        }
      }
    }

    // Add the last input
    if (currentInput) {
      // Mark as required if no default was specified (GitLab CI/CD component behavior)
      if (currentInput.default === undefined) {
        currentInput.required = true;
      }
      extractedVariables.push(currentInput);
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
          default: defaultValue || undefined
        };
      });

    logger.debug(`${logPrefix} Extracted ${extractedVariables.length} variables from fallback parsing`, 'SpecParser');
    return extractedVariables;
  }
}
