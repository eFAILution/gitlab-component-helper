/**
 * Helper class for building HTML elements with proper escaping and formatting.
 */
export class HtmlBuilder {
  /**
   * Escapes HTML special characters to prevent XSS attacks.
   */
  static escape(text: string | undefined): string {
    if (!text) {
      return '';
    }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Builds a metadata item div with label and content.
   */
  static buildMetadataItem(label: string, content: string): string {
    return `<div><strong>${this.escape(label)}:</strong> ${content}</div>`;
  }

  /**
   * Builds a link element.
   */
  static buildLink(href: string, text: string, target: string = '_blank'): string {
    return `<a href="${this.escape(href)}" target="${target}">${this.escape(text)}</a>`;
  }

  /**
   * Builds a checkbox input element.
   */
  static buildCheckbox(
    id: string,
    className: string = '',
    checked: boolean = false,
    onChange: string = '',
    dataAttributes: Record<string, string> = {}
  ): string {
    const dataAttrs = Object.entries(dataAttributes)
      .map(([key, value]) => `data-${key}="${this.escape(value)}"`)
      .join(' ');

    return `<input type="checkbox" id="${this.escape(id)}" class="${this.escape(className)}" ${checked ? 'checked' : ''} ${onChange ? `onchange="${onChange}"` : ''} ${dataAttrs}>`;
  }

  /**
   * Builds a label element.
   */
  static buildLabel(forId: string, text: string): string {
    return `<label for="${this.escape(forId)}">${this.escape(text)}</label>`;
  }

  /**
   * Wraps content in a div with optional class.
   */
  static wrapDiv(content: string, className: string = ''): string {
    const classAttr = className ? ` class="${this.escape(className)}"` : '';
    return `<div${classAttr}>${content}</div>`;
  }

  /**
   * Builds a button element.
   */
  static buildButton(text: string, onClick: string, className: string = ''): string {
    const classAttr = className ? ` class="${this.escape(className)}"` : '';
    return `<button${classAttr} onclick="${onClick}">${this.escape(text)}</button>`;
  }

  /**
   * Conditionally renders content based on a condition.
   */
  static renderIf(condition: boolean, content: string, fallback: string = ''): string {
    return condition ? content : fallback;
  }
}
