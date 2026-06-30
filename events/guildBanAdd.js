// events/guildBanAdd.js
// Logs bans to the configured "ban" log channel (if set). Catches bans done by
// anyone — through the bot's /ban or directly in Discord. Requires the
// (non-privileged) GuildModeration intent.

import { Events, EmbedBuilder } from 'discord.js';
import { sendEventLog } from '../utils/eventLog.js';
import { COLORS } from '../utils/embeds.js';

export default {
  name: Events.GuildBanAdd,
  once: false,
  async execute(ban) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setAuthor({ name: ban.user.tag, iconURL: ban.user.displayAvatarURL() })
      .setDescription(`🔨 **${ban.user.tag}** was banned.`)
      .setFooter({ text: `ID: ${ban.user.id}` })
      .setTimestamp();
    if (ban.reason) embed.addFields({ name: 'Reason', value: String(ban.reason).slice(0, 1024) });
    await sendEventLog(ban.client, ban.guild.id, 'ban', embed);
  },
};
