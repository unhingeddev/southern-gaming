// commands/statuslist.js
// List all rotating statuses with their IDs (use the ID with /statusremove).
// Owner only.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { isBotOwner } from '../utils/owner.js';

export default {
  data: new SlashCommandBuilder()
    .setName('statuslist')
    .setDescription('List the rotating statuses (owner only).')
    .setDMPermission(false),

  async execute(interaction) {
    if (!(await isBotOwner(interaction))) {
      return interaction.reply({
        embeds: [Embeds.error('Owner only', 'Only the bot owner can manage rotating statuses.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const rows = Store.getStatuses();
    if (!rows.length) {
      return interaction.reply({
        embeds: [Embeds.info('No statuses', 'None set. The bot shows its default. Add one with `/statusadd`.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const lines = rows
      .map((r) => `\`${r.id}\` **[${r.type}]** ${r.text} — *${r.presence}* • ${r.duration}s`)
      .join('\n');

    return interaction.reply({
      embeds: [Embeds.info('Rotating statuses', lines)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
