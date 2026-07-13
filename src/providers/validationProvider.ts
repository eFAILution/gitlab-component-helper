import * as vscode from 'vscode';
import { getComponentService } from '../services/component';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { parseYaml, isYamlNode } from '../utils/yamlParser';
import { Component, ComponentParameter } from '../types/git-component';
import { Logger } from '../utils/logger';
import { expandComponentUrl, containsGitLabVariables } from '../utils/gitlabVariables';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';
import { spawn } from 'child_process';
import { resolveLocalIncludeOutcome, isUnsupportedLocalPath } from './localComponentResolver';
import { attachDiagnosticMetadata, readDiagnosticMetadata } from './validationMetadata';
import { isAuthError } from '../errors';
import type { MissingRequiredInputMetadata } from './validationMetadata';
import type { GitApi, GitRepository } from '../types/vscode-git';
import type { CachedComponent } from '../types/cache';
import {
    collectSemverComponentBases,
    findOutdatedComponentRefs,
    type OutdatedComponentRef,
} from './componentVersionCheck';
import {
    type IncludeEntry,
    type LocalInclude,
    isIncludeEntry,
    isLocalInclude,
    includeKeyAndUrl,
    includeLineMatches,
    findIncludeLine,
} from '../utils/includeMatcher';

export class ValidationProvider implements vscode.CodeActionProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    // Separate collection for "newer component version available" warnings. Kept apart from input/structure
    // diagnostics so the on-save version check and the on-edit input validation never clobber each other's
    // squiggles (VS Code merges diagnostics across collections natively).
    private versionDiagnostics: vscode.DiagnosticCollection;
    private logger = Logger.getInstance();
    private cacheManager = getComponentCacheManager();
    private validationTimeouts = new Map<string, NodeJS.Timeout>(); // Throttle validation per document

    constructor(context: vscode.ExtensionContext) {
        this.logger.debug('[ValidationProvider] Constructor called - initializing validation provider', 'ValidationProvider');

        // Test logger configuration
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const logLevel = config.get<string>('logLevel', 'INFO');
        this.logger.info(`[ValidationProvider] Logger test - current log level: ${logLevel}`, 'ValidationProvider');
        this.logger.debug('[ValidationProvider] Logger DEBUG test - if you see this, debug logging is working', 'ValidationProvider');

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('gitlab-component-helper');
        context.subscriptions.push(this.diagnosticCollection);

        this.versionDiagnostics = vscode.languages.createDiagnosticCollection('gitlab-component-versions');
        context.subscriptions.push(this.versionDiagnostics);

        // Register code action provider for the languages the providers run against.
        this.logger.debug('[ValidationProvider] Registering code action provider for yaml and shellscript', 'ValidationProvider');
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                [
                    { language: 'yaml' },
                    { language: 'shellscript' },
                ],
                this,
                {
                    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
                }
            )
        );

        this.logger.debug('[ValidationProvider] Registering document event listeners', 'ValidationProvider');
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                this.validate(doc);
                // Version checks hit the GitLab tags API, so they run on open/save rather than on every keystroke.
                this.checkComponentVersions(doc);
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                this.scheduleValidation(e.document);
            }),
            vscode.workspace.onDidSaveTextDocument(doc => this.checkComponentVersions(doc)),
            vscode.workspace.onDidCloseTextDocument(doc => {
                const documentId = doc.uri.toString();
                // Clear any pending validation timeouts
                const existingTimeout = this.validationTimeouts.get(documentId);
                if (existingTimeout) {
                    clearTimeout(existingTimeout);
                    this.validationTimeouts.delete(documentId);
                }
                this.diagnosticCollection.delete(doc.uri);
                this.versionDiagnostics.delete(doc.uri);
            })
        );

        // A newly-saved token can turn a `component-auth-failed` (or generic fetch failure) into a
        // successful fetch, so re-run validation on open documents to clear the stale diagnostics.
        this.logger.debug('[ValidationProvider] Subscribing to token changes', 'ValidationProvider');
        context.subscriptions.push(
            getComponentService().onDidChangeToken(() => {
                this.logger.debug('[ValidationProvider] Token changed - revalidating open documents', 'ValidationProvider');
                this.revalidateOpenDocuments();
            })
        );

        // Register command for showing input suggestions
        this.logger.debug('[ValidationProvider] Registering input suggestion commands', 'ValidationProvider');
        context.subscriptions.push(
            vscode.commands.registerCommand('gitlab-component-helper.showInputSuggestions',
                (args) => this.showInputSuggestionsQuickPick(args))
        );

        this.logger.debug('[ValidationProvider] Validating currently open documents', 'ValidationProvider');
        this.revalidateOpenDocuments();

        this.logger.debug('[ValidationProvider] Initialization complete', 'ValidationProvider');
    }

    public revalidateOpenDocuments(): void {
        vscode.workspace.textDocuments.forEach(doc => {
            this.logger.debug(`[ValidationProvider] Found open document: ${doc.fileName} (${doc.languageId})`, 'ValidationProvider');
            this.validate(doc);
            this.checkComponentVersions(doc);
        });
    }

    /**
     * Only the working-tree copy of a file should carry diagnostics. In a diff view the source (left) panel is a
     * read-only document under a VCS scheme (`git`, `gitlens`, `pr`, …) sharing the same `fsPath` as the working-tree
     * document, so validating both makes the squiggles appear on both panels. Restricting to the `file` scheme keeps
     * diagnostics on the editable (right) panel only.
     *
     * @param document - The text document a provider is about to validate.
     * @returns `true` if the document is the editable working-tree copy (`file` scheme); `false` for diff-source and
     *   other non-`file` documents that should not receive diagnostics.
     */
    private isDiagnosableDocument(document: vscode.TextDocument): boolean {
        return document.uri.scheme === 'file';
    }

    private async validate(document: vscode.TextDocument) {
        this.logger.debug(`[ValidationProvider] validate() called for: ${document.fileName}, languageId: ${document.languageId}`, 'ValidationProvider');

        if (!this.isDiagnosableDocument(document)) {
            this.logger.debug(`[ValidationProvider] Skipping validation - non-file URI scheme: ${document.uri.scheme}`, 'ValidationProvider');
            return;
        }

        if (!isGitLabCIFile(document)) {
            this.logger.debug(`[ValidationProvider] Skipping validation - not a supported file type`, 'ValidationProvider');
            return;
        }

        // Additional check: ensure the content actually looks like GitLab CI (contains 'include:' or 'include')
        const text = document.getText();
        if (!text.includes('include:') && !text.includes('include')) {
            this.logger.debug(`[ValidationProvider] Skipping validation - no 'include' found in content`, 'ValidationProvider');
            this.diagnosticCollection.set(document.uri, []); // Clear any existing diagnostics
            return;
        }

        this.logger.debug(`[ValidationProvider] Validating ${document.fileName}`, 'ValidationProvider');

        const diagnostics: vscode.Diagnostic[] = [];
        const diagnosticKeys = new Set<string>(); // Track unique diagnostics to prevent duplicates
        // Silent: validation runs on every edit against the live, often mid-edit document; a parse failure is
        // expected and handled below (diagnostics cleared), so it should not log to the debug console.
        const parsedYaml = parseYaml(text, true);

        if (!isYamlNode(parsedYaml) || !parsedYaml.include) {
            this.diagnosticCollection.set(document.uri, diagnostics);
            return;
        }

        const rawIncludes: unknown[] = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];
        const includes: IncludeEntry[] = rawIncludes.filter(isIncludeEntry);
        this.logger.debug(`[ValidationProvider] Found ${includes.length} include entries`, 'ValidationProvider');

        for (let includeIndex = 0; includeIndex < includes.length; includeIndex++) {
            const include = includes[includeIndex];
            if (isLocalInclude(include)) {
                await this.validateLocalInclude(document, include, includes, includeIndex, diagnostics, diagnosticKeys);
                continue;
            }
            if (include.component) {
                const componentUrl = include.component;
                this.logger.debug(`[ValidationProvider] Processing component ${includeIndex + 1}/${includes.length}: ${componentUrl}`, 'ValidationProvider');
                this.logger.debug(`[ValidationProvider] Include object:`, 'ValidationProvider');
                this.logger.debug(JSON.stringify(include, null, 2), 'ValidationProvider');

                // Check if component URL contains GitLab variables and expand them
                let expandedUrl = componentUrl;
                if (containsGitLabVariables(componentUrl)) {
                    this.logger.debug(`[ValidationProvider] Component URL contains variables, expanding: ${componentUrl}`, 'ValidationProvider');

                    // Try to get some context from workspace/git for expansion.
                    // Pass the document URI so multi-repo workspaces resolve to
                    // the GitLab host of the file's containing repo.
                    const workspaceContext = await this.getWorkspaceContext(document.uri);

                    // Only attempt expansion if we have sufficient context
                    if (workspaceContext.gitlabInstance && workspaceContext.projectPath) {
                        expandedUrl = expandComponentUrl(componentUrl, workspaceContext);
                        this.logger.debug(`[ValidationProvider] Expanded URL: ${expandedUrl}`, 'ValidationProvider');
                    } else {
                        this.logger.debug(`[ValidationProvider] Insufficient context for expansion. GitLab instance: ${workspaceContext.gitlabInstance}, Project path: ${workspaceContext.projectPath}`, 'ValidationProvider');

                        // Check if we're in a non-GitLab repository
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        const nonGitlabInfo = workspaceFolders ? await this.detectNonGitLabRepository(workspaceFolders[0].uri.fsPath) : null;
                        this.logger.debug(`[ValidationProvider] Non-GitLab repository detection result: ${nonGitlabInfo ? JSON.stringify(nonGitlabInfo) : 'null'}`, 'ValidationProvider');

                        if (nonGitlabInfo) {
                            // We're in a non-GitLab repository, create unresolved variables diagnostic
                            let diagnosticMessage = `Component URL contains unresolved GitLab variables: '${componentUrl}'. `;
                            diagnosticMessage += `This project is hosted on ${nonGitlabInfo.hostname}, not GitLab. GitLab Component Helper requires a GitLab repository to resolve CI/CD variables like $CI_SERVER_FQDN and $CI_PROJECT_PATH.`;

                            const line = this.findLineForComponent(document, includes, includeIndex);
                            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);

                            const diagnostic = new vscode.Diagnostic(
                                range,
                                diagnosticMessage,
                                vscode.DiagnosticSeverity.Information
                            );

                            diagnostic.code = 'unresolved-variables';
                            diagnostic.source = 'gitlab-component-helper';
                            attachDiagnosticMetadata(diagnostic, {
                                code: 'unresolved-variables',
                                componentUrl: componentUrl,
                                expandedUrl: expandedUrl,
                                includeInputs: include.inputs || {},
                                isNonGitlabRepo: true
                            });

                            this.logger.debug(`[ValidationProvider] Created unresolved variables diagnostic for non-GitLab repo: ${componentUrl}`, 'ValidationProvider');
                            diagnostics.push(diagnostic);

                            // Skip input validation for URLs with unresolved variables in non-GitLab repos
                            continue;
                        }

                        // If no non-GitLab repo detected, check for configured component sources
                        this.logger.debug(`[ValidationProvider] No non-GitLab repository detected, checking for configured component sources`, 'ValidationProvider');
                    }

                    // If expansion didn't help (still contains variables), treat as unresolved
                    if (containsGitLabVariables(expandedUrl) || expandedUrl.includes('undefined') || expandedUrl === componentUrl) {
                        this.logger.debug(`[ValidationProvider] URL expansion failed or incomplete: ${expandedUrl}`, 'ValidationProvider');

                        const line = this.findLineForComponent(document, includes, includeIndex);
                        const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Component URL contains unresolved GitLab variables: '${componentUrl}'. Configure component sources in settings to resolve these variables.`,
                            vscode.DiagnosticSeverity.Information
                        );

                        diagnostic.code = 'unresolved-variables';
                        diagnostic.source = 'gitlab-component-helper';
                        attachDiagnosticMetadata(diagnostic, {
                            code: 'unresolved-variables',
                            componentUrl: componentUrl,
                            expandedUrl: expandedUrl,
                            includeInputs: include.inputs || {}
                        });

                        this.logger.debug(`[ValidationProvider] Created unresolved variables diagnostic for ${componentUrl}`, 'ValidationProvider');
                        diagnostics.push(diagnostic);

                        // Skip input validation for URLs with unresolved variables
                        continue;
                    }
                }

                // First try to find the component in cache (using expanded URL)
                let component = await this.findComponentInCache(expandedUrl);

                // Track if component fetch failed, and whether the failure was an auth/token error
                // (which gets a distinct diagnostic + "update token" quick fix).
                let componentFetchFailed = false;
                let componentAuthFailed = false;

                // If not found in cache, fetch from API and cache it (using expanded URL)
                if (!component) {
                    this.logger.debug(`[ValidationProvider] Component not found in cache, fetching: ${expandedUrl}`, 'ValidationProvider');
                    try {
                        const fetchedComponent = await getComponentService().getComponentFromUrl(expandedUrl);
                        if (fetchedComponent) {
                            // Add to cache for future use (using original URL as key)
                            this.addComponentToCache(componentUrl, fetchedComponent);
                            component = fetchedComponent;
                            this.logger.debug(`[ValidationProvider] Successfully fetched component: ${fetchedComponent.name}`, 'ValidationProvider');
                        } else {
                            this.logger.debug(`[ValidationProvider] Component not found or accessible: ${expandedUrl}`, 'ValidationProvider');
                            componentFetchFailed = true;

                            // For testing purposes, create a mock component for known example URLs
                            if (this.isExampleMockComponentUrl(expandedUrl)) {
                                this.logger.debug(`[ValidationProvider] Creating mock component for testing: ${expandedUrl}`, 'ValidationProvider');
                                component = {
                                    name: 'mock-component',
                                    description: 'Mock component for testing validation',
                                    parameters: [
                                        { name: 'valid_input', description: 'A valid input parameter', required: true, type: 'string' },
                                        { name: 'optional_input', description: 'An optional input parameter', required: false, type: 'string' },
                                        { name: 'number_input', description: 'A number input parameter', required: false, type: 'number' }
                                    ],
                                    version: '1.0.0',
                                    source: expandedUrl,
                                    context: {
                                        gitlabInstance: 'gitlab.example.com',
                                        path: 'my-group/my-component'
                                    }
                                };
                                componentFetchFailed = false; // Mock component created successfully
                            }
                        }
                    } catch (error) {
                        this.logger.debug(`[ValidationProvider] Error fetching component ${expandedUrl}: ${error}`, 'ValidationProvider');
                        componentFetchFailed = true;
                        componentAuthFailed = isAuthError(error);
                    }
                } else {
                    this.logger.debug(`[ValidationProvider] Using cached component: ${component.name}`, 'ValidationProvider');
                }

                // If component fetch failed, add a single diagnostic about the fetch failure
                // instead of showing "unknown input" warnings for all inputs. An auth failure gets a
                // distinct message + "update token" quick fix; everything else stays generic.
                if (componentFetchFailed) {
                    const line = this.findLineForComponent(document, includes, includeIndex);
                    const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);

                    const code = componentAuthFailed ? 'component-auth-failed' : 'component-fetch-failed';
                    const message = componentAuthFailed
                        ? `GitLab token for '${componentUrl}' is missing, invalid, or expired. Update it to validate this component.`
                        : `Unable to fetch component '${componentUrl}'. Component may not exist, be inaccessible, or the URL may be incorrect.`;

                    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
                    diagnostic.code = code;
                    diagnostic.source = 'gitlab-component-helper';
                    attachDiagnosticMetadata(diagnostic, {
                        code,
                        componentUrl: componentUrl,
                        expandedUrl: expandedUrl,
                        includeInputs: include.inputs || {}
                    });

                    this.logger.debug(`[ValidationProvider] Created component ${componentAuthFailed ? 'auth' : 'fetch'} failure diagnostic for ${componentUrl}`, 'ValidationProvider');
                    diagnostics.push(diagnostic);

                    // Skip input validation for failed component fetches
                    continue;
                }

                if (component && component.parameters) {
                    // Skip input validation for components that represent unresolved variables
                    if (component.source === 'Non-GitLab Repository' ||
                        component.source === 'GitLab Variables' ||
                        component.name?.includes('unresolved variables') ||
                        component.name?.includes('Component with variables')) {
                        this.logger.debug(`[ValidationProvider] Skipping input validation for component with unresolved variables: ${component.name}`, 'ValidationProvider');
                        continue;
                    }

                    this.logger.debug(`[ValidationProvider] Component has ${component.parameters.length} parameters`, 'ValidationProvider');
                    const providedInputs = include.inputs || {};
                    const componentInputs = component.parameters;

                    // Defensive check: validate that provided inputs are reasonable
                    // Skip validation if inputs seem malformed (e.g., numeric keys, function names)
                    const inputKeys = Object.keys(providedInputs);
                    const suspiciousKeys = inputKeys.filter(key =>
                        // Filter out numeric keys (like '0', '1', '2')
                        /^\d+$/.test(key) ||
                        // Filter out function-like names that shouldn't be component inputs
                        /^(toCommandArgument|fileToCommandArgument|trimQuotes|format|splitLines|fileToCommandArgumentForPythonExt|toCommandArgumentForPythonExt)/.test(key) ||
                        // Filter out very short keys that are likely incomplete typing
                        key.length <= 2
                    );

                    if (suspiciousKeys.length > 0) {
                        this.logger.debug(`[ValidationProvider] Skipping validation due to suspicious input keys: ${suspiciousKeys.join(', ')}`, 'ValidationProvider');
                        continue;
                    }

                    for (const providedInput in providedInputs) {
                        if (!componentInputs.some(p => p.name === providedInput)) {
                            const line = this.findLineForInput(document, includes, includeIndex, providedInput);

                            // Create a unique key to prevent duplicate diagnostics for the same input
                            const diagnosticKey = `unknown-input-${line}-${providedInput}-${componentUrl}`;
                            if (diagnosticKeys.has(diagnosticKey)) {
                                this.logger.debug(`[ValidationProvider] Skipping duplicate diagnostic for input '${providedInput}' at line ${line}`, 'ValidationProvider');
                                continue;
                            }
                            diagnosticKeys.add(diagnosticKey);

                            // Create a more precise range that only covers the input name, not the entire line
                            const lineText = document.lineAt(line).text;
                            const inputIndex = lineText.indexOf(`${providedInput}:`);
                            let range: vscode.Range;

                            if (inputIndex !== -1) {
                                // Precise range covering only the input name
                                const startPos = new vscode.Position(line, inputIndex);
                                const endPos = new vscode.Position(line, inputIndex + providedInput.length);
                                range = new vscode.Range(startPos, endPos);
                                this.logger.debug(`[ValidationProvider] Created precise range for '${providedInput}': ${startPos.line}:${startPos.character}-${endPos.line}:${endPos.character}`, 'ValidationProvider');
                            } else {
                                // Fallback to entire line if we can't find the input
                                range = new vscode.Range(line, 0, line, lineText.length);
                                this.logger.debug(`[ValidationProvider] Using fallback range for '${providedInput}': entire line ${line}`, 'ValidationProvider');
                            }

                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Unknown input '${providedInput}' for component '${component.name}'.`,
                                vscode.DiagnosticSeverity.Warning
                            );

                            // Add metadata for code actions - specific to this input only
                            diagnostic.code = 'unknown-input';
                            diagnostic.source = 'gitlab-component-helper';
                            attachDiagnosticMetadata(diagnostic, {
                                code: 'unknown-input',
                                componentName: component.name,
                                componentUrl: componentUrl,
                                unknownInput: providedInput,
                                availableInputs: componentInputs.map(p => p.name),
                                componentInputs: componentInputs, // Include full input details for descriptions
                                // Only include the current unknown input, not all provided inputs
                                currentInputOnly: true
                            });

                            this.logger.debug(`[ValidationProvider] Created diagnostic for unknown input '${providedInput}' at range ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`, 'ValidationProvider');
                            diagnostics.push(diagnostic);
                        }
                    }

                    for (const componentInput of componentInputs) {
                        if (componentInput.required && !Object.prototype.hasOwnProperty.call(providedInputs, componentInput.name)) {
                            const line = this.findLineForComponent(document, includes, includeIndex);
                            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Missing required input '${componentInput.name}' for component '${component.name}'.`,
                                vscode.DiagnosticSeverity.Error
                            );

                            // Add metadata for code actions
                            diagnostic.code = 'missing-required-input';
                            diagnostic.source = 'gitlab-component-helper';
                            attachDiagnosticMetadata(diagnostic, {
                                code: 'missing-required-input',
                                componentName: component.name,
                                componentUrl: componentUrl,
                                missingInput: componentInput.name,
                                inputDescription: componentInput.description,
                                inputType: componentInput.type,
                                inputDefault: componentInput.default,
                                providedInputs: Object.keys(providedInputs)
                            });

                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }
        }

        this.logger.debug(`[ValidationProvider] Created ${diagnostics.length} total diagnostics for ${document.fileName}`, 'ValidationProvider');
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private isExampleMockComponentUrl(componentUrl: string): boolean {
        try {
            const parsed = new URL(componentUrl);
            const isExampleHost = parsed.hostname === 'gitlab.example.com';
            const hasExpectedPath = parsed.pathname.includes('/my-group/my-component');
            return isExampleHost || hasExpectedPath;
        } catch {
            // Fallback for malformed input in tests.
            return componentUrl.includes('my-group/my-component');
        }
    }

    /**
     * Re-validate a document after an edit, throttled to coalesce rapid keystrokes.
     *
     * Every edit to a GitLab CI file schedules a full pass: diagnostics depend on the whole document (an input edit
     * can resolve or raise a component-level error several lines away), so the change must be re-checked as a whole
     * rather than judged "relevant" by its surrounding lines. {@link validate} cheaply skips files that aren't GitLab
     * CI files or carry no `include`, and the 300ms throttle keeps typing responsive.
     */
    private scheduleValidation(document: vscode.TextDocument): void {
        if (!this.isDiagnosableDocument(document) || !isGitLabCIFile(document)) {
            return;
        }

        const documentId = document.uri.toString();
        const existingTimeout = this.validationTimeouts.get(documentId);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        this.validationTimeouts.set(documentId, setTimeout(() => {
            this.logger.debug(`[ValidationProvider] Throttled validation triggered for ${document.fileName}`, 'ValidationProvider');
            this.validate(document);
            this.validationTimeouts.delete(documentId);
        }, 300)); // 300ms delay to allow user to finish typing
    }

    /**
     * Provide code actions for diagnostics (suggestions for unknown inputs)
     */
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {

        this.logger.debug(`[ValidationProvider] provideCodeActions called with ${context.diagnostics.length} diagnostics for range ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`, 'ValidationProvider');

        const actions: vscode.CodeAction[] = [];
        const actionTitles = new Set<string>(); // Track action titles to prevent duplicates
        const processedDiagnostics = new Set<string>(); // Track processed diagnostics to prevent duplicates

        // Process only gitlab-component-helper diagnostics that EXACTLY overlap with the current range
        // This ensures we only show code actions for the specific diagnostic at the cursor position
        const relevantDiagnostics = context.diagnostics.filter(d => {
            if (d.source !== 'gitlab-component-helper') {
                return false;
            }

            // Check if the diagnostic range contains the cursor position or selection
            const diagnosticContainsRange = d.range.contains(range.start) ||
                                          d.range.contains(range.end) ||
                                          range.contains(d.range.start) ||
                                          range.contains(d.range.end);

            return diagnosticContainsRange;
        });

        this.logger.debug(`[ValidationProvider] Filtered to ${relevantDiagnostics.length} relevant diagnostics that exactly overlap with cursor/selection`, 'ValidationProvider');
        this.logger.debug(`[ValidationProvider] Cursor range: ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`, 'ValidationProvider');

        // Log each relevant diagnostic for debugging
        relevantDiagnostics.forEach((d, index) => {
            this.logger.debug(`[ValidationProvider] Relevant diagnostic ${index + 1}: range=${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}, message="${d.message}"`, 'ValidationProvider');
        });

        for (const diagnostic of relevantDiagnostics) {
            // Create a unique key for this diagnostic to prevent duplicate processing
            const diagnosticKey = `${diagnostic.range.start.line}:${diagnostic.range.start.character}-${diagnostic.code}-${diagnostic.message}`;

            if (processedDiagnostics.has(diagnosticKey)) {
                this.logger.debug(`[ValidationProvider] Skipping duplicate diagnostic: ${diagnosticKey}`, 'ValidationProvider');
                continue;
            }
            processedDiagnostics.add(diagnosticKey);

            this.logger.debug(`[ValidationProvider] Processing diagnostic: code=${diagnostic.code}, range=${diagnostic.range.start.line}:${diagnostic.range.start.character}, message="${diagnostic.message}"`, 'ValidationProvider');

            const diagnosticMetadata = readDiagnosticMetadata(diagnostic);
            if (diagnosticMetadata?.code === 'unknown-input') {
                const metadata = diagnosticMetadata;
                const availableInputs = metadata.availableInputs;
                const unknownInput = metadata.unknownInput;

                // For individual input diagnostics, only suggest replacements for that specific input
                // Don't exclude other provided inputs since this diagnostic is specific to one input
                const suggestedInputs = availableInputs.filter(input => input !== unknownInput);

                this.logger.debug(`[ValidationProvider] Available inputs: ${availableInputs.join(', ')}`, 'ValidationProvider');
                this.logger.debug(`[ValidationProvider] Unknown input: ${unknownInput}`, 'ValidationProvider');
                this.logger.debug(`[ValidationProvider] Suggested replacements: ${suggestedInputs.join(', ')}`, 'ValidationProvider');

                if (suggestedInputs.length > 0) {
                    // Limit the number of individual replacement suggestions to avoid clutter
                    const maxIndividualSuggestions = 3;
                    const limitedSuggestions = suggestedInputs.slice(0, maxIndividualSuggestions);

                    // Create action to replace with a suggested input (limited to top 3)
                    for (const suggestedInput of limitedSuggestions) {
                        const actionTitle = `Replace '${unknownInput}' with '${suggestedInput}'`;

                        // Skip if we already have this action
                        if (actionTitles.has(actionTitle)) {
                            continue;
                        }
                        actionTitles.add(actionTitle);

                        const action = new vscode.CodeAction(actionTitle, vscode.CodeActionKind.QuickFix);
                        action.edit = new vscode.WorkspaceEdit();

                        // Use the diagnostic's range for precise replacement
                        action.edit.replace(document.uri, diagnostic.range, suggestedInput);

                        // Associate this action with only the specific diagnostic it addresses
                        action.diagnostics = [diagnostic];
                        action.isPreferred = limitedSuggestions.indexOf(suggestedInput) === 0;

                        this.logger.debug(`[ValidationProvider] Created replacement action: "${actionTitle}" for diagnostic at ${diagnostic.range.start.line}:${diagnostic.range.start.character}`, 'ValidationProvider');
                        actions.push(action);
                    }

                    // Only add "show all options" if there are more than the limited suggestions
                    if (suggestedInputs.length > maxIndividualSuggestions) {
                        const showAllTitle = `Show all ${availableInputs.length} available inputs for '${metadata.componentName}'`;

                        if (!actionTitles.has(showAllTitle)) {
                            actionTitles.add(showAllTitle);

                            const showAllAction = new vscode.CodeAction(showAllTitle, vscode.CodeActionKind.QuickFix);
                            showAllAction.command = {
                                title: showAllTitle,
                                command: 'gitlab-component-helper.showInputSuggestions',
                                arguments: [{
                                    type: 'replace',
                                    documentUri: document.uri.toString(),
                                    range: diagnostic.range,
                                    unknownInput: unknownInput,
                                    availableInputs: availableInputs,
                                    componentInputs: metadata.componentInputs, // Include full input details
                                    componentName: metadata.componentName
                                }]
                            };
                            actions.push(showAllAction);
                        }
                    }
                }
            }
            else if (diagnosticMetadata?.code === 'unresolved-variables') {
                const metadata = diagnosticMetadata;
                const isNonGitlabRepo = metadata.isNonGitlabRepo ?? false;

                // Different suggestions based on repository type
                if (isNonGitlabRepo) {
                    const infoTitle = `GitLab Component Helper requires a GitLab repository`;
                    if (!actionTitles.has(infoTitle)) {
                        actionTitles.add(infoTitle);

                        const infoAction = new vscode.CodeAction(infoTitle, vscode.CodeActionKind.QuickFix);
                        infoAction.command = {
                            title: infoTitle,
                            command: 'vscode.open',
                            arguments: [vscode.Uri.parse('https://docs.gitlab.com/ee/ci/components/')]
                        };
                        infoAction.diagnostics = [diagnostic];
                        actions.push(infoAction);
                    }
                } else {
                    // Suggest actions for unresolved variables
                    const configureTitle = `Configure GitLab variables for development`;
                    if (!actionTitles.has(configureTitle)) {
                        actionTitles.add(configureTitle);

                        const configureAction = new vscode.CodeAction(configureTitle, vscode.CodeActionKind.QuickFix);
                        configureAction.command = {
                            title: configureTitle,
                            command: 'workbench.action.openSettings',
                            arguments: ['gitlabComponentHelper']
                        };
                        configureAction.diagnostics = [diagnostic];
                        actions.push(configureAction);
                    }

                    // Action to learn about GitLab variables
                    const learnTitle = `Learn about GitLab CI/CD variables`;
                    if (!actionTitles.has(learnTitle)) {
                        actionTitles.add(learnTitle);

                        const learnAction = new vscode.CodeAction(learnTitle, vscode.CodeActionKind.QuickFix);
                        learnAction.command = {
                            title: learnTitle,
                            command: 'vscode.open',
                            arguments: [vscode.Uri.parse('https://docs.gitlab.com/ee/ci/variables/predefined_variables.html')]
                        };
                        actions.push(learnAction);
                    }
                }
            }
            else if (diagnosticMetadata?.code === 'component-fetch-failed') {
                const metadata = diagnosticMetadata;
                const componentUrl = metadata.componentUrl;

                // Suggest actions for component fetch failures
                const retryTitle = `Retry fetching component from '${componentUrl}'`;
                if (!actionTitles.has(retryTitle)) {
                    actionTitles.add(retryTitle);

                    const retryAction = new vscode.CodeAction(retryTitle, vscode.CodeActionKind.QuickFix);
                    retryAction.command = {
                        title: retryTitle,
                        command: 'workbench.action.reloadWindow' // Simple retry by reloading
                    };
                    retryAction.diagnostics = [diagnostic];
                    actions.push(retryAction);
                }

                // Action to validate component URL format
                const validateUrlTitle = `Check component URL format`;
                if (!actionTitles.has(validateUrlTitle)) {
                    actionTitles.add(validateUrlTitle);

                    const validateUrlAction = new vscode.CodeAction(validateUrlTitle, vscode.CodeActionKind.QuickFix);
                    validateUrlAction.command = {
                        title: validateUrlTitle,
                        command: 'vscode.open',
                        arguments: [vscode.Uri.parse('https://docs.gitlab.com/ee/ci/components/')]
                    };
                    actions.push(validateUrlAction);
                }
            }
            else if (diagnosticMetadata?.code === 'component-auth-failed') {
                const updateTokenTitle = `Update GitLab token`;
                if (!actionTitles.has(updateTokenTitle)) {
                    actionTitles.add(updateTokenTitle);

                    const updateTokenAction = new vscode.CodeAction(updateTokenTitle, vscode.CodeActionKind.QuickFix);
                    updateTokenAction.command = {
                        title: updateTokenTitle,
                        command: 'gitlabComponentHelper.addProjectToken'
                    };
                    updateTokenAction.diagnostics = [diagnostic];
                    updateTokenAction.isPreferred = true;
                    actions.push(updateTokenAction);
                }
            }
            else if (diagnosticMetadata?.code === 'missing-required-input') {
                const metadata = diagnosticMetadata;
                const missingInput = metadata.missingInput;
                const inputDescription = metadata.inputDescription;
                const inputType = metadata.inputType;
                const inputDefault = metadata.inputDefault;

                const actionTitle = `Add required input '${missingInput}'`;

                // Skip if we already have this action
                if (!actionTitles.has(actionTitle)) {
                    actionTitles.add(actionTitle);

                    // Create action to add the missing input
                    const addInputAction = new vscode.CodeAction(actionTitle, vscode.CodeActionKind.QuickFix);
                    addInputAction.edit = new vscode.WorkspaceEdit();

                    // Find where to insert the input (look for inputs section or create one)
                    const componentLine = diagnostic.range.start.line;
                    const insertInfo = this.findInputsInsertPosition(document, componentLine);

                    let insertText: string;
                    if (insertInfo.needsInputsSection) {
                        // Add inputs section
                        insertText = `${insertInfo.indentation}inputs:\n${insertInfo.indentation}  ${missingInput}: `;
                    } else {
                        // Add to existing inputs section
                        insertText = `${insertInfo.indentation}${missingInput}: `;
                    }

                    // Add default value or placeholder based on type
                    if (inputDefault !== undefined) {
                        insertText += `${JSON.stringify(inputDefault)}`;
                    } else {
                        switch (inputType?.toLowerCase()) {
                            case 'boolean':
                                insertText += 'true';
                                break;
                            case 'number':
                            case 'integer':
                                insertText += '0';
                                break;
                            case 'array':
                                insertText += '[]';
                                break;
                            case 'object':
                                insertText += '{}';
                                break;
                            default:
                                insertText += `"" # ${inputDescription || 'Set value'}`;
                        }
                    }
                    insertText += '\n';

                    addInputAction.edit.insert(document.uri, insertInfo.position, insertText);
                    addInputAction.diagnostics = [diagnostic];
                    addInputAction.isPreferred = true;
                    actions.push(addInputAction);

                    // Add action to show all missing inputs for this component if there are multiple
                    const componentUrl = metadata.componentUrl;
                    const allMissingForComponent = relevantDiagnostics
                        .map(d => ({ diagnostic: d, metadata: readDiagnosticMetadata(d) }))
                        .filter((pair): pair is { diagnostic: vscode.Diagnostic; metadata: MissingRequiredInputMetadata } =>
                            pair.metadata?.code === 'missing-required-input' &&
                            pair.metadata.componentUrl === componentUrl
                        );

                    if (allMissingForComponent.length > 1) {
                        const showAllMissingTitle = `Add all ${allMissingForComponent.length} missing inputs for '${metadata.componentName}'`;

                        if (!actionTitles.has(showAllMissingTitle)) {
                            actionTitles.add(showAllMissingTitle);

                            const showAllMissingAction = new vscode.CodeAction(showAllMissingTitle, vscode.CodeActionKind.QuickFix);
                            showAllMissingAction.command = {
                                title: showAllMissingTitle,
                                command: 'gitlab-component-helper.showInputSuggestions',
                                arguments: [{
                                    type: 'add',
                                    documentUri: document.uri.toString(),
                                    range: diagnostic.range,
                                    availableInputs: allMissingForComponent.map(p => p.metadata.missingInput),
                                    componentName: metadata.componentName,
                                    missingInputs: allMissingForComponent.map(p => ({
                                        name: p.metadata.missingInput,
                                        description: p.metadata.inputDescription || '',
                                        type: p.metadata.inputType || 'string',
                                        default: p.metadata.inputDefault,
                                        required: true
                                    }))
                                }]
                            };
                            actions.push(showAllMissingAction);
                        }
                    }
                }
            }
            else if (diagnosticMetadata?.code === 'outdated-component-version') {
                const metadata = diagnosticMetadata;
                const updateTitle = `Update to ${metadata.latestVersion}`;
                if (!actionTitles.has(updateTitle)) {
                    actionTitles.add(updateTitle);

                    const updateAction = new vscode.CodeAction(updateTitle, vscode.CodeActionKind.QuickFix);
                    updateAction.edit = new vscode.WorkspaceEdit();
                    // diagnostic.range covers exactly the version ref, so replacing it bumps only the pinned version.
                    updateAction.edit.replace(document.uri, diagnostic.range, metadata.latestVersion);
                    updateAction.diagnostics = [diagnostic];
                    updateAction.isPreferred = true;
                    actions.push(updateAction);
                }
            }
        }

        this.logger.debug(`[ValidationProvider] Returning ${actions.length} unique code actions`, 'ValidationProvider');
        return actions;
    }

    private findLineForInput(
        document: vscode.TextDocument,
        includes: IncludeEntry[],
        includeIndex: number,
        inputName: string
    ): number {
        const lines = document.getText().split('\n');
        const componentLine = this.findLineForComponent(document, includes, includeIndex);
        const nextIncludeLine = this.findLineForNextInclude(document, includes, includeIndex, componentLine);

        this.logger.debug(`[ValidationProvider] Finding line for input '${inputName}', component line: ${componentLine}, bounded by next include at ${nextIncludeLine}`, 'ValidationProvider');

        // Two bounds keep the scan inside this include's own inputs block:
        //  - nextIncludeLine caps it before a sibling that may share input names (two includes of one component).
        //  - the indent break ends it at the first non-indented line, so it can't bleed into a top-level section
        //    (a job, `variables:`, etc.) below the last include, where nextIncludeLine is just end-of-file.
        for (let i = componentLine + 1; i < nextIncludeLine; i++) {
            if (lines[i].includes('inputs:')) {
                this.logger.debug(`[ValidationProvider] Found inputs section at line ${i}`, 'ValidationProvider');
                for (let j = i + 1; j < nextIncludeLine; j++) {
                    if (lines[j].includes(`${inputName}:`)) {
                        this.logger.debug(`[ValidationProvider] Found input '${inputName}' at line ${j}`, 'ValidationProvider');
                        return j;
                    }
                    if (!/^\s/.test(lines[j]) && lines[j].trim() !== '') {
                        break;
                    }
                }
                break;
            }
        }
        this.logger.debug(`[ValidationProvider] Input '${inputName}' not found, returning component line ${componentLine}`, 'ValidationProvider');
        return componentLine;
    }

    /**
     * Validate a single `include: - local:` entry. Resolves the target file relative to the workspace, parses its
     * `spec.inputs` block, and reports diagnostics for unknown inputs, missing required inputs, and unresolvable
     * file paths. Returns silently when the resolved file has no `spec.inputs` (it's a plain include, not a
     * parameterised template).
     *
     * @param document        The document being validated — used to read line text for diagnostic ranges and to
     *                        anchor workspace-relative path resolution.
     * @param include         This local include, already narrowed to {@link LocalInclude} by the caller.
     * @param includes        The full parsed include list, in document order. Passed alongside `includeIndex` so the
     *                        line-finders can disambiguate this entry from siblings that share its path.
     * @param includeIndex    This entry's position in `includes` (i.e. `includes[includeIndex] === include`).
     * @param diagnostics     Accumulator array. New diagnostics are pushed onto it; the caller owns publishing
     *                        the final list to the diagnostic collection.
     * @param diagnosticKeys  Dedup set shared across the whole validation pass. Prevents duplicate
     *                        `unknown-input` diagnostics for the same input on the same line.
     * @returns               Resolves once all diagnostics for this include have been pushed. Never rejects —
     *                        resolution or parse failures surface as warning diagnostics, not exceptions.
     */
    private async validateLocalInclude(
        document: vscode.TextDocument,
        include: LocalInclude,
        includes: IncludeEntry[],
        includeIndex: number,
        diagnostics: vscode.Diagnostic[],
        diagnosticKeys: Set<string>
    ): Promise<void> {
        const localPath = include.local;
        this.logger.debug(`[ValidationProvider] Processing local include: ${localPath}`, 'ValidationProvider');

        if (isUnsupportedLocalPath(localPath)) {
            // Globs and `../` paths are intentionally not handled; skip without diagnostics.
            return;
        }

        const outcome = await resolveLocalIncludeOutcome(localPath, document);
        if (outcome.kind === 'unreadable') {
            const line = this.findLineForComponent(document, includes, includeIndex);
            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Unable to resolve local include '${localPath}'. File not found or unreadable.`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = 'local-include-not-found';
            diagnostic.source = 'gitlab-component-helper';
            diagnostics.push(diagnostic);
            return;
        }

        // `skipped` (glob/`..`/no root) and `no-spec` (a valid plain include with no `spec:` block) both have no
        // inputs to validate — leave them alone rather than reporting a spurious not-found.
        if (outcome.kind !== 'component') {
            this.logger.debug(`[ValidationProvider] Local include not a parameterised template (${outcome.kind}), skipping: ${localPath}`, 'ValidationProvider');
            return;
        }
        const component = outcome.component;

        if (!component.parameters || component.parameters.length === 0) {
            this.logger.debug(`[ValidationProvider] Local include has no spec.inputs, skipping input validation: ${localPath}`, 'ValidationProvider');
            return;
        }

        const providedInputs: Record<string, unknown> = include.inputs || {};
        const componentInputs: ComponentParameter[] = component.parameters;

        for (const providedInput of Object.keys(providedInputs)) {
            if (componentInputs.some(p => p.name === providedInput)) {
                continue;
            }
            const line = this.findLineForInput(document, includes, includeIndex, providedInput);
            const diagnosticKey = `unknown-input-${line}-${providedInput}-${localPath}`;
            if (diagnosticKeys.has(diagnosticKey)) continue;
            diagnosticKeys.add(diagnosticKey);

            const lineText = document.lineAt(line).text;
            const inputIndex = lineText.indexOf(`${providedInput}:`);
            const range = inputIndex !== -1
                ? new vscode.Range(line, inputIndex, line, inputIndex + providedInput.length)
                : new vscode.Range(line, 0, line, lineText.length);

            const diagnostic = new vscode.Diagnostic(
                range,
                `Unknown input '${providedInput}' for local include '${component.name}'.`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = 'unknown-input';
            diagnostic.source = 'gitlab-component-helper';
            (diagnostic as vscode.Diagnostic & { metadata?: unknown }).metadata = {
                componentName: component.name,
                componentUrl: localPath,
                unknownInput: providedInput,
                availableInputs: componentInputs.map(p => p.name),
                componentInputs,
                currentInputOnly: true,
            };
            diagnostics.push(diagnostic);
        }

        for (const componentInput of componentInputs) {
            if (componentInput.required && !Object.prototype.hasOwnProperty.call(providedInputs, componentInput.name)) {
                const line = this.findLineForComponent(document, includes, includeIndex);
                const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Missing required input '${componentInput.name}' for local include '${component.name}'.`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.code = 'missing-required-input';
                diagnostic.source = 'gitlab-component-helper';
                (diagnostic as vscode.Diagnostic & { metadata?: unknown }).metadata = {
                    componentName: component.name,
                    componentUrl: localPath,
                    missingInput: componentInput.name,
                    inputDescription: componentInput.description,
                    inputType: componentInput.type,
                    inputDefault: componentInput.default,
                    providedInputs: Object.keys(providedInputs),
                };
                diagnostics.push(diagnostic);
            }
        }
    }

    /**
     * Locate the document line of the include entry at {@link includeIndex}.
     *
     * Two include entries can share an identical key+URL (e.g. the same component included twice with different
     * inputs). Matching on key+URL alone returns the first occurrence for both, mis-anchoring the second entry's
     * diagnostics onto the first. To disambiguate, this counts how many earlier entries in the parsed `includes`
     * array carry the same key+URL and returns the correspondingly-numbered occurrence in the document — relying
     * on the array being built in document order.
     *
     * @param document     The document being validated; its text is scanned line by line for the include.
     * @param includes     The full parsed include list, in document order.
     * @param includeIndex The position in `includes` of the entry to locate.
     * @returns The 0-based line number of the matching include declaration, or `0` when no matching line is found
     *          (e.g. the URL doesn't appear literally on a single line — folded scalar, alias). Callers use the
     *          returned line as the anchor for a diagnostic range.
     */
    private findLineForComponent(document: vscode.TextDocument, includes: IncludeEntry[], includeIndex: number): number {
        const { key, url } = includeKeyAndUrl(includes[includeIndex]);

        // The occurrence ordinal: how many entries at-or-before includeIndex share this exact key+URL.
        let targetOccurrence = 0;
        for (let k = 0; k <= includeIndex; k++) {
            const prior = includeKeyAndUrl(includes[k]);
            if (prior.key === key && prior.url === url) {
                targetOccurrence++;
            }
        }

        this.logger.debug(`[ValidationProvider] Looking for include URL: ${url} (occurrence ${targetOccurrence})`, 'ValidationProvider');

        const lines = document.getText().split('\n');
        const line = findIncludeLine(lines, key, url, targetOccurrence);
        if (line !== -1) {
            this.logger.debug(`[ValidationProvider] Found include at line ${line}: ${lines[line].trim()}`, 'ValidationProvider');
            return line;
        }
        this.logger.debug(`[ValidationProvider] Include URL not found, returning 0`, 'ValidationProvider');
        return 0;
    }

    /**
     * The line where the include entry *after* {@link includeIndex} begins, used as an exclusive upper bound when
     * scanning an include's inputs. Returns `document.lineCount` when this is the last include, so the scan runs to
     * end-of-file. `searchFrom` is the current include's own line — the next entry is found by scanning past it.
     *
     * @param document     The document being validated; its text is scanned line by line for the next include.
     * @param includes     The full parsed include list, in document order.
     * @param includeIndex The position in `includes` of the *current* entry; the next entry is `includeIndex + 1`.
     * @param searchFrom   The current include's own line; scanning starts at the line after it.
     * @returns The 0-based line number where the next include begins, or `document.lineCount` when there is no next
     *          include or its line can't be found — either way an exclusive upper bound that runs to end-of-file.
     */
    private findLineForNextInclude(
        document: vscode.TextDocument,
        includes: IncludeEntry[],
        includeIndex: number,
        searchFrom: number
    ): number {
        if (includeIndex + 1 >= includes.length) {
            return document.lineCount;
        }
        const { key, url } = includeKeyAndUrl(includes[includeIndex + 1]);
        const lines = document.getText().split('\n');
        for (let i = searchFrom + 1; i < lines.length; i++) {
            if (includeLineMatches(lines[i], key, url)) {
                return i;
            }
        }
        return document.lineCount;
    }

    /**
     * Find a component in the cache by URL
     */
    private async findComponentInCache(componentUrl: string): Promise<Component | null> {
        try {
            const cachedComponents = await this.cacheManager.getComponents();

            // Parse the URL to extract component information
            const parsedUrl = this.parseComponentUrl(componentUrl);
            if (!parsedUrl) {
                return null;
            }

            // Find matching component in cache
            const cachedComponent = cachedComponents.find(comp =>
                comp.url === componentUrl ||
                (comp.gitlabInstance === parsedUrl.gitlabInstance &&
                 comp.sourcePath === parsedUrl.projectPath &&
                 comp.name === parsedUrl.componentName &&
                 comp.version === parsedUrl.version)
            );

            if (cachedComponent) {
                // Convert cached component to Component interface
                return {
                    name: cachedComponent.name,
                    description: cachedComponent.description,
                    parameters: cachedComponent.parameters,
                    version: cachedComponent.version,
                    source: cachedComponent.source,
                    documentationUrl: undefined,
                    context: {
                        gitlabInstance: cachedComponent.gitlabInstance,
                        path: cachedComponent.sourcePath
                    }
                };
            }

            return null;
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error searching cache: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Add a component to the cache
     */
    private addComponentToCache(componentUrl: string, component: Component): void {
        try {
            const parsedUrl = this.parseComponentUrl(componentUrl);
            if (!parsedUrl || !component.context) {
                return;
            }

            this.cacheManager.addDynamicComponent({
                name: component.name,
                description: component.description,
                parameters: component.parameters,
                source: component.source || '',
                sourcePath: component.context.path,
                gitlabInstance: component.context.gitlabInstance,
                version: component.version || 'main',
                url: componentUrl,
                templatePath: component.templatePath
            });

            this.logger.debug(`[ValidationProvider] Added component to cache: ${component.name}`, 'ValidationProvider');
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error adding component to cache: ${error}`, 'ValidationProvider');
        }
    }

    /**
     * Parse a component URL to extract its parts
     */
    private parseComponentUrl(url: string): { gitlabInstance: string; projectPath: string; componentName: string; version: string } | null {
        try {
            const urlObj = new URL(url);
            const gitlabInstance = urlObj.hostname;
            const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);

            if (pathParts.length < 2) {
                return null;
            }

            const lastPart = pathParts[pathParts.length - 1];
            let componentName: string, version: string;

            if (lastPart.includes('@')) {
                [componentName, version] = lastPart.split('@');
                const projectPath = pathParts.slice(0, pathParts.length - 1).join('/');
                return { gitlabInstance, projectPath, componentName, version };
            } else {
                componentName = lastPart;
                version = 'main';
                const projectPath = pathParts.slice(0, pathParts.length - 1).join('/');
                return { gitlabInstance, projectPath, componentName, version };
            }
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error parsing component URL: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Find the best position to insert new inputs
     */
    private findInputsInsertPosition(document: vscode.TextDocument, componentLine: number): {
        position: vscode.Position;
        indentation: string;
        needsInputsSection: boolean;
    } {
        const text = document.getText();
        const lines = text.split('\n');

        // Get component indentation
        const componentLineText = lines[componentLine];
        const componentIndentation = componentLineText.match(/^\s*/)?.[0] || '';
        const inputsIndentation = componentIndentation + '  ';

        // Look for existing inputs section after the component line
        for (let i = componentLine + 1; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Skip empty lines
            if (!trimmedLine) {
                continue;
            }

            // Check indentation to see if we're still in the same component block
            const indentation = line.length - line.trimStart().length;
            if (indentation <= componentIndentation.length && trimmedLine !== '') {
                // We've left the component block, insert inputs section before this line
                return {
                    position: new vscode.Position(i, 0),
                    indentation: inputsIndentation,
                    needsInputsSection: true
                };
            }

            // Found existing inputs section
            if (trimmedLine === 'inputs:' || trimmedLine.startsWith('inputs:')) {
                // Find the end of the inputs section to insert new input
                for (let j = i + 1; j < lines.length; j++) {
                    const inputLine = lines[j];
                    const inputIndentation = inputLine.length - inputLine.trimStart().length;

                    // If we find a line with same or less indentation than inputs, insert here
                    if (inputLine.trim() && inputIndentation <= indentation) {
                        return {
                            position: new vscode.Position(j, 0),
                            indentation: inputsIndentation + '  ',
                            needsInputsSection: false
                        };
                    }
                }

                // If we reach here, inputs section is at the end of the component
                return {
                    position: new vscode.Position(lines.length, 0),
                    indentation: inputsIndentation + '  ',
                    needsInputsSection: false
                };
            }
        }

        // No inputs section found, add at end of file
        return {
            position: new vscode.Position(lines.length, 0),
            indentation: inputsIndentation,
            needsInputsSection: true
        };
    }

    /**
     * Show input suggestions in a QuickPick UI for better handling of large lists
     */
    private async showInputSuggestionsQuickPick(args: {
        type: 'replace' | 'add';
        documentUri: string;
        range: vscode.Range;
        unknownInput?: string;
        availableInputs: string[];
        /** Full component-spec parameters, used to render descriptions/types alongside replacement suggestions. */
        componentInputs?: ComponentParameter[];
        componentName: string;
        /** Required parameters the document is missing — same shape as componentInputs, populated from diagnostic metadata. */
        missingInputs?: ComponentParameter[];
    }): Promise<void> {
        this.logger.debug(`[ValidationProvider] Showing QuickPick for ${args.type} with ${args.availableInputs.length} options`, 'ValidationProvider');

        const quickPick = vscode.window.createQuickPick();

        if (args.type === 'replace') {
            quickPick.title = `Replace '${args.unknownInput}' in component '${args.componentName}'`;
            quickPick.placeholder = 'Type to search, then press Enter to replace...';

            // Create items for replacement suggestions with enhanced details
            quickPick.items = args.availableInputs.map(input => {
                // Check if this is a close match to the unknown input for better sorting
                const similarity = this.calculateStringSimilarity(args.unknownInput || '', input);
                const isCloseMatch = similarity > 0.3;

                // Find the full input details if available
                const inputDetails = args.componentInputs?.find(ci => ci.name === input);

                // Use the input description if available, otherwise fall back to replacement text
                let detail: string;
                if (inputDetails?.description) {
                    detail = `${inputDetails.description}${inputDetails.type ? ` (${inputDetails.type})` : ''}${isCloseMatch ? ' (recommended)' : ''}`;
                } else {
                    detail = `Replace '${args.unknownInput}' with '${input}'${isCloseMatch ? ' (recommended)' : ''}`;
                }

                return {
                    label: input,
                    description: isCloseMatch ? '$(star) Close match' : '',
                    detail: detail
                };
            }).sort((a, b) => {
                // Sort by close matches first, then alphabetically
                const aIsClose = a.description.includes('Close match');
                const bIsClose = b.description.includes('Close match');
                if (aIsClose && !bIsClose) return -1;
                if (!aIsClose && bIsClose) return 1;
                return a.label.localeCompare(b.label);
            });
        } else {
            quickPick.title = `Add missing inputs to component '${args.componentName}'`;
            quickPick.placeholder = 'Select input(s) to add (use Ctrl/Cmd+Click for multiple)...';
            quickPick.canSelectMany = true;

            // Create items for missing inputs with detailed information
            quickPick.items = (args.missingInputs || []).map(input => ({
                label: input.name,
                description: input.required ? 'Required' : 'Optional',
                detail: `${input.description} (${input.type}${input.default !== undefined ? `, default: ${JSON.stringify(input.default)}` : ''})`
            }));
        }

        quickPick.onDidAccept(async () => {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(args.documentUri));
            await vscode.window.showTextDocument(document);

            if (args.type === 'replace' && quickPick.selectedItems.length === 1) {
                // Replace the unknown input with the selected one
                const selectedInput = quickPick.selectedItems[0].label;
                this.logger.debug(`[ValidationProvider] Replacing '${args.unknownInput}' with '${selectedInput}'`, 'ValidationProvider');

                const edit = new vscode.WorkspaceEdit();
                edit.replace(document.uri, args.range, selectedInput);
                await vscode.workspace.applyEdit(edit);

                // Show confirmation message
                vscode.window.showInformationMessage(`Replaced '${args.unknownInput}' with '${selectedInput}'`);

            } else if (args.type === 'add' && quickPick.selectedItems.length > 0) {
                // Add selected missing inputs
                const selectedInputs = quickPick.selectedItems.map(item => item.label);
                this.logger.debug(`[ValidationProvider] Adding inputs: ${selectedInputs.join(', ')}`, 'ValidationProvider');

                const edit = new vscode.WorkspaceEdit();
                const componentLine = args.range.start.line;
                const insertInfo = this.findInputsInsertPosition(document, componentLine);

                let insertText = '';
                if (insertInfo.needsInputsSection) {
                    insertText += `${insertInfo.indentation}inputs:\n`;
                }

                // Add each selected input
                for (const inputName of selectedInputs) {
                    const inputInfo = args.missingInputs?.find(i => i.name === inputName);
                    const indentation = insertInfo.needsInputsSection ?
                        insertInfo.indentation + '  ' : insertInfo.indentation;

                    insertText += `${indentation}${inputName}: `;

                    // Add appropriate default value
                    if (inputInfo?.default !== undefined) {
                        insertText += `${JSON.stringify(inputInfo.default)}`;
                    } else {
                        switch (inputInfo?.type?.toLowerCase()) {
                            case 'boolean':
                                insertText += 'true';
                                break;
                            case 'number':
                            case 'integer':
                                insertText += '0';
                                break;
                            case 'array':
                                insertText += '[]';
                                break;
                            case 'object':
                                insertText += '{}';
                                break;
                            default:
                                insertText += `"" # ${inputInfo?.description || 'Set value'}`;
                        }
                    }
                    insertText += '\n';
                }

                edit.insert(document.uri, insertInfo.position, insertText);
                await vscode.workspace.applyEdit(edit);

                // Show confirmation message
                const inputCount = selectedInputs.length;
                const inputWord = inputCount === 1 ? 'input' : 'inputs';
                vscode.window.showInformationMessage(`Added ${inputCount} ${inputWord}: ${selectedInputs.join(', ')}`);
            }

            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
        });

        quickPick.show();
    }

    /**
     * Calculate string similarity using Levenshtein distance for better input suggestions
     */
    private calculateStringSimilarity(str1: string, str2: string): number {
        if (str1.length === 0) return str2.length === 0 ? 1 : 0;
        if (str2.length === 0) return 0;

        const matrix: number[][] = [];

        // Initialize matrix
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        // Fill matrix
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        const maxLength = Math.max(str1.length, str2.length);
        const distance = matrix[str2.length][str1.length];
        return (maxLength - distance) / maxLength;
    }

    /**
     * Get workspace context for GitLab variable expansion.
     *
     * `forUri` is the URI of the document being validated. When supplied, the
     * GitLab repo lookup is scoped to the file's containing repo so multi-repo
     * workspaces resolve to the correct host.
     */
    private async getWorkspaceContext(forUri?: vscode.Uri): Promise<{
        gitlabInstance?: string;
        projectPath?: string;
        serverUrl?: string;
        commitSha?: string;
    }> {
        try {
            // Try to get git information from the workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return {};
            }

            const workspaceFolder = workspaceFolders[0].uri.fsPath;

            // Try to get Git remote information for the current repository
            const gitContext = await this.getGitRepositoryContext(workspaceFolder, forUri);
            if (gitContext.gitlabInstance && gitContext.projectPath) {
                this.logger.debug(`[ValidationProvider] Using Git repository context: ${gitContext.gitlabInstance}/${gitContext.projectPath}`, 'ValidationProvider');
                return {
                    gitlabInstance: gitContext.gitlabInstance,
                    projectPath: gitContext.projectPath,
                    serverUrl: `https://${gitContext.gitlabInstance}`,
                    commitSha: gitContext.commitSha || 'main'
                };
            }

            // Check if we're in a non-GitLab repository - if so, don't fall back to component sources for variable expansion
            const nonGitlabInfo = await this.detectNonGitLabRepository(workspaceFolder);
            this.logger.debug(`[ValidationProvider] Non-GitLab repository detection result: ${nonGitlabInfo ? JSON.stringify(nonGitlabInfo) : 'null'}`, 'ValidationProvider');

            if (nonGitlabInfo) {
                this.logger.debug(`[ValidationProvider] Detected non-GitLab repository (${nonGitlabInfo.hostname}), not using component sources for variable expansion`, 'ValidationProvider');
                return {}; // Return empty context to trigger unresolved variables diagnostic
            }

            // Fallback to configured component sources only if we're not in a detected non-GitLab repository
            const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
            const componentSources = config.get<Array<{
                name: string;
                path: string;
                gitlabInstance?: string;
            }>>('componentSources', []);

            this.logger.debug(`[ValidationProvider] Found ${componentSources.length} configured component sources`, 'ValidationProvider');

            // Use first component source if available
            if (componentSources.length > 0) {
                const source = componentSources[0];
                this.logger.debug(`[ValidationProvider] Using configured component source: ${source.gitlabInstance}/${source.path}`, 'ValidationProvider');
                return {
                    gitlabInstance: source.gitlabInstance || 'gitlab.com',
                    projectPath: source.path,
                    serverUrl: `https://${source.gitlabInstance || 'gitlab.com'}`,
                    commitSha: 'main'
                };
            }

            // Final fallback to basic defaults
            const gitlabInstance = config.get<string>('defaultGitlabInstance') || 'gitlab.com';
            const projectPath = config.get<string>('defaultProjectPath');

            return {
                gitlabInstance,
                projectPath,
                serverUrl: `https://${gitlabInstance}`,
                commitSha: 'main'
            };
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error getting workspace context: ${error}`, 'ValidationProvider');
            return {};
        }
    }

    /**
     * Extract Git repository information from the workspace.
     *
     * When `forUri` is supplied, the lookup resolves to the repository that
     * contains that specific file — required for multi-repo workspaces where
     * workspaceFolders[0] would otherwise pick the wrong GitLab host.
     */
    private async getGitRepositoryContext(workspacePath: string, forUri?: vscode.Uri): Promise<{
        gitlabInstance?: string;
        projectPath?: string;
        commitSha?: string;
    }> {
        try {
            // Use VS Code's Git extension API if available
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                const git: GitApi | undefined = gitExtension.exports.getAPI(1);
                if (git) {
                    let repo: GitRepository | null = null;
                    if (forUri) {
                        // File-relative lookup; null if file isn't in any repo.
                        // Do NOT fall through to workspace[0] here.
                        repo = git.getRepository(forUri);
                    } else if (git.repositories.length > 0) {
                        repo = git.repositories.find(r =>
                            workspacePath.startsWith(r.rootUri.fsPath)
                        ) || git.repositories[0];
                    }

                    if (repo) {
                        // Get remote URLs
                        const remotes = repo.state.remotes;
                        const origin = remotes.find(r => r.name === 'origin') || remotes[0];

                        if (origin && origin.fetchUrl) {
                            const gitlabInfo = this.parseGitLabRemoteUrl(origin.fetchUrl);
                            if (gitlabInfo) {
                                // Try to get current commit SHA
                                let commitSha = 'main';
                                try {
                                    if (repo.state.HEAD && repo.state.HEAD.commit) {
                                        commitSha = repo.state.HEAD.commit;
                                    } else if (repo.state.HEAD && repo.state.HEAD.name) {
                                        commitSha = repo.state.HEAD.name;
                                    }
                                } catch (error) {
                                    this.logger.debug(`[ValidationProvider] Could not get commit SHA: ${error}`, 'ValidationProvider');
                                }

                                return {
                                    gitlabInstance: gitlabInfo.gitlabInstance,
                                    projectPath: gitlabInfo.projectPath,
                                    commitSha: commitSha
                                };
                            }
                        }
                    }
                }
            }

            // Fallback: try to read git config directly
            return await this.getGitInfoFromCommand(workspacePath);
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error getting Git repository context: ${error}`, 'ValidationProvider');
            return {};
        }
    }

    /**
     * Parse GitLab remote URL to extract instance and project path
     */
    private parseGitLabRemoteUrl(remoteUrl: string): { gitlabInstance: string; projectPath: string } | null {
        try {
            // Handle both HTTPS and SSH URLs
            // HTTPS: https://gitlab.com/owner/repo.git
            // SSH: git@gitlab.com:owner/repo.git

            let gitlabInstance: string;
            let projectPath: string;

            if (remoteUrl.startsWith('https://')) {
                const url = new URL(remoteUrl);
                gitlabInstance = url.hostname;
                projectPath = url.pathname.substring(1).replace(/\.git$/, '');
            } else if (remoteUrl.startsWith('git@')) {
                // git@gitlab.com:owner/repo.git
                const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
                if (match) {
                    gitlabInstance = match[1];
                    projectPath = match[2];
                } else {
                    return null;
                }
            } else {
                return null;
            }

            // Only return for GitLab instances - this extension is specifically for GitLab
            if (gitlabInstance.includes('gitlab')) {
                return { gitlabInstance, projectPath };
            }

            // For non-GitLab repositories, log what we detected but return null
            this.logger.debug(`[ValidationProvider] Detected non-GitLab repository: ${gitlabInstance}. GitLab Component Helper requires a GitLab repository.`, 'ValidationProvider');
            return null;
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error parsing Git remote URL: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Fallback method to get git info using git commands
     */
    private async getGitInfoFromCommand(_workspacePath: string): Promise<{
        gitlabInstance?: string;
        projectPath?: string;
        commitSha?: string;
    }> {
        try {
            // This is a simplified fallback - in a real implementation you might want to
            // execute git commands to get remote URLs and current commit
            // For now, return empty to rely on configuration
            return {};
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error getting Git info from command: ${error}`, 'ValidationProvider');
            return {};
        }
    }

    /**
     * Detect if this is a non-GitLab repository for better error messaging
     */
    private async detectNonGitLabRepository(workspacePath: string): Promise<{ hostname: string; projectPath: string } | null> {
        try {
            this.logger.debug(`[ValidationProvider] Detecting non-GitLab repository for path: ${workspacePath}`, 'ValidationProvider');

            // First try VS Code's Git extension API
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                const git: GitApi | undefined = gitExtension.exports.getAPI(1);
                if (git && git.repositories.length > 0) {
                    this.logger.debug(`[ValidationProvider] Found ${git.repositories.length} Git repositories via VS Code Git API`, 'ValidationProvider');

                    const repo = git.repositories.find(r =>
                        workspacePath.startsWith(r.rootUri.fsPath) ||
                        r.rootUri.fsPath.startsWith(workspacePath)
                    ) || git.repositories[0];

                    if (repo) {
                        this.logger.debug(`[ValidationProvider] Using Git repository: ${repo.rootUri.fsPath}`, 'ValidationProvider');

                        // Get remote URLs from VS Code Git API
                        const remotes = repo.state.remotes;
                        const origin = remotes.find(r => r.name === 'origin') || remotes[0];

                        if (origin && origin.fetchUrl) {
                            this.logger.debug(`[ValidationProvider] Found origin remote via VS Code Git API: ${origin.fetchUrl}`, 'ValidationProvider');
                            return await this.parseAndClassifyRepository(origin.fetchUrl);
                        }
                    }
                }
            }

            // Fallback to direct Git commands if VS Code Git API doesn't work
            this.logger.debug(`[ValidationProvider] VS Code Git API not available or no repositories found, trying direct Git commands`, 'ValidationProvider');
            return await this.detectRepositoryViaGitCommands(workspacePath);
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error detecting non-GitLab repository: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Use direct Git commands to detect repository information
     */
    private async detectRepositoryViaGitCommands(workspacePath: string): Promise<{ hostname: string; projectPath: string } | null> {
        try {
            // First, check if we're in a Git repository
            const isGitRepo = await new Promise<boolean>((resolve) => {
                const gitCheck = spawn('git', ['rev-parse', '--is-inside-work-tree'], {
                    cwd: workspacePath,
                    stdio: 'pipe'
                });

                gitCheck.on('exit', (code: number | null) => {
                    resolve(code === 0);
                });

                gitCheck.on('error', () => {
                    resolve(false);
                });
            });

            if (!isGitRepo) {
                this.logger.debug(`[ValidationProvider] Not inside a Git repository`, 'ValidationProvider');
                return null;
            }

            this.logger.debug(`[ValidationProvider] Confirmed we're in a Git repository`, 'ValidationProvider');

            // Get the remote origin URL
            const remoteUrl = await new Promise<string | null>((resolve) => {
                const gitRemote = spawn('git', ['remote', 'get-url', 'origin'], {
                    cwd: workspacePath,
                    stdio: 'pipe'
                });

                let output = '';
                gitRemote.stdout.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                gitRemote.on('exit', (code: number | null) => {
                    if (code === 0 && output.trim()) {
                        resolve(output.trim());
                    } else {
                        resolve(null);
                    }
                });

                gitRemote.on('error', () => {
                    resolve(null);
                });
            });

            if (!remoteUrl) {
                this.logger.debug(`[ValidationProvider] No origin remote found`, 'ValidationProvider');
                return null;
            }

            this.logger.debug(`[ValidationProvider] Found origin remote via Git command: ${remoteUrl}`, 'ValidationProvider');
            return await this.parseAndClassifyRepository(remoteUrl);

        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error using Git commands: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Parse and classify a Git remote URL
     */
    private async parseAndClassifyRepository(remoteUrl: string): Promise<{ hostname: string; projectPath: string } | null> {
        try {
            const repoInfo = this.parseAnyRemoteUrl(remoteUrl);
            if (!repoInfo) {
                this.logger.debug(`[ValidationProvider] Failed to parse remote URL: ${remoteUrl}`, 'ValidationProvider');
                return null;
            }

            this.logger.debug(`[ValidationProvider] Parsed repository info: hostname=${repoInfo.hostname}, projectPath=${repoInfo.projectPath}`, 'ValidationProvider');

            // Check if this is NOT a GitLab repository
            const isGitLab = repoInfo.hostname.toLowerCase().includes('gitlab');
            this.logger.debug(`[ValidationProvider] Is GitLab repository: ${isGitLab}`, 'ValidationProvider');

            if (!isGitLab) {
                this.logger.debug(`[ValidationProvider] Detected non-GitLab repository: ${repoInfo.hostname}`, 'ValidationProvider');
                return {
                    hostname: repoInfo.hostname,
                    projectPath: repoInfo.projectPath
                };
            }

            this.logger.debug(`[ValidationProvider] This is a GitLab repository, not returning non-GitLab info`, 'ValidationProvider');
            return null;
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error parsing and classifying repository: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Parse any Git remote URL to extract hostname and project path (for detection purposes)
     */
    private parseAnyRemoteUrl(remoteUrl: string): { hostname: string; projectPath: string } | null {
        try {
            // Handle both HTTPS and SSH URLs
            let hostname: string;
            let projectPath: string;

            if (remoteUrl.startsWith('https://')) {
                const url = new URL(remoteUrl);
                hostname = url.hostname;
                projectPath = url.pathname.substring(1).replace(/\.git$/, '');
            } else if (remoteUrl.startsWith('git@')) {
                // git@github.com:owner/repo.git
                const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
                if (match) {
                    hostname = match[1];
                    projectPath = match[2];
                } else {
                    return null;
                }
            } else {
                return null;
            }

            // Return any valid-looking Git repository info
            if (hostname && projectPath.includes('/')) {
                return { hostname, projectPath };
            }

            return null;
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Error parsing remote URL for detection: ${error}`, 'ValidationProvider');
            return null;
        }
    }

    /**
     * Recompute the "newer version available" diagnostics for a document and publish them to the dedicated version
     * diagnostic collection. Runs on open/save (not on every keystroke) since it queries the GitLab tags API; the
     * per-project tag cache keeps repeated runs cheap. No-op — and clears existing markers — when the feature is
     * disabled or the document isn't a GitLab CI file.
     *
     * @param document The document to check.
     */
    private async checkComponentVersions(document: vscode.TextDocument): Promise<void> {
        if (!this.isDiagnosableDocument(document) || !isGitLabCIFile(document)) {
            return;
        }

        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        if (!config.get<boolean>('versionCheck.enabled', true)) {
            this.versionDiagnostics.delete(document.uri);
            return;
        }

        const findings = await this.computeOutdatedRefs(document);

        const severity = config.get<string>('versionCheck.severity', 'warning') === 'information'
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Warning;

        const diagnostics = findings.map(finding => {
            const range = new vscode.Range(finding.line, finding.refStart, finding.line, finding.refEnd);
            const diagnostic = new vscode.Diagnostic(
                range,
                `A newer version of '${finding.componentName}' is available: ${finding.latestVersion} (current: ${finding.currentVersion}).`,
                severity,
            );
            diagnostic.code = 'outdated-component-version';
            diagnostic.source = 'gitlab-component-helper';
            attachDiagnosticMetadata(diagnostic, {
                code: 'outdated-component-version',
                componentUrl: finding.componentUrl,
                currentVersion: finding.currentVersion,
                latestVersion: finding.latestVersion,
            });
            return diagnostic;
        });

        this.versionDiagnostics.set(document.uri, diagnostics);
        this.logger.debug(`[ValidationProvider] ${diagnostics.length} outdated-version diagnostics for ${document.fileName}`, 'ValidationProvider');
    }

    /**
     * Resolve the outdated component refs in a document: collect each clean-semver component's project, fetch its
     * available versions once (deduped, via the shared per-project cache), then run the pure detection pass.
     *
     * Component URLs that use GitLab variables (e.g. `$CI_SERVER_FQDN/group/comp@1.2.3`) are expanded the same way
     * {@link validate} expands them — resolving the instance/project from the file's repo context — before their
     * versions are fetched. The version map is keyed by the *raw* base URL (as written in the document), because
     * the pure finder matches against the document text and places ranges there; only the lookup uses the expanded
     * URL.
     *
     * @param document The document to scan.
     * @returns The outdated refs with their precise document locations; empty when nothing is behind.
     */
    private async computeOutdatedRefs(document: vscode.TextDocument): Promise<OutdatedComponentRef[]> {
        const text = document.getText();
        const bases = collectSemverComponentBases(text);
        if (bases.length === 0) {
            return [];
        }

        // Resolve workspace context once (git remote of the file's repo, or configured sources) only when some base
        // URL actually uses variables — it can involve git lookups we don't want to pay for otherwise.
        const workspaceContext = bases.some(base => containsGitLabVariables(base))
            ? await this.getWorkspaceContext(document.uri)
            : undefined;

        const versionsByBase = new Map<string, readonly string[] | undefined>();
        await Promise.all(
            bases.map(async rawBase => {
                let lookupUrl = rawBase;
                if (containsGitLabVariables(rawBase)) {
                    if (!workspaceContext?.gitlabInstance) {
                        return; // can't resolve the instance for this file — leave the component unchecked
                    }
                    lookupUrl = expandComponentUrl(rawBase, workspaceContext);
                    if (containsGitLabVariables(lookupUrl) || lookupUrl.includes('undefined')) {
                        return; // expansion was incomplete — don't guess
                    }
                }
                versionsByBase.set(rawBase, await this.fetchVersionsForBaseUrl(lookupUrl));
            }),
        );

        return findOutdatedComponentRefs(text, baseUrl => versionsByBase.get(baseUrl));
    }

    /**
     * Fetch the available version refs (tags + branches) for a component's base URL via the shared per-project
     * version cache. Reuses a cached component when one is known (so monorepo tag-pattern scoping applies),
     * otherwise builds a minimal lookup from the parsed URL.
     *
     * @param baseUrl The component base URL (no `@version`).
     * @returns The available refs, or `undefined` when the URL can't be parsed or the fetch fails.
     */
    private async fetchVersionsForBaseUrl(baseUrl: string): Promise<string[] | undefined> {
        const parsed = this.parseComponentUrl(baseUrl);
        if (!parsed) {
            return undefined;
        }

        try {
            const cached = (await this.cacheManager.getComponents()).find(
                component =>
                    component.gitlabInstance === parsed.gitlabInstance &&
                    component.sourcePath === parsed.projectPath &&
                    component.name === parsed.componentName,
            );
            const lookup: CachedComponent = cached ?? {
                name: parsed.componentName,
                description: '',
                parameters: [],
                source: `${parsed.gitlabInstance}/${parsed.projectPath}`,
                sourcePath: parsed.projectPath,
                gitlabInstance: parsed.gitlabInstance,
                version: parsed.version,
                url: baseUrl,
            };
            return await this.cacheManager.fetchComponentVersions(lookup);
        } catch (error) {
            this.logger.debug(`[ValidationProvider] Could not fetch versions for ${baseUrl}: ${error}`, 'ValidationProvider');
            return undefined;
        }
    }

    /**
     * Bump every outdated component in `document` to its latest stable version in a single edit. Backs the
     * "Update all component versions to latest" command.
     *
     * @param document The document to update.
     * @returns The number of component refs updated (0 when everything is already current).
     */
    public async updateAllComponentVersions(document: vscode.TextDocument): Promise<number> {
        const findings = await this.computeOutdatedRefs(document);
        if (findings.length === 0) {
            return 0;
        }

        const edit = new vscode.WorkspaceEdit();
        for (const finding of findings) {
            const range = new vscode.Range(finding.line, finding.refStart, finding.line, finding.refEnd);
            edit.replace(document.uri, range, finding.latestVersion);
        }
        await vscode.workspace.applyEdit(edit);

        // Refresh markers so the just-fixed squiggles clear immediately.
        await this.checkComponentVersions(document);
        return findings.length;
    }
}
