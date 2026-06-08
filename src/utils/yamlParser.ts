import * as yaml from 'js-yaml';

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
