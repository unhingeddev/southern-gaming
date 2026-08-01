import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

const sessions = new Map();
const PREFIX = 'embed:';
const EMPTY = { fields: [], timestamp: false };
const MENTIONS = ['none', 'here', 'everyone'];

export default {
  data: new SlashCommandBuilder()
    .setName('embed').setDescription('Create and manage rich embeds.')
    .setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('new').setDescription('Open the interactive embed builder.'))
    .addSubcommand(s => s.setName('list').setDescription('Edit a saved template or an embed already sent.'))
    .addSubcommand(s => s.setName('send').setDescription('Quickly send a saved template.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'new') return openBuilder(interaction, structuredClone(EMPTY));
    if (sub === 'list') return interaction.reply({
      content: 'Select a template or a sent embed to edit.',
      components: [row(button('list_templates', 'Edit a Saved Template', ButtonStyle.Primary), button('list_sent', 'Edit a Sent Embed', ButtonStyle.Secondary))],
      flags: MessageFlags.Ephemeral,
    });
    return showTemplates(interaction, 'quick_send');
  },

  async component(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages))
      return fail(interaction, 'You need **Manage Messages** to use the embed manager.');
    const parts = interaction.customId.slice(PREFIX.length).split(':');
    const action = parts[0];
    if (action === 'list_templates') return showTemplates(interaction, 'edit_template', true);
    if (action === 'list_sent') return showChannelPicker(interaction, 'sent_channel', true);
    if (action === 'template') return loadTemplate(interaction, interaction.values[0]);
    if (action === 'quick') return quickTemplate(interaction, interaction.values[0]);
    if (action === 'sent_channel') return findSentEmbeds(interaction, interaction.values[0]);
    if (action === 'sent_message') return loadSentEmbed(interaction, parts[1], interaction.values[0]);

    const session = sessions.get(parts[1]);
    if (!session || session.userId !== interaction.user.id)
      return fail(interaction, 'This builder expired or belongs to another user. Run `/embed new` again.');
    session.touched = Date.now();
    if (action === 'edit') return showEditModal(interaction, parts[1], parts[2]);
    if (action === 'toggle_timestamp') { session.data.timestamp = !session.data.timestamp; return refresh(interaction, session); }
    if (action === 'toggle_mention') {
      const current = MENTIONS.indexOf(session.data.mention || 'none');
      session.data.mention = MENTIONS[(current + 1) % MENTIONS.length];
      return refresh(interaction, session);
    }
    if (action === 'remove_field') { session.data.fields.pop(); return refresh(interaction, session); }
    if (action === 'save') return showSaveModal(interaction, parts[1]);
    if (action === 'send') {
      if (session.targetMessageId) return sendOrEdit(interaction, session);
      return showChannelPicker(interaction, `send_channel:${parts[1]}`, true);
    }
    if (action === 'send_channel') return sendOrEdit(interaction, session, interaction.values[0]);
  },

  async modal(interaction) {
    const [, action, sid] = interaction.customId.split(':');
    const session = sessions.get(sid);
    if (!session || session.userId !== interaction.user.id) return fail(interaction, 'This builder expired.');
    if (action === 'save_modal') {
      const name = value(interaction, 'name').slice(0, 80);
      if (!name) return fail(interaction, 'Template name cannot be empty.');
      Store.saveEmbedTemplate(interaction.guildId, name, session.data, interaction.user.id);
      session.templateName = name;
      return interaction.reply({ embeds: [Embeds.success('Template saved', `Saved **${name}**.`)], flags: MessageFlags.Ephemeral });
    }
    if (action !== 'modal') return;
    const kind = interaction.customId.split(':')[3];
    applyModal(interaction, session.data, kind);
    return interaction.update(builderPayload(session));
  },
};

function newSession(interaction, data, extra = {}) {
  cleanup();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const session = { id, userId: interaction.user.id, guildId: interaction.guildId, data: normalize(data), touched: Date.now(), ...extra };
  sessions.set(id, session);
  return session;
}

async function openBuilder(interaction, data, extra = {}) {
  const session = newSession(interaction, data, extra);
  return interaction.reply({ ...builderPayload(session), flags: MessageFlags.Ephemeral });
}

function builderPayload(s) {
  const d = s.data;
  const preview = isEmpty(d)
    ? new EmbedBuilder().setColor(COLORS.danger).setDescription('Your embed is empty. Use the buttons below to add content.')
    : makeEmbed(d, null);
  const vars = new EmbedBuilder().setColor(COLORS.neutral).setTitle('Available Variables')
    .setDescription('Text: `{server.name}` `{server.membercount}` `{bot.name}`\nImages: `{server.icon}` `{bot.icon}`');
  const id = s.id;
  return {
    content: s.targetMessageId ? `Editing message \`${s.targetMessageId}\` in <#${s.targetChannelId}>.` : (s.templateName ? `Editing template **${s.templateName}**.` : 'Interactive embed builder'),
    embeds: [preview, vars],
    components: [
      row(button(`edit:${id}:title`, 'Title'), button(`edit:${id}:description`, 'Description'), button(`edit:${id}:color`, 'Color')),
      row(button(`edit:${id}:media`, 'Image / Thumbnail'), button(`edit:${id}:author`, 'Author'), button(`edit:${id}:footer`, 'Footer')),
      row(button(`edit:${id}:field`, 'Add Field'), button(`remove_field:${id}`, 'Remove Field', ButtonStyle.Secondary, !d.fields.length), button(`toggle_timestamp:${id}`, `Timestamp: ${d.timestamp ? 'On' : 'Off'}`, ButtonStyle.Secondary)),
      row(button(`toggle_mention:${id}`, `Hidden Ping: ${d.mention === 'here' ? '@here' : d.mention === 'everyone' ? '@everyone' : 'Off'}`, d.mention === 'none' ? ButtonStyle.Secondary : ButtonStyle.Primary)),
      row(button(`send:${id}`, s.targetMessageId ? 'Save Changes' : 'Send', ButtonStyle.Success), button(`save:${id}`, 'Save Template', ButtonStyle.Primary)),
    ],
  };
}

async function refresh(i, s) { return i.update(builderPayload(s)); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false) { return new ButtonBuilder().setCustomId(PREFIX + id).setLabel(label).setStyle(style).setDisabled(disabled); }
function row(...components) { return new ActionRowBuilder().addComponents(...components); }

async function showTemplates(i, mode, update = false) {
  const templates = Store.getEmbedTemplates(i.guildId);
  if (!templates.length) return fail(i, 'No saved templates exist in this server.');
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}${mode === 'quick_send' ? 'quick' : 'template'}`).setPlaceholder('Choose a saved template')
    .addOptions(templates.map(t => ({ label: t.name.slice(0, 100), value: String(t.id), description: `Template ID: ${t.id}` })));
  const payload = { content: mode === 'quick_send' ? 'Choose a template to send.' : 'Choose a template to edit.', embeds: [], components: [row(select)] };
  return update ? i.update(payload) : i.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function loadTemplate(i, id) {
  const t = Store.getEmbedTemplate(i.guildId, Number(id));
  if (!t) return fail(i, 'That template no longer exists.');
  const s = newSession(i, t.data, { templateName: t.name });
  return i.update(builderPayload(s));
}

async function quickTemplate(i, id) {
  const t = Store.getEmbedTemplate(i.guildId, Number(id));
  if (!t) return fail(i, 'That template no longer exists.');
  const s = newSession(i, t.data, { templateName: t.name });
  return showChannelPicker(i, `send_channel:${s.id}`, true);
}

function showChannelPicker(i, purpose, update = false) {
  const select = new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}${purpose}`).setPlaceholder('Select a channel (ID is shown after selection)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const payload = { content: 'Select a channel. Discord’s channel picker includes every channel you can view; the selected channel ID is used directly.', embeds: [], components: [row(select)] };
  return update ? i.update(payload) : i.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function findSentEmbeds(i, channelId) {
  const channel = await i.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return fail(i, 'That channel is unavailable.');
  const perms = channel.permissionsFor(i.guild.members.me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) return fail(i, `I need **View Channel** and **Read Message History** in <#${channelId}>.`);
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const found = messages?.filter(m => m.author.id === i.client.user.id && m.embeds.length).first(25) ?? [];
  if (!found.length) return fail(i, `I found no recent embed messages sent by me in <#${channelId}>.`);
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}sent_message:${channelId}`).setPlaceholder('Choose an embed message')
    .addOptions(found.map(m => ({ label: (m.embeds[0].title || m.embeds[0].description || 'Untitled embed').slice(0, 100), value: m.id, description: `Message ID: ${m.id}` })));
  return i.update({ content: `Recent editable embeds in <#${channelId}> (channel ID: \`${channelId}\`):`, embeds: [], components: [row(select)] });
}

async function loadSentEmbed(i, channelId, messageId) {
  const channel = await i.guild.channels.fetch(channelId).catch(() => null);
  const message = await channel?.messages.fetch(messageId).catch(() => null);
  if (!message || message.author.id !== i.client.user.id || !message.embeds[0]) return fail(i, 'That embed message is no longer editable.');
  const mention = message.content.includes('@everyone') ? 'everyone' : message.content.includes('@here') ? 'here' : 'none';
  const s = newSession(i, { ...message.embeds[0].toJSON(), mention }, { targetChannelId: channelId, targetMessageId: messageId });
  return i.update(builderPayload(s));
}

async function sendOrEdit(i, s, selectedChannelId) {
  const channelId = s.targetChannelId ?? selectedChannelId;
  const channel = await i.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return fail(i, 'That channel is unavailable.');
  const needed = s.targetMessageId ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] : [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!channel.permissionsFor(i.guild.members.me)?.has(needed)) return fail(i, 'I do not have the required channel permissions for that action.');
  if (isEmpty(s.data)) return fail(i, 'Add some content before sending the embed.');
  try {
    const embed = makeEmbed(s.data, i);
    const messageContent = mentionContent(s.data.mention);
    const allowedMentions = s.data.mention === 'here' || s.data.mention === 'everyone' ? { parse: ['everyone'] } : { parse: [] };
    if (s.targetMessageId) {
      const message = await channel.messages.fetch(s.targetMessageId);
      if (message.author.id !== i.client.user.id) return fail(i, 'I can only edit messages sent by this bot.');
      await message.edit({ content: messageContent, embeds: [embed], allowedMentions });
    } else await channel.send({ content: messageContent, embeds: [embed], allowedMentions });
    sessions.delete(s.id);
    return i.update({ content: `${s.targetMessageId ? 'Updated' : 'Sent'} the embed in <#${channelId}> (channel ID: \`${channelId}\`).`, embeds: [], components: [] });
  } catch (err) {
    logger.error(`Embed send/edit failed: ${err.stack || err.message}`);
    return fail(i, `Discord rejected the embed: ${err.message}`);
  }
}

function showEditModal(i, sid, kind) {
  const d = sessions.get(sid).data;
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal:${sid}:${kind}`).setTitle(`Edit ${kind}`);
  const add = (id, label, current = '', style = TextInputStyle.Short, max = 1024, required = false) => modal.addComponents(row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required).setValue(String(current || '').slice(0, max))));
  if (kind === 'title') add('title', 'Title (blank removes it)', d.title, TextInputStyle.Short, 256);
  else if (kind === 'description') add('description', 'Description (blank removes it)', d.description, TextInputStyle.Paragraph, 4000);
  else if (kind === 'color') add('color', 'Hex color, e.g. #5865F2', d.color == null ? '' : `#${Number(d.color).toString(16).padStart(6, '0')}`, TextInputStyle.Short, 7);
  else if (kind === 'media') { add('image', 'Image URL (blank removes)', d.image?.url, TextInputStyle.Short, 1000); add('thumbnail', 'Thumbnail URL (blank removes)', d.thumbnail?.url, TextInputStyle.Short, 1000); }
  else if (kind === 'author') { add('author_name', 'Author name (blank removes)', d.author?.name, TextInputStyle.Short, 256); add('author_icon', 'Author icon URL', d.author?.icon_url, TextInputStyle.Short, 1000); add('author_url', 'Author link URL', d.author?.url, TextInputStyle.Short, 1000); }
  else if (kind === 'footer') { add('footer_text', 'Footer text (blank removes)', d.footer?.text, TextInputStyle.Short, 2048); add('footer_icon', 'Footer icon URL', d.footer?.icon_url, TextInputStyle.Short, 1000); }
  else if (kind === 'field') { add('field_name', 'Field name', '', TextInputStyle.Short, 256, true); add('field_value', 'Field value', '', TextInputStyle.Paragraph, 1024, true); add('field_inline', 'Inline? yes or no', 'no', TextInputStyle.Short, 3); }
  return i.showModal(modal);
}

function showSaveModal(i, sid) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}save_modal:${sid}`).setTitle('Save embed template');
  modal.addComponents(row(new TextInputBuilder().setCustomId('name').setLabel('Template name').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true).setValue(sessions.get(sid).templateName || '')));
  return i.showModal(modal);
}

function applyModal(i, d, kind) {
  if (kind === 'title' || kind === 'description') setOrDelete(d, kind, value(i, kind));
  else if (kind === 'color') { const raw = value(i, 'color').replace(/^#/, ''); if (!raw) delete d.color; else if (/^[\da-f]{6}$/i.test(raw)) d.color = parseInt(raw, 16); }
  else if (kind === 'media') { setNestedUrl(d, 'image', value(i, 'image')); setNestedUrl(d, 'thumbnail', value(i, 'thumbnail')); }
  else if (kind === 'author') { const name = value(i, 'author_name'); if (!name) delete d.author; else d.author = { name, ...(url(value(i, 'author_icon')) ? { icon_url: value(i, 'author_icon') } : {}), ...(url(value(i, 'author_url')) ? { url: value(i, 'author_url') } : {}) }; }
  else if (kind === 'footer') { const text = value(i, 'footer_text'); if (!text) delete d.footer; else d.footer = { text, ...(url(value(i, 'footer_icon')) ? { icon_url: value(i, 'footer_icon') } : {}) }; }
  else if (kind === 'field' && d.fields.length < 25) d.fields.push({ name: value(i, 'field_name'), value: value(i, 'field_value'), inline: /^y(es)?$/i.test(value(i, 'field_inline')) });
}

function normalize(raw = {}) { const d = structuredClone(raw); d.fields = Array.isArray(d.fields) ? d.fields.slice(0, 25) : []; d.timestamp = Boolean(d.timestamp); d.mention = MENTIONS.includes(d.mention) ? d.mention : 'none'; return d; }
function makeEmbed(data, i) { const d = substitute(structuredClone(data), i); delete d.mention; if (d.timestamp === true) d.timestamp = new Date().toISOString(); else delete d.timestamp; return EmbedBuilder.from(d); }
function mentionContent(mention) { return mention === 'here' ? '|| @here ||' : mention === 'everyone' ? '|| @everyone ||' : null; }
function substitute(v, i) { if (!i) return v; if (typeof v === 'string') return v.replaceAll('{server.name}', i.guild.name).replaceAll('{server.membercount}', String(i.guild.memberCount)).replaceAll('{server.icon}', i.guild.iconURL() || '').replaceAll('{bot.name}', i.client.user.username).replaceAll('{bot.icon}', i.client.user.displayAvatarURL()); if (Array.isArray(v)) return v.map(x => substitute(x, i)); if (v && typeof v === 'object') for (const k of Object.keys(v)) v[k] = substitute(v[k], i); return v; }
function isEmpty(d) { return !d.title && !d.description && !d.author?.name && !d.footer?.text && !d.image?.url && !d.thumbnail?.url && !d.fields?.length; }
function value(i, id) { return i.fields.getTextInputValue(id).replaceAll('\\n', '\n').trim(); }
function setOrDelete(o, k, v) { if (v) o[k] = v; else delete o[k]; }
function setNestedUrl(o, k, v) { if (url(v)) o[k] = { url: v }; else delete o[k]; }
function url(v) { try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } }
function cleanup() { const cutoff = Date.now() - 30 * 60_000; for (const [id, s] of sessions) if (s.touched < cutoff) sessions.delete(id); }
async function fail(i, text) { const payload = { embeds: [Embeds.error('Embed manager', text)], components: [], flags: MessageFlags.Ephemeral }; return i.replied || i.deferred ? i.followUp(payload) : i.reply(payload); }

export { PREFIX as EMBED_INTERACTION_PREFIX };
