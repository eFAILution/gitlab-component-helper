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

/**
 * Parse a YAML document.
 *
 * @param text - The YAML source to parse.
 * @param silent - Suppress the `console.error` on a parse failure. Use when a parse failure is expected and
 *   handled by the caller (e.g. probing a document that is invalid mid-edit), to avoid log noise on a hot path.
 * @returns the parsed YAML value (a mapping, sequence, scalar, or `undefined` for empty input), or `null` if the
 *   text fails to parse. Callers narrow object results with {@link isYamlNode} before reading fields.
 */
export function parseYaml(text: string, silent = false): unknown {
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
    if (!silent) {
      console.error('Error parsing YAML:', e);
    }
    return null;
  }
}

/**
 * Parse a YAML document *stream* into its constituent mapping documents.
 *
 * A GitLab CI component template is a multi-document file: the `spec:` header is one document, the `include:`/jobs
 * body another, separated by `---`. `js-yaml`'s `load` throws on any stream with more than one document, so
 * {@link parseYaml} returns `null` for these files. This uses `loadAll` and returns each document that is a mapping,
 * in document order, so a caller can select the one owning the key it needs (see {@link findDocumentWith}) rather
 * than flattening distinct documents together.
 *
 * @param text - The YAML source (one or more `---`-separated documents) to parse.
 * @param silent - Suppress the `console.error` on a parse failure. Use on hot paths where a mid-edit parse failure
 *   is expected and handled.
 * @returns the stream's mapping documents in order (non-mapping documents — scalars, sequences, `null` — are
 *   dropped); an empty array when the stream is empty or fails to parse.
 */
export function parseYamlDocuments(text: string, silent = false): YamlNode[] {
  try {
    const docs = yaml.loadAll(text);
    return docs.filter(isYamlNode);
  } catch (e) {
    if (!silent) {
      console.error('Error parsing YAML:', e);
    }
    return [];
  }
}

/**
 * Find the first document in a parsed stream that carries the given top-level key.
 *
 * @param docs - Mapping documents from {@link parseYamlDocuments}, in document order.
 * @param key - The top-level key to locate (e.g. `'include'` or `'spec'`).
 * @returns the first document whose own `key` is defined, or `null` when no document carries it.
 */
export function findDocumentWith(docs: YamlNode[], key: string): YamlNode | null {
  return docs.find((doc) => doc[key] !== undefined) ?? null;
}

// Clean expired cache entries
function cleanParseCache(currentTime: number): void {
  for (const [key, value] of parseCache.entries()) {
    if (currentTime - value.timestamp > CACHE_TTL) {
      parseCache.delete(key);
    }
  }
}
