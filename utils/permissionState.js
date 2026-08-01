import { PermissionFlagsBits } from 'discord.js';

const KEYS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];

export function captureOverwrite(channel, roleId) {
  const overwrite = channel.permissionOverwrites.cache.get(roleId);
  return Object.fromEntries(KEYS.map((key) => [key, overwrite ? (overwrite.allow.has(PermissionFlagsBits[key]) ? true : overwrite.deny.has(PermissionFlagsBits[key]) ? false : null) : null]));
}

export { KEYS as LOCKDOWN_PERMISSION_KEYS };
