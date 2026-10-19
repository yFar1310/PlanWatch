import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import type { SessionInfo } from '../shared/session';

export interface AuthBindings {
  LOCAL_DEV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
}
export interface Session extends SessionInfo { ownerId: string }
export class AuthError extends Error {
  constructor(public code: string, message: string, public status: 401 | 403 | 503) { super(message); }
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticate(request: Request, env: AuthBindings): Promise<Session> {
  const hostname = new URL(request.url).hostname;
  if (env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return { ownerId: 'local-preview', mode: 'local', email: null, expiresAt: null };
  }
  const team = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
  const audience = env.ACCESS_AUD?.trim();
  const owner = env.OWNER_EMAIL?.trim().toLowerCase();
  if (!team || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(team) || !audience || !z.email().safeParse(owner).success) {
    throw new AuthError('setup_required', 'Private access has not been configured for this app.', 503);
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) throw new AuthError('sign_in_required', 'Sign in to load and save your tasks. Your drafts are kept on this device.', 401);
  let keySet = keySets.get(team);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`), { timeoutDuration: 5_000 });
    keySets.set(team, keySet);
  }
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: `https://${team}`, audience, algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5,
    });
    if (typeof payload.email !== 'string' || typeof payload.sub !== 'string' || !payload.sub || payload.iat! > Date.now() / 1000 + 5) {
      throw new AuthError('invalid_session', 'This session could not be verified. Sign in again.', 401);
    }
    if (payload.email.trim().toLowerCase() !== owner) throw new AuthError('not_allowed', 'This account does not have access to this workspace.', 403);
    // A stable single-person workspace; changing login providers does not change the data owner.
    return { ownerId: 'personal', mode: 'access', email: owner!, expiresAt: payload.exp! * 1000 };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof errors.JOSEError && !['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC'].includes(error.code)) {
      throw new AuthError('invalid_session', 'Your session has expired or could not be verified. Sign in again.', 401);
    }
    throw new AuthError('auth_unavailable', 'Sign-in verification is temporarily unavailable. Please try again.', 503);
  }
}
