import { runDigest } from './digest.js';
import { runHunter } from './hunter.js';
import { esc, sendTelegramHtml, TelegramNotifier } from './notifier.js';

const GET_UPDATES_TIMEOUT = 50;

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

function parseCommand(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t.startsWith('/')) return null;
  const first = t.split(/\s+/)[0] ?? '';
  return first.split('@')[0]!.toLowerCase();
}

async function deleteWebhookQuiet(token: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  } catch {
    /* ignore */
  }
}

async function getUpdates(
  token: string,
  offset: number,
  timeout: number,
): Promise<TelegramUpdate[]> {
  const u = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('timeout', String(timeout));
  u.searchParams.set('limit', '50');
  const res = await fetch(u);
  if (!res.ok) {
    throw new Error(`getUpdates ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
  return Array.isArray(body.result) ? body.result : [];
}

/** Consume pending updates so a fresh /digest does not replay old commands. */
async function drainBacklog(token: string): Promise<number> {
  let next = 0;
  for (;;) {
    const batch = await getUpdates(token, next, 0);
    if (batch.length === 0) return next;
    for (const u of batch) next = u.update_id + 1;
  }
}

function formatManualStatus(title: string, phase: string, detail?: string): string {
  const lines = [`🧪 <b>${esc(title)}</b>`, `<b>${esc(phase)}</b>`];
  if (detail) lines.push(esc(detail));
  return lines.join('\n');
}

const HELP_HTML =
  '🧪 <b>Pepper Bot — komendy</b>\n' +
  '/digest — uruchom digest z komunikatami statusu\n' +
  '/hunter — uruchom hunter z komunikatami statusu\n' +
  '/help — ta pomoc\n\n' +
  '<i>Działa tylko z czatu skonfigurowanego jako TELEGRAM_CHAT_ID.</i>';

export async function runTelegramListener(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const allowedChat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !allowedChat) {
    throw new Error('TELEGRAM_BOT_TOKEN i TELEGRAM_CHAT_ID są wymagane dla trybu telegram');
  }

  await deleteWebhookQuiet(token);
  let offset = await drainBacklog(token);
  console.log(`[telegram] long poll started (offset=${offset}). Send /help from your chat.`);

  let busy = false;

  for (;;) {
    const updates = await getUpdates(token, offset, GET_UPDATES_TIMEOUT);
    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg?.text) continue;

      const chatIdStr = String(msg.chat.id);
      if (chatIdStr !== allowedChat) {
        console.warn(`[telegram] ignored message from chat ${chatIdStr}`);
        continue;
      }

      const cmd = parseCommand(msg.text);
      if (!cmd) continue;

      if (cmd === '/start' || cmd === '/help') {
        await sendTelegramHtml(token, allowedChat, HELP_HTML);
        continue;
      }

      if (cmd !== '/digest' && cmd !== '/hunter') {
        await sendTelegramHtml(
          token,
          allowedChat,
          `Nieznana komenda ${esc(cmd)}. Wyślij /help.`,
        );
        continue;
      }

      if (busy) {
        await sendTelegramHtml(token, allowedChat, '⏳ Już coś uruchomiłem — poczekaj na koniec.');
        continue;
      }

      busy = true;
      const title = cmd === '/digest' ? 'Digest (ręczny)' : 'Hunter (ręczny)';
      const report = (phase: string, detail?: string) =>
        sendTelegramHtml(token, allowedChat, formatManualStatus(title, phase, detail));

      try {
        if (cmd === '/digest') {
          await runDigest({
            notifier: new TelegramNotifier(token, allowedChat),
            onProgress: report,
          });
        } else {
          await runHunter({
            notifier: new TelegramNotifier(token, allowedChat),
            onProgress: report,
          });
        }
      } catch (e: unknown) {
        console.error('[telegram] command failed:', e);
      } finally {
        busy = false;
      }
    }
  }
}
