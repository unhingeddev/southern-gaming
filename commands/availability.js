// commands/availability.js
// Controls the availability auto-responder.
//   /availability preview        — show the card now (ephemeral)
//   /availability reset          — clear the once-a-day flags so it can reply again
//   /availability toggle [on]    — enable/disable the responder
//   /availability mode <mode>    — auto (default) | available | away
// Usable by the owner themselves, staff/admins (canModerate).

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { canModerate } from '../automod/permissions.js';
import {
  buildAvailabilityEmbed,
  resetDaily,
  setEnabled,
  isEnabled,
  setMode,
  getMode,
  OWNER_USER_ID,
} from '../services/availability.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('availability')
    .setDescription('Control the availability auto-responder.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('preview').setDescription('Preview the availability card.'))
    .addSubcommand((s) => s.setName('reset').setDescription("Reset today's responses so it can reply again."))
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable or disable the responder.')
        .addBooleanOption((o) => o.setName('on').setDescription('On/off — omit to flip'))
    )
    .addSubcommand((s) =>
      s
        .setName('mode')
        .setDescription('Set the availability mode.')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('auto = work-hours aware (default)')
            .setRequired(true)
            .addChoices(
              { name: 'auto (work-hours aware)', value: 'auto' },
              { name: 'available (force green)', value: 'available' },
              { name: 'away (force red)', value: 'away' }
            )
        )
    ),

  async execute(interaction) {
    // The owner can always manage their own availability; otherwise staff/admins.
    const isOwner = interaction.user.id === OWNER_USER_ID;
    if (!isOwner && !canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'Only the owner or **Owner / Co-Owner / Staff** can manage this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'preview') {
      return interaction.reply({ embeds: [buildAvailabilityEmbed(getMode())], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'reset') {
      const n = resetDaily();
      return interaction.reply({
        embeds: [Embeds.success('Reset', `Cleared today's availability replies (${n} channel${n === 1 ? '' : 's'}). It can respond again now.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'toggle') {
      const next = interaction.options.getBoolean('on') ?? !isEnabled();
      setEnabled(next);
      return interaction.reply({
        embeds: [Embeds.success('Updated', `Availability responder is now **${next ? 'enabled 🟢' : 'disabled 🔴'}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // mode
    const mode = interaction.options.getString('mode', true);
    setMode(mode);
    return interaction.reply({
      embeds: [Embeds.success('Mode set', `Availability mode is now **${mode}**.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
