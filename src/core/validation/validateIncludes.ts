/**
 * Validate every `include:` entry of a GitLab CI document: component references (unresolved variables, fetch and
 * auth failures, unknown and missing inputs) and `local:` includes. Host-neutral: the caller supplies how to resolve
 * references, look up components, and read local includes.
 */

import { Logger } from '../../utils/logger';
import { isAuthError } from '../../errors';
import { parseYamlDocuments, findDocumentWith } from '../../utils/yamlParser';
import { isIncludeEntry, isLocalInclude, type IncludeEntry } from '../../utils/includeMatcher';
import type { ComponentParameter } from '../../types/git-component';
import type { ReferenceResolver } from '../references';
import type { LocalIncludeOutcome } from '../localInclude';
import { splitDocumentLines, wholeLineRange, type Finding } from './findings';
import { findLineForComponent } from './includeLines';
import { validateLocalInclude, unknownInputRange } from './validateLocalInclude';

const logger = Logger.getInstance();

/** The parts of a component validation reads. */
export interface ValidatableComponent {
  name: string;
  parameters?: ComponentParameter[];
  source?: string;
}

/** How the validator finds the component a reference points at. */
export interface ComponentLookupPort {
  /** The cached component for exactly this expanded URL, or `null`. Must not throw. */
  findCached(expandedUrl: string): Promise<ValidatableComponent | null>;
  /** Fetch (and cache) the component. Resolves `null` when it doesn't exist; rejects when the fetch fails. */
  fetch(expandedUrl: string): Promise<ValidatableComponent | null>;
}

export interface ValidateIncludesInput {
  /** The document text. */
  text: string;
  /** The document's path, copied onto every finding. */
  file: string;
  /** One resolver per document pass, so the expansion context is looked up at most once. */
  resolveReference: ReferenceResolver;
  components: ComponentLookupPort;
  /** Resolves a `local:` path against the document's repository. */
  resolveLocalInclude(localPath: string): Promise<LocalIncludeOutcome<{ name: string; parameters: ComponentParameter[] }>>;
}

/** Shared state for one validation pass. */
export interface ValidationPass {
  input: ValidateIncludesInput;
  includes: IncludeEntry[];
  documentLines: string[];
  findings: Finding[];
  /** Prevents duplicate unknown-input findings for the same input on the same line. */
  findingKeys: Set<string>;
}

// Inputs that are really mid-edit typing or stray editor tokens: numeric keys, function-like names, 1-2 characters.
const SUSPICIOUS_INPUT_KEY = /^(toCommandArgument|fileToCommandArgument|trimQuotes|format|splitLines|fileToCommandArgumentForPythonExt|toCommandArgumentForPythonExt)/;
const MIN_INPUT_KEY_LENGTH = 3;

/**
 * Validate the includes of a GitLab CI document.
 *
 * @returns The findings in document order; empty when the text has no `include` or doesn't parse.
 */
export async function validateIncludes(input: ValidateIncludesInput): Promise<Finding[]> {
  const { text } = input;
  // Additional check: ensure the content actually looks like GitLab CI (contains 'include:' or 'include')
  if (!text.includes('include:') && !text.includes('include')) {
    logger.debug(`[ValidationProvider] Skipping validation - no 'include' found in content`, 'ValidationProvider');
    return [];
  }

  // Silent: validation runs on every edit against the live, often mid-edit document; a parse failure is
  // expected and handled below (no findings), so it should not log to the debug console.
  // A component template is a multi-document stream (`spec:` header + `include:` body), so select the
  // document that owns `include` rather than assuming a single document.
  const parsedYaml = findDocumentWith(parseYamlDocuments(text, true), 'include');
  if (parsedYaml === null) {
    return [];
  }

  const rawIncludes: unknown[] = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];
  const includes: IncludeEntry[] = rawIncludes.filter(isIncludeEntry);
  logger.debug(`[ValidationProvider] Found ${includes.length} include entries`, 'ValidationProvider');

  const pass: ValidationPass = {
    input,
    includes,
    documentLines: splitDocumentLines(text),
    findings: [],
    findingKeys: new Set<string>(),
  };

  for (let includeIndex = 0; includeIndex < includes.length; includeIndex++) {
    const include = includes[includeIndex];
    if (isLocalInclude(include)) {
      await validateLocalInclude(pass, include, includeIndex);
      continue;
    }
    if (include.component) {
      await validateComponentInclude(pass, include, includeIndex, include.component);
    }
  }
  return pass.findings;
}

async function validateComponentInclude(
  pass: ValidationPass,
  include: IncludeEntry,
  includeIndex: number,
  componentUrl: string
): Promise<void> {
  const { input, includes, documentLines, findings } = pass;
  logger.debug(`[ValidationProvider] Processing component ${includeIndex + 1}/${includes.length}: ${componentUrl}`, 'ValidationProvider');
  logger.debug(`[ValidationProvider] Include object:`, 'ValidationProvider');
  logger.debug(JSON.stringify(include, null, 2), 'ValidationProvider');

  const resolved = await input.resolveReference(componentUrl);
  if (!resolved.resolved) {
    const { reason } = resolved;
    const isNonGitlabRepo = reason.kind === 'non-gitlab-repo';
    const message = isNonGitlabRepo
      ? `Component URL contains unresolved GitLab variables: '${componentUrl}'. This project is hosted on ${reason.hostname}, not GitLab. GitLab Component Helper requires a GitLab repository to resolve CI/CD variables like $CI_SERVER_FQDN and $CI_PROJECT_PATH.`
      : `Component URL contains unresolved GitLab variables: '${componentUrl}'. Configure component sources in settings to resolve these variables.`;

    const line = findLineForComponent(input.text, includes, includeIndex);
    findings.push({
      code: 'unresolved-variables',
      severity: 'information',
      message,
      file: input.file,
      range: wholeLineRange(documentLines, line),
      metadata: {
        code: 'unresolved-variables',
        componentUrl,
        expandedUrl: reason.kind === 'incomplete' ? reason.expandedUrl : componentUrl,
        includeInputs: include.inputs || {},
        isNonGitlabRepo,
      },
    });
    logger.debug(`[ValidationProvider] Created unresolved variables diagnostic (${reason.kind}) for ${componentUrl}`, 'ValidationProvider');
    // Skip input validation for URLs with unresolved variables
    return;
  }
  const expandedUrl = resolved.url;

  // First try to find the component in cache (using expanded URL)
  let component = await input.components.findCached(expandedUrl);

  // Track if component fetch failed, and whether the failure was an auth/token error
  // (which gets a distinct diagnostic + "update token" quick fix).
  let componentFetchFailed = false;
  let componentAuthFailed = false;

  // If not found in cache, fetch from API and cache it (using expanded URL)
  if (!component) {
    logger.debug(`[ValidationProvider] Component not found in cache, fetching: ${expandedUrl}`, 'ValidationProvider');
    try {
      const fetchedComponent = await input.components.fetch(expandedUrl);
      if (fetchedComponent) {
        component = fetchedComponent;
        logger.debug(`[ValidationProvider] Successfully fetched component: ${fetchedComponent.name}`, 'ValidationProvider');
      } else {
        logger.debug(`[ValidationProvider] Component not found or accessible: ${expandedUrl}`, 'ValidationProvider');
        componentFetchFailed = true;
      }
    } catch (error) {
      logger.debug(`[ValidationProvider] Error fetching component ${expandedUrl}: ${error}`, 'ValidationProvider');
      componentFetchFailed = true;
      componentAuthFailed = isAuthError(error);
    }
  } else {
    logger.debug(`[ValidationProvider] Using cached component: ${component.name}`, 'ValidationProvider');
  }

  // If component fetch failed, add a single diagnostic about the fetch failure
  // instead of showing "unknown input" warnings for all inputs. An auth failure gets a
  // distinct message + "update token" quick fix; everything else stays generic.
  if (componentFetchFailed) {
    const line = findLineForComponent(input.text, includes, includeIndex);
    const code = componentAuthFailed ? 'component-auth-failed' : 'component-fetch-failed';
    const message = componentAuthFailed
      ? `GitLab token for '${componentUrl}' is missing, invalid, or expired. Update it to validate this component.`
      : `Unable to fetch component '${componentUrl}'. Component may not exist, be inaccessible, or the URL may be incorrect.`;

    findings.push({
      code,
      severity: 'warning',
      message,
      file: input.file,
      range: wholeLineRange(documentLines, line),
      metadata: {
        code,
        componentUrl: componentUrl,
        expandedUrl: expandedUrl,
        includeInputs: include.inputs || {}
      },
    });
    logger.debug(`[ValidationProvider] Created component ${componentAuthFailed ? 'auth' : 'fetch'} failure diagnostic for ${componentUrl}`, 'ValidationProvider');
    // Skip input validation for failed component fetches
    return;
  }

  if (component && component.parameters) {
    validateComponentInputs(pass, include, includeIndex, componentUrl, { ...component, parameters: component.parameters });
  }
}

function isUnresolvedPlaceholder(component: ValidatableComponent): boolean {
  return component.source === 'Non-GitLab Repository' ||
    component.source === 'GitLab Variables' ||
    !!component.name?.includes('unresolved variables') ||
    !!component.name?.includes('Component with variables');
}

function validateComponentInputs(
  pass: ValidationPass,
  include: IncludeEntry,
  includeIndex: number,
  componentUrl: string,
  component: ValidatableComponent & { parameters: ComponentParameter[] }
): void {
  const { input, includes, documentLines, findings } = pass;
  // Skip input validation for components that represent unresolved variables
  if (isUnresolvedPlaceholder(component)) {
    logger.debug(`[ValidationProvider] Skipping input validation for component with unresolved variables: ${component.name}`, 'ValidationProvider');
    return;
  }

  logger.debug(`[ValidationProvider] Component has ${component.parameters.length} parameters`, 'ValidationProvider');
  const providedInputs = include.inputs || {};
  const componentInputs = component.parameters;

  // Defensive check: validate that provided inputs are reasonable
  // Skip validation if inputs seem malformed (e.g., numeric keys, function names)
  const suspiciousKeys = Object.keys(providedInputs).filter(key =>
    /^\d+$/.test(key) || SUSPICIOUS_INPUT_KEY.test(key) || key.length < MIN_INPUT_KEY_LENGTH
  );
  if (suspiciousKeys.length > 0) {
    logger.debug(`[ValidationProvider] Skipping validation due to suspicious input keys: ${suspiciousKeys.join(', ')}`, 'ValidationProvider');
    return;
  }

  for (const providedInput in providedInputs) {
    if (componentInputs.some(p => p.name === providedInput)) {
      continue;
    }
    const placed = unknownInputRange(pass, includeIndex, providedInput, componentUrl);
    if (!placed) {
      continue;
    }
    findings.push({
      code: 'unknown-input',
      severity: 'warning',
      message: `Unknown input '${providedInput}' for component '${component.name}'.`,
      file: input.file,
      range: placed.range,
      // Metadata for code actions - specific to this input only
      metadata: {
        code: 'unknown-input',
        componentName: component.name,
        componentUrl: componentUrl,
        unknownInput: providedInput,
        availableInputs: componentInputs.map(p => p.name),
        componentInputs: componentInputs, // Include full input details for descriptions
        // Only include the current unknown input, not all provided inputs
        currentInputOnly: true
      },
    });
  }

  for (const componentInput of componentInputs) {
    if (componentInput.required && !Object.prototype.hasOwnProperty.call(providedInputs, componentInput.name)) {
      const line = findLineForComponent(input.text, includes, includeIndex);
      findings.push({
        code: 'missing-required-input',
        severity: 'error',
        message: `Missing required input '${componentInput.name}' for component '${component.name}'.`,
        file: input.file,
        range: wholeLineRange(documentLines, line),
        metadata: {
          code: 'missing-required-input',
          componentName: component.name,
          componentUrl: componentUrl,
          missingInput: componentInput.name,
          inputDescription: componentInput.description,
          inputType: componentInput.type,
          inputDefault: componentInput.default,
          providedInputs: Object.keys(providedInputs)
        },
      });
    }
  }
}
