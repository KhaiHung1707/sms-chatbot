import { Hono } from 'hono';
import type { Config } from '../config.js';
import type { Store } from '../db/store.js';
import type { LlmClient } from '../llm/claude.js';
import type { InventoryClient } from '../providers/inventory.js';
import type { Pipeline } from '../core/pipeline.js';
import { logger } from '../logger.js';
import {
  requireAuth,
  checkCredentials,
  setAuthCookie,
  clearAuthCookie,
  type AdminCreds,
} from '../admin/auth.js';
import { validateSteps } from '../admin/steps.js';
import { lintSteps } from '../llm/promptLint.js';
import { runPreview } from '../admin/preview.js';
import { loginPage, editorPage } from './adminHtml.js';
import { DEFAULT_INSTRUCTION_STEPS } from '../llm/systemPrompt.js';

/**
 * /admin — the shop owner's page to edit the bot's conversation-flow steps.
 * Server-rendered, password-protected. Mounted on the same app as the webhook.
 * If ADMIN_PASSWORD is unset (dev/tests), the whole page is disabled (404).
 */
export function createAdminRoute(
  config: Config,
  deps: { store: Store; llm: LlmClient; inventory: InventoryClient; pipeline: Pipeline },
): Hono {
  const app = new Hono();
  // Admin disabled without a password (dev/tests) — every route 404s.
  if (!config.ADMIN_PASSWORD) {
    app.all('/admin/*', (c) => c.notFound());
    app.all('/admin', (c) => c.notFound());
    return app;
  }
  const creds: AdminCreds = {
    username: config.ADMIN_USERNAME,
    password: config.ADMIN_PASSWORD,
  };

  // ── Login (unguarded) ──────────────────────────────────────────────────────
  app.get('/admin/login', (c) => c.html(loginPage()));

  app.post('/admin/login', async (c) => {
    const body = await c.req.parseBody();
    const user = typeof body.username === 'string' ? body.username : '';
    const pass = typeof body.password === 'string' ? body.password : '';
    if (checkCredentials(user, pass, creds)) {
      setAuthCookie(c, creds);
      return c.redirect('/admin');
    }
    return c.html(loginPage('Wrong username or password, try again.'));
  });

  app.post('/admin/logout', (c) => {
    clearAuthCookie(c);
    return c.redirect('/admin/login');
  });

  // ── Everything below requires auth ─────────────────────────────────────────
  app.use('/admin', requireAuth(creds));
  app.use('/admin/steps', requireAuth(creds));
  app.use('/admin/preview', requireAuth(creds));
  app.use('/admin/lint', requireAuth(creds));
  app.use('/admin/publish', requireAuth(creds));
  app.use('/admin/rollback', requireAuth(creds));

  app.get('/admin', async (c) => {
    const [liveRaw, draft, history, stats] = await Promise.all([
      deps.store.getLiveInstructions(),
      deps.store.getDraftInstructions(),
      deps.store.listInstructionVersions(),
      deps.store.getBotStats(new Date()),
    ]);
    // If nothing is seeded yet (e.g. dev MemoryStore), show the code defaults so
    // the editor is never blank — this matches what the bot actually uses.
    const live =
      liveRaw ??
      ({
        id: 'default', version: 0, steps: [...DEFAULT_INSTRUCTION_STEPS],
        status: 'live' as const, note: 'Default (not yet saved)', author: 'system',
        createdAt: new Date().toISOString(), publishedAt: null,
      });
    return c.html(editorPage({ live, draft, history, stats }));
  });

  app.post('/admin/steps', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const v = validateSteps((body as { steps?: unknown }).steps);
    if (!v.ok) return c.json({ ok: false, errors: v.errors });
    await deps.store.saveDraftInstructions(v.steps, 'admin');
    return c.json({ ok: true });
  });

  app.post('/admin/lint', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const v = validateSteps((body as { steps?: unknown }).steps);
    return c.json({ ok: v.ok, errors: v.errors, warnings: lintSteps(v.steps) });
  });

  app.post('/admin/preview', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      steps?: unknown;
      message?: unknown;
      history?: unknown;
    };
    const v = validateSteps(body.steps);
    const message = typeof body.message === 'string' ? body.message.slice(0, 500) : '';
    if (!message.trim()) return c.json({ reply: '', silent: true });
    // Sanitize the conversation history (cap length so a huge payload can't abuse
    // the LLM call). Each turn is {who: customer|bot, text}.
    const history = Array.isArray(body.history)
      ? body.history
          .slice(-20)
          .filter(
            (t): t is { who: 'customer' | 'bot'; text: string } =>
              !!t &&
              typeof (t as { text?: unknown }).text === 'string' &&
              ((t as { who?: unknown }).who === 'customer' ||
                (t as { who?: unknown }).who === 'bot'),
          )
          .map((t) => ({ who: t.who, text: t.text.slice(0, 500) }))
      : [];
    try {
      const result = await runPreview({
        llm: deps.llm,
        inventory: deps.inventory,
        config,
        steps: v.steps,
        message,
        history,
      });
      return c.json(result);
    } catch (err) {
      logger.error({ err }, 'admin preview failed');
      return c.json({ reply: '', silent: true });
    }
  });

  app.post('/admin/publish', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { note?: unknown };
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
    const live = await deps.store.publishDraftInstructions(note);
    if (!live) return c.json({ ok: false, error: 'no draft to publish' });
    deps.pipeline.refreshInstructions(); // take effect without a restart
    logger.info({ version: live.version }, 'admin published new instructions');
    return c.json({ ok: true, version: live.version });
  });

  app.post('/admin/rollback', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { versionId?: unknown };
    const id = typeof body.versionId === 'string' ? body.versionId : '';
    const draft = await deps.store.restoreInstructionVersion(id, 'admin');
    if (!draft) return c.json({ ok: false, error: 'unknown version' });
    return c.json({ ok: true });
  });

  return app;
}
