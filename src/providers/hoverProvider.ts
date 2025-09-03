import * as vscode from 'vscode';
import { getComponentUnderCursor, Component, ComponentParameter, detectIncludeComponent } from './componentDetector';
import { Logger } from '../utils/logger';
import { getVariableInfo } from '../utils/gitlabVariables';
import { parseYaml } from '../utils/yamlParser';

export class HoverProvider implements vscode.HoverProvider {
  private logger = Logger.getInstance();

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
      this.logger.debug(`[HoverProvider] Skipping hover for non-GitLab CI file: ${document.fileName} (language: ${document.languageId})`, 'HoverProvider');
      return null;
    }

    this.logger.debug(`[HoverProvider] Hover requested at line ${position.line + 1}, character ${position.character}`, 'HoverProvider');
    this.logger.debug(`[HoverProvider] File: ${document.fileName} (language: ${document.languageId})`, 'HoverProvider');

    const line = document.lineAt(position.line).text;
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
      let description = component.description || '';

      hoverContent.appendMarkdown(`${description}\n\n`);

      // Source information with clickable link
      if (component.context) {
        const sourceUrl = `https://${component.context.gitlabInstance}/${component.context.path}`;
        hoverContent.appendMarkdown(`**Source:** [${component.context.gitlabInstance}/${component.context.path}](${sourceUrl})\n\n`);
      } else if (component.source) {
        // Try to create a clickable link from the source string
        let sourceUrl = component.source;
        if (!sourceUrl.startsWith('http')) {
          sourceUrl = `https://${component.source}`;
        }
        hoverContent.appendMarkdown(`**Source:** [${component.source}](${sourceUrl})\n\n`);
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
      }      // Enable command URIs
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
      const parsedYaml = parseYaml(text);

      if (!parsedYaml || !parsedYaml.include) {
        return null;
      }

      const includes = Array.isArray(parsedYaml.include) ? parsedYaml.include : [parsedYaml.include];
      const currentLineIndex = position.line;
      const lines = text.split('\n');
      const currentLine = lines[currentLineIndex];

      this.logger.debug(`[HoverProvider] Checking for input parameter hover at line ${currentLineIndex + 1}: "${currentLine.trim()}"`, 'HoverProvider');

      // Check if current line looks like an input parameter (indented with parameter_name:)
      const inputMatch = currentLine.match(/^(\s+)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
      if (!inputMatch) {
        return null;
      }

      const inputIndent = inputMatch[1].length;
      const inputName = inputMatch[2];

      this.logger.debug(`[HoverProvider] Found potential input parameter: "${inputName}" with indent ${inputIndent}`, 'HoverProvider');

      // Find which component this input belongs to
      let closestComponent = null;
      let closestDistance = Infinity;

      for (const include of includes) {
        if (!include.component) continue;

        const componentUrl = include.component;

        // Find this component's position in the file
        let componentLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('component:') && lines[i].includes(componentUrl)) {
            componentLineIndex = i;
            break;
          }
        }

        if (componentLineIndex === -1) continue;

        // Check if this component is above the cursor and closer than any previous component
        if (componentLineIndex < currentLineIndex) {
          const distance = currentLineIndex - componentLineIndex;
          if (distance < closestDistance) {
            closestDistance = distance;
            closestComponent = { include, componentLineIndex, componentUrl };
          }
        }
      }

      if (!closestComponent) {
        this.logger.debug(`[HoverProvider] No component found above input parameter`, 'HoverProvider');
        return null;
      }

      this.logger.debug(`[HoverProvider] Found closest component: ${closestComponent.componentUrl}`, 'HoverProvider');

      // Verify we're in the inputs section of this component
      const include = closestComponent.include;
      const componentLineIndex = closestComponent.componentLineIndex;

      // Look for inputs: section between component and current line
      let inputsSectionStart = -1;
      for (let i = componentLineIndex + 1; i < currentLineIndex; i++) {
        const line = lines[i];
        if (line.trim() === 'inputs:') {
          inputsSectionStart = i;
          break;
        }
      }

      if (inputsSectionStart === -1) {
        this.logger.debug(`[HoverProvider] No inputs section found between component and cursor`, 'HoverProvider');
        return null;
      }

      // Check if we're properly indented within the inputs section
      const inputsLine = lines[inputsSectionStart];
      const inputsIndentMatch = inputsLine.match(/^(\s*)/);
      const inputsIndent = inputsIndentMatch ? inputsIndentMatch[1].length : 0;

      // Input parameters should be indented more than the inputs: line
      if (inputIndent <= inputsIndent) {
        this.logger.debug(`[HoverProvider] Input parameter not properly indented within inputs section`, 'HoverProvider');
        return null;
      }

      this.logger.debug(`[HoverProvider] Confirmed input parameter "${inputName}" is within inputs section of component`, 'HoverProvider');

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
    let description = component.description || 'Component/Project does not have a description';

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
