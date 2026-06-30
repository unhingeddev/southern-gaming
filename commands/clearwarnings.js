// commands/clearwarnings.js  (auto-mod system)
// /clearwarnings <user> [purge] — reset a member's strikes.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../automod/db.js';
import { canModerate } from '../automod/permissions.js';
import { buildModEmbed, sendModLog } from '../automod/modLog.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription("Reset a member's strikes.")
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to clear').setRequired(true))
    .addBooleanOption((o) => o.setName('purge').setDescription('Also delete their stored history (default: keep for audit)')),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('user', true);
    const purge = interaction.options.getBoolean('purge') ?? false;

    const had = Store.getStrikes(interaction.guildId, user.id).count;
    Store.clearStrikes(interaction.guildId, user.id);
    let purged = 0;
    if (purge) purged = Store.clearHistory(interaction.guildId, user.id);

    await sendModLog(
      interaction.client,
      interaction.guildId,
      buildModEmbed({
        action: 'info',
        user,
        rule: 'Strikes cleared',
        reason: `Reset from **${had}** strike(s)${purge ? ` and purged ${purged} history record(s)` : ''}.`,
        moderator: interaction.user.tag,
      })
    );

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Strikes cleared',
          `**${user.tag}**'s strikes have been reset (was **${had}**).` + (purge ? `\nPurged **${purged}** history record(s).` : '')
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
