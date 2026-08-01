import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { Store } from '../database/db.js';
import logger from '../utils/logger.js';

const timers = new Map();
const generations = new Map();

function currentGeneration(channelId) {
  return generations.get(channelId) ?? 0;
}

function payload(row) {
  const allowedMentions = { parse: [] };
  if (row.kind === 'embed') return { embeds: [new EmbedBuilder().setTitle(row.title).setDescription(row.description)], allowedMentions };
  return { content: row.content, allowedMentions };
}

export async function postSticky(channel, row = Store.getSticky(channel.id), expectedGeneration = currentGeneration(channel.id)) {
  if (!row) return null;
  const isCurrent = () => currentGeneration(channel.id) === expectedGeneration;
  if (!isCurrent()) return null;
  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) return null;
  if (row.message_id) {
    // Clear the saved ID before intentionally deleting the old sticky. This
    // keeps messageDelete from mistaking our move-to-bottom operation for a
    // manual deletion and scheduling another repost.
    Store.setStickyMessageId(channel.id, null);
    const old = await channel.messages.fetch(row.message_id).catch(() => null);
    if (old) await old.delete().catch(() => {});
    if (!isCurrent()) return null;
  }
  const sent = await channel.send(payload(row));
  // A manager may have turned the sticky off while Discord was processing the
  // send. Remove that now-orphaned message instead of bringing the sticky back.
  if (!isCurrent() || !Store.getSticky(channel.id)) {
    await sent.delete().catch(() => {});
    return null;
  }
  Store.setStickyMessageId(channel.id, sent.id);
  return sent;
}

export function cancelSticky(channelId) {
  const timer = timers.get(channelId);
  if (timer) clearTimeout(timer);
  timers.delete(channelId);
  generations.set(channelId, currentGeneration(channelId) + 1);
  return Boolean(timer);
}

export function queueStickyForChannel(channel, triggerMessageId = null) {
  if (!channel?.id || !channel?.guild) return false;
  const row = Store.getSticky(channel.id);
  if (!row || triggerMessageId === row.message_id) return false;

  cancelSticky(channel.id);
  const generation = currentGeneration(channel.id);
  const timer = setTimeout(async () => {
    timers.delete(channel.id);
    try {
      const current = Store.getSticky(channel.id);
      if (current) await postSticky(channel, current, generation);
    } catch (err) {
      logger.warn(`Sticky repost failed in ${channel.id}: ${err.message}`);
    }
  }, row.delay_seconds * 1000);
  timer.unref?.();
  timers.set(channel.id, timer);
  return true;
}

export function queueSticky(message) {
  // Normal bot responses must not bump the sticky, or the sticky could trigger
  // itself forever. Bot-created vouches use queueStickyForChannel explicitly.
  if (!message.guildId || message.author?.bot) return false;
  return queueStickyForChannel(message.channel, message.id);
}

export async function validateStickies(client) {
  for (const row of Store.getAllStickies()) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (!channel?.isTextBased?.() || !('messages' in channel)) continue;
    const existing = row.message_id ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
    if (!existing) await postSticky(channel, row).catch((err) => logger.warn(`Sticky recovery failed in ${row.channel_id}: ${err.message}`));
  }
}

export function stopStickies() { for (const t of timers.values()) clearTimeout(t); timers.clear(); generations.clear(); }
