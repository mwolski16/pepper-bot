import type { Notifier } from './types.js';

/** Low-level send (HTML). Shared by the notifier and the Telegram control loop. */
export async function sendTelegramHtml(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
}

export class TelegramNotifier implements Notifier {
  name = 'telegram';
  constructor(
    private token: string,
    private chatId: string,
  ) {}

  async send(text: string): Promise<void> {
    await sendTelegramHtml(this.token, this.chatId, text);
  }
}

class ConsoleNotifier implements Notifier {
  name = 'console';
  async send(text: string): Promise<void> {
    console.log('--- NOTIFICATION ---\n' + text + '\n--- END ---');
  }
}

export function makeNotifier(): Notifier {
  if (process.env.DRY_RUN === '1') return new ConsoleNotifier();
  const kind = process.env.NOTIFIER ?? 'telegram';
  switch (kind) {
    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) throw new Error('Telegram env vars missing');
      return new TelegramNotifier(token, chatId);
    }
    case 'console':
      return new ConsoleNotifier();
    default:
      throw new Error(`Unknown notifier: ${kind}`);
  }
}

/** HTML-escape for Telegram. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
