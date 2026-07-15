import { randomUUID } from 'node:crypto';

/**
 * A fake Quo client for local dev: instead of sending a real SMS, it prints the
 * outbound reply to the terminal. Returns a UNIQUE id per send so auto-handoff
 * correlation works and so ids don't collide with rows left in a real Postgres
 * from a previous run (a plain counter would reset on restart and clash with
 * the unique provider_message_id index).
 */
export class ConsoleQuo {
  async sendMessage(to: string, content: string): Promise<{ id: string }> {
    // eslint-disable-next-line no-console
    console.log(`\n  📤 BOT → ${to}\n     "${content}"\n`);
    return { id: `dev-out-${randomUUID()}` };
  }
}
