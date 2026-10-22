import * as vscode from 'vscode';
import { getComponentService } from '../services/component';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { Component, ComponentParameter } from '../types/git-component';
import { Logger } from '../utils/logger';
import { createReferenceResolver } from './componentDetector';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';
import { resolveLocalIncludeOutcome } from './localComponentResolver';
import { readDiagnosticMetadata } from './validationMetadata';
import { renderDefaultValue } from './completionInputContext';
import { findingToDiagnostic } from './findingToDiagnostic';
import { validateIncludes, type ComponentLookupPort } from '../core/validation/validateIncludes';
import {
    checkComponentVersions,
    computeOutdatedRefs,
    outdatedRefRange,
    type VersionCheckInput,
} from '../core/validation/versionFindings';
import { buildVersionLookup, findComponentInCache, parseComponentRef } from '../core/validation/componentLookup';
import type { MissingRequiredInputMetadata } from './validationMetadata';

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

        this.logger.debug(`[ValidationProvider] Validating ${document.fileName}`, 'ValidationProvider');
        const findings = await validateIncludes({
            text: document.getText(),
            file: document.uri.fsPath,
            resolveReference: createReferenceResolver(document.uri),
            components: this.componentLookup,
            resolveLocalInclude: localPath => resolveLocalIncludeOutcome(localPath, document),
        });

        this.logger.debug(`[ValidationProvider] Created ${findings.length} total diagnostics for ${document.fileName}`, 'ValidationProvider');
        this.diagnosticCollection.set(document.uri, findings.map(findingToDiagnostic));
    }

    /** How validation finds components: the cache first, then GitLab (caching what it fetches). */
    private readonly componentLookup: ComponentLookupPort = {
        findCached: url => this.findComponentInCache(url),
        fetch: url => this.fetchComponent(url),
    };

    /**
     * Fetch a component and add it to the cache, keyed by the parseable URL every lookup compares against. When
     * GitLab has no such component, the `gitlab.example.com` example URLs from the docs get a mock component so they
     * can be used to try validation.
     */
    private async fetchComponent(expandedUrl: string): Promise<Component | null> {
        const fetchedComponent = await getComponentService().getComponentFromUrl(expandedUrl);
        if (fetchedComponent) {
            this.addComponentToCache(expandedUrl, fetchedComponent);
            return fetchedComponent;
        }
        if (!this.isExampleMockComponentUrl(expandedUrl)) {
            return null;
        }
        this.logger.debug(`[ValidationProvider] Creating mock component for testing: ${expandedUrl}`, 'ValidationProvider');
        return {
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

    /**
     * Find a component in the cache by URL
     */
    private async findComponentInCache(componentUrl: string): Promise<Component | null> {
        try {
            return findComponentInCache(await this.cacheManager.getComponents(), componentUrl);
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
            if (!parseComponentRef(componentUrl) || !component.context) {
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
                detail: `${input.description} (${input.type}${input.default !== undefined ? `, default: ${renderDefaultValue(input.default)}` : ''})`
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

                    // Add appropriate default value, rendered as the YAML the input's type expects — `JSON.stringify`
                    // would quote every scalar, inserting `"false"`/`"production"` where a bare scalar belongs.
                    if (inputInfo?.default !== undefined) {
                        insertText += renderDefaultValue(inputInfo.default);
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

        const findings = await checkComponentVersions(this.versionCheckInput(document));
        if (!findings) {
            this.versionDiagnostics.delete(document.uri);
            return;
        }

        this.versionDiagnostics.set(document.uri, findings.map(findingToDiagnostic));
        this.logger.debug(`[ValidationProvider] ${findings.length} outdated-version diagnostics for ${document.fileName}`, 'ValidationProvider');
    }

    /** The version check's view of a document. One resolver per call, so git lookups happen at most once. */
    private versionCheckInput(document: vscode.TextDocument): VersionCheckInput {
        return {
            text: document.getText(),
            file: document.uri.fsPath,
            resolveReference: createReferenceResolver(document.uri),
            fetchVersions: baseUrl => this.fetchVersionsForBaseUrl(baseUrl),
        };
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
        try {
            const lookup = await buildVersionLookup(() => this.cacheManager.getComponents(), baseUrl);
            return lookup && await this.cacheManager.fetchComponentVersions(lookup);
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
        const findings = await computeOutdatedRefs(this.versionCheckInput(document));
        if (findings.length === 0) {
            return 0;
        }

        const edit = new vscode.WorkspaceEdit();
        for (const finding of findings) {
            const { line, startCol, endCol } = outdatedRefRange(finding);
            edit.replace(document.uri, new vscode.Range(line, startCol, line, endCol), finding.latestVersion);
        }
        await vscode.workspace.applyEdit(edit);

        // Refresh markers so the just-fixed squiggles clear immediately.
        await this.checkComponentVersions(document);
        return findings.length;
    }
}
