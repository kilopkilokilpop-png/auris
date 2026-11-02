import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Recognition, Track } from '@auris/shared';
import { formatDuration, TELEGRAM_GETFILE_MAX_BYTES } from '@auris/shared';
import { ApiCallError, type AurisApi } from './api-client.js';

export interface BotConfig {
  token: string;
  miniAppUrl: string;
  /** Override for tests (skips getMe). */
  botInfo?: ConstructorParameters<typeof Bot>[1] extends infer O ? (O extends { botInfo?: infer B } ? B : never) : never;
}

export const COMMANDS = [
  { command: 'start', description: 'Открыть AURIS' },
  { command: 'wave', description: 'Резонанс — бесконечная волна' },
  { command: 'search', description: 'Поиск: /search название' },
  { command: 'liked', description: 'Избранное' },
  { command: 'settings', description: 'Настройки и удаление данных' },
];

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function appUrl(base: string, params: Record<string, string> = {}): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Telegram allows web_app buttons only for HTTPS URLs. */
const canWebApp = (url: string) => url.startsWith('https://');

function availability(t: Track): string {
  if (t.playback.kind === 'preview') return `превью ${Math.round(t.playback.playableSec)} с`;
  if (t.playback.kind === 'none') return 'нельзя послушать';
  return formatDuration(t.durationSec);
}

export function trackLine(t: Track, i: number): string {
  return `${i + 1}. <b>${esc(t.title)}</b> — ${esc(t.artist.name)} · <i>${availability(t)}</i>`;
}

export function trackKeyboard(tracks: Track[], miniAppUrl: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  tracks.forEach((t, i) => {
    const label = `${i + 1}. ${t.title}`.slice(0, 40);
    if (canWebApp(miniAppUrl)) kb.webApp(`▶ ${label}`, appUrl(miniAppUrl, { track: t.id }));
    else kb.text(`▶ ${label}`, `noop`);
    kb.text('♥', `like:${t.id}`);
    // Download button only when the provider + licence allow it; otherwise a short explanation.
    kb.text(t.downloadable ? '⬇' : '🚫', t.downloadable ? `dl:${t.id}` : `nodl:${t.id}`);
    kb.row();
  });
  return kb;
}

/** Telegram rejects non-HTTPS (e.g. localhost) button URLs, so without HTTPS we show an explanation instead. */
function openKeyboard(miniAppUrl: string, text: string, params: Record<string, string> = {}) {
  return canWebApp(miniAppUrl) ? new InlineKeyboard().webApp(text, appUrl(miniAppUrl, params)) : new InlineKeyboard().text(text, 'noapp');
}

export function recognitionMessage(r: Recognition, miniAppUrl: string): { text: string; keyboard: InlineKeyboard } {
  const lines = [`🎧 <b>${esc(r.title)}</b>`, esc(r.artist)];
  if (r.album) lines.push(`<i>${esc(r.album)}</i>`);
  if (r.unavailableReason) lines.push('', esc(r.unavailableReason));
  const kb = new InlineKeyboard();
  if (r.track && r.track.playback.kind !== 'none') {
    if (canWebApp(miniAppUrl)) kb.webApp('▶ Слушать в AURIS', appUrl(miniAppUrl, { track: r.track.id }));
    kb.text('♥ В избранное', `like:${r.track.id}`).row();
    if (r.track.downloadable) kb.text('⬇ Скачать в Telegram', `dl:${r.track.id}`);
    else kb.text('Скачивание недоступно', `nodl:${r.track.id}`);
  }
  return { text: lines.join('\n'), keyboard: kb };
}

export function createBot(api: AurisApi, cfg: BotConfig): Bot {
  const bot = new Bot(cfg.token, cfg.botInfo ? { botInfo: cfg.botInfo } : undefined);
  const touch = (ctx: Context, started = true) =>
    ctx.from ? api.touchUser({ id: ctx.from.id, first_name: ctx.from.first_name, last_name: ctx.from.last_name, username: ctx.from.username }, started).catch(() => {}) : Promise.resolve();

  // Everything here is for private chats only.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    await next();
  });

  bot.command('start', async (ctx) => {
    await touch(ctx, true);
    const payload = ctx.match?.trim();
    const text =
      payload === 'download'
        ? 'Готово — теперь я могу присылать вам файлы. Вернитесь в AURIS и нажмите «Скачать в Telegram» ещё раз.'
        : '<b>AURIS</b> — слышать каждую ноту.\n\nСлушайте музыку, включайте бесконечный «Резонанс» и узнавайте песни вокруг — прямо в Telegram.\n\nПришлите голосовое или аудиофайл — я распознаю трек.';
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: openKeyboard(cfg.miniAppUrl, 'Открыть AURIS') });
  });

  bot.command('wave', async (ctx) => {
    await touch(ctx);
    await ctx.reply('Резонанс подберёт музыку под ваш вкус. Чем больше слушаете — тем точнее.', {
      reply_markup: openKeyboard(cfg.miniAppUrl, '〰 Включить Резонанс', { screen: 'wave' }),
    });
  });

  bot.command('search', async (ctx) => {
    await touch(ctx);
    const q = ctx.match?.trim();
    if (!q) return ctx.reply('Напишите, что найти: <code>/search название или артист</code>', { parse_mode: 'HTML' });
    if (q.length > 120) return ctx.reply('Слишком длинный запрос.');
    try {
      const tracks = await api.search(ctx.from!.id, q);
      if (!tracks.length) return ctx.reply(`Ничего не нашлось по запросу «${esc(q)}». Попробуйте иначе.`, { parse_mode: 'HTML' });
      await ctx.reply(tracks.map(trackLine).join('\n'), { parse_mode: 'HTML', reply_markup: trackKeyboard(tracks, cfg.miniAppUrl) });
    } catch {
      await ctx.reply('Поиск сейчас недоступен. Попробуйте позже.');
    }
  });

  bot.command('liked', async (ctx) => {
    await touch(ctx);
    try {
      const tracks = await api.liked(ctx.from!.id);
      if (!tracks.length) return ctx.reply('В избранном пока пусто. Нажимайте ♥ в плеере или в поиске.', { reply_markup: openKeyboard(cfg.miniAppUrl, 'Открыть AURIS') });
      await ctx.reply(`<b>Избранное</b>\n${tracks.map(trackLine).join('\n')}`, { parse_mode: 'HTML', reply_markup: trackKeyboard(tracks, cfg.miniAppUrl) });
    } catch {
      await ctx.reply('Избранное сейчас недоступно. Попробуйте позже.');
    }
  });

  bot.command('settings', async (ctx) => {
    await touch(ctx);
    const kb = openKeyboard(cfg.miniAppUrl, '⚙ Открыть настройки', { screen: 'settings' }).row().text('Сбросить рекомендации', 'reset').row().text('Удалить все мои данные', 'del');
    await ctx.reply('<b>Настройки</b>\nСброс рекомендаций удаляет историю прослушиваний и лайки-сигналы для «Резонанса». Удаление данных стирает всё, что AURIS о вас хранит.', { parse_mode: 'HTML', reply_markup: kb });
  });

  // ---------- callbacks ----------
  bot.callbackQuery(/^like:(.+)$/, async (ctx) => {
    try {
      await api.like(ctx.from.id, ctx.match[1]!);
      await ctx.answerCallbackQuery({ text: 'Добавлено в избранное ♥' });
    } catch {
      await ctx.answerCallbackQuery({ text: 'Не удалось добавить', show_alert: true });
    }
  });
  bot.callbackQuery(/^dl:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Отправляю файл…' });
    try {
      await api.download(ctx.from.id, ctx.match[1]!);
    } catch (e) {
      const msg = e instanceof ApiCallError ? e.message : 'Не удалось отправить файл';
      await ctx.reply(`⚠ ${msg}`);
    }
  });
  bot.callbackQuery(/^nodl:/, (ctx) =>
    ctx.answerCallbackQuery({ text: 'Скачивание этого трека не разрешено источником или лицензией. Его можно только слушать.', show_alert: true }),
  );
  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery({ text: 'Откройте AURIS через кнопку меню' }));
  bot.callbackQuery('noapp', (ctx) =>
    ctx.answerCallbackQuery({ text: 'Mini App ещё не опубликован по HTTPS. Пока работают команды бота: /search, /liked, /settings и распознавание голосовых.', show_alert: true }),
  );
  bot.callbackQuery('reset', (ctx) =>
    ctx.editMessageText('Сбросить рекомендации? История прослушиваний будет удалена, избранное останется.', {
      reply_markup: new InlineKeyboard().text('Да, сбросить', 'reset!').text('Отмена', 'cancel'),
    }),
  );
  bot.callbackQuery('reset!', async (ctx) => {
    await api.resetRecommendations(ctx.from.id);
    await ctx.editMessageText('Рекомендации сброшены. «Резонанс» начнёт с чистого листа.');
  });
  bot.callbackQuery('del', (ctx) =>
    ctx.editMessageText('Удалить все ваши данные из AURIS? Избранное, плейлисты, история и найденные треки будут стёрты без возможности восстановления.', {
      reply_markup: new InlineKeyboard().text('Удалить навсегда', 'del!').text('Отмена', 'cancel'),
    }),
  );
  bot.callbackQuery('del!', async (ctx) => {
    await api.deleteUser(ctx.from.id);
    await ctx.editMessageText('Готово. Все ваши данные удалены.');
  });
  bot.callbackQuery('cancel', (ctx) => ctx.editMessageText('Отменено.'));

  // ---------- Слух: voice / audio / video note / audio document ----------
  bot.on(['message:voice', 'message:audio', 'message:video_note', 'message:document'], async (ctx) => {
    const m = ctx.message;
    const media = m.voice ?? m.audio ?? m.video_note ?? m.document;
    if (!media) return;
    const mime = ('mime_type' in media && media.mime_type) || (m.voice ? 'audio/ogg' : m.video_note ? 'video/mp4' : 'application/octet-stream');
    if (m.document && !/^(audio|video)\//.test(mime)) return ctx.reply('Пришлите голосовое сообщение или аудиофайл — я распознаю песню.');
    if ((media.file_size ?? 0) > TELEGRAM_GETFILE_MAX_BYTES) {
      return ctx.reply('Файл больше 20 МБ — Telegram не даёт ботам скачивать такие. Пришлите фрагмент покороче (10–15 секунд достаточно).');
    }
    await touch(ctx);
    await ctx.replyWithChatAction('typing');
    const status = await ctx.reply('Слушаю…');
    try {
      const file = await ctx.getFile();
      const res = await fetch(`https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new ApiCallError('AUDIO_INVALID', 'Не удалось получить файл от Telegram');
      // The voice file is held in memory only for this call and never stored.
      const r = await api.recognize(ctx.from.id, Buffer.from(await res.arrayBuffer()), mime, file.file_path?.split('/').pop() ?? 'audio');
      const msg = recognitionMessage(r, cfg.miniAppUrl);
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, msg.text, { parse_mode: 'HTML', reply_markup: msg.keyboard });
    } catch (e) {
      const text =
        e instanceof ApiCallError
          ? e.code === 'RECOGNITION_NOT_FOUND'
            ? 'Не удалось распознать. Запишите 10–15 секунд поближе к источнику звука.'
            : e.code === 'RECOGNITION_UNAVAILABLE'
              ? 'Сервис распознавания сейчас недоступен. Попробуйте позже.'
              : e.message
          : 'Что-то пошло не так. Попробуйте ещё раз.';
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, text);
    }
  });

  bot.on('message:text', (ctx) =>
    ctx.reply('Чтобы найти трек, напишите <code>/search название</code>. Чтобы распознать песню — пришлите голосовое.', { parse_mode: 'HTML', reply_markup: openKeyboard(cfg.miniAppUrl, 'Открыть AURIS') }),
  );

  bot.catch((err) => {
    console.error('bot error', err.error instanceof Error ? err.error.message : err.error);
  });
  return bot;
}

/** Menu button + commands. Menu button requires an HTTPS Mini App URL. */
export async function configureBot(bot: Bot, miniAppUrl: string) {
  await bot.api.setMyCommands(COMMANDS);
  if (canWebApp(miniAppUrl)) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'AURIS', web_app: { url: miniAppUrl } } });
  } else {
    console.warn('MINI_APP_URL is not HTTPS — skipping Menu Button (Telegram requires HTTPS).');
  }
}
