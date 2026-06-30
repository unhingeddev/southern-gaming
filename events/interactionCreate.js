// events/interactionCreate.js
// Central dispatcher for slash commands. Handles cooldowns, permission checks,
// shared context injection, and uniform error handling so individual command
// files stay focused on their own logic.

import { Events, MessageFlags } from 'discord.js';
import logger from '../utils/logger.js';
import Embeds from '../utils/embeds.js';
import { checkCooldown } from '../utils/cooldowns.js';
import config from '../config/config.js';
import { openTicket, closeTicket, claimTicket, openTicketFromSelect } from '../services/tickets.js';
import { handleEnter, ENTER_PREFIX } from '../services/giveaways.js';

// Persistent ticket buttons → their handlers. These have no message collector,
// so they're dispatched here and keep working across bot restarts.
// Each wrapper passes ONLY the interaction — never the shared ctx — so it can't
// be mistaken for a second argument (e.g. openTicket's optional `category`).
const TICKET_BUTTONS = {
  'ticket-open': (i) => openTicket(i),
  'ticket-close': (i) => closeTicket(i),
  'ticket-claim': (i) => claimTicket(i),
};

export default {
  name: Events.InteractionCreate,
  once: false,
  /**
   * @param {import('discord.js').Interaction} interaction
   * @param {object} ctx Shared context ({ client, Store }).
   */
  async execute(interaction, ctx) {
    // Modal submissions (e.g. the /embed and /ticketpanel builders) are routed to
    // the owning command's `modal` handler based on the customId prefix.
    if (interaction.isModalSubmit()) {
      const modalRoutes = {
        'embed-modal:': 'embed',
        'ticket-panel-modal:': 'ticketpanel',
      };
      const prefix = Object.keys(modalRoutes).find((p) => interaction.customId.startsWith(p));
      if (prefix) {
        const cmd = interaction.client.commands.get(modalRoutes[prefix]);
        try {
          await cmd?.modal?.(interaction, ctx);
        } catch (err) {
          logger.error('Error handling modal submit:', err.stack || err.message);
          const payload = {
            embeds: [Embeds.error('Something went wrong', 'Could not process that form.')],
            flags: MessageFlags.Ephemeral,
          };
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => {});
          } else {
            await interaction.reply(payload).catch(() => {});
          }
        }
      }
      return;
    }

    // Persistent giveaway "Enter" button (customId = `giveaway-enter:<id>`).
    // Like the ticket buttons it has no collector, so it works across restarts.
    if (interaction.isButton() && interaction.customId.startsWith(ENTER_PREFIX)) {
      try {
        await handleEnter(interaction);
      } catch (err) {
        logger.error(`Error handling ${interaction.customId}:`, err.stack || err.message);
        const payload = {
          embeds: [Embeds.error('Something went wrong', 'Could not process that action.')],
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // Persistent ticket buttons (Open / Close / Claim) and the ticket-type dropdown.
    const isTicketButton = interaction.isButton() && TICKET_BUTTONS[interaction.customId];
    const isTicketSelect = interaction.isStringSelectMenu() && interaction.customId === 'ticket-select';
    if (isTicketButton || isTicketSelect) {
      try {
        if (isTicketSelect) await openTicketFromSelect(interaction, ctx);
        else await TICKET_BUTTONS[interaction.customId](interaction, ctx);
      } catch (err) {
        logger.error(`Error handling ${interaction.customId}:`, err.stack || err.message);
        const payload = {
          embeds: [Embeds.error('Something went wrong', 'Could not process that action.')],
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // Button confirmations (e.g. /nuke) are handled inside their own command via
    // collectors, so here we only deal with chat input (slash) commands.
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Received unknown command: /${interaction.commandName}`);
      return;
    }

    // Per-user cooldown (commands may override with `command.cooldown`).
    const cooldownSeconds = command.cooldown ?? config.bot.commandCooldownSeconds;
    const { onCooldown, remaining } = checkCooldown(
      interaction.commandName,
      interaction.user.id,
      cooldownSeconds
    );
    if (onCooldown) {
      return interaction.reply({
        embeds: [
          Embeds.warning('Slow down!', `Try again in **${remaining}s**.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await command.execute(interaction, ctx);
    } catch (err) {
      logger.error(`Error in /${interaction.commandName}:`, err.stack || err.message);
      const payload = {
        embeds: [
          Embeds.error(
            'Something went wrong',
            'An unexpected error occurred while running that command. ' +
              'The team has been notified — please try again shortly.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      };
      // Reply or follow-up depending on whether we already responded.
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
