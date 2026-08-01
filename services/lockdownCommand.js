import { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { canManage, canTargetRole } from '../utils/management.js';
import { parseDuration, formatDuration } from '../utils/duration.js';
import { Store } from '../database/db.js';
import { applyLockdown, restoreLockdown } from '../services/lockdowns.js';
import Embeds from '../utils/embeds.js';

const TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
export function command(unlock = false) {
  let data = new SlashCommandBuilder().setName(unlock ? 'unlockdown' : 'lockdown').setDescription(unlock ? 'Restore channel permissions saved by lockdown.' : 'Lock one or more channels.').setDMPermission(false)
    .addRoleOption((o) => o.setName('role').setDescription('Role to restrict/restore').setRequired(true))
    .addStringOption((o) => o.setName('scope').setDescription('Lock selected channels or all supported channels').addChoices({ name: 'Selected channels', value: 'channels' }, { name: 'Server-wide', value: 'server' }))
    .addChannelOption((o) => o.setName('channel-1').setDescription('First channel').addChannelTypes(...TYPES))
    .addChannelOption((o) => o.setName('channel-2').setDescription('Second channel').addChannelTypes(...TYPES))
    .addChannelOption((o) => o.setName('channel-3').setDescription('Third channel').addChannelTypes(...TYPES))
    .addChannelOption((o) => o.setName('channel-4').setDescription('Fourth channel').addChannelTypes(...TYPES))
    .addChannelOption((o) => o.setName('channel-5').setDescription('Fifth channel').addChannelTypes(...TYPES));
  if (!unlock) data = data.addStringOption((o) => o.setName('reason').setDescription('Reason')).addStringOption((o) => o.setName('duration').setDescription('Examples: 10m, 1h, 6h, 1d'));
  return { data, async execute(interaction) {
    if (!canManage(interaction, 'lockdown_manager')) return interaction.reply({ embeds: [Embeds.error('Permission denied', 'You need Administrator or the configured Lockdown Manager role.')], flags: MessageFlags.Ephemeral });
    const role = interaction.options.getRole('role', true);
    if (!canTargetRole(interaction, role)) return interaction.reply({ embeds: [Embeds.error('Invalid role', 'That role is managed, above your authority, or above the bot’s highest role.')], flags: MessageFlags.Ephemeral });
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ embeds: [Embeds.error('Missing permission', 'I need Manage Channels.')], flags: MessageFlags.Ephemeral });
    const scope = interaction.options.getString('scope') ?? 'channels';
    const selected = [1,2,3,4,5].map((n) => interaction.options.getChannel(`channel-${n}`)).filter(Boolean);
    const channels = scope === 'server' ? [...interaction.guild.channels.cache.values()].filter((c) => TYPES.includes(c.type)) : [...new Map(selected.map((c) => [c.id,c])).values()];
    if (!channels.length) return interaction.reply({ embeds: [Embeds.error('No channels', 'Select at least one channel or use server-wide scope.')], flags: MessageFlags.Ephemeral });
    const durationText = !unlock ? interaction.options.getString('duration') : null;
    const seconds = durationText ? parseDuration(durationText) : null;
    if (durationText && (!seconds || seconds < 10 || seconds > 30 * 86400)) return interaction.reply({ embeds: [Embeds.error('Invalid duration', 'Use a duration from 10 seconds through 30 days, such as `10m`, `1h`, or `1d`.')], flags: MessageFlags.Ephemeral });
    const reason = !unlock ? interaction.options.getString('reason') : null;
    const changed = [], failed = [];
    for (const channel of channels) {
      try {
        if (!channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageChannels)) throw new Error('missing Manage Channels');
        if (unlock) { const row = Store.getLockdown(channel.id, role.id); if (!row) throw new Error('no saved lockdown'); await restoreLockdown(channel, role, row); }
        else await applyLockdown(channel, role, { guildId: interaction.guildId, moderatorId: interaction.user.id, reason, unlockAt: seconds ? Math.floor(Date.now()/1000)+seconds : null });
        changed.push(channel);
      } catch (err) { failed.push(`<#${channel.id}> (${err.message})`); }
    }
    const description = `${unlock ? 'Unlocked' : 'Locked'}: ${changed.map((c) => `<#${c.id}>`).join(', ') || 'none'}\nRole: <@&${role.id}>\nModerator: <@${interaction.user.id}>\nReason: ${reason || 'Not provided'}\nDuration: ${seconds ? formatDuration(seconds) : 'Until manually unlocked'}${failed.length ? `\nFailed: ${failed.join(', ')}` : ''}`;
    return interaction.reply({ embeds: [changed.length ? Embeds.success(unlock ? 'Lockdown removed' : 'Lockdown enabled', description) : Embeds.error('No changes made', description)], allowedMentions: { parse: [] } });
  }};
}
