import * as vscode from 'vscode';
import { getComponentUnderCursor, Component, ComponentParameter, detectIncludeComponent } from './componentDetector';
import { outputChannel } from '../utils/outputChannel';
import { getVariableInfo, detectGitLabVariables } from '../utils/gitlabVariables';

export class HoverProvider implements vscode.HoverProvider {
  // Helper function to check if file is a GitLab CI file
  private isGitLabCIFile(document: vscode.TextDocument): boolean {
    const fileName = document.fileName.toLowerCase();
    return fileName.endsWith('.gitlab-ci.yml') || fileName.endsWith('.gitlab-ci.yaml') ||
           fileName.includes('gitlab-ci') || document.languageId === 'gitlab-ci';
  }

  // Update the hover provider to display component information properly
  public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    // First check if this is a GitLab CI file
    if (!this.isGitLabCIFile(document)) {
      outputChannel.appendLine(`[HoverProvider] Skipping hover for non-GitLab CI file: ${document.fileName} (language: ${document.languageId})`);
      return null;
    }

    outputChannel.appendLine(`[HoverProvider] Hover requested at line ${position.line + 1}, character ${position.character}`);
    outputChannel.appendLine(`[HoverProvider] File: ${document.fileName} (language: ${document.languageId})`);

    const line = document.lineAt(position.line).text;
    const wordRange = document.getWordRangeAtPosition(position);

    // Check for GitLab variables first
    if (wordRange) {
      const word = document.getText(wordRange);
      outputChannel.appendLine(`[HoverProvider] Checking word at position: "${word}"`);

      // Check if the word is a GitLab variable (with or without $)
      const variableName = word.startsWith('$') ? word.substring(1) : word;

      // Also check if there's a $ before the word
      let fullVariableName = variableName;
      if (wordRange.start.character > 0) {
        const charBefore = document.getText(new vscode.Range(
          new vscode.Position(position.line, wordRange.start.character - 1),
          wordRange.start
        ));
        if (charBefore === '$') {
          fullVariableName = variableName;
        }
      }

      const variableInfo = getVariableInfo(fullVariableName);
      if (variableInfo) {
        outputChannel.appendLine(`[HoverProvider] Found GitLab variable: ${fullVariableName}`);

        const hoverContent = new vscode.MarkdownString();
        hoverContent.appendMarkdown(`## GitLab Variable: \`$${variableInfo.name}\`\n\n`);
        hoverContent.appendMarkdown(`${variableInfo.description}\n\n`);
        hoverContent.appendMarkdown(`**Example value:** \`${variableInfo.example}\`\n\n`);

        if (variableInfo.availableIn) {
          hoverContent.appendMarkdown(`**Available in:** ${variableInfo.availableIn.join(', ')}\n\n`);
        }

        hoverContent.appendMarkdown(`[📖 GitLab CI Variables Documentation](https://docs.gitlab.com/ee/ci/variables/predefined_variables.html)`);

        return new vscode.Hover(hoverContent, wordRange);
      }
    }

    // Existing code to get component
    const component = await detectIncludeComponent(document, position);

    if (component) {
      outputChannel.appendLine(`[HoverProvider] Found component: ${component.name}`);
      outputChannel.appendLine(`[HoverProvider] Component source: ${component.context?.gitlabInstance || component.source || 'unknown'}`);
      outputChannel.appendLine(`[HoverProvider] Component has ${component.parameters?.length || 0} parameters`);

      // Create markdown content for hover with enhanced features
      const hoverContent = new vscode.MarkdownString();

      // Header with title and detach link
      hoverContent.appendMarkdown(`## ${component.name}\n\n`);

      // Add a command link to detach the hover window
      const detachCommand = vscode.Uri.parse(`command:gitlab-component-helper.detachHover?${encodeURIComponent(JSON.stringify(component))}`);
      hoverContent.appendMarkdown(`[🔗 Open in Detailed View](${detachCommand.toString()})\n\n`);

      // Description
      const description = component.description || '';
      hoverContent.appendMarkdown(`${description}\n\n`);

      // Source information
      if (component.context) {
        hoverContent.appendMarkdown(`**Source:** ${component.context.gitlabInstance}/${component.context.path}\n\n`);
      } else if (component.source) {
        hoverContent.appendMarkdown(`**Source:** ${component.source}\n\n`);
      }

      // Version
      if (component.version) {
        hoverContent.appendMarkdown(`**Version:** ${component.version}\n\n`);
      }

      // Parameters table
      if (component.parameters && component.parameters.length > 0) {
        hoverContent.appendMarkdown(`### Parameters\n\n`);
        hoverContent.appendMarkdown(`| Name | Description | Required | Default |\n`);
        hoverContent.appendMarkdown(`| ---- | ----------- | -------- | ------- |\n`);

        for (const param of component.parameters) {
          hoverContent.appendMarkdown(`| ${param.name} | ${param.description} | ${param.required ? 'Yes' : 'No'} | ${param.default !== undefined ? `\`${param.default}\`` : '-'} |\n`);
        }
        hoverContent.appendMarkdown(`\n`);
      }

      // README section (collapsible) - only show preview in hover
      if (component.readme && component.readme.trim()) {
        hoverContent.appendMarkdown(`### 📖 README Preview\n\n`);

        // Show just a preview of the README in the hover
        let readmePreview = component.readme.trim();
        if (readmePreview.length > 300) {
          readmePreview = readmePreview.substring(0, 300) + '...';
        }

        // Take first few lines only
        const lines = readmePreview.split('\n').slice(0, 4);
        hoverContent.appendMarkdown(lines.join('\n'));
        hoverContent.appendMarkdown(`\n\n*[Click "Open in Detailed View" above to see the full README]*\n`);
      }

      // Enable command URIs
      hoverContent.isTrusted = true;
      hoverContent.supportThemeIcons = true;

      return new vscode.Hover(hoverContent);
    }

    outputChannel.appendLine(`[HoverProvider] No component found at cursor position`);
    return null;
  }

  private createComponentHover(component: Component): vscode.Hover {
    outputChannel.appendLine(`Creating hover for component: ${component.name}`);
    const markdown = new vscode.MarkdownString();

    markdown.appendMarkdown(`## ${component.name}\n\n`);
    markdown.appendMarkdown(`${component.description}\n\n`);

    markdown.appendMarkdown('### Parameters\n\n');

    for (const param of component.parameters) {
      const requiredLabel = param.required ? '(required)' : '(optional)';
      const defaultValue = param.default !== undefined ? `Default: \`${param.default}\`` : '';

      markdown.appendMarkdown(`* **${param.name}** ${requiredLabel} - ${param.description}. Type: ${param.type}. ${defaultValue}\n`);
    }

    return new vscode.Hover(markdown);
  }

  private createParameterHover(param: ComponentParameter): vscode.Hover {
    console.log(`[GitLab Component Helper] Creating hover for parameter: ${param.name}`);
    const markdown = new vscode.MarkdownString();

    const requiredLabel = param.required ? '(required)' : '(optional)';
    markdown.appendMarkdown(`## ${param.name} ${requiredLabel}\n\n`);
    markdown.appendMarkdown(`${param.description}\n\n`);
    markdown.appendMarkdown(`**Type:** ${param.type}\n`);

    if (param.default !== undefined) {
      markdown.appendMarkdown(`**Default:** \`${param.default}\``);
    }

    return new vscode.Hover(markdown);
  }
}
