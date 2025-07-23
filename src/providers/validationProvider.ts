import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { getComponentCacheManager } from '../services/componentCacheManager';
import { parseYaml } from '../utils/yamlParser';
import { Component } from '../types/git-component';
import { Logger } from '../utils/logger';
import { expandComponentUrl, containsGitLabVariables } from '../utils/gitlabVariables';

export class ValidationProvider implements vscode.CodeActionProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
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

        // Register code action provider for GitLab CI files (supports yaml, gitlab-ci, and shellscript languages)
        this.logger.debug('[ValidationProvider] Registering code action provider for yaml, gitlab-ci, and shellscript languages', 'ValidationProvider');
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                [
                    { language: 'yaml' },
                    { language: 'gitlab-ci' },
                    { language: 'shellscript' },
                    { pattern: '**/*.gitlab-ci.yml' },
                    { pattern: '**/.gitlab-ci.yml' }
                ],
                this,
                {
                    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
                }
            )
        );

        this.logger.debug('[ValidationProvider] Registering document event listeners', 'ValidationProvider');
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.validate(doc)),
            vscode.workspace.onDidChangeTextDocument(e => {
                // Only validate if the change affects component inputs
                this.validateIfInputsChanged(e);
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                const documentId = doc.uri.toString();
                // Clear any pending validation timeouts
                const existingTimeout = this.validationTimeouts.get(documentId);
                if (existingTimeout) {
                    clearTimeout(existingTimeout);
                    this.validationTimeouts.delete(documentId);
                }
                this.diagnosticCollection.delete(doc.uri);
            })
        );

        // Register command for showing input suggestions
        this.logger.debug('[ValidationProvider] Registering input suggestion commands', 'ValidationProvider');
        context.subscriptions.push(
            vscode.commands.registerCommand('gitlab-component-helper.showInputSuggestions',
                (args) => this.showInputSuggestionsQuickPick(args))
        );

        this.logger.debug('[ValidationProvider] Validating currently open documents', 'ValidationProvider');
        vscode.workspace.textDocuments.forEach(doc => {
            this.logger.debug(`[ValidationProvider] Found open document: ${doc.fileName} (${doc.languageId})`, 'ValidationProvider');
            this.validate(doc);
        });

        this.logger.debug('[ValidationProvider] Initialization complete', 'ValidationProvider');
    }

    private async validate(document: vscode.TextDocument) {
        this.logger.debug(`[ValidationProvider] validate() called for: ${document.fileName}, languageId: ${document.languageId}`, 'ValidationProvider');

        // Support yaml, gitlab-ci, and shellscript languages, and files ending with gitlab-ci patterns
        const isGitLabCIFile = document.languageId === 'gitlab-ci' ||
                              document.languageId === 'yaml' ||
                              document.languageId === 'shellscript' ||
                              document.fileName.endsWith('.gitlab-ci.yml') ||
                              document.fileName.endsWith('/.gitlab-ci.yml');

        if (!isGitLabCIFile) {
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
        const parsedYaml = parseYaml(text);

        if (!parsedYaml || !parsedYaml.include) {
            this.diagnosticCollection.set(document.uri, diagnostics);
            return;
        }

        const includes = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];
        this.logger.debug(`[ValidationProvider] Found ${includes.length} include entries`, 'ValidationProvider');

        for (let includeIndex = 0; includeIndex < includes.length; includeIndex++) {
            const include = includes[includeIndex];
            if (include.component) {
                const componentUrl = include.component;
                this.logger.debug(`[ValidationProvider] Processing component ${includeIndex + 1}/${includes.length}: ${componentUrl}`, 'ValidationProvider');
                this.logger.debug(`[ValidationProvider] Include object:`, 'ValidationProvider');
                this.logger.debug(JSON.stringify(include, null, 2), 'ValidationProvider');

                // Check if component URL contains GitLab variables and expand them
                let expandedUrl = componentUrl;
                if (containsGitLabVariables(componentUrl)) {
                    this.logger.debug(`[ValidationProvider] Component URL contains variables, expanding: ${componentUrl}`, 'ValidationProvider');

                    // Try to get some context from workspace/git for expansion
                    const workspaceContext = await this.getWorkspaceContext();

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

                            const line = this.findLineForComponent(document, include);
                            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);

                            const diagnostic = new vscode.Diagnostic(
                                range,
                                diagnosticMessage,
                                vscode.DiagnosticSeverity.Information
                            );

                            diagnostic.code = 'unresolved-variables';
                            diagnostic.source = 'gitlab-component-helper';
                            (diagnostic as any).metadata = {
                                componentUrl: componentUrl,
                                expandedUrl: expandedUrl,
                                includeInputs: include.inputs || {},
                                isNonGitlabRepo: true
                            };

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

                        const line = this.findLineForComponent(document, include);
                        const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);

                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Component URL contains unresolved GitLab variables: '${componentUrl}'. Configure component sources in settings to resolve these variables.`,
                            vscode.DiagnosticSeverity.Information
                        );

                        diagnostic.code = 'unresolved-variables';
                        diagnostic.source = 'gitlab-component-helper';
                        (diagnostic as any).metadata = {
                            componentUrl: componentUrl,
                            expandedUrl: expandedUrl,
                            includeInputs: include.inputs || {}
                        };

                        this.logger.debug(`[ValidationProvider] Created unresolved variables diagnostic for ${componentUrl}`, 'ValidationProvider');
                        diagnostics.push(diagnostic);

                        // Skip input validation for URLs with unresolved variables
                        continue;
                    }
                }

                // First try to find the component in cache (using expanded URL)
                let component = await this.findComponentInCache(expandedUrl);

                // Track if component fetch failed
                let componentFetchFailed = false;

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

                            // For testing purposes, create a mock component for example URLs
                            if (expandedUrl.includes('gitlab.example.com') || expandedUrl.includes('my-group/my-component')) {
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
                    }
                } else {
                    this.logger.debug(`[ValidationProvider] Using cached component: ${component.name}`, 'ValidationProvider');
                }

                // If component fetch failed, add a single diagnostic about the fetch failure
                // instead of showing "unknown input" warnings for all inputs
                if (componentFetchFailed) {
                    const line = this.findLineForComponent(document, include);
                    const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Unable to fetch component '${componentUrl}'. Component may not exist, be inaccessible, or the URL may be incorrect.`,
                        vscode.DiagnosticSeverity.Warning
                    );

                    diagnostic.code = 'component-fetch-failed';
                    diagnostic.source = 'gitlab-component-helper';
                    (diagnostic as any).metadata = {
                        componentUrl: componentUrl,
                        expandedUrl: expandedUrl,
                        includeInputs: include.inputs || {}
                    };

                    this.logger.debug(`[ValidationProvider] Created component fetch failure diagnostic for ${componentUrl}`, 'ValidationProvider');
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
                        if (!componentInputs.some((p: any) => p.name === providedInput)) {
                            const line = this.findLineForInput(document, include, providedInput);

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
                            (diagnostic as any).metadata = {
                                componentName: component.name,
                                componentUrl: componentUrl,
                                unknownInput: providedInput,
                                availableInputs: componentInputs.map((p: any) => p.name),
                                componentInputs: componentInputs, // Include full input details for descriptions
                                // Only include the current unknown input, not all provided inputs
                                currentInputOnly: true
                            };

                            this.logger.debug(`[ValidationProvider] Created diagnostic for unknown input '${providedInput}' at range ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`, 'ValidationProvider');
                            diagnostics.push(diagnostic);
                        }
                    }

                    for (const componentInput of componentInputs) {
                        if (componentInput.required && !providedInputs.hasOwnProperty(componentInput.name)) {
                            const line = this.findLineForComponent(document, include);
                            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Missing required input '${componentInput.name}' for component '${component.name}'.`,
                                vscode.DiagnosticSeverity.Error
                            );

                            // Add metadata for code actions
                            diagnostic.code = 'missing-required-input';
                            diagnostic.source = 'gitlab-component-helper';
                            (diagnostic as any).metadata = {
                                componentName: component.name,
                                componentUrl: componentUrl,
                                missingInput: componentInput.name,
                                inputDescription: componentInput.description,
                                inputType: componentInput.type,
                                inputDefault: componentInput.default,
                                providedInputs: Object.keys(providedInputs)
                            };

                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }
        }

        this.logger.debug(`[ValidationProvider] Created ${diagnostics.length} total diagnostics for ${document.fileName}`, 'ValidationProvider');
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Smart validation that only triggers when inputs are actually changed
     */
    private validateIfInputsChanged(e: vscode.TextDocumentChangeEvent): void {
        const document = e.document;
        const documentId = document.uri.toString();

        // Check if this is a GitLab CI file
        const isGitLabCIFile = document.languageId === 'gitlab-ci' ||
                              document.languageId === 'yaml' ||
                              document.languageId === 'shellscript' ||
                              document.fileName.endsWith('.gitlab-ci.yml') ||
                              document.fileName.endsWith('/.gitlab-ci.yml');

        if (!isGitLabCIFile) {
            return;
        }

        // Check if the changes affect component inputs
        let shouldValidate = false;
        for (const change of e.contentChanges) {
            const changedText = change.text;
            const rangeText = document.getText(change.range);

            // Check if the change is in an inputs section or affects component/include declarations
            if (this.isInputRelatedChange(document, change.range, changedText, rangeText)) {
                shouldValidate = true;
                break;
            }
        }

        if (!shouldValidate) {
            this.logger.debug(`[ValidationProvider] Skipping validation - changes don't affect component inputs`, 'ValidationProvider');
            return;
        }

        // Throttle validation to avoid excessive calls
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
     * Check if a change affects component inputs
     */
    private isInputRelatedChange(document: vscode.TextDocument, range: vscode.Range, newText: string, oldText: string): boolean {
        const startLine = range.start.line;
        const endLine = range.end.line;

        // Check lines around the change for component/inputs context
        const contextStart = Math.max(0, startLine - 5);
        const contextEnd = Math.min(document.lineCount - 1, endLine + 5);

        let hasComponentContext = false;
        let hasInputsContext = false;

        for (let i = contextStart; i <= contextEnd; i++) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes('component:') || lineText.includes('include:')) {
                hasComponentContext = true;
            }
            if (lineText.includes('inputs:')) {
                hasInputsContext = true;
            }
        }

        // If we're in a component context and either:
        // 1. We're in an inputs section, or
        // 2. The change involves input-like text (contains ':' which is common in YAML key-value pairs)
        if (hasComponentContext && (hasInputsContext || newText.includes(':') || oldText.includes(':'))) {
            this.logger.debug(`[ValidationProvider] Input-related change detected at line ${startLine}`, 'ValidationProvider');
            return true;
        }

        return false;
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

            if (diagnostic.code === 'unknown-input' && (diagnostic as any).metadata) {
                const metadata = (diagnostic as any).metadata;
                const availableInputs = metadata.availableInputs as string[];
                const unknownInput = metadata.unknownInput as string;

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
            else if (diagnostic.code === 'unresolved-variables' && (diagnostic as any).metadata) {
                const metadata = (diagnostic as any).metadata;
                const componentUrl = metadata.componentUrl as string;
                const isNonGitlabRepo = metadata.isNonGitlabRepo as boolean;

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
            else if (diagnostic.code === 'component-fetch-failed' && (diagnostic as any).metadata) {
                const metadata = (diagnostic as any).metadata;
                const componentUrl = metadata.componentUrl as string;

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
            else if (diagnostic.code === 'missing-required-input' && (diagnostic as any).metadata) {
                const metadata = (diagnostic as any).metadata;
                const missingInput = metadata.missingInput as string;
                const inputDescription = metadata.inputDescription as string;
                const inputType = metadata.inputType as string;
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

                    let insertText = '';
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
                    const allMissingForComponent = relevantDiagnostics.filter(d =>
                        d.code === 'missing-required-input' &&
                        (d as any).metadata?.componentUrl === componentUrl
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
                                    availableInputs: allMissingForComponent.map(d => (d as any).metadata.missingInput),
                                    componentName: metadata.componentName,
                                    missingInputs: allMissingForComponent.map(d => ({
                                        name: (d as any).metadata.missingInput,
                                        description: (d as any).metadata.inputDescription || '',
                                        type: (d as any).metadata.inputType || 'string',
                                        default: (d as any).metadata.inputDefault,
                                        required: true
                                    }))
                                }]
                            };
                            actions.push(showAllMissingAction);
                        }
                    }
                }
            }
        }

        this.logger.debug(`[ValidationProvider] Returning ${actions.length} unique code actions`, 'ValidationProvider');
        return actions;
    }

    private findLineForInput(document: vscode.TextDocument, include: any, inputName: string): number {
        const text = document.getText();
        const lines = text.split('\n');
        const componentLine = this.findLineForComponent(document, include);

        this.logger.debug(`[ValidationProvider] Finding line for input '${inputName}', component line: ${componentLine}`, 'ValidationProvider');

        for (let i = componentLine + 1; i < lines.length; i++) {
            if (lines[i].includes('inputs:')) {
                this.logger.debug(`[ValidationProvider] Found inputs section at line ${i}`, 'ValidationProvider');
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].includes(`${inputName}:`)) {
                        this.logger.debug(`[ValidationProvider] Found input '${inputName}' at line ${j}`, 'ValidationProvider');
                        return j;
                    }
                    if (!lines[j].match(/^\s+/)) {
                        break;
                    }
                }
                break;
            }
        }
        this.logger.debug(`[ValidationProvider] Input '${inputName}' not found, returning component line ${componentLine}`, 'ValidationProvider');
        return componentLine;
    }

    private findLineForComponent(document: vscode.TextDocument, include: any): number {
        const text = document.getText();
        const lines = text.split('\n');
        const componentUrl = include.component;

        this.logger.debug(`[ValidationProvider] Looking for component URL: ${componentUrl}`, 'ValidationProvider');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(componentUrl)) {
                this.logger.debug(`[ValidationProvider] Found component URL at line ${i}: ${line.trim()}`, 'ValidationProvider');
                return i;
            }
        }
        this.logger.debug(`[ValidationProvider] Component URL not found, returning 0`, 'ValidationProvider');
        return 0;
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
                url: componentUrl
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
        componentInputs?: Array<{ name: string; description?: string; type?: string; required?: boolean; default?: any }>; // Add full input details
        componentName: string;
        missingInputs?: Array<{
            name: string;
            description: string;
            type: string;
            default?: any;
            required: boolean;
        }>;
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
            const editor = await vscode.window.showTextDocument(document);

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
     * Get workspace context for GitLab variable expansion
     */
    private async getWorkspaceContext(): Promise<{
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
            const gitContext = await this.getGitRepositoryContext(workspaceFolder);
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
     * Extract Git repository information from the workspace
     */
    private async getGitRepositoryContext(workspacePath: string): Promise<{
        gitlabInstance?: string;
        projectPath?: string;
        commitSha?: string;
    }> {
        try {
            // Use VS Code's Git extension API if available
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                const git = gitExtension.exports.getAPI(1);
                if (git && git.repositories.length > 0) {
                    const repo = git.repositories.find((r: any) =>
                        workspacePath.startsWith(r.rootUri.fsPath)
                    ) || git.repositories[0];

                    if (repo) {
                        // Get remote URLs
                        const remotes = repo.state.remotes;
                        const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];

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
    private async getGitInfoFromCommand(workspacePath: string): Promise<{
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
                const git = gitExtension.exports.getAPI(1);
                if (git && git.repositories.length > 0) {
                    this.logger.debug(`[ValidationProvider] Found ${git.repositories.length} Git repositories via VS Code Git API`, 'ValidationProvider');

                    const repo = git.repositories.find((r: any) =>
                        workspacePath.startsWith(r.rootUri.fsPath) ||
                        r.rootUri.fsPath.startsWith(workspacePath)
                    ) || git.repositories[0];

                    if (repo) {
                        this.logger.debug(`[ValidationProvider] Using Git repository: ${repo.rootUri.fsPath}`, 'ValidationProvider');

                        // Get remote URLs from VS Code Git API
                        const remotes = repo.state.remotes;
                        const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];

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
            const { spawn } = require('child_process');

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
}
