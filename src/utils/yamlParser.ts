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
  const text = document.getText();
  return parseYaml(text);
}

export function findInputNode(document: vscode.TextDocument, componentNode: any, inputName: string): any {
    if (!componentNode || !componentNode.inputs) {
        return null;
    }

    const text = document.getText();
    const lines = text.split('\n');

    const componentLine = lines.findIndex(line => line.includes(componentNode.component));
    if (componentLine === -1) {
        return null;
    }

    let inInputsSection = false;
    for (let i = componentLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('inputs:')) {
            inInputsSection = true;
            continue;
        }

        if (inInputsSection) {
            if (line.includes(`${inputName}:`)) {
                return {
                    line: i,
                    column: line.indexOf(inputName)
                };
            }

            if (!line.match(/^\s+/)) {
                break;
            }
        }
    }

    return null;
}