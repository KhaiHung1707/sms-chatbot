import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny zero-dependency loader for an optional .env.local file at the repo root.
 * Only sets keys that aren't already in process.env, so real env vars win.
 * Lines are `KEY=value`; blank lines and `#` comments are ignored. Values may be
 * quoted. Missing file is fine — dev harness runs at Level 1 without it.
 */
export function loadEnvLocal(): void {
  const path = join(process.cwd(), '.env.local');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // no .env.local — that's Level 1 (all fakes)
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
