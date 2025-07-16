import * as vscode from 'vscode';
import { getComponentService } from '../services/componentService';
import { parseYaml } from '../utils/yamlParser';
import { Component } from '../types/git-component';
import { Logger } from '../utils/logger';

export class ValidationProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private logger = Logger.getInstance();

    constructor(context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('gitlab-component-helper');
        context.subscriptions.push(this.diagnosticCollection);

        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.validate(doc)),
            vscode.workspace.onDidChangeTextDocument(e => this.validate(e.document)),
            vscode.workspace.onDidCloseTextDocument(doc => this.diagnosticCollection.delete(doc.uri))
        );

        vscode.workspace.textDocuments.forEach(doc => this.validate(doc));
    }

    private async validate(document: vscode.TextDocument) {
        if (document.languageId !== 'gitlab-ci' && !document.fileName.endsWith('.gitlab-ci.yml')) {
            return;
        }

        this.logger.debug(`[ValidationProvider] Validating ${document.fileName}`, 'ValidationProvider');

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const parsedYaml = parseYaml(text);

        if (!parsedYaml || !parsedYaml.include) {
            this.diagnosticCollection.set(document.uri, diagnostics);
            return;
        }

        const includes = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];

        for (const include of includes) {
            if (include.component) {
                const componentUrl = include.component;
                const component = await getComponentService().getComponentFromUrl(componentUrl);

                if (component && component.parameters) {
                    const providedInputs = include.inputs || {};
                    const componentInputs = component.parameters;

                    for (const providedInput in providedInputs) {
                        if (!componentInputs.some(p => p.name === providedInput)) {
                            const line = this.findLineForInput(document, include, providedInput);
                            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Unknown input '${providedInput}' for component '${component.name}'.`,
                                vscode.DiagnosticSeverity.Warning
                            );
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
                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private findLineForInput(document: vscode.TextDocument, include: any, inputName: string): number {
        const text = document.getText();
        const lines = text.split('\n');
        const componentLine = this.findLineForComponent(document, include);

        for (let i = componentLine + 1; i < lines.length; i++) {
            if (lines[i].includes('inputs:')) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].includes(`${inputName}:`)) {
                        return j;
                    }
                    if (!lines[j].match(/^\s+/)) {
                        break;
                    }
                }
                break;
            }
        }
        return componentLine;
    }

    private findLineForComponent(document: vscode.TextDocument, include: any): number {
        const text = document.getText();
        const lines = text.split('\n');
        const componentUrl = include.component;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(componentUrl)) {
                return i;
            }
        }
        return 0;
    }
}
