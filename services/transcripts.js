// services/transcripts.js
// Generates a viewable HTML transcript of a ticket's conversation and saves it to
// a log channel when the ticket closes (or on demand via /transcript). The HTML
// file opens in any browser and shows the full conversation — authors, times,
// message text, and attachment links.
//
// NOTE: message text is only captured if the bot has the Message Content intent
// enabled (Developer Portal → Bot → Privileged Gateway Intents). Without it,
// Discord returns empty content and transcripts will show "[no message content]".

import { AttachmentBuilder } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

const MAX_BATCHES = 200; // safety cap: up to ~20k messages per ticket

/** Fetch every message in a channel, oldest first. */
async function fetchAllMessages(channel) {
  const all = [];
  let before;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    const arr = [...batch.values()];
    all.push(...arr);
    before = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

/** Escape a string for safe insertion into HTML. */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Render one message as an HTML block. */
function renderMessage(msg) {
  const author = msg.author;
  const name = esc(author?.tag ?? author?.username ?? 'Unknown');
  const botTag = author?.bot ? ' <span class="bot">BOT</span>' : '';
  const when = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const avatar = author?.displayAvatarURL?.({ extension: 'png', size: 64 }) ?? '';

  const text = msg.content
    ? esc(msg.content).replaceAll('\n', '<br>')
    : '<span class="empty">[no text content]</span>';

  const attachments = [...(msg.attachments?.values?.() ?? [])]
    .map((a) => `<div class="attach">📎 <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a></div>`)
    .join('');

  const embeds = msg.embeds?.length ? `<div class="embeds">[${msg.embeds.length} embed(s)]</div>` : '';

  return `
  <div class="msg">
    <img class="avatar" src="${esc(avatar)}" alt="" loading="lazy">
    <div class="body">
      <div class="meta"><span class="name">${name}</span>${botTag} <span class="time">${esc(when)}</span> <span class="uid">(${esc(author?.id ?? '?')})</span></div>
      <div class="content">${text}</div>
      ${attachments}
      ${embeds}
    </div>
  </div>`;
}

/** Build the full HTML document for a ticket transcript. */
function renderHtml(ticket, messages, guildName) {
  const opened = ticket.created_at ? new Date(ticket.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
  const ticketNo = String(ticket.number).padStart(4, '0');
  const body = messages.map(renderMessage).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket #${esc(ticketNo)} transcript</title>
<style>
  :root { color-scheme: dark; }
  body { background:#313338; color:#dbdee1; font-family:'gg sans',system-ui,Arial,sans-serif; margin:0; padding:0; }
  header { background:#2b2d31; padding:20px 24px; border-bottom:1px solid #1f2023; }
  header h1 { margin:0 0 6px; font-size:20px; }
  header .sub { color:#949ba4; font-size:13px; line-height:1.6; }
  .log { padding:16px 24px 48px; }
  .msg { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid #2b2d3133; }
  .avatar { width:40px; height:40px; border-radius:50%; flex:0 0 40px; background:#1f2023; }
  .body { flex:1; min-width:0; }
  .meta { font-size:13px; margin-bottom:2px; }
  .name { color:#f2f3f5; font-weight:600; }
  .time { color:#949ba4; font-size:11px; margin-left:6px; }
  .uid { color:#5c5e66; font-size:11px; }
  .bot { background:#5865f2; color:#fff; font-size:10px; padding:1px 4px; border-radius:3px; vertical-align:middle; }
  .content { font-size:15px; line-height:1.4; white-space:normal; word-wrap:break-word; }
  .empty { color:#5c5e66; font-style:italic; }
  .attach { margin-top:4px; font-size:13px; }
  .attach a { color:#00a8fc; }
  .embeds { margin-top:4px; color:#949ba4; font-size:12px; }
  footer { padding:16px 24px; color:#5c5e66; font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>🎫 Ticket #${esc(ticketNo)}</h1>
  <div class="sub">
    Server: ${esc(guildName ?? '—')}<br>
    Opened by: ${esc(ticket.opener_id)} &nbsp;•&nbsp; Type: ${esc(ticket.ticket_type ?? 'General')}<br>
    Opened: ${esc(opened)} &nbsp;•&nbsp; Messages: ${messages.length}
  </div>
</header>
<div class="log">
${body || '<p class="empty">No messages were found in this ticket.</p>'}
</div>
<footer>Transcript generated ${esc(new Date().toISOString().replace('T', ' ').slice(0, 19))} UTC</footer>
</body>
</html>`;
}

/**
 * Build a transcript attachment for a ticket channel.
 * @returns {Promise<{ attachment: AttachmentBuilder, messageCount: number, participants: Set<string> }>}
 */
export async function buildTranscript(channel, ticket) {
  const messages = await fetchAllMessages(channel);
  const participants = new Set(messages.map((m) => m.author?.id).filter(Boolean));
  const html = renderHtml(ticket, messages, channel.guild?.name);
  const filename = `ticket-${String(ticket.number).padStart(4, '0')}-transcript.html`;
  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: filename });
  return { attachment, messageCount: messages.length, participants };
}

/** Resolve where transcripts should go: the 'transcript' log, else the audit log channel. */
function resolveTranscriptChannelId(guildId) {
  return Store.getEventLog(guildId, 'transcript') ?? Store.getGuild(guildId)?.log_channel_id ?? null;
}

/**
 * Generate a transcript and post it (file + summary embed) to the configured
 * transcript/log channel. Safe to call right before deleting the ticket channel.
 * Never throws — logs and returns false on failure so closing always proceeds.
 * @returns {Promise<boolean>} whether a transcript was posted
 */
export async function saveTranscript(client, ticket, channel, { closedBy, reason } = {}) {
  try {
    const targetId = resolveTranscriptChannelId(ticket.guild_id);
    if (!targetId) return false; // no destination configured — skip silently

    const target = await client.channels.fetch(targetId).catch(() => null);
    if (!target?.isTextBased?.()) return false;

    const { attachment, messageCount, participants } = await buildTranscript(channel, ticket);

    const embed = Embeds.info(`🎫 Ticket #${String(ticket.number).padStart(4, '0')} transcript`, null)
      .setColor(COLORS.neutral)
      .addFields(
        { name: 'Opened by', value: `<@${ticket.opener_id}>`, inline: true },
        { name: 'Closed by', value: closedBy ? `<@${closedBy}>` : 'Auto', inline: true },
        { name: 'Messages', value: String(messageCount), inline: true },
        { name: 'Participants', value: String(participants.size), inline: true },
        { name: 'Type', value: ticket.ticket_type ?? 'General', inline: true },
        { name: 'Reason', value: reason ? String(reason).slice(0, 1024) : '—', inline: true }
      );

    await target.send({ embeds: [embed], files: [attachment] });
    logger.info(`[${ticket.guild_id}] Saved transcript for ticket #${ticket.number} (${messageCount} messages).`);
    return true;
  } catch (err) {
    logger.warn(`Failed to save transcript for ticket #${ticket?.number}: ${err.message}`);
    return false;
  }
}
