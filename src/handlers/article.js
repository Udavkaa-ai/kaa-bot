const claude = require('../providers/claude');
const messagesRepo = require('../db/repo/messages');
const { withTyping } = require('../utils/typing');
const { humorReply } = require('../ai/errorHumor');

// Стиль опционально: "/article <тема> в стиле:научпоп"
const STYLE_RE = /\bв\s+стиле:?\s*([^\n]+)$/i;

async function handleArticleCommand(bot, msg, rawArgs) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const userName = msg.from?.username ? '@' + msg.from.username : (msg.from?.first_name || 'кто-то');

  const trimmed = (rawArgs || '').trim();
  if (!trimmed || trimmed.length < 3) {
    await bot.sendMessage(chatId,
      'Про что писать? Пример:\n<code>/article зачем нужны нейронки</code>\n<code>/article метаморфозы Кафки в стиле:лонгрид</code>',
      { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
    return;
  }

  let topic = trimmed;
  let style = null;
  const styleMatch = trimmed.match(STYLE_RE);
  if (styleMatch) {
    style = styleMatch[1].trim();
    topic = trimmed.replace(STYLE_RE, '').trim();
  }

  try {
    const article = await withTyping(bot, chatId, () =>
      claude.callWithFallback([
        { role: 'system', content: buildSystemPrompt(style) },
        { role: 'user', content: `Тема: ${topic}` },
      ], { temperature: 0.85, maxTokens: 2400 })
    );

    if (!article?.text) {
      await bot.sendMessage(chatId, 'Не получилось написать. Попробуй перефразировать тему.',
        { reply_to_message_id: msg.message_id });
      return;
    }

    const html = sanitizeTelegramHtml(article.text);
    await sendArticle(bot, chatId, html, msg.message_id);

    // Сохраняем в историю чата
    const plain = htmlToPlain(html).slice(0, 3000);
    await messagesRepo.addMessage(chatId, 'user',
      `(попросил статью) ${topic}${style ? ' в стиле ' + style : ''}`,
      { userId, username: userName, messageId: msg.message_id }).catch(() => {});
    await messagesRepo.addMessage(chatId, 'assistant', plain, {}).catch(() => {});

    console.log(`[ARTICLE] chat=${chatId} "${topic.slice(0, 60)}" ${article.model} → ${html.length}c`);
  } catch (err) {
    console.error('[ARTICLE]', err.message);
    await bot.sendMessage(chatId, humorReply(err), { reply_to_message_id: msg.message_id });
  }
}

function buildSystemPrompt(style) {
  return `Ты — редактор авторского Telegram-канала. Напиши статью в формате Telegram HTML.

СТРУКТУРА:
1. Заголовок жирным с 1-2 подходящими emoji: <b>🎯 ЗАГОЛОВОК</b>
2. Лид одной-двумя фразами курсивом — крючок, интрига: <i>...</i>
3. Разделитель: ━━━━━━━━━━━━━━━━
4. 3-5 разделов. Каждый начинается с <b>▸ Название раздела</b> (или другой значок из ▸ ◆ ● ⬡ ◇)
5. В теле разделов используй:
   • <b>жирный</b> для ключевых терминов (без фанатизма — не более 2-3 раз на раздел)
   • <i>курсив</i> для акцентов и определений
   • <code>инлайн</code> для терминов или названий
   • <blockquote>цитата или инсайт</blockquote> — 1-2 pull-цитаты во всей статье
6. Финальный разделитель ━━━━━━━━━━━━━━━━
7. <blockquote expandable>💡 <b>Коротко</b>

TL;DR в 2-3 предложениях</blockquote>

TELEGRAM HTML (это не Markdown!):
- Разрешено: <b>, <i>, <u>, <s>, <span class="tg-spoiler">, <blockquote>, <blockquote expandable>, <code>, <pre>, <a href="url">
- Запрещено: # * ** _ ~ или любая другая Markdown-разметка
- Все < > & внутри текста экранируй как &lt; &gt; &amp;
- Не оборачивай ответ в \`\`\`html\`\`\` или другие обёртки

ТОН:
- Свежий, с личным взглядом, ясный и не выспренный
- Разделы дают РАЗНЫЕ углы, а не пересказ друг друга
- Живые примеры и метафоры лучше сухих определений
- Без клише «в современном мире», «неудивительно, что» и подобных
${style ? `- Стиль: ${style}` : ''}

ДЛИНА: 500-800 слов на всю статью.

Верни ТОЛЬКО HTML статьи. Без пояснений, без \`\`\`, без комментариев в конце.`;
}

function sanitizeTelegramHtml(text) {
  let out = text.trim();
  // Убираем возможные обёртки ```html … ```
  out = out.replace(/^```(?:html|xml)?\s*\n?/i, '');
  out = out.replace(/\n?```\s*$/, '');
  // Если Claude случайно оставил Markdown — конвертим самое популярное
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/(?<!\w)__(.+?)__(?!\w)/g, '<b>$1</b>');
  return out.trim();
}

// Умное разбиение HTML на части ≤ maxLen без разрыва тегов.
// Режем по границам блочных элементов и \n\n.
function splitHtmlSmart(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Ищем удачную точку разреза, где мы точно вне тега.
    // Приоритеты: </blockquote>\n, \n\n, \n
    let cut = -1;
    const candidates = [
      remaining.lastIndexOf('</blockquote>\n', maxLen),
      remaining.lastIndexOf('\n\n', maxLen),
      remaining.lastIndexOf('\n', maxLen),
    ];
    for (const c of candidates) {
      if (c > maxLen / 2) { cut = c; break; }
    }
    if (cut < 0) cut = maxLen;

    // Убеждаемся что не в середине тега
    const chunk = remaining.slice(0, cut);
    if (hasOpenTag(chunk)) {
      // откат до предыдущего \n
      const back = chunk.lastIndexOf('\n');
      if (back > 0) cut = back;
    }
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function hasOpenTag(s) {
  const lastLt = s.lastIndexOf('<');
  const lastGt = s.lastIndexOf('>');
  return lastLt > lastGt;
}

async function sendArticle(bot, chatId, html, replyTo) {
  const parts = splitHtmlSmart(html);
  for (let i = 0; i < parts.length; i++) {
    const opts = { parse_mode: 'HTML', disable_web_page_preview: true };
    if (i === 0 && replyTo) opts.reply_to_message_id = replyTo;
    try {
      await bot.sendMessage(chatId, parts[i], opts);
    } catch (err) {
      console.warn(`[ARTICLE] HTML send failed: ${err.message}, fallback to plain`);
      const plain = htmlToPlain(parts[i]);
      const fallbackOpts = i === 0 && replyTo ? { reply_to_message_id: replyTo } : {};
      await bot.sendMessage(chatId, plain, fallbackOpts).catch(err2 =>
        console.error('[ARTICLE] plain send also failed:', err2.message));
    }
  }
}

function htmlToPlain(html) {
  return html
    .replace(/<blockquote(?:\s+expandable)?>/g, '「 ')
    .replace(/<\/blockquote>/g, ' 」')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

module.exports = { handleArticleCommand };
