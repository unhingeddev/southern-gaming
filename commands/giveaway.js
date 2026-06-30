// commands/giveaway.js
// Run giveaways with a one-click "Enter" button. Subcommands:
//   /giveaway start   — start a giveaway (prize, winners, duration, channel, role)
//   /giveaway end     — end a running giveaway early and draw now
//   /giveaway reroll  — draw replacement winner(s) for a finished giveaway
//   /giveaway list    — show recent giveaways in this server
//
// Requires Manage Server (or Administrator). Ending is handled automatically by
// the giveaway sweeper once the timer runs out; `end` just triggers it early.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { parseDuration, formatDuration } from '../utils/duration.js';
import {
  buildRunningMessage,
  endGiveaway,
  rerollGiveaway,
  canManageGiveaways,
} from '../services/giveaways.js';
import logger from '../utils/logger.js';

// Guard rails on giveaway length.
const MIN_SECONDS = 10;
const MAX_SECONDS = 90 * 86400; // 90 days

export default {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create and manage giveaways.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a new giveaway.')
        .addStringOption((o) =>
          o.setName('prize').setDescription('What is being given away').setRequired(true).setMaxLength(200)
        )
        .addStringOption((o) =>
          o
            .setName('duration')
            .setDescription('How long it runs, e.g. 30m, 2h, 1d, "1d 12h"')
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName('winners')
            .setDescription('Number of winners (default 1)')
            .setMinValue(1)
            .setMaxValue(50)
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post in (defaults to here)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addRoleOption((o) =>
          o.setName('required_role').setDescription('Only members with this role may enter')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('End a running giveaway now and draw winners.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Giveaway ID (see /giveaway list)').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Draw replacement winner(s) for a finished giveaway.')
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Giveaway ID (see /giveaway list)').setRequired(true).setMinValue(1)
        )
        .addIntegerOption((o) =>
          o.setName('winners').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(50)
        )
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('Show recent giveaways in this server.')
    ),

  async execute(interaction) {
    if (!canManageGiveaways(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'You need **Manage Server** to manage giveaways.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'start') return startGiveaway(interaction);
    if (sub === 'end') return endCommand(interaction);
    if (sub === 'reroll') return rerollCommand(interaction);
    if (sub === 'list') return listCommand(interaction);
  },
};

async function startGiveaway(interaction) {
  const prize = interaction.options.getString('prize', true);
  const durationStr = interaction.options.getString('duration', true);
  const winners = interaction.options.getInteger('winners') ?? 1;
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const requiredRole = interaction.options.getRole('required_role');

  const seconds = parseDuration(durationStr);
  if (seconds === null || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    return interaction.reply({
      embeds: [
        Embeds.error(
          'Invalid duration',
          `Use a value like \`30m\`, \`2h\`, \`1d\`, or \`1d 12h\` ` +
            `(between ${formatDuration(MIN_SECONDS)} and ${formatDuration(MAX_SECONDS)}).`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Make sure we can actually post in the target channel.
  const me = interaction.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
    return interaction.reply({
      embeds: [Embeds.error('Missing permissions', `I need **Send Messages** + **Embed Links** in <#${channel.id}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const endAt = Math.floor(Date.now() / 1000) + seconds;
  const id = Store.createGiveaway({
    guildId: interaction.guildId,
    channelId: channel.id,
    prize,
    winnersCount: winners,
    hostId: interaction.user.id,
    requiredRoleId: requiredRole?.id ?? null,
    endAt,
  });

  // Post the giveaway message, then save its id so the sweeper can edit it later.
  const row = Store.getGiveaway(id);
  let message;
  try {
    message = await channel.send(buildRunningMessage(row, 0));
    Store.setGiveawayMessage(id, message.id);
  } catch (err) {
    logger.error(`Failed to post giveaway #${id}: ${err.message}`);
    return interaction.reply({
      embeds: [Embeds.error('Could not post giveaway', err.message)],
      flags: MessageFlags.Ephemeral,
    });
  }

  await audit(
    interaction,
    'Giveaway Started',
    `**${prize}** (#${id}) — ${winners} winner(s), ends <t:${endAt}:R> in <#${channel.id}>.`
  );

  return interaction.reply({
    embeds: [
      Embeds.success(
        'Giveaway started',
        `**${prize}** is live in <#${channel.id}>.\nID **#${id}** · ends <t:${endAt}:R> · ${winners} winner(s).`
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function endCommand(interaction) {
  const id = interaction.options.getInteger('id', true);
  const g = Store.getGiveaway(id);
  if (!g || g.guild_id !== interaction.guildId) {
    return interaction.reply({
      embeds: [Embeds.error('Not found', `No giveaway **#${id}** in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (g.ended) {
    return interaction.reply({
      embeds: [Embeds.warning('Already ended', `Giveaway **#${id}** has already finished. Use \`/giveaway reroll\` to draw again.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const winners = await endGiveaway(interaction.client, id);
  await audit(interaction, 'Giveaway Ended Early', `**${g.prize}** (#${id}) — ${winners.length} winner(s).`);
  return interaction.editReply({
    embeds: [
      Embeds.success(
        'Giveaway ended',
        winners.length
          ? `Drew ${winners.length} winner(s): ${winners.map((w) => `<@${w}>`).join(', ')}.`
          : 'No valid entries — no winner was drawn.'
      ),
    ],
  });
}

async function rerollCommand(interaction) {
  const id = interaction.options.getInteger('id', true);
  const count = interaction.options.getInteger('winners') ?? 1;
  const g = Store.getGiveaway(id);
  if (!g || g.guild_id !== interaction.guildId) {
    return interaction.reply({
      embeds: [Embeds.error('Not found', `No giveaway **#${id}** in this server.`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!g.ended) {
    return interaction.reply({
      embeds: [Embeds.warning('Still running', `Giveaway **#${id}** hasn't ended yet. End it first, or wait for the timer.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const winners = await rerollGiveaway(interaction.client, id, count);
  if (!winners.length) {
    return interaction.editReply({
      embeds: [Embeds.warning('No one left to draw', 'There are no eligible entrants left to reroll.')],
    });
  }
  await audit(interaction, 'Giveaway Rerolled', `**${g.prize}** (#${id}) — ${winners.length} new winner(s).`);
  return interaction.editReply({
    embeds: [Embeds.success('Reroll complete', `New winner(s): ${winners.map((w) => `<@${w}>`).join(', ')}.`)],
  });
}

async function listCommand(interaction) {
  const rows = Store.getGuildGiveaways(interaction.guildId, 10);
  if (!rows.length) {
    return interaction.reply({
      embeds: [Embeds.info('No giveaways yet', 'Start one with `/giveaway start`.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = rows.map((g) => {
    const count = Store.countGiveawayEntries(g.id);
    const state = g.ended ? '🏁 ended' : `⏳ ends <t:${g.end_at}:R>`;
    return `**#${g.id}** — ${g.prize} · ${count} entries · ${state}`;
  });

  return interaction.reply({
    embeds: [Embeds.info('🎉 Recent giveaways', lines.join('\n'))],
    flags: MessageFlags.Ephemeral,
  });
}
