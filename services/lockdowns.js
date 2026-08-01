import { Store } from '../database/db.js';
import logger from '../utils/logger.js';
import { captureOverwrite, LOCKDOWN_PERMISSION_KEYS as KEYS } from '../utils/permissionState.js';

let timer;
export async function applyLockdown(channel, role, data) {
  if (!Store.getLockdown(channel.id, role.id)) Store.saveLockdown({ ...data, channelId: channel.id, roleId: role.id, previous: captureOverwrite(channel, role.id) });
  await channel.permissionOverwrites.edit(role, Object.fromEntries(KEYS.map((k) => [k, false])), { reason: data.reason || 'Channel lockdown' });
}

export async function restoreLockdown(channel, role, row) {
  const previous = JSON.parse(row.previous_json);
  await channel.permissionOverwrites.edit(role, previous, { reason: 'Lockdown ended' });
  Store.removeLockdown(channel.id, role.id);
}

async function sweep(client) {
  const now = Math.floor(Date.now() / 1000);
  for (const row of Store.getActiveLockdowns().filter((r) => r.unlock_at && r.unlock_at <= now)) {
    try {
      const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id);
      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
      const role = guild.roles.cache.get(row.role_id) || await guild.roles.fetch(row.role_id).catch(() => null);
      if (channel && role) await restoreLockdown(channel, role, row); else Store.removeLockdown(row.channel_id, row.role_id);
    } catch (err) { logger.warn(`Timed unlock failed for ${row.channel_id}: ${err.message}`); }
  }
}
export function startLockdownSweeper(client) { void sweep(client); timer = setInterval(() => void sweep(client), 15000); }
export function stopLockdownSweeper() { clearInterval(timer); timer = null; }
