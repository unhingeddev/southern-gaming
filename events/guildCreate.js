// events/guildCreate.js
// Fired when the bot is added to a new server. To make running the bot across
// many servers effortless, this auto-registers all slash commands to the new
// guild instantly (no manual `deploy-commands.js` run needed).
//
// Controlled by config.bot.autoRegisterOnJoin (env AUTO_REGISTER_ON_JOIN). Turn
// it off if you register commands globally, so they don't appear twice.

import { Events } from 'discord.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { registerGuildCommands } from '../handlers/commandHandler.js';

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
      const n = await registerGuildCommands(ctx.client, guild.id);
      logger.info(`Auto-registered ${n} command(s) to new guild ${guild.id}.`);
    } catch (err) {
      logger.warn(`Failed to auto-register commands for guild ${guild.id}: ${err.message}`);
    }
  },
};
