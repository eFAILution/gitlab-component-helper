"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseYaml = parseYaml;
exports.getYamlNodeAtPosition = getYamlNodeAtPosition;
exports.findInputNode = findInputNode;
const yaml = __importStar(require("js-yaml"));
// Cache for parsed YAML documents to avoid re-parsing
const parseCache = new Map();
const CACHE_TTL = 5000; // 5 seconds TTL for parse cache
// Define GitLab specific YAML tags
const referenceType = new yaml.Type('!reference', {
    kind: 'sequence',
    construct: function (data) {
        return { reference: data };
    }
});
const GITLAB_SCHEMA = yaml.DEFAULT_SCHEMA.extend([referenceType]);
function parseYaml(text) {
    try {
        // Generate a simple hash of the content for caching
        const contentHash = text.length + text.substring(0, 100) + text.substring(text.length - 100);
        const now = Date.now();
        // Check cache first
        const cached = parseCache.get(contentHash);
        if (cached && cached.content === text && (now - cached.timestamp) < CACHE_TTL) {
            return cached.parsed;
        }
        // Parse and cache with GitLab schema
        const parsed = yaml.load(text, { schema: GITLAB_SCHEMA });
        parseCache.set(contentHash, { content: text, parsed, timestamp: now });
        // Clean old cache entries periodically
        if (parseCache.size > 50) {
            cleanParseCache(now);
        }
        return parsed;
    }
    catch (e) {
        console.error('Error parsing YAML:', e);
        return null;
    }
}
// Clean expired cache entries
function cleanParseCache(currentTime) {
    for (const [key, value] of parseCache.entries()) {
        if (currentTime - value.timestamp > CACHE_TTL) {
            parseCache.delete(key);
        }
    }
}
function getYamlNodeAtPosition(document, position) {
    const text = document.getText();
    const parsed = parseYaml(text);
    // TODO: Implement actual position-based node finding
    // For now, return the parsed document (maintains current behavior)
    return parsed;
}
function findInputNode(document, componentNode, inputName) {
    if (!componentNode || !componentNode.inputs) {
        return null;
    }
    const text = document.getText();
    const lines = text.split('\n');
    // More precise component line finding
    const componentUrl = componentNode.component;
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
//# sourceMappingURL=yamlParser.js.map