// commands/availability.js
// Controls the availability auto-responder.
//   /availability preview          — show the card now (ephemeral)
//   /availability test [user]      — post the card publicly, like a real trigger
//   /availability testmode [on]    — let a tracked person ping themselves + ignore daily limit
//   /availability reset            — clear the once-a-day flags so it can reply again
//   /availability toggle [on]      — enable/disable the responder
//   /availability mode <mode>      — auto (default) | available | away
// Usable by a tracked person themselves, or staff/admins (canModerate).

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { canModerate } from '../automod/permissions.js';
import {
  buildAvailabilityEmbed,
  resetDaily,
  setEnabled,
  isEnabled,
  setMode,
  getMode,
  isTestMode,
  setTestMode,
  getPerson,
  getPeople,
  TRACKED_USER_IDS,
} from '../services/availability.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('availability')
    .setDescription('Control the availability auto-responder.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('preview').setDescription('Preview the availability card (only you see it).'))
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Post the availability card publicly now, like a real ping.')
        .addUserOption((o) => o.setName('user').setDescription('Which tracked person to show (default: all)'))
    )
    .addSubcommand((s) =>
      s
        .setName('testmode')
        .setDescription('Toggle test mode (lets you ping yourself + ignores the daily limit).')
        .addBooleanOption((o) => o.setName('on').setDescription('On/off — omit to flip'))
    )
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
    // A tracked person can always manage their own availability; otherwise staff/admins.
    const isTracked = TRACKED_USER_IDS.includes(interaction.user.id);
    if (!isTracked && !canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'Only a tracked person or **Owner / Co-Owner / Staff** can manage this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'preview') {
      const people = getPeople();
      if (!people.length) {
        return interaction.reply({
          embeds: [Embeds.warning('No one configured', 'No tracked people are set in the availability config.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        embeds: people.map((p) => buildAvailabilityEmbed(p, getMode())),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'test') {
      const chosen = interaction.options.getUser('user');
      let people = getPeople();
      if (chosen) {
        const person = getPerson(chosen.id);
        if (!person) {
          return interaction.reply({
            embeds: [Embeds.error('Not tracked', `<@${chosen.id}> isn't in the availability config.`)],
            flags: MessageFlags.Ephemeral,
          });
        }
        people = [person];
      }
      if (!people.length) {
        return interaction.reply({
          embeds: [Embeds.warning('No one configured', 'No tracked people are set in the availability config.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      // Public reply so you can see exactly what a real ping produces.
      return interaction.reply({ embeds: people.map((p) => buildAvailabilityEmbed(p, getMode())) });
    }

    if (sub === 'testmode') {
      const next = interaction.options.getBoolean('on') ?? !isTestMode();
      setTestMode(next);
      return interaction.reply({
        embeds: [
          Embeds.success(
            'Test mode ' + (next ? 'ON 🧪' : 'OFF'),
            next
              ? 'You can now **ping yourself** to trigger the card, and the once-a-day limit is ignored. Turn it off when done.'
              : 'Back to normal: self-pings are ignored and the daily limit applies again.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'reset') {
      const n = resetDaily();
      return interaction.reply({
        embeds: [Embeds.success('Reset', `Cleared today's availability replies (${n} entr${n === 1 ? 'y' : 'ies'}). It can respond again now.`)],
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
