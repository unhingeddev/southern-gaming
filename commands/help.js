// commands/help.js
// Friendly overview of every command, grouped by category.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Embeds, { COLORS } from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all available commands and what they do.')
    .setDMPermission(false),

  async execute(interaction) {
    const embed = Embeds.info('🤖 SellAuth Bot — Help', 'Here is everything I can do.')
      .setColor(COLORS.brand)
      .addFields(
        {
          name: '🔧 SellAuth Setup (admin)',
          value:
            '`/setapikey` — Store your SellAuth API key (encrypted)\n' +
            '`/testconnection` — Verify the API connection',
        },
        {
          name: '📺 Channel Configuration (admin)',
          value:
            '`/setvouchchannel` — Where vouches are posted\n' +
            '`/setpurchasechannel` — Where purchases are posted\n' +
            '`/setlogchannel` — Where audit logs are posted',
        },
        {
          name: '⚙️ Automation (admin)',
          value:
            '`/startvouches` · `/stopvouches`\n' +
            '`/startpurchases` · `/stoppurchases`',
        },
        {
          name: '📈 Utility',
          value:
            '`/vouch` — Leave a vouch/review (posts a card to the vouch channel)\n' +
            '`/vouches` — Show latest reviews\n' +
            '`/recentpurchases` — Show recent orders\n' +
            '`/status` — Show config & connection (admin)\n' +
            '`/reload` — Reload commands (admin)\n' +
            '`/help` — This menu',
        },
        {
          name: '🧹 Moderation',
          value:
            '`/kick` — Kick a member (needs Kick Members)\n' +
            '`/ban` — Ban a user, optionally purging messages (needs Ban Members)\n' +
            '`/unban` — Lift a ban by user ID (needs Ban Members)\n' +
            '`/timeout` — Temporarily mute a member, or clear it (needs Timeout Members)\n' +
            '`/nuke` — Bulk-clear messages in a channel (with confirmation)\n' +
            '`/embed` — Compose & send a rich embed (multi-paragraph supported)',
        },
        {
          name: '🧩 Roles (admin)',
          value:
            '`/roles set` — Assign Owner/Co-owner/Staff/Buyers/Members roles\n' +
            '`/roles view` — Show configured roles\n' +
            '`/roles auto add|remove|list` — Manage roles auto-given on join',
        },
        {
          name: '🎫 Tickets',
          value:
            '`/ticketconfig` — Set support role + ticket category\n' +
            '`/ticketcategory add|remove|list` — Manage dropdown ticket types\n' +
            '`/ticketpanel` — Post a panel (button **or** dropdown)\n' +
            '`/ticketautoclose` — Auto-close inactive tickets after N minutes\n' +
            '`/transcript` — Save a viewable HTML transcript of this ticket\n' +
            '`/close` — Close the current ticket (auto-saves a transcript)\n' +
            '`/closeall` — Close all tickets (5-min warning, owner/admin)',
        },
        {
          name: '🎉 Giveaways (Manage Server)',
          value:
            '`/giveaway start` — Start a giveaway (prize, duration, winners, channel, role)\n' +
            '`/giveaway end` — End a running giveaway now and draw winners\n' +
            '`/giveaway reroll` — Draw replacement winner(s) for a finished giveaway\n' +
            '`/giveaway list` — Show recent giveaways in this server',
        },
        {
          name: '🎭 Presence (owner)',
          value:
            '`/statusadd` — Add a rotating status with its own `duration`\n' +
            '`/statuslist` — List statuses · `/statusremove` — Remove one by ID\n' +
            '`/statusclear` — Remove all rotating statuses\n' +
            '`/sync` — Re-register commands to this server',
        },
        {
          name: '📝 Logging (Manage Server)',
          value:
            '`/setlog` — Set a channel for leave/ban/kick/embed/join/transcript logs\n' +
            '`/viewlogs` — Show configured log channels\n' +
            '`/removelog` — Disable a log type',
        }
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
