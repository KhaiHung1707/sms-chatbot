import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

/**
 * Minimal username+password auth for the /admin page (1–2 users, low frequency).
 * No user table, no session store: a successful login sets an HttpOnly cookie
 * whose value is an HMAC over the username, keyed by the password. Each request
 * re-derives and constant-time-compares. Changing either the username or password
 * invalidates all cookies automatically.
 */

const COOKIE_NAME = 'obp_admin';

/** Admin credentials, from config. */
export interface AdminCreds {
  username: string;
  password: string;
}

/** The cookie value for a given credential pair. */
export function issueToken(creds: AdminCreds): string {
  return createHmac('sha256', creds.password)
    .update(`obp-admin-v1:${creds.username}`)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verify a submitted username + password (constant-time on both). */
export function checkCredentials(
  inputUser: string,
  inputPass: string,
  creds: AdminCreds,
): boolean {
  // Compare both independently, constant-time; require both to match.
  const userOk = safeEqual(inputUser, creds.username);
  const passOk = safeEqual(inputPass, creds.password);
  return userOk && passOk;
}

/** Read the auth cookie from a request. */
function readCookie(c: Context): string | null {
  const header = c.req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=');
  }
  return null;
}

/** Set the auth cookie (HttpOnly, Secure, SameSite=Strict). */
export function setAuthCookie(c: Context, creds: AdminCreds): void {
  const token = issueToken(creds);
  // 7-day session; Secure so it only rides HTTPS (Caddy terminates TLS in prod).
  c.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
  );
}

export function clearAuthCookie(c: Context): void {
  c.header('Set-Cookie', `${COOKIE_NAME}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

/** True if the request carries a valid auth cookie for these credentials. */
export function isAuthed(c: Context, creds: AdminCreds | undefined): boolean {
  if (!creds) return false;
  const cookie = readCookie(c);
  if (!cookie) return false;
  return safeEqual(cookie, issueToken(creds));
}

/**
 * Hono middleware guarding admin routes. Redirects unauthenticated browser
 * requests to the login page; returns 401 JSON for API (POST) requests.
 */
export function requireAuth(creds: AdminCreds | undefined) {
  return async (c: Context, next: Next) => {
    if (isAuthed(c, creds)) return next();
    // API calls (fetch) get JSON; page loads get a redirect to login.
    const accept = c.req.header('accept') ?? '';
    if (c.req.method !== 'GET' || accept.includes('application/json')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return c.redirect('/admin/login');
  };
}

export { COOKIE_NAME };
