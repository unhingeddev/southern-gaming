import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { Store } from '../database/db.js';
import logger from '../utils/logger.js';

const timers = new Map();

function payload(row) {
  const allowedMentions = { parse: [] };
  if (row.kind === 'embed') return { embeds: [new EmbedBuilder().setTitle(row.title).setDescription(row.description)], allowedMentions };
  return { content: row.content, allowedMentions };
}

export async function postSticky(channel, row = Store.getSticky(channel.id)) {
  if (!row) return null;
  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) return null;
  if (row.message_id) {
    const old = await channel.messages.fetch(row.message_id).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const sent = await channel.send(payload(row));
  Store.setStickyMessageId(channel.id, sent.id);
  return sent;
}

export function queueSticky(message) {
  if (!message.guildId || message.author?.bot) return;
  const row = Store.getSticky(message.channelId);
  if (!row || message.id === row.message_id) return;
  clearTimeout(timers.get(message.channelId));
  timers.set(message.channelId, setTimeout(async () => {
    timers.delete(message.channelId);
    try { await postSticky(message.channel, Store.getSticky(message.channelId)); }
    catch (err) { logger.warn(`Sticky repost failed in ${message.channelId}: ${err.message}`); }
  }, row.delay_seconds * 1000));
}

export async function validateStickies(client) {
  for (const row of Store.getAllStickies()) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (!channel?.isTextBased?.() || !('messages' in channel)) continue;
    const existing = row.message_id ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    if (!existing) await postSticky(channel, row).catch((err) => logger.warn(`Sticky recovery failed in ${row.channel_id}: ${err.message}`));
  }
}

export function stopStickies() { for (const t of timers.values()) clearTimeout(t); timers.clear(); }
