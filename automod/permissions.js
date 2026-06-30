// automod/permissions.js
// Role-based access control for the auto-mod slash commands, and the auto-mod
// immunity check. A member may use the commands if they are an Administrator,
// hold Manage Server, have a role NAMED in config.gate.roleNames, or have a role
// whose ID is in config.gate.roleIds (both editable in automod/config.json).

import { PermissionFlagsBits } from 'discord.js';
import config from './config.js';

const gate = config.defaults.gate ?? { roleNames: [], roleIds: [] };
const NAME_SET = new Set((gate.roleNames ?? []).map((n) => n.toLowerCase()));
const ID_SET = new Set(gate.roleIds ?? []);

/** May this member use the auto-mod commands? */
export function canModerate(interaction) {
  const perms = interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.Administrator)) return true;
  if (perms?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles?.cache;
  if (!roles) return false;
  return roles.some((role) => ID_SET.has(role.id) || NAME_SET.has(role.name.toLowerCase()));
}

/** Should this member be EXEMPT from auto-moderation (staff/admins/owner)? */
export function isImmune(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  const perms = member.permissions;
  if (perms?.has(PermissionFlagsBits.Administrator)) return true;
  if (perms?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (perms?.has(PermissionFlagsBits.ManageMessages)) return true;
  const roles = member.roles?.cache;
  if (roles?.some((role) => ID_SET.has(role.id) || NAME_SET.has(role.name.toLowerCase()))) return true;
  return false;
}

export { PermissionFlagsBits };
