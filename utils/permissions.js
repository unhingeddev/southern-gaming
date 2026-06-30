// utils/permissions.js
// Role-based access checks that go beyond Discord's built-in permission flags.
// Used for commands that should be usable by specific named roles (e.g. the
// Owner / Co-owner roles managing ticket setup) regardless of whether those
// roles carry the Administrator permission.

import { PermissionFlagsBits } from 'discord.js';
import { Store } from '../database/db.js';

/**
 * May this member manage the ticket system (config + panels)?
 * Allowed: server Administrators, plus the configured Owner / Co-owner roles.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
export function canManageTickets(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  const roles = Store.getNamedRoles(interaction.guildId);
  const allowed = [roles.owner, roles.coowner].filter(Boolean);
  const memberRoles = interaction.member?.roles?.cache;
  return allowed.some((id) => memberRoles?.has(id));
}
