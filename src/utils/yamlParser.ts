import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

export function parseYaml(text: string): any {
  try {
    return yaml.load(text);
  } catch (e) {
    console.error('Error parsing YAML:', e);
    return null;
  }
}

export function getYamlNodeAtPosition(document: vscode.TextDocument, position: vscode.Position): any {
  // This is a stub function that will need more complex implementation
  // For now, just return the parsed document
  const text = document.getText();
  return parseYaml(text);
}
