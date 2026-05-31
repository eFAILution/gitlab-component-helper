import * as vscode from 'vscode';
import { Component, ComponentParameter, detectIncludeComponent } from './componentDetector';
import { Logger } from '../utils/logger';
import { getVariableInfo } from '../utils/gitlabVariables';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';
import { templateFileUrlForResolved } from '../utils/templateFileUrl';
import { findInputContextAtLine } from './hoverInputContext';

export class HoverProvider implements vscode.HoverProvider {
  private logger = Logger.getInstance();

  // Update the hover provider to display component information properly
  public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    // First check if this is a GitLab CI file
    if (!isGitLabCIFile(document)) {
      this.logger.debug(`[HoverProvider] Skipping hover for non-GitLab CI file: ${document.fileName} (language: ${document.languageId})`, 'HoverProvider');
      return null;
    }

    this.logger.debug(`[HoverProvider] Hover requested at line ${position.line + 1}, character ${position.character}`, 'HoverProvider');
    this.logger.debug(`[HoverProvider] File: ${document.fileName} (language: ${document.languageId})`, 'HoverProvider');

    const wordRange = document.getWordRangeAtPosition(position);

    // Check if we're hovering over a component input parameter first
    const inputHover = await this.getComponentInputHover(document, position);
    if (inputHover) {
      return inputHover;
    }

    // Check for GitLab variables
    if (wordRange) {
      const word = document.getText(wordRange);
      this.logger.debug(`[HoverProvider] Checking word at position: "${word}"`, 'HoverProvider');

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
        this.logger.debug(`[HoverProvider] Found GitLab variable: ${fullVariableName}`, 'HoverProvider');

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
      this.logger.debug(`[HoverProvider] Found component: ${component.name}`, 'HoverProvider');
      this.logger.debug(`[HoverProvider] Component source: ${component.context?.gitlabInstance || component.source || 'unknown'}`, 'HoverProvider');
      this.logger.debug(`[HoverProvider] Component has ${component.parameters?.length || 0} parameters`, 'HoverProvider');

      // Create markdown content for hover with enhanced features
      const hoverContent = new vscode.MarkdownString();

      // Header with title and detach link
      hoverContent.appendMarkdown(`## ${component.name}\n\n`);

      // Add a command link to detach the hover window with position context
      const componentWithContext = {
        ...component,
        _hoverContext: {
          documentUri: document.uri.toString(),
          position: { line: position.line, character: position.character }
        }
      };
      const detachCommand = vscode.Uri.parse(`command:gitlab-component-helper.detachHover?${encodeURIComponent(JSON.stringify(componentWithContext))}`);
      hoverContent.appendMarkdown(`[🔗 Open in Detailed View](${detachCommand.toString()})\n\n`);

      // Description with fallback handling
      const description = component.description || '';

      hoverContent.appendMarkdown(`${description}\n\n`);

      // Source link. When we have a resolved templatePath we link directly to the template (matching the inline editor
      // link and the Component Browser's "Template File" link). Without templatePath we fall back to plain text
      if (component.context && component.templatePath) {
        const sourceUrl = templateFileUrlForResolved({
          gitlabInstance: component.context.gitlabInstance,
          projectPath: component.context.path,
          version: component.version,
          templatePath: component.templatePath,
        });
        hoverContent.appendMarkdown(`**Source:** [${sourceUrl}](${sourceUrl})\n\n`);
      } else if (component.context) {
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

      // Enable command URIs
      hoverContent.isTrusted = true;
      hoverContent.supportThemeIcons = true;

      return new vscode.Hover(hoverContent);
    }

    this.logger.debug(`[HoverProvider] No component found at cursor position`, 'HoverProvider');
    return null;
  }

  /**
   * Check if we're hovering over a component input parameter and provide input-specific hover info
   */
  private async getComponentInputHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    try {
      const text = document.getText();
      const lines = text.split('\n');
      const currentLineIndex = position.line;
      const currentLine = lines[currentLineIndex];

      const ctx = findInputContextAtLine(text, currentLineIndex);
      if (!ctx) {
        this.logger.debug(`[HoverProvider] Line ${currentLineIndex + 1} is not a component input`, 'HoverProvider');
        return null;
      }
      const { inputName, componentUrl } = ctx;

      this.logger.debug(`[HoverProvider] Confirmed input "${inputName}" under component ${componentUrl}`, 'HoverProvider');

      // Re-find the include line so we can hand a position to detectIncludeComponent. `findInputContextAtLine`
      // tells us whether to look for `component:` or `local:`.
      const lineKey = `${ctx.includeKind}:`;
      let componentLineIndex = -1;
      for (let i = 0; i < currentLineIndex; i++) {
        if (lines[i].includes(lineKey) && lines[i].includes(componentUrl)) {
          componentLineIndex = i;
          break;
        }
      }
      if (componentLineIndex === -1) return null;

      // Get the component details to find parameter information
      const component = await detectIncludeComponent(document, new vscode.Position(componentLineIndex, 0));
      if (!component || !component.parameters) {
        this.logger.debug(`[HoverProvider] Could not get component details or no parameters found`, 'HoverProvider');
        return null;
      }

      // Find the matching parameter definition
      const parameterDef = component.parameters.find(param => param.name === inputName);
      if (!parameterDef) {
        this.logger.debug(`[HoverProvider] No parameter definition found for input "${inputName}"`, 'HoverProvider');
        return null;
      }

      this.logger.debug(`[HoverProvider] Found parameter definition for "${inputName}": ${parameterDef.description}`, 'HoverProvider');

      // Create hover content for the input parameter
      const hoverContent = new vscode.MarkdownString();

      // Header with parameter name and component context
      hoverContent.appendMarkdown(`## Input Parameter: \`${parameterDef.name}\`\n\n`);
      hoverContent.appendMarkdown(`*From component: **${component.name}***\n\n`);

      // Description
      if (parameterDef.description) {
        hoverContent.appendMarkdown(`${parameterDef.description}\n\n`);
      }

      // Parameter details
      hoverContent.appendMarkdown(`**Type:** ${parameterDef.type || 'string'}\n\n`);
      hoverContent.appendMarkdown(`**Required:** ${parameterDef.required ? 'Yes' : 'No'}\n\n`);

      if (parameterDef.default !== undefined) {
        hoverContent.appendMarkdown(`**Default Value:** \`${parameterDef.default}\`\n\n`);
      } else {
        hoverContent.appendMarkdown(`**Default Value:** *None*\n\n`);
      }

      // Add link to view full component details
      const componentWithContext = {
        ...component,
        _hoverContext: {
          documentUri: document.uri.toString(),
          position: { line: position.line, character: position.character }
        }
      };
      const detachCommand = vscode.Uri.parse(`command:gitlab-component-helper.detachHover?${encodeURIComponent(JSON.stringify(componentWithContext))}`);
      hoverContent.appendMarkdown(`---\n\n[📄 View Full Component Details](${detachCommand.toString()})`);

      hoverContent.isTrusted = true;
      hoverContent.supportThemeIcons = true;

      // Create range for the parameter name only (not the whole line)
      const paramNameStart = currentLine.indexOf(inputName);
      const paramRange = new vscode.Range(
        new vscode.Position(position.line, paramNameStart),
        new vscode.Position(position.line, paramNameStart + inputName.length)
      );

      return new vscode.Hover(hoverContent, paramRange);

    } catch (error) {
      this.logger.error(`[HoverProvider] Error in getComponentInputHover: ${error}`, 'HoverProvider');
      return null;
    }
  }

  private createComponentHover(component: Component): vscode.Hover {
    this.logger.debug(`Creating hover for component: ${component.name}`, 'HoverProvider');
    const markdown = new vscode.MarkdownString();

    markdown.appendMarkdown(`## ${component.name}\n\n`);

    // Enhanced description with fallback handling
    const description = component.description || 'Component/Project does not have a description';

    markdown.appendMarkdown(`${description}\n\n`);

    markdown.appendMarkdown('### Parameters\n\n');

    for (const param of component.parameters) {
      const requiredLabel = param.required ? '(required)' : '(optional)';
      const defaultValue = param.default !== undefined ? `Default: \`${param.default}\`` : '';

      markdown.appendMarkdown(`* **${param.name}** ${requiredLabel} - ${param.description}. Type: ${param.type}. ${defaultValue}\n`);
    }

    markdown.isTrusted = true;
    markdown.supportThemeIcons = true;
    return new vscode.Hover(markdown);
  }

  private createParameterHover(param: ComponentParameter): vscode.Hover {
    this.logger.debug(`Creating hover for parameter: ${param.name}`, 'HoverProvider');
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
