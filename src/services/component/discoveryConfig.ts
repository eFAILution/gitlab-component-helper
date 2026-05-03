import * as vscode from 'vscode';

export interface DiscoveryConfig {
  templateRoots: string[];
  maxDepth: number;
  filePatterns: string[];
  templateFileNames: string[];
}

export interface DiscoveryOverride {
  templateRoots?: string[];
  maxDepth?: number;
  filePatterns?: string[];
  templateFileNames?: string[];
}

export interface ComponentSourceWithDiscovery {
  name?: string;
  path?: string;
  gitlabInstance?: string;
  discovery?: DiscoveryOverride;
}

export const HARD_DEFAULTS: Readonly<DiscoveryConfig> = Object.freeze({
  templateRoots: ['templates'],
  maxDepth: 1,
  filePatterns: ['*.yml', '*.yaml'],
  templateFileNames: ['template.yml', 'template.yaml'],
});

export const DISCOVERY_LIMITS = Object.freeze({
  maxDepth: 3,
  templateRootsCount: 5,
  filePatternsCount: 10,
  templateFileNamesCount: 10,
});

export function mergeDiscoveryConfig(
  global: DiscoveryOverride | undefined,
  override: DiscoveryOverride | undefined,
): DiscoveryConfig {
  return {
    templateRoots:
      override?.templateRoots ?? global?.templateRoots ?? [...HARD_DEFAULTS.templateRoots],
    maxDepth: override?.maxDepth ?? global?.maxDepth ?? HARD_DEFAULTS.maxDepth,
    filePatterns:
      override?.filePatterns ?? global?.filePatterns ?? [...HARD_DEFAULTS.filePatterns],
    templateFileNames:
      override?.templateFileNames ??
      global?.templateFileNames ??
      [...HARD_DEFAULTS.templateFileNames],
  };
}

export function clampDiscoveryConfig(config: DiscoveryConfig): DiscoveryConfig {
  return {
    templateRoots: dedupe(
      config.templateRoots
        .slice(0, DISCOVERY_LIMITS.templateRootsCount)
        .map(normalizeRoot)
        .filter((root): root is string => Boolean(root)),
    ),
    maxDepth: clamp(config.maxDepth, 0, DISCOVERY_LIMITS.maxDepth),
    filePatterns: dedupe(
      config.filePatterns
        .slice(0, DISCOVERY_LIMITS.filePatternsCount)
        .filter(isFilenamePattern),
    ),
    templateFileNames: dedupe(
      config.templateFileNames
        .slice(0, DISCOVERY_LIMITS.templateFileNamesCount)
        .filter(isFilenameOnly),
    ),
  };
}

export function buildTemplatePathCandidates(
  componentName: string,
  config: DiscoveryConfig,
): string[] {
  const candidates: string[] = [];
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

export function matchesFilePattern(filename: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const ext = patternExtension(pattern);
    if (ext !== undefined) {
      return ext === '' ? true : filename.endsWith(ext);
    }
    return filename === pattern;
  });
}

export function readGlobalDiscoveryConfig(): DiscoveryOverride {
  const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
  const override: DiscoveryOverride = {};
  const roots = config.get<string[]>('discovery.templateRoots');
  const depth = config.get<number>('discovery.maxDepth');
  const patterns = config.get<string[]>('discovery.filePatterns');
  const templateFileNames = config.get<string[]>('discovery.templateFileNames');
  if (Array.isArray(roots)) override.templateRoots = roots;
  if (typeof depth === 'number') override.maxDepth = depth;
  if (Array.isArray(patterns)) override.filePatterns = patterns;
  if (Array.isArray(templateFileNames)) override.templateFileNames = templateFileNames;
  return override;
}

export function getDiscoveryConfigForSource(
  source?: ComponentSourceWithDiscovery,
): DiscoveryConfig {
  return clampDiscoveryConfig(
    mergeDiscoveryConfig(readGlobalDiscoveryConfig(), source?.discovery),
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeRoot(root: string): string {
  if (typeof root !== 'string') return '';
  const trimmed = root.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed || trimmed.includes('..')) return '';
  return trimmed;
}

function isFilenamePattern(pattern: string): boolean {
  if (typeof pattern !== 'string' || !pattern) return false;
  if (pattern.includes('/') || pattern.includes('..')) return false;
  return pattern.startsWith('*') || /^[\w.-]+$/.test(pattern);
}

function isFilenameOnly(name: string): boolean {
  return typeof name === 'string' && !!name && !name.includes('/') && !name.includes('..');
}

function patternExtension(pattern: string): string | undefined {
  if (pattern.startsWith('*')) {
    return pattern.slice(1);
  }
  return undefined;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
