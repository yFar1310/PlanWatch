import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { SessionInfo } from '../shared/session';

export interface AuthBindings {
  LOCAL_DEV?: string;
  CLERK_ISSUER_URL?: string;
  CLERK_OWNER_USER_ID?: string;
  APP_ORIGIN?: string;
  API_ORIGIN?: string;
}
export interface Identity {
  mode: SessionInfo['mode']; email: string | null; expiresAt: number | null;
  userId: string | null; sessionId: string | null;
}
export interface Session extends SessionInfo { ownerId: string; userId: string | null; sessionId: string | null }
export class AuthError extends Error {
  constructor(public code: string, message: string, public status: 401 | 403 | 503) { super(message); }
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function configuration(env: AuthBindings) {
  try {
    const issuer = new URL(env.CLERK_ISSUER_URL ?? '');
    const origin = new URL(env.APP_ORIGIN ?? '');
    const apiOrigin = new URL(env.API_ORIGIN ?? env.APP_ORIGIN ?? '');
    const owner = env.CLERK_OWNER_USER_ID?.trim();
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (issuer.protocol !== 'https:' || issuer.port || issuer.username || issuer.password || issuer.href !== `${issuer.origin}/`
      || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(issuer.hostname)
      || origin.username || origin.password || origin.href !== `${origin.origin}/`
      || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))
      || apiOrigin.username || apiOrigin.password || apiOrigin.href !== `${apiOrigin.origin}/`
      || (apiOrigin.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]'].includes(apiOrigin.hostname) && apiOrigin.protocol === 'http:'))
      || !owner || !/^user_[a-zA-Z0-9]+$/.test(owner)) throw new Error('Invalid configuration');
    return { issuer: issuer.origin, origin: origin.origin, apiOrigin: apiOrigin.origin, owner };
  } catch {
    throw new AuthError('setup_required', 'Private sign-in is being configured. Your saved tasks remain protected.', 503);
  }
}

export async function authenticate(request: Request, env: AuthBindings): Promise<Identity> {
  const hostname = new URL(request.url).hostname;
  if (env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return { userId: null, sessionId: null, mode: 'local', email: null, expiresAt: null };
  }
  const config = configuration(env);
  if (new URL(request.url).origin !== config.apiOrigin) throw new AuthError('invalid_origin', 'Open your private PlanWatch address to continue.', 403);
  // Accept only an explicit session bearer, never an identity header or ambient cookie.
  const authorization = request.headers.get('Authorization');
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i)?.[1];
  if (!token || token.length > 16_384) throw new AuthError('sign_in_required', 'Sign in to load and save your tasks. Your drafts are kept on this device.', 401);
  let keySet = keySets.get(config.issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`), { timeoutDuration: 5_000 });
    keySets.set(config.issuer, keySet);
  }
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: config.issuer, algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'nbf', 'sub', 'sid', 'azp', 'v'], clockTolerance: 5,
    });
    if (payload.v !== 2 || typeof payload.sub !== 'string' || !/^user_[a-zA-Z0-9]+$/.test(payload.sub)
      || typeof payload.sid !== 'string' || !/^sess_[a-zA-Z0-9]+$/.test(payload.sid)
      || payload.azp !== config.origin || payload.iat! > Date.now() / 1000 + 5
      || payload.act !== undefined || (payload.sts !== undefined && payload.sts !== 'active')) {
      throw new AuthError('invalid_session', 'This session could not be verified. Sign in again.', 401);
    }
    return { userId: payload.sub, sessionId: payload.sid, mode: 'clerk', email: null, expiresAt: payload.exp! * 1000 };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof errors.JOSEError && !['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC'].includes(error.code)) {
      throw new AuthError('invalid_session', 'Your session has expired or could not be verified. Sign in again.', 401);
    }
    throw new AuthError('auth_unavailable', 'Sign-in verification is temporarily unavailable. Please try again.', 503);
  }
}
