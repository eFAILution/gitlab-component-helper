import { HtmlBuilder } from './helpers/htmlBuilder';
import { StyleBuilder } from './helpers/styleBuilder';

/**
 * Template class for generating HTML for the detached component view.
 * Breaks down the HTML generation into smaller, manageable methods.
 */
export class DetachedComponentTemplate {
  /**
   * Renders the complete HTML for a detached component view.
   * @param component - The component data object
   * @param existingInputs - Array of input parameter names already present in the file
   * @returns Complete HTML string ready for webview display
   */
  static render(component: any, existingInputs: string[] = []): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      ${this.buildHead(component)}
      <body>
        ${this.buildHeader(component)}
        ${this.buildDescription(component)}
        ${this.buildParameters(component, existingInputs)}
        ${this.buildInsertOptions(component, existingInputs)}
        ${this.buildScripts()}
      </body>
      </html>
    `;
  }

  /**
   * Builds the HTML head section with title and styles.
   */
  private static buildHead(component: any): string {
    return `
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${HtmlBuilder.escape(component.name)} - Component Details</title>
        <style>
          ${StyleBuilder.buildStyles()}
        </style>
      </head>
    `;
  }

  /**
   * Builds the header section with component name and metadata.
   */
  private static buildHeader(component: any): string {
    const metadataItems: string[] = [];

    // Add source metadata
    if (component.context) {
      const sourceUrl = `https://${component.context.gitlabInstance}/${component.context.path}`;
      const sourceLink = HtmlBuilder.buildLink(
        sourceUrl,
        `${component.context.gitlabInstance}/${component.context.path}`
      );
      metadataItems.push(HtmlBuilder.buildMetadataItem('Source', sourceLink));
    } else if (component.source) {
      const sourceLink = HtmlBuilder.buildLink(component.source, component.source);
      metadataItems.push(HtmlBuilder.buildMetadataItem('Source', sourceLink));
    }

    // Add version metadata
    if (component.version) {
      metadataItems.push(HtmlBuilder.buildMetadataItem('Version', HtmlBuilder.escape(component.version)));
    }

    // Add documentation metadata
    if (component.documentationUrl) {
      const docLink = HtmlBuilder.buildLink(component.documentationUrl, 'View Online');
      metadataItems.push(HtmlBuilder.buildMetadataItem('Documentation', docLink));
    }

    return `
      <div class="header">
        <h1>${HtmlBuilder.escape(component.name)}</h1>
        <div class="metadata">
          ${metadataItems.join('\n')}
        </div>
      </div>
    `;
  }

  /**
   * Builds the description section.
   */
  private static buildDescription(component: any): string {
    if (component.description) {
      return `
        <div class="description">
          ${HtmlBuilder.escape(component.description)}
        </div>
      `;
    }

    return `
      <div class="description">
        <strong>Component/Project does not have a description</strong><br>
        <em>No additional documentation available.</em>
      </div>
    `;
  }

  /**
   * Builds the parameters section with individual parameter cards.
   */
  private static buildParameters(component: any, existingInputs: string[]): string {
    const parameters = component.parameters || [];
    const hasParameters = parameters.length > 0;

    const existingCountBadge = existingInputs.length > 0
      ? `<div style="font-size: 0.8em; color: var(--vscode-charts-green); background-color: var(--vscode-diffEditor-insertedTextBackground); padding: 3px 8px; border-radius: 3px;">
          ${existingInputs.length} already in file
        </div>`
      : '';

    const selectAllControl = hasParameters
      ? `<div class="select-all-group">
          ${HtmlBuilder.buildCheckbox('selectAllInputs', '', false, 'toggleAllInputs()')}
          ${HtmlBuilder.buildLabel('selectAllInputs', 'Select All')}
        </div>`
      : '';

    const parametersContent = hasParameters
      ? `<div class="parameters">
          ${parameters.map((param: any) => this.buildParameter(param, existingInputs)).join('')}
        </div>`
      : '<div class="no-content">No parameters documented for this component.</div>';

    return `
      <div class="section">
        <div class="parameters-header">
          <h2>Parameters</h2>
          <div style="display: flex; align-items: center; gap: 15px;">
            ${existingCountBadge}
            ${selectAllControl}
          </div>
        </div>
        ${parametersContent}
      </div>
    `;
  }

  /**
   * Builds a single parameter card.
   */
  private static buildParameter(param: any, existingInputs: string[]): string {
    const isExisting = existingInputs.includes(param.name);
    const checkboxClass = isExisting ? 'parameter-checkbox existing' : 'parameter-checkbox';
    const checkboxLabel = isExisting ? 'Already Present' : 'Insert';

    const defaultValueDisplay = param.default !== undefined
      ? `<div><strong>Type:</strong> ${HtmlBuilder.escape(param.type || 'string')}</div>
        <div><strong>Default:</strong> <span class="parameter-default">${HtmlBuilder.escape(String(param.default))}</span></div>`
      : `<div><strong>Type:</strong> ${HtmlBuilder.escape(param.type || 'string')}</div>`;

    return `
      <div class="parameter">
        <div class="parameter-content">
          <div class="parameter-name">${HtmlBuilder.escape(param.name)}</div>
          <div class="${param.required ? 'parameter-required' : 'parameter-optional'}">
            (${param.required ? 'required' : 'optional'})
          </div>
          <div class="parameter-description">${HtmlBuilder.escape(param.description || `Parameter: ${param.name}`)}</div>
          <div class="parameter-details">
            ${defaultValueDisplay}
          </div>
        </div>
        <div class="${checkboxClass}">
          ${HtmlBuilder.buildCheckbox(
            `input-${param.name}`,
            'input-checkbox',
            isExisting,
            'updateInputSelection()',
            { 'param-name': param.name }
          )}
          ${HtmlBuilder.buildLabel(`input-${param.name}`, checkboxLabel)}
        </div>
      </div>
    `;
  }

  /**
   * Builds the insert options section with action buttons.
   */
  private static buildInsertOptions(component: any, existingInputs: string[]): string {
    const isEditMode = existingInputs.length > 0;
    const heading = isEditMode ? 'Edit Component' : 'Insert Component';
    const buttonText = isEditMode ? 'Update Component' : 'Insert Component';

    const editModeNotice = isEditMode
      ? `<div style="background-color: var(--vscode-diffEditor-insertedTextBackground); padding: 10px; border-radius: 5px; margin-bottom: 15px; border: 1px solid var(--vscode-diffEditor-insertedTextBorder);">
          <strong>📝 Edit Mode:</strong> This will update the existing component in your GitLab CI file. Uncheck inputs to remove them, check new ones to add them.
        </div>`
      : '';

    return `
      <div class="insert-options">
        <h3>${heading}</h3>
        ${editModeNotice}
        <div class="checkbox-group">
          <label>
            ${HtmlBuilder.buildCheckbox('includeInputs', '', false)}
            Include input parameters with default values
          </label>
        </div>
        <div class="button-group">
          ${HtmlBuilder.buildButton(buttonText, 'insertComponent()')}
        </div>
      </div>
    `;
  }

  /**
   * Builds the JavaScript section for interactive functionality.
   */
  private static buildScripts(): string {
    return `
      <script>
        const vscode = acquireVsCodeApi();

        function insertComponent() {
          const includeInputs = document.getElementById('includeInputs')?.checked || false;

          // Get selected individual inputs
          const selectedInputs = [];
          const inputCheckboxes = document.querySelectorAll('.input-checkbox:checked');
          inputCheckboxes.forEach(checkbox => {
            selectedInputs.push(checkbox.getAttribute('data-param-name'));
          });

          vscode.postMessage({
            command: 'insertComponent',
            includeInputs: includeInputs,
            selectedInputs: selectedInputs
          });
        }

        function toggleAllInputs() {
          const selectAllCheckbox = document.getElementById('selectAllInputs');
          const inputCheckboxes = document.querySelectorAll('.input-checkbox');

          inputCheckboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
          });

          updateInputSelection();
        }

        function updateInputSelection() {
          const inputCheckboxes = document.querySelectorAll('.input-checkbox');
          const checkedInputs = document.querySelectorAll('.input-checkbox:checked');
          const selectAllCheckbox = document.getElementById('selectAllInputs');
          const includeInputsCheckbox = document.getElementById('includeInputs');

          // Update select all checkbox state
          if (checkedInputs.length === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
          } else if (checkedInputs.length === inputCheckboxes.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
          } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
          }

          // Auto-check "Include input parameters" if any individual inputs are selected
          if (checkedInputs.length > 0) {
            includeInputsCheckbox.checked = true;
          }
        }

        // Initialize the checkbox states on load
        document.addEventListener('DOMContentLoaded', function() {
          updateInputSelection();

          // Show a helpful message if existing inputs were detected
          const checkedInputs = document.querySelectorAll('.input-checkbox:checked');
          if (checkedInputs.length > 0) {
            console.log('Pre-selected existing inputs from your GitLab CI file');
          }
        });
      </script>
    `;
  }
}
