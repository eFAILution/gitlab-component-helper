/**
 * Utility functions for safely parsing URLs.
 */

/**
 * Safely parses a URL string, automatically prepending a dummy protocol
 * if it's missing (e.g., for GitLab component references without a protocol).
 * This prevents TypeError: Invalid URL when parsing hostname/pathname.
 * 
 * @param url The URL string to parse
 * @returns A parsed URL object
 */
export function safeUrlParse(url: string): URL {
  let parseableUrl = url;
  if (!url.includes('://')) {
    parseableUrl = `https://${url}`;
  }
  return new URL(parseableUrl);
}
