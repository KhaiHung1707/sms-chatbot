import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

/**
 * Minimal shared-password auth for the /admin page (1–2 users, low frequency).
 * No user table, no session store: a successful login sets an HttpOnly cookie
 * whose value is an HMAC of a constant, keyed by the admin password. Each request
 * re-derives and constant-time-compares. Changing the password invalidates all
 * cookies automatically.
 */

const COOKIE_NAME = 'obp_admin';
// Signed payload is a fixed marker — we only need "did they know the password",
// not a per-session identity.
const MARKER = 'obp-admin-v1';

/** The cookie value for a given admin password. */
export function issueToken(password: string): string {
  return createHmac('sha256', password).update(MARKER).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verify the admin password (constant-time). */
export function checkPassword(input: string, password: string): boolean {
  return safeEqual(input, password);
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
export function setAuthCookie(c: Context, password: string): void {
  const token = issueToken(password);
  // 7-day session; Secure so it only rides HTTPS (Caddy terminates TLS in prod).
  c.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
  );
}

export function clearAuthCookie(c: Context): void {
  c.header('Set-Cookie', `${COOKIE_NAME}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

/** True if the request carries a valid auth cookie for this password. */
export function isAuthed(c: Context, password: string | undefined): boolean {
  if (!password) return false;
  const cookie = readCookie(c);
  if (!cookie) return false;
  return safeEqual(cookie, issueToken(password));
}

/**
 * Hono middleware guarding admin routes. Redirects unauthenticated browser
 * requests to the login page; returns 401 JSON for API (POST) requests.
 */
export function requireAuth(password: string | undefined) {
  return async (c: Context, next: Next) => {
    if (isAuthed(c, password)) return next();
    // API calls (fetch) get JSON; page loads get a redirect to login.
    const accept = c.req.header('accept') ?? '';
    if (c.req.method !== 'GET' || accept.includes('application/json')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return c.redirect('/admin/login');
  };
}

export { COOKIE_NAME };
