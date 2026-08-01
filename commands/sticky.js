import { SlashCommandBuilder, ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Store } from '../database/db.js';
import { canManage } from '../utils/management.js';
import { cancelSticky, postSticky } from '../services/stickies.js';
import Embeds from '../utils/embeds.js';

const channelOption = (o) => o.setName('channel').setDescription('Sticky channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
export default {
  data: new SlashCommandBuilder().setName('sticky').setDescription('Manage sticky channel messages.').setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Create a text sticky.').addChannelOption(channelOption).addStringOption((o) => o.setName('message').setDescription('Sticky text').setRequired(true).setMaxLength(2000)).addIntegerOption((o) => o.setName('delay').setDescription('Quiet-period delay in seconds').setMinValue(3).setMaxValue(60)))
    .addSubcommand((s) => s.setName('create-embed').setDescription('Create an embed sticky.').addChannelOption(channelOption).addStringOption((o) => o.setName('title').setDescription('Embed title').setRequired(true).setMaxLength(256)).addStringOption((o) => o.setName('description').setDescription('Embed description').setRequired(true).setMaxLength(4000)).addIntegerOption((o) => o.setName('delay').setDescription('Quiet-period delay in seconds').setMinValue(3).setMaxValue(60)))
    .addSubcommand((s) => s.setName('edit').setDescription('Edit a text sticky.').addChannelOption(channelOption).addStringOption((o) => o.setName('message').setDescription('New text').setRequired(true).setMaxLength(2000)))
    .addSubcommand((s) => s.setName('off').setDescription('Turn off the sticky in this or another channel.').addChannelOption((o) => o.setName('channel').setDescription('Sticky channel (defaults to this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a sticky.').addChannelOption(channelOption))
    .addSubcommand((s) => s.setName('view').setDescription('View sticky configuration.').addChannelOption(channelOption))
    .addSubcommand((s) => s.setName('list').setDescription('List this server’s stickies.')),
  async execute(interaction) {
    if (!canManage(interaction, 'sticky_manager')) return interaction.reply({ embeds: [Embeds.error('Permission denied', 'You need Administrator or the configured Sticky Manager role.')], flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = Store.getGuildStickies(interaction.guildId);
      return interaction.reply({ embeds: [Embeds.info('Sticky messages', rows.length ? rows.map((r) => `<#${r.channel_id}> — ${r.kind}, ${r.delay_seconds}s`).join('\n') : 'None configured.')], flags: MessageFlags.Ephemeral });
    }
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type)) return interaction.reply({ embeds: [Embeds.error('Invalid channel', 'Run this in a server text channel or select one with the channel option.')], flags: MessageFlags.Ephemeral });
    if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) return interaction.reply({ embeds: [Embeds.error('Missing permissions', 'I need View Channel, Send Messages, and Manage Messages there.')], flags: MessageFlags.Ephemeral });
    const existing = Store.getSticky(channel.id);
    if (sub === 'view') return interaction.reply({ embeds: [Embeds.info('Sticky configuration', existing ? `Type: **${existing.kind}**\nDelay: **${existing.delay_seconds}s**\nContent: ${existing.content || `${existing.title}\n${existing.description}`}` : 'No sticky is configured.')], flags: MessageFlags.Ephemeral });
    if (sub === 'remove' || sub === 'off') {
      cancelSticky(channel.id);
      Store.removeSticky(channel.id);
      if (existing?.message_id) await channel.messages.delete(existing.message_id).catch(() => {});
      return interaction.reply({ embeds: [Embeds.success('Sticky turned off', existing ? `The sticky in <#${channel.id}> is now off.` : `There was no active sticky in <#${channel.id}>.`)], flags: MessageFlags.Ephemeral });
    }
    const kind = sub === 'create-embed' ? 'embed' : 'text';
    cancelSticky(channel.id);
    Store.saveSticky({ guildId: interaction.guildId, channelId: channel.id, kind, content: interaction.options.getString('message') ?? existing?.content, title: interaction.options.getString('title'), description: interaction.options.getString('description'), messageId: existing?.message_id, delaySeconds: interaction.options.getInteger('delay') ?? existing?.delay_seconds ?? 4, createdBy: interaction.user.id });
    await postSticky(channel);
    return interaction.reply({ embeds: [Embeds.success('Sticky saved', `The sticky in <#${channel.id}> is active.`)], flags: MessageFlags.Ephemeral });
  },
};
