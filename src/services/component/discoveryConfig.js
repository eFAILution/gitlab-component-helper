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
exports.DISCOVERY_LIMITS = exports.HARD_DEFAULTS = void 0;
exports.mergeDiscoveryConfig = mergeDiscoveryConfig;
exports.clampDiscoveryConfig = clampDiscoveryConfig;
exports.buildTemplatePathCandidates = buildTemplatePathCandidates;
exports.matchesFilePattern = matchesFilePattern;
exports.readGlobalDiscoveryConfig = readGlobalDiscoveryConfig;
exports.getDiscoveryConfigForSource = getDiscoveryConfigForSource;
const vscode = __importStar(require("vscode"));
exports.HARD_DEFAULTS = Object.freeze({
    templateRoots: ['templates'],
    maxDepth: 1,
    filePatterns: ['*.yml', '*.yaml'],
    templateFileNames: ['template.yml', 'template.yaml'],
});
exports.DISCOVERY_LIMITS = Object.freeze({
    maxDepth: 3,
    templateRootsCount: 5,
    filePatternsCount: 10,
    templateFileNamesCount: 10,
});
function mergeDiscoveryConfig(global, override) {
    return {
        templateRoots: override?.templateRoots ?? global?.templateRoots ?? [...exports.HARD_DEFAULTS.templateRoots],
        maxDepth: override?.maxDepth ?? global?.maxDepth ?? exports.HARD_DEFAULTS.maxDepth,
        filePatterns: override?.filePatterns ?? global?.filePatterns ?? [...exports.HARD_DEFAULTS.filePatterns],
        templateFileNames: override?.templateFileNames ??
            global?.templateFileNames ??
            [...exports.HARD_DEFAULTS.templateFileNames],
    };
}
function clampDiscoveryConfig(config) {
    return {
        templateRoots: dedupe(config.templateRoots
            .slice(0, exports.DISCOVERY_LIMITS.templateRootsCount)
            .map(normalizeRoot)
            .filter((root) => Boolean(root))),
        maxDepth: clamp(config.maxDepth, 0, exports.DISCOVERY_LIMITS.maxDepth),
        filePatterns: dedupe(config.filePatterns
            .slice(0, exports.DISCOVERY_LIMITS.filePatternsCount)
            .filter(isFilenamePattern)),
        templateFileNames: dedupe(config.templateFileNames
            .slice(0, exports.DISCOVERY_LIMITS.templateFileNamesCount)
            .filter(isFilenameOnly)),
    };
}
function buildTemplatePathCandidates(componentName, config) {
    const candidates = [];
    for (const root of config.templateRoots) {
        for (const pattern of config.filePatterns) {
            const ext = patternExtension(pattern);
            if (ext !== undefined) {
                candidates.push(`${root}/${componentName}${ext}`);
            }
        }
        for (const fileName of config.templateFileNames) {
            candidates.push(`${root}/${componentName}/${fileName}`);
        }
    }
    return dedupe(candidates);
}
function matchesFilePattern(filename, patterns) {
    return patterns.some((pattern) => {
        const ext = patternExtension(pattern);
        if (ext !== undefined) {
            return ext === '' ? true : filename.endsWith(ext);
        }
        return filename === pattern;
    });
}
function readGlobalDiscoveryConfig() {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    const override = {};
    const roots = config.get('discovery.templateRoots');
    const depth = config.get('discovery.maxDepth');
    const patterns = config.get('discovery.filePatterns');
    const templateFileNames = config.get('discovery.templateFileNames');
    if (Array.isArray(roots))
        override.templateRoots = roots;
    if (typeof depth === 'number')
        override.maxDepth = depth;
    if (Array.isArray(patterns))
        override.filePatterns = patterns;
    if (Array.isArray(templateFileNames))
        override.templateFileNames = templateFileNames;
    return override;
}
function getDiscoveryConfigForSource(source) {
    return clampDiscoveryConfig(mergeDiscoveryConfig(readGlobalDiscoveryConfig(), source?.discovery));
}
function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(Math.max(Math.trunc(value), min), max);
}
function normalizeRoot(root) {
    if (typeof root !== 'string')
        return '';
    const trimmed = root.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!trimmed || trimmed.includes('..'))
        return '';
    return trimmed;
}
function isFilenamePattern(pattern) {
    if (typeof pattern !== 'string' || !pattern)
        return false;
    if (pattern.includes('/') || pattern.includes('..'))
        return false;
    return pattern.startsWith('*') || /^[\w.-]+$/.test(pattern);
}
function isFilenameOnly(name) {
    return typeof name === 'string' && !!name && !name.includes('/') && !name.includes('..');
}
function patternExtension(pattern) {
    if (pattern.startsWith('*')) {
        return pattern.slice(1);
    }
    return undefined;
}
function dedupe(items) {
    return Array.from(new Set(items));
}
//# sourceMappingURL=discoveryConfig.js.map