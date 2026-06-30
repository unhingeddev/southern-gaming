// commands/embed.js
// Rich embed sender. Opens a modal so the author can write a multi-paragraph
// description naturally (the modal's Paragraph input supports real line breaks),
// then posts a clean embed into the chosen channel.
//
// Requires "Manage Messages" to use. The target channel option is captured on
// the slash command, then encoded into the modal's customId so it survives the
// round-trip to the modal-submit handler.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { sendEventLog } from '../utils/eventLog.js';
import logger from '../utils/logger.js';

const MODAL_PREFIX = 'embed-modal:';

// Maps the /embed `ping` choice → the message text posted above the embed.
const PING_MAP = {
  here: '@here',
  everyone: '@everyone',
  here_spoiler: '|| @here ||',
  everyone_spoiler: '|| @everyone ||',
};

export default {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Compose and send a rich embed (supports multi-paragraph text).')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to send the embed to (defaults to here)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('ping')
        .setDescription('Optional ping/text posted above the embed')
        .addChoices(
          { name: '@here', value: 'here' },
          { name: '@everyone', value: 'everyone' },
          { name: '@here (spoiler ||…||)', value: 'here_spoiler' },
          { name: '@everyone (spoiler ||…||)', value: 'everyone_spoiler' }
        )
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  /** Slash entry: validate, then show the embed-builder modal. */
  async execute(interaction) {
    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    const ping = interaction.options.getString('ping') ?? '';

    // Ensure the bot can actually post an embed in the target channel.
    const me = interaction.guild.members.me;
    const perms = target.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        embeds: [
          Embeds.error(
            'Missing permissions',
            `I need **Send Messages** and **Embed Links** in <#${target.id}>.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Build the modal. Up to 5 inputs, each on its own row.
    // Encode both the target channel and the chosen ping into the customId so
    // they survive the round-trip to the modal-submit handler.
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${target.id}:${ping}`)
      .setTitle('Create an embed');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(false);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description — press Enter for new paragraphs')
      .setStyle(TextInputStyle.Paragraph) // multi-line / multi-paragraph
      .setMaxLength(4000)
      .setPlaceholder('Line one.\n\nA second paragraph.\n\nA third…')
      .setRequired(true);

    const colorInput = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('Color hex (optional, e.g. #5865F2)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(7)
      .setRequired(false);

    const footerInput = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer text (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false);

    const imageInput = new TextInputBuilder()
      .setCustomId('image')
      .setLabel('Image URL (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(1024)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(footerInput),
      new ActionRowBuilder().addComponents(imageInput)
    );

    await interaction.showModal(modal);
  },

  /**
   * Modal-submit handler (routed here from events/interactionCreate.js when the
   * customId starts with the embed prefix).
   * @param {import('discord.js').ModalSubmitInteraction} interaction
   */
  async modal(interaction) {
    // customId = "embed-modal:<channelId>:<pingKey>"
    const rest = interaction.customId.slice(MODAL_PREFIX.length);
    const [channelId, pingKey = ''] = rest.split(':');
    const pingContent = PING_MAP[pingKey] ?? '';
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      return interaction.reply({
        embeds: [Embeds.error('Channel unavailable', 'That channel no longer exists or I cannot see it.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const title = interaction.fields.getTextInputValue('title').trim();
    // Convert any literal "\n" the author typed into real newlines, on top of the
    // genuine line breaks the Paragraph input already provides.
    const description = interaction.fields
      .getTextInputValue('description')
      .replaceAll('\\n', '\n')
      .trim();
    const colorRaw = interaction.fields.getTextInputValue('color').trim();
    const footer = interaction.fields.getTextInputValue('footer').trim();
    const image = interaction.fields.getTextInputValue('image').trim();

    const embed = new EmbedBuilder()
      .setDescription(description.slice(0, 4096))
      .setColor(parseColor(colorRaw))
      .setTimestamp();

    if (title) embed.setTitle(title.slice(0, 256));
    if (footer) embed.setFooter({ text: footer.slice(0, 2048) });
    if (image && isHttpUrl(image)) embed.setImage(image);

    try {
      await channel.send({
        content: pingContent || undefined,
        embeds: [embed],
        // Allow the @here/@everyone in `content` to actually ping (the bot still
        // needs the "Mention @everyone" permission in that channel).
        allowedMentions: pingContent ? { parse: ['everyone', 'roles', 'users'] } : undefined,
      });
    } catch (err) {
      logger.error(`Failed to send /embed to ${channelId}: ${err.message}`);
      return interaction.reply({
        embeds: [Embeds.error('Send failed', `Could not post the embed: ${err.message}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await audit(
      interaction,
      'Embed Sent',
      `An embed was sent to <#${channelId}>${title ? ` (titled “${title}”)` : ''}.`
    );

    // Post to the "embed" event-log channel if configured.
    await sendEventLog(
      interaction.client,
      interaction.guildId,
      'embed',
      Embeds.info('Embed sent', `By <@${interaction.user.id}> in <#${channelId}>${title ? `\n**Title:** ${title}` : ''}`)
    );

    return interaction.reply({
      embeds: [
        Embeds.success('Embed sent', `Posted to <#${channelId}>.${pingContent ? `\nWith ping: ${pingContent}` : ''}`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/** Parse a "#RRGGBB"/"RRGGBB" hex string into an int, defaulting to brand color. */
function parseColor(raw) {
  if (!raw) return COLORS.brand;
  const hex = raw.replace(/^#/, '');
  const n = parseInt(hex, 16);
  return /^[0-9a-fA-F]{6}$/.test(hex) && Number.isFinite(n) ? n : COLORS.brand;
}

/** Allow only http(s) URLs for the image, as a small safety check. */
function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
