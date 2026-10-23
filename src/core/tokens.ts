/**
 * Token hygiene shared by everything that stores or reads a GitLab token.
 */

// C0 controls and DEL. A token is ASCII; anything in this range inside it was pasted by mistake (or is an attack on
// an HTTP header).
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/** A token that can't be used. The message never contains the token. */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Trim surrounding whitespace (a pasted token often ends in a newline) and refuse what's left if it is empty or
 * contains control characters.
 *
 * @throws InvalidTokenError
 */
export function normalizeToken(raw: string): string {
  const token = raw.trim();
  if (token === '') {
    throw new InvalidTokenError('The token is empty.');
  }
  if (CONTROL_CHARACTERS.test(token)) {
    throw new InvalidTokenError('The token contains control characters. Copy it again from GitLab and paste only the token.');
  }
  return token;
}
