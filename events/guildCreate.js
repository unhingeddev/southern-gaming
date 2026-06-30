// events/guildCreate.js
// Fired when the bot is added to a new server. To make running the bot across
// many servers effortless, this auto-registers all slash commands to the new
// guild instantly (no manual `deploy-commands.js` run needed).
//
// Controlled by config.bot.autoRegisterOnJoin (env AUTO_REGISTER_ON_JOIN). Turn
// it off if you register commands globally, so they don't appear twice.

import { Events, REST, Routes } from 'discord.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { collectCommandData } from '../handlers/commandHandler.js';

export default {
  name: Events.GuildCreate,
  once: false,
  /**
   * @param {import('discord.js').Guild} guild
   * @param {object} ctx Shared context ({ client, Store, config }).
   */
  async execute(guild, ctx) {
    logger.info(`Joined guild "${guild.name}" (${guild.id}); now in ${ctx.client.guilds.cache.size} guild(s).`);

    if (!config.bot.autoRegisterOnJoin) return;

    try {
      const body = collectCommandData(ctx.client.commands);
      const rest = new REST({ version: '10' }).setToken(config.discord.token);
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guild.id), { body });
      logger.info(`Auto-registered ${body.length} command(s) to new guild ${guild.id}.`);
    } catch (err) {
      logger.warn(`Failed to auto-register commands for guild ${guild.id}: ${err.message}`);
    }
  },
};
