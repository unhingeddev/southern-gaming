// commands/warnings.js  (auto-mod system)
// /warnings <user> — show a member's strike count and recent history.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../automod/db.js';
import { canModerate } from '../automod/permissions.js';
import Embeds from '../utils/embeds.js';

const ACTION_EMOJI = { warn: '⚠️', timeout: '⏳', ban: '🔨' };

export default {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("View a member's strike history.")
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to inspect').setRequired(true)),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('user', true);
    const { count, last_strike_at } = Store.getStrikes(interaction.guildId, user.id);
    const history = Store.getHistory(interaction.guildId, user.id, 10);

    const embed = Embeds.info(`Strike history — ${user.tag}`, `Current strikes: **${count} / 4**`);
    embed.setThumbnail(user.displayAvatarURL());
    if (last_strike_at) embed.addFields({ name: 'Last strike', value: `<t:${last_strike_at}:R>`, inline: true });

    if (history.length) {
      const lines = history.map((h) => {
        const when = `<t:${h.created_at}:d>`;
        const emoji = ACTION_EMOJI[h.action] ?? '•';
        const who = h.moderator_id ? `<@${h.moderator_id}>` : 'Auto-Mod';
        return `${emoji} ${when} — **${h.rule ?? 'violation'}** (${h.reason ?? 'n/a'}) · by ${who}`;
      });
      embed.addFields({ name: `Recent actions (${history.length})`, value: lines.join('\n').slice(0, 1024) });
    } else {
      embed.addFields({ name: 'Recent actions', value: '_No history on record._' });
    }

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
