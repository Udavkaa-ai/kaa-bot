const crypto = require('crypto');
const giveawaysRepo = require('../db/repo/giveaways');
const { sendSafe } = require('../utils/telegram');

const DEFAULT_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TARGET = 10000;
const MAX_WINNERS = 50;

// Дебаунс обновлений счётчика на кнопке (Telegram лимит на edit)
const editTimers = new Map();
const EDIT_DEBOUNCE_MS = 1500;

function parseDuration(text) {
  const m = text.match(/(\d+)\s*([smhdсмчд])(?![а-яёa-z])/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  let ms;
  if (u === 's' || u === 'с') ms = n * 1000;
  else if (u === 'm' || u === 'м') ms = n * 60 * 1000;
  else if (u === 'h' || u === 'ч') ms = n * 60 * 60 * 1000;
  else ms = n * 24 * 60 * 60 * 1000;
  return { ms: Math.min(ms, MAX_DURATION_MS), match: m[0] };
}

function parseArgs(text) {
  let prize = text;
  let winnersCount = 1;
  let targetCount = null;

  const winMatch = prize.match(/(?:winners?|победителей?)\s*=?\s*(\d+)/i);
  if (winMatch) {
    winnersCount = Math.max(1, Math.min(parseInt(winMatch[1], 10), MAX_WINNERS));
    prize = prize.replace(winMatch[0], '');
  }

  const countMatch = prize.match(/(?:count\s*=\s*|до\s+)(\d+)/i);
  if (countMatch) {
    targetCount = Math.max(2, Math.min(parseInt(countMatch[1], 10), MAX_TARGET));
    prize = prize.replace(countMatch[0], '');
  }

  const dur = parseDuration(prize);
  let durationMs = null;
  if (dur) {
    durationMs = dur.ms;
    prize = prize.replace(dur.match, '');
  }

  prize = prize.trim().replace(/\s+/g, ' ');

  if (!durationMs && !targetCount) durationMs = DEFAULT_DURATION_MS;

  return { prize, durationMs, targetCount, winnersCount };
}

function formatRemaining(endsAt) {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'скоро';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} сек`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} д ${h % 24} ч`;
}

function buildMessage(gw, count) {
  const lines = [`🎁 **РОЗЫГРЫШ**`, '', gw.prize];
  if (gw.winners_count > 1) lines.push(`Победителей: ${gw.winners_count}`);
  lines.push('');
  if (gw.target_count) {
    lines.push(`Участвует: ${count} / ${gw.target_count}`);
  } else {
    lines.push(`Участвует: ${count}`);
  }
  if (gw.ends_at) {
    lines.push(`Осталось: ${formatRemaining(gw.ends_at)}`);
  }
  return lines.join('\n');
}

function buildKeyboard(giveawayId, count) {
  return {
    inline_keyboard: [[
      { text: `🎁 Участвую (${count})`, callback_data: `gw:${giveawayId}` },
    ]],
  };
}

async function handleGiveawayCommand(bot, msg, argsText) {
  const chatId = msg.chat.id;
  const text = (argsText || '').trim();

  if (!text) {
    await sendSafe(bot, chatId,
      `Розыгрыш. Примеры:\n` +
      `/giveaway iPhone 15 60m\n` +
      `/giveaway подписка Spotify до 20\n` +
      `/giveaway виски 24h winners=3\n` +
      `/giveaway пицца 30m до 50 winners=2\n\n` +
      `Время: 30s / 5m / 2h / 1d (или 30с/5м/2ч/1д).\n` +
      `до N — закроется когда наберётся N участников.\n` +
      `winners=K — несколько победителей.`,
      { reply_to_message_id: msg.message_id });
    return;
  }

  const { prize, durationMs, targetCount, winnersCount } = parseArgs(text);
  if (!prize || prize.length < 2) {
    await sendSafe(bot, chatId, 'Не понял что разыгрываем. Напиши /giveaway без аргументов для примеров.',
      { reply_to_message_id: msg.message_id });
    return;
  }

  const endsAt = durationMs ? new Date(Date.now() + durationMs) : null;

  // Сначала отправляем сообщение-заглушку чтобы получить message_id
  let sent;
  try {
    sent = await bot.sendMessage(chatId, '🎁 Создаю розыгрыш...');
  } catch (err) {
    console.error('[GW] send failed:', err.message);
    return;
  }

  const giveawayId = await giveawaysRepo.create({
    chatId,
    messageId: sent.message_id,
    creatorId: msg.from?.id || 0,
    prize,
    endsAt,
    targetCount,
    winnersCount,
  });

  const gw = await giveawaysRepo.get(giveawayId);
  const text2 = buildMessage(gw, 0);
  const kb = buildKeyboard(giveawayId, 0);

  try {
    await bot.editMessageText(text2, {
      chat_id: chatId,
      message_id: sent.message_id,
      reply_markup: kb,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('[GW] edit failed:', err.message);
  }

  console.log(`[GW] #${giveawayId} chat=${chatId} prize="${prize}" dur=${durationMs} target=${targetCount} winners=${winnersCount}`);
}

async function handleJoinCallback(bot, query) {
  const data = query.data || '';
  if (!data.startsWith('gw:')) return false;

  const giveawayId = parseInt(data.slice(3), 10);
  if (!giveawayId) {
    await bot.answerCallbackQuery(query.id, { text: 'Не понял розыгрыш' });
    return true;
  }

  const userId = query.from.id;
  const username = query.from.username ? `@${query.from.username}` : query.from.first_name || `id${userId}`;

  // Боты не участвуют
  if (query.from.is_bot) {
    await bot.answerCallbackQuery(query.id, { text: 'Боты не участвуют' });
    return true;
  }

  const gw = await giveawaysRepo.get(giveawayId);
  if (!gw || gw.status !== 'active') {
    await bot.answerCallbackQuery(query.id, { text: 'Розыгрыш уже окончен' });
    return true;
  }

  const added = await giveawaysRepo.join(giveawayId, userId, username);
  if (!added) {
    await bot.answerCallbackQuery(query.id, { text: 'Ты уже в списке' });
    return true;
  }

  await bot.answerCallbackQuery(query.id, { text: '✅ Ты участвуешь' });

  const count = await giveawaysRepo.countParticipants(giveawayId);

  // Дебаунс обновления кнопки
  scheduleEdit(bot, gw, count);

  // Достигли порога?
  if (gw.target_count && count >= gw.target_count) {
    await finalize(bot, giveawayId);
  }

  return true;
}

function scheduleEdit(bot, gw, count) {
  const existing = editTimers.get(gw.id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    editTimers.delete(gw.id);
    try {
      const fresh = await giveawaysRepo.get(gw.id);
      if (!fresh || fresh.status !== 'active') return;
      const c = await giveawaysRepo.countParticipants(gw.id);
      await bot.editMessageText(buildMessage(fresh, c), {
        chat_id: fresh.chat_id,
        message_id: fresh.message_id,
        reply_markup: buildKeyboard(fresh.id, c),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      if (!/message is not modified/i.test(err.message)) {
        console.warn('[GW] edit:', err.message);
      }
    }
  }, EDIT_DEBOUNCE_MS);
  editTimers.set(gw.id, { timer, count });
}

function secureShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function finalize(bot, giveawayId) {
  const gw = await giveawaysRepo.get(giveawayId);
  if (!gw || gw.status !== 'active') return;

  await giveawaysRepo.setStatus(giveawayId, 'finished');

  // Останавливаем pending edits
  const t = editTimers.get(giveawayId);
  if (t) { clearTimeout(t.timer); editTimers.delete(giveawayId); }

  const participants = await giveawaysRepo.getParticipants(giveawayId);

  if (participants.length === 0) {
    try {
      await bot.editMessageText(
        `🎁 ${gw.prize}\n\n❌ Розыгрыш окончен.\nНикто не пришёл — джунгли молчали.`,
        { chat_id: gw.chat_id, message_id: gw.message_id, reply_markup: { inline_keyboard: [] } }
      );
    } catch (_) {}
    console.log(`[GW] #${giveawayId} finished, 0 participants`);
    return;
  }

  const K = Math.min(gw.winners_count, participants.length);
  const winners = secureShuffle(participants).slice(0, K);
  await giveawaysRepo.saveWinners(giveawayId, winners);

  const winnerTags = winners.map(w => w.username || `id${w.user_id}`).join(', ');
  const text = [
    `🎁 ${gw.prize}`,
    '',
    `✅ Розыгрыш окончен`,
    `Участников: ${participants.length}`,
    `${K > 1 ? 'Победители' : 'Победитель'}: ${winnerTags}`,
  ].join('\n');

  try {
    await bot.editMessageText(text, {
      chat_id: gw.chat_id,
      message_id: gw.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (_) {}

  try {
    await bot.sendMessage(gw.chat_id, `🎉 Поздравляю: ${winnerTags}!`, { reply_to_message_id: gw.message_id });
  } catch (_) {}

  console.log(`[GW] #${giveawayId} finished, winners: ${winnerTags}`);
}

async function tickExpired(bot) {
  try {
    const rows = await giveawaysRepo.getExpired();
    for (const row of rows) {
      try {
        await finalize(bot, row.id);
      } catch (err) {
        console.error(`[GW TICK] #${row.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[GW TICK]', err.message);
  }
}

module.exports = {
  handleGiveawayCommand,
  handleJoinCallback,
  finalize,
  tickExpired,
};
