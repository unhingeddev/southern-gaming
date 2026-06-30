// commands/statusadd.js
// Add a line to the bot's rotating presence/status. Because presence is global
// across every server the bot is in, this command is restricted to the BOT OWNER
// (not per-server admins).
//
// Supports placeholders in the text: {servers}, {users}, {ping}.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { isBotOwner } from '../utils/owner.js';
import { refreshStatusNow } from '../services/statusRotator.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('statusadd')
    .setDescription('Add a rotating status to the bot (owner only).')
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription('Status text. Placeholders: {servers}, {users}, {ping}')
        .setRequired(true)
        .setMaxLength(128)
    )
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Activity type (default: Watching)')
        .addChoices(
          { name: 'Playing', value: 'Playing' },
          { name: 'Watching', value: 'Watching' },
          { name: 'Listening', value: 'Listening' },
          { name: 'Competing', value: 'Competing' },
          { name: 'Custom', value: 'Custom' }
        )
    )
    .addStringOption((o) =>
      o
        .setName('presence')
        .setDescription('Online indicator (default: online)')
        .addChoices(
          { name: 'Online', value: 'online' },
          { name: 'Idle', value: 'idle' },
          { name: 'Do Not Disturb', value: 'dnd' }
        )
    )
    .addIntegerOption((o) =>
      o
        .setName('duration')
        .setDescription('Seconds to show this status before rotating (default: 30)')
        .setMinValue(5)
        .setMaxValue(3600)
    )
    .setDMPermission(false),

  async execute(interaction) {
    // Owner-only gate (presence affects every server).
    if (!(await isBotOwner(interaction))) {
      return interaction.reply({
        embeds: [
          Embeds.error('Owner only', 'Only the bot owner can manage rotating statuses.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const text = interaction.options.getString('text', true).trim();
    const type = interaction.options.getString('type') ?? 'Watching';
    const presence = interaction.options.getString('presence') ?? 'online';
    const duration = interaction.options.getInteger('duration') ?? 30;

    if (!text) {
      return interaction.reply({
        embeds: [Embeds.error('Empty status', 'Status text cannot be blank.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const id = Store.addStatus(text, type, presence, duration, interaction.user.id);
    logger.info(
      `Status #${id} added by ${interaction.user.tag}: "${text}" (${type}/${presence}, ${duration}s).`
    );

    // Apply right away so the owner sees it take effect immediately.
    refreshStatusNow(interaction.client);

    const total = Store.countStatuses();
    const preview =
      type === 'Custom' ? text : `${typeWord(type)} ${text}`;

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Status added',
          `**#${id}** added to the rotation (${total} total).\n` +
            `Preview: *${preview}* — \`${presence}\` • shows for **${duration}s**\n\n` +
            `It will cycle in along with the others. Placeholders like ` +
            `\`{servers}\`, \`{users}\`, \`{ping}\` are filled in live.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/** Human prefix shown in the preview line. */
function typeWord(type) {
  switch (type) {
    case 'Playing':
      return 'Playing';
    case 'Listening':
      return 'Listening to';
    case 'Competing':
      return 'Competing in';
    default:
      return 'Watching';
  }
}
