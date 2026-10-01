/**
 * GitLab's `include: component:` value is `<fqdn>/<project-path>/<component>@<version>` — no scheme. The parsers
 * downstream (all `new URL(...)`) take the `https://` URL {@link referenceToUrl} builds from it.
 */

/** Matches `component: <base>@<partial-version>` at the end of a line prefix, tolerating an opening quote. */
const VERSION_PREFIX_REGEX = /component:\s*['"]?([^\s'"@]+)@([^\s'"]*)$/;

/**
 * Build the value GitLab accepts for `include: component:`.
 *
 * @param serverFqdn The GitLab host of the repository the reference is written into, when known. A component on that
 *                   same host is written as `$CI_SERVER_FQDN/…` — GitLab's recommended form, which keeps the include
 *                   working if the project is mirrored or moved to another instance.
 * @returns `<instance>/<sourcePath>/<name>`, suffixed with `@<version>` when a version is given.
 */
export function buildComponentReference(
  instance: string,
  sourcePath: string,
  name: string,
  version?: string,
  serverFqdn?: string,
): string {
  const host = serverFqdn && serverFqdn.toLowerCase() === instance.toLowerCase() ? '$CI_SERVER_FQDN' : instance;
  const base = `${host}/${sourcePath}/${name}`;
  return version ? `${base}@${version}` : base;
}

/** Turn a written `host/path` component reference (no variables) into an `https://` URL `new URL()` can parse. */
export function referenceToUrl(reference: string): string {
  return `https://${reference}`;
}

/**
 * Detect a version being typed after `@` in a `component:` value.
 *
 * @returns The reference before `@` exactly as written — GitLab variables included, for the caller to expand — and the
 *          partial version after it, or `null` when the line isn't a component version slot.
 */
export function parseVersionCompletionPrefix(linePrefix: string): { base: string; partialVersion: string } | null {
  const match = VERSION_PREFIX_REGEX.exec(linePrefix);
  return match ? { base: match[1], partialVersion: match[2] } : null;
}
