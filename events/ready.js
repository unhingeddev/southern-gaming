// events/ready.js
// Fired once when the bot has logged in. Sets presence and starts automation.

import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { startAutomation } from '../services/automation.js';
import { startStatusRotation } from '../services/statusRotator.js';
import { startTicketSweeper } from '../services/ticketSweeper.js';
import { startGiveawaySweeper } from '../services/giveawaySweeper.js';

export default {
  name: Events.ClientReady,
  once: true,
  /**
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  execute(client, ctx) {
    logger.info(`Logged in as ${client.user.tag} (serving ${client.guilds.cache.size} guild(s)).`);

    // Begin rotating presence/statuses (managed via /statusadd).
    startStatusRotation(client);

    // Kick off the vouch/purchase auto-poster.
    startAutomation(client);

    // Sweeper for scheduled/inactivity ticket closes.
    startTicketSweeper(client);

    // Sweeper that ends giveaways when their timer runs out.
    startGiveawaySweeper(client);
    void ctx;
  },
};
