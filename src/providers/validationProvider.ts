import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { getComponentCacheManager } from '../services/componentCacheManager';
import { parseYaml } from '../utils/yamlParser';
import { Component } from '../types/git-component';
import { Logger } from '../utils/logger';
import { outputChannel } from '../utils/outputChannel';

// TODO: When there are too many input suggestions to list show them in details view
// and allow user to select which ones to insert
// This will require a custom webview or quick pick UI to handle large lists of inputs
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

                // First try to find the component in cache
                let component = await this.findComponentInCache(componentUrl);

                // If not found in cache, fetch from API and cache it
                if (!component) {
                    this.logger.debug(`[ValidationProvider] Component not found in cache, fetching: ${componentUrl}`, 'ValidationProvider');
                    try {
                        const fetchedComponent = await getComponentService().getComponentFromUrl(componentUrl);
                        if (fetchedComponent) {
                            // Add to cache for future use
                            this.addComponentToCache(componentUrl, fetchedComponent);
                            component = fetchedComponent;
                            this.logger.debug(`[ValidationProvider] Successfully fetched component: ${fetchedComponent.name}`, 'ValidationProvider');
                        } else {
                            this.logger.debug(`[ValidationProvider] Component not found or accessible: ${componentUrl}`, 'ValidationProvider');

                            // For testing purposes, create a mock component for example URLs
                            if (componentUrl.includes('gitlab.example.com') || componentUrl.includes('my-group/my-component')) {
                                this.logger.debug(`[ValidationProvider] Creating mock component for testing: ${componentUrl}`, 'ValidationProvider');
                                component = {
                                    name: 'mock-component',
                                    description: 'Mock component for testing validation',
                                    parameters: [
                                        { name: 'valid_input', description: 'A valid input parameter', required: true, type: 'string' },
                                        { name: 'optional_input', description: 'An optional input parameter', required: false, type: 'string' },
                                        { name: 'number_input', description: 'A number input parameter', required: false, type: 'number' }
                                    ],
                                    version: '1.0.0',
                                    source: componentUrl,
                                    context: {
                                        gitlabInstance: 'gitlab.example.com',
                                        path: 'my-group/my-component'
                                    }
                                };
                            }
                        }
                    } catch (error) {
                        this.logger.debug(`[ValidationProvider] Error fetching component ${componentUrl}: ${error}`, 'ValidationProvider');
                    }
                } else {
                    this.logger.debug(`[ValidationProvider] Using cached component: ${component.name}`, 'ValidationProvider');
                }

                if (component && component.parameters) {
                    this.logger.debug(`[ValidationProvider] Component has ${component.parameters.length} parameters`, 'ValidationProvider');
                    const providedInputs = include.inputs || {};
                    const componentInputs = component.parameters;

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
                        const showAllTitle = `Show all ${suggestedInputs.length} replacement options for '${unknownInput}'`;

                        if (!actionTitles.has(showAllTitle)) {
                            actionTitles.add(showAllTitle);

                            const showAllAction = new vscode.CodeAction(showAllTitle, vscode.CodeActionKind.QuickFix);
                            showAllAction.command = {
                                title: showAllTitle,
                                command: 'vscode.executeCodeActionProvider',
                                arguments: [document.uri, diagnostic.range]
                            };
                            actions.push(showAllAction);
                        }
                    }
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
}
