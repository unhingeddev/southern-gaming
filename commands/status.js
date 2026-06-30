// commands/status.js
// Show the bot's current configuration and health for this server. Admin only,
// since it reveals which channels/automation are configured.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, version as djsVersion } from 'discord.js';
import { Store } from '../database/db.js';
import { clientForGuild } from '../services/sellauth.js';
import Embeds from '../utils/embeds.js';
import { COLORS } from '../utils/embeds.js';

const yn = (v) => (v ? '🟢 Enabled' : '🔴 Disabled');
const ch = (id) => (id ? `<#${id}>` : '_not set_');

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the bot configuration and connection status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const s = Store.getGuild(interaction.guildId);

    // Probe SellAuth without throwing.
    const sa = clientForGuild(Store, interaction.guildId);
    let apiState = '🔴 No API key set';
    if (sa) {
      const r = await sa.testConnection();
      apiState = r.ok ? '🟢 Connected' : `🟠 Error: ${r.message}`;
    }

    const uptime = formatUptime(interaction.client.uptime);

    const embed = Embeds.info('📊 Bot Status', null)
      .setColor(COLORS.brand)
      .addFields(
        { name: 'SellAuth API', value: apiState, inline: false },
        { name: 'Shop ID', value: s?.shop_id ? `\`${s.shop_id}\`` : '_not set_', inline: true },
        { name: 'Vouch channel', value: ch(s?.vouch_channel_id), inline: true },
        { name: 'Purchase channel', value: ch(s?.purchase_channel_id), inline: true },
        { name: 'Log channel', value: ch(s?.log_channel_id), inline: true },
        { name: 'Vouch automation', value: yn(s?.vouches_enabled), inline: true },
        { name: 'Purchase automation', value: yn(s?.purchases_enabled), inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Ping', value: `${Math.round(interaction.client.ws.ping)}ms`, inline: true },
        { name: 'discord.js', value: `v${djsVersion}`, inline: true }
      );

    return interaction.editReply({ embeds: [embed] });
  },
};

function formatUptime(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
