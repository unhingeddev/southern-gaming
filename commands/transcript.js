// commands/transcript.js
// Generate a viewable HTML transcript of the CURRENT ticket on demand, without
// closing it. Replies with the file (so you can read it immediately) and also
// archives a copy to the configured transcript/log channel. Support staff or
// members with Manage Channels.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { buildTranscript, saveTranscript } from '../services/transcripts.js';

export default {
  // Transcripts fetch the whole channel history — a longer cooldown is sensible.
  cooldown: 15,

  data: new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('Save a viewable transcript of this ticket without closing it.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const ticket = Store.getTicketByChannel(interaction.channelId);
    if (!ticket) {
      return interaction.reply({
        embeds: [Embeds.error('Not a ticket', 'Run this inside a ticket channel.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Support staff (or Manage Channels) only.
    const settings = Store.getGuild(interaction.guildId);
    const isSupport =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
      (settings?.support_role_id && interaction.member?.roles?.cache?.has(settings.support_role_id));
    if (!isSupport) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only support staff can generate transcripts.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Build a copy for the requester to read right now.
    const { attachment, messageCount } = await buildTranscript(interaction.channel, ticket);
    // Archive a copy to the transcript/log channel (no-op if none configured).
    const archived = await saveTranscript(interaction.client, ticket, interaction.channel, {
      closedBy: interaction.user.id,
      reason: 'Manual /transcript (ticket still open)',
    });

    return interaction.editReply({
      embeds: [
        Embeds.success(
          'Transcript ready',
          `Captured **${messageCount}** message(s).` +
            (archived ? ' A copy was archived to the transcript log.' : '\n\n_Tip: set a log with `/setlog transcript #channel` to archive copies automatically._')
        ),
      ],
      files: [attachment],
    });
  },
};
