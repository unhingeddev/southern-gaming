// automod/modLog.js
// Builds and delivers moderation-action log embeds to the auto-mod log channel.
// Destination: per-guild channel (set via /automod logchannel) → else the
// default in automod/config.json (LOG_CHANNEL_ID env / defaultLogChannelId).
// Colours: yellow = warning, orange = timeout, red = ban.

import { EmbedBuilder } from 'discord.js';
import { Store } from './db.js';
import config from './config.js';
import logger from '../utils/logger.js';
import { COLORS } from '../utils/embeds.js';

const ORANGE = COLORS.timeout ?? 0xe67e22;

const ACTION_COLORS = {
  warn: COLORS.warning,
  timeout: ORANGE,
  ban: COLORS.danger,
  raid: COLORS.danger,
  info: COLORS.brand,
  flag: COLORS.warning,
};

const ACTION_LABELS = {
  warn: '⚠️ Warning Issued',
  timeout: '⏳ Member Timed Out',
  ban: '🔨 Member Banned',
  raid: '🛡️ Raid Protection',
  info: 'ℹ️ Moderation Notice',
  flag: '🚩 Member Flagged',
};

function clip(value, max = 1024) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function buildModEmbed(o = {}) {
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[o.action] ?? COLORS.neutral ?? 0x2b2d31)
    .setTitle(ACTION_LABELS[o.action] ?? 'Moderation Action')
    .setTimestamp();

  if (o.user) {
    embed.setAuthor({ name: o.user.tag ?? o.user.username ?? 'Unknown', iconURL: o.user.displayAvatarURL?.() || undefined });
    embed.addFields({ name: 'User', value: `<@${o.user.id}> (\`${o.user.id}\`)`, inline: false });
  }
  if (o.rule) embed.addFields({ name: 'Rule violated', value: clip(o.rule, 256), inline: true });
  if (typeof o.strikeCount === 'number') embed.addFields({ name: 'Strikes', value: `**${o.strikeCount}** / 4`, inline: true });
  if (o.channelId) embed.addFields({ name: 'Channel', value: `<#${o.channelId}>`, inline: true });
  if (o.reason) embed.addFields({ name: 'Action / detail', value: clip(o.reason), inline: false });

  if (o.content !== undefined) {
    const shown = o.redact
      ? '`[redacted - contained slur]`'
      : o.content.trim()
        ? clip(`\`\`\`\n${o.content.replace(/`/g, '´')}\n\`\`\``, 1024)
        : '_(no text content)_';
    embed.addFields({ name: 'Message content', value: shown, inline: false });
  }

  embed.addFields({ name: 'Responsible', value: clip(o.moderator ?? 'Auto-Mod', 256), inline: true });
  if (o.note) embed.setFooter({ text: clip(o.note, 2048) });

  return embed;
}

export async function resolveLogChannel(client, guildId) {
  const channelId = Store.getLogChannel(guildId) || config.bot.defaultLogChannelId;
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

export async function sendModLog(client, guildId, embed) {
  try {
    const channel = await resolveLogChannel(client, guildId);
    if (!channel) {
      logger.warn(`[automod][${guildId}] No usable log channel — skipping log delivery.`);
      return false;
    }
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    logger.warn(`[automod][${guildId}] Failed to send mod log: ${err.message}`);
    return false;
  }
}

export default { buildModEmbed, sendModLog, resolveLogChannel };
