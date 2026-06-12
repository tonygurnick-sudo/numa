/**
 * Claims-only JWT decode. NOT a verifier — verification happens server-side
 * (the Cognito-issued token is signed; we trust Cognito's signing chain
 * because we just authenticated with Cognito).
 */

export interface IdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  'cognito:groups'?: string[];
  'cognito:username'?: string;
  exp: number;
  iat: number;
  iss: string;
  [key: string]: unknown;
}

export function decodeJwtClaims<T = IdTokenClaims>(token: string): T {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('decodeJwtClaims: not a JWT (expected three dot-separated parts)');
  }
  const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
  const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  return JSON.parse(json) as T;
}
