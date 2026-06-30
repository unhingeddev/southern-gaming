// commands/statusremove.js
// Remove a single rotating status by its ID (from /statuslist). Owner only.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { isBotOwner } from '../utils/owner.js';
import { refreshStatusNow } from '../services/statusRotator.js';

export default {
  data: new SlashCommandBuilder()
    .setName('statusremove')
    .setDescription('Remove a rotating status by its ID (owner only).')
    .addIntegerOption((o) =>
      o.setName('id').setDescription('Status ID from /statuslist').setRequired(true).setMinValue(1)
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!(await isBotOwner(interaction))) {
      return interaction.reply({
        embeds: [Embeds.error('Owner only', 'Only the bot owner can manage rotating statuses.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const id = interaction.options.getInteger('id', true);
    const removed = Store.removeStatus(id);
    if (removed) refreshStatusNow(interaction.client);

    return interaction.reply({
      embeds: [
        removed
          ? Embeds.success('Status removed', `Removed status \`${id}\`.`)
          : Embeds.warning('Not found', `No status with ID \`${id}\`. Check \`/statuslist\`.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
