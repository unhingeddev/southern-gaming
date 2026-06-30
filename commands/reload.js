// commands/reload.js
// Hot-reload all command modules without restarting the process. Admin only.
// Useful during development or after editing a command file.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { loadCommands } from '../handlers/commandHandler.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Reload all bot commands from disk (admin/dev tool).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const commands = await loadCommands(interaction.client);
      await audit(interaction, 'Commands Reloaded', `Reloaded ${commands.size} command modules.`);
      return interaction.editReply({
        embeds: [
          Embeds.success(
            'Commands reloaded',
            `Reloaded **${commands.size}** command module(s) from disk.\n` +
              `_Note: this does not re-register them with Discord — run \`npm run deploy\` if you changed command definitions._`
          ),
        ],
      });
    } catch (err) {
      logger.error('Reload failed:', err.message);
      return interaction.editReply({
        embeds: [Embeds.error('Reload failed', err.message)],
      });
    }
  },
};
