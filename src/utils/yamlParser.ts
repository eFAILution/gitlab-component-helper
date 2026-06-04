import * as yaml from 'js-yaml';
import type * as vscode from 'vscode';

/** Loose object shape returned by `js-yaml`. Callers narrow via property checks before reading fields. */
export type YamlNode = Record<string, unknown>;

/** Type-guard: a parsed YAML value is a non-null object (i.e. a mapping). Use to narrow `unknown` results. */
export function isYamlNode(value: unknown): value is YamlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Cache for parsed YAML documents to avoid re-parsing
const parseCache = new Map<string, { content: string; parsed: unknown; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds TTL for parse cache

export function parseYaml(text: string): unknown {
  try {
    // Generate a simple hash of the content for caching
    const contentHash = text.length + text.substring(0, 100) + text.substring(text.length - 100);
    const now = Date.now();

    // Check cache first
    const cached = parseCache.get(contentHash);
    if (cached && cached.content === text && (now - cached.timestamp) < CACHE_TTL) {
      return cached.parsed;
    }

    // Parse and cache
    const parsed = yaml.load(text);
    parseCache.set(contentHash, { content: text, parsed, timestamp: now });

    // Clean old cache entries periodically
    if (parseCache.size > 50) {
      cleanParseCache(now);
    }

    return parsed;
  } catch (e) {
    console.error('Error parsing YAML:', e);
    return null;
  }
}

// Clean expired cache entries
function cleanParseCache(currentTime: number): void {
  for (const [key, value] of parseCache.entries()) {
    if (currentTime - value.timestamp > CACHE_TTL) {
      parseCache.delete(key);
    }
  }
}

export function getYamlNodeAtPosition(document: vscode.TextDocument, _position: vscode.Position): unknown {
  const text = document.getText();
  const parsed = parseYaml(text);

  // TODO: Implement actual position-based node finding
  // For now, return the parsed document (maintains current behavior)
  return parsed;
}

export function findInputNode(document: vscode.TextDocument, componentNode: YamlNode | null | undefined, inputName: string): { line: number; column: number } | null {
    if (!componentNode || !componentNode.inputs) {
        return null;
    }

    const text = document.getText();
    const lines = text.split('\n');

    // More precise component line finding
    const componentUrl = componentNode.component;
    if (typeof componentUrl !== 'string') {
        return null;
    }
    let componentLine = -1;

    // Find the line that contains the component URL with proper YAML structure
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('component:') && line.includes(componentUrl)) {
            componentLine = i;
            break;
        }
        // Alternative: look for the URL on its own line after a component: key
        if (line.trim() === componentUrl && i > 0 && lines[i - 1].includes('component:')) {
            componentLine = i;
            break;
        }
    }

    if (componentLine === -1) {
        return null;
    }

    // Look for inputs section more efficiently
    let inInputsSection = false;
    let inputsIndentation = 0;

    for (let i = componentLine + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) {
            continue;
        }

        // Calculate indentation
        const indentation = line.length - line.trimStart().length;

        // Check if we've entered the inputs section
        if (trimmedLine === 'inputs:' || trimmedLine.startsWith('inputs:')) {
            inInputsSection = true;
            inputsIndentation = indentation;
            continue;
        }

        if (inInputsSection) {
            // If we encounter a line with same or less indentation than inputs, we've left the inputs section
            if (indentation <= inputsIndentation && trimmedLine !== '') {
                break;
            }

            // Look for the specific input with proper YAML key format
            if (trimmedLine === `${inputName}:` || trimmedLine.startsWith(`${inputName}:`)) {
                return {
                    line: i,
                    column: line.indexOf(inputName)
                };
            }
        }
    }

    return null;
}
