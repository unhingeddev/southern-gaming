// commands/blocklist.js  (auto-mod system)
// /blocklist add|remove|list — manage this server's extra blocked words.
// Built-in default slurs (automod/config.json) are always active and not listed.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../automod/db.js';
import { canModerate } from '../automod/permissions.js';
import { invalidateGuildCache } from '../automod/wordFilter.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('blocklist')
    .setDescription("Manage this server's blocked-word list.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a word or phrase to the blocklist.')
        .addStringOption((o) => o.setName('word').setDescription('Word or phrase to block').setRequired(true).setMaxLength(100))
        .addStringOption((o) =>
          o.setName('category').setDescription('slur = redacted in logs; general = shown').addChoices({ name: 'general', value: 'general' }, { name: 'slur', value: 'slur' })
        )
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove a word from the blocklist.').addStringOption((o) => o.setName('word').setDescription('Word/phrase to remove').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription("Show this server's added blocked words.")),

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
      const rows = Store.listBlockwords(guildId);
      const body = rows.length
        ? rows.map((r) => `• \`${r.word}\`${r.category === 'slur' ? ' _(slur)_' : ''}`).join('\n').slice(0, 4000)
        : '_No custom words added. (Built-in default slur protection is always active.)_';
      return interaction.reply({ embeds: [Embeds.info('Blocklist (custom additions)', body)], flags: MessageFlags.Ephemeral });
    }

    const word = interaction.options.getString('word', true).trim().toLowerCase();

    if (sub === 'add') {
      const category = interaction.options.getString('category') ?? 'general';
      Store.addBlockword(guildId, word, category, interaction.user.id);
      invalidateGuildCache(guildId);
      return interaction.reply({ embeds: [Embeds.success('Word blocked', `Added \`${word}\` to the blocklist (**${category}**).`)], flags: MessageFlags.Ephemeral });
    }

    const removed = Store.removeBlockword(guildId, word);
    invalidateGuildCache(guildId);
    return interaction.reply({
      embeds: [removed ? Embeds.success('Word removed', `Removed \`${word}\` from the blocklist.`) : Embeds.warning('Not found', `\`${word}\` was not in this server's custom blocklist.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
