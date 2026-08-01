import { PermissionFlagsBits } from 'discord.js';
import { Store } from '../database/db.js';

export function canManage(interaction, key) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = Store.getNamedRoles(interaction.guildId)[key];
  return Boolean(roleId && interaction.member?.roles?.cache?.has(roleId));
}

export function canTargetRole(interaction, role) {
  const guild = interaction.guild;
  const actor = interaction.member;
  const bot = guild.members.me;
  if (!role || role.managed || role.id === bot.roles.highest.id) return false;
  if (role.id !== guild.roles.everyone.id && bot.roles.highest.comparePositionTo(role) <= 0) return false;
  if (interaction.user.id !== guild.ownerId && role.id !== guild.roles.everyone.id && actor.roles.highest.comparePositionTo(role) <= 0) return false;
  return true;
}
