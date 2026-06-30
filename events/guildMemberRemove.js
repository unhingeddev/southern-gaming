// events/guildMemberRemove.js
// Logs members leaving to the configured "leave" log channel (if set).

import { Events, EmbedBuilder } from 'discord.js';
import { sendEventLog } from '../utils/eventLog.js';
import { COLORS } from '../utils/embeds.js';

export default {
  name: Events.GuildMemberRemove,
  once: false,
  async execute(member) {
    if (member.user?.bot) return;
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(`📤 <@${member.id}> (**${member.user.tag}**) left the server.`)
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await sendEventLog(member.client, member.guild.id, 'leave', embed);
  },
};
