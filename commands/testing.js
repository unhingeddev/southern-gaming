// commands/testing.js  (auto-mod system)
// /testing [enabled] — toggle test mode. When ON, detections delete the message
// + DM the user a warning, but apply NO strike/timeout/ban, and bypass staff
// immunity so admins can test on their own account.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../automod/db.js';
import { canModerate } from '../automod/permissions.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('testing')
    .setDescription('Toggle auto-mod test mode (deletes + DMs a warning, but no strike/timeout/ban).')
    .setDMPermission(false)
    .addBooleanOption((o) => o.setName('enabled').setDescription('On = dry-run (DM only). Off = enforce normally. Omit to flip.')),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const current = Store.getTestMode(interaction.guildId);
    const next = interaction.options.getBoolean('enabled') ?? !current;
    Store.setTestMode(interaction.guildId, next);

    const embed = next
      ? Embeds.warning(
          'Test mode ENABLED 🧪',
          "Violations will be **deleted and the user DM'd a warning** — but **no strikes, timeouts, or bans**. " +
            'Staff immunity is bypassed so you can test on yourself.\n\nTurn off with `/testing enabled:False`.'
        )
      : Embeds.success('Test mode DISABLED', 'Enforcement is back to normal: delete + 4-strike escalation (warn → timeout → timeout → ban).');

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
