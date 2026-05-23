// src/utils/crypto.ts
/**
 * Cryptographically secure random utilities used across the extension.
 * This file is deliberately tiny so it can be imported without pulling in heavy deps.
 */
import * as crypto from 'crypto';

/**
 * Returns a URL‑safe base64 string of the requested byte length.
 * Used for CSP nonces and any other place where a random token is needed.
 */
export function secureRandomBase64Url(byteLength: number = 16): string {
    // crypto.randomBytes returns a Buffer. Convert to base64url (replace +/ and trim =)
    return crypto.randomBytes(byteLength).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
