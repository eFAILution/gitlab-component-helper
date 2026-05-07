/**
 * Helper class for building CSS styles for the detached component view.
 * All VSCode CSS variables are preserved for theme compatibility.
 */
export class StyleBuilder {
  /**
   * Generates the complete CSS styles for the detached component view.
   */
  static buildStyles(): string {
    return `
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        padding: 20px;
        line-height: 1.6;
      }
      .header {
        border-bottom: 2px solid var(--vscode-panel-border);
        padding-bottom: 15px;
        margin-bottom: 20px;
      }
      h1 {
        margin: 0 0 10px 0;
        color: var(--vscode-editor-foreground);
      }
      .metadata {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        margin-bottom: 20px;
        font-size: 0.9em;
      }
      .metadata div {
        background-color: var(--vscode-panel-background);
        padding: 8px 12px;
        border-radius: 4px;
        border: 1px solid var(--vscode-panel-border);
      }
      .description {
        background-color: var(--vscode-textBlockQuote-background);
        border-left: 4px solid var(--vscode-textBlockQuote-border);
        padding: 15px;
        margin-bottom: 25px;
        border-radius: 0 4px 4px 0;
      }
      .section {
        margin-bottom: 30px;
      }
      .section h2 {
        color: var(--vscode-editor-foreground);
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 8px;
        margin-bottom: 15px;
      }
      .parameters-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      }
      .select-all-group {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 0.9em;
      }
      .parameters {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 5px;
      }
      .parameter {
        padding: 15px;
        border-bottom: 1px solid var(--vscode-panel-border);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .parameter:last-child {
        border-bottom: none;
      }
      .parameter-content {
        flex: 1;
        margin-right: 15px;
      }
      .parameter-checkbox {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 5px;
      }
      .parameter-checkbox.existing {
        background-color: var(--vscode-diffEditor-insertedTextBackground);
        padding: 5px;
        border-radius: 3px;
        border: 1px solid var(--vscode-diffEditor-insertedTextBorder);
      }
      .parameter-checkbox.existing label {
        color: var(--vscode-diffEditor-insertedLineBackground);
        font-weight: 500;
      }
      .parameter-name {
        font-weight: bold;
        font-size: 1.1em;
        margin-bottom: 5px;
      }
      .parameter-required {
        color: var(--vscode-errorForeground);
        font-size: 0.9em;
        font-weight: bold;
      }
      .parameter-optional {
        color: var(--vscode-disabledForeground);
        font-size: 0.9em;
      }
      .parameter-description {
        margin: 8px 0;
        line-height: 1.4;
      }
      .parameter-details {
        display: flex;
        gap: 15px;
        margin-top: 8px;
        font-size: 0.9em;
      }
      .parameter-default {
        background-color: var(--vscode-textCodeBlock-background);
        padding: 2px 6px;
        border-radius: 3px;
        font-family: monospace;
        font-size: 0.9em;
      }
      .insert-options {
        background-color: var(--vscode-panel-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 5px;
        padding: 20px;
        margin-top: 25px;
      }
      .insert-options h3 {
        margin-top: 0;
        margin-bottom: 15px;
        color: var(--vscode-editor-foreground);
      }
      .checkbox-group {
        margin-bottom: 15px;
      }
      .checkbox-group label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      .button-group {
        display: flex;
        gap: 10px;
      }
      button {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 10px 20px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: 500;
      }
      button:hover {
        background-color: var(--vscode-button-hoverBackground);
      }
      button.secondary {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      button.secondary:hover {
        background-color: var(--vscode-button-secondaryHoverBackground);
      }
      .no-content {
        color: var(--vscode-disabledForeground);
        font-style: italic;
        text-align: center;
        padding: 20px;
      }
      a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
      }
      a:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
      }
    `;
  }
}
