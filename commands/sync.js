// commands/sync.js
// Re-register slash commands to the current server instantly, from inside Discord.
// Owner only. Handy after adding/changing a command without running the deploy
// script from a terminal.

import { SlashCommandBuilder, MessageFlags, REST, Routes } from 'discord.js';
import config from '../config/config.js';
import Embeds from '../utils/embeds.js';
import { isBotOwner } from '../utils/owner.js';
import { collectCommandData } from '../handlers/commandHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Re-register slash commands to this server (owner only).')
    .setDMPermission(false),

  async execute(interaction) {
    if (!(await isBotOwner(interaction))) {
      return interaction.reply({
        embeds: [Embeds.error('Owner only', 'Only the bot owner can sync commands.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const body = collectCommandData(interaction.client.commands);
    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    try {
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, interaction.guildId), { body });
      return interaction.editReply({
        embeds: [Embeds.success('Commands synced', `Re-registered **${body.length}** commands to this server (instant).`)],
      });
    } catch (err) {
      return interaction.editReply({ embeds: [Embeds.error('Sync failed', err.message)] });
    }
  },
};
