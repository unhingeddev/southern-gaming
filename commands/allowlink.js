// commands/allowlink.js  (auto-mod system)
// /allowlink add|remove|list — manage per-guild allowed link domains.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../automod/db.js';
import config from '../automod/config.js';
import { canModerate } from '../automod/permissions.js';
import Embeds from '../utils/embeds.js';

function cleanDomain(input) {
  return String(input).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
}

export default {
  data: new SlashCommandBuilder()
    .setName('allowlink')
    .setDescription('Manage allowed link domains.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName('add').setDescription('Allow links from a domain.').addStringOption((o) => o.setName('domain').setDescription('e.g. youtube.com').setRequired(true).setMaxLength(100))
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove an allowed domain.').addStringOption((o) => o.setName('domain').setDescription('Domain to remove').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show allowed domains.')),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const custom = Store.listAllowDomains(guildId);
      const builtin = config.defaults.allowedLinkDomains ?? [];
      const embed = Embeds.info('Allowed link domains', custom.length ? custom.map((d) => `• \`${d}\``).join('\n') : '_No custom domains added._').addFields({
        name: 'Built-in (always allowed)',
        value: builtin.map((d) => `\`${d}\``).join(', ') || '_none_',
      });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const domain = cleanDomain(interaction.options.getString('domain', true));
    if (!domain.includes('.')) {
      return interaction.reply({ embeds: [Embeds.error('Invalid domain', 'Please provide a valid domain like `example.com`.')], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'add') {
      Store.addAllowDomain(guildId, domain, interaction.user.id);
      return interaction.reply({ embeds: [Embeds.success('Domain allowed', `Links from \`${domain}\` are now permitted.`)], flags: MessageFlags.Ephemeral });
    }

    const removed = Store.removeAllowDomain(guildId, domain);
    return interaction.reply({
      embeds: [removed ? Embeds.success('Domain removed', `\`${domain}\` is no longer allowed.`) : Embeds.warning('Not found', `\`${domain}\` was not in the custom allowlist.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
