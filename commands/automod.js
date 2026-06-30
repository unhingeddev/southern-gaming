// commands/automod.js  (auto-mod system)
// /automod toggle <module> [enabled]  — enable/disable a module
// /automod status                      — show module states + test mode
// /automod logchannel <channel>        — set the auto-mod log channel
// Gated to Owner / Co-Owner / Staff (or admins) via automod/permissions.js.

import { SlashCommandBuilder, MessageFlags, ChannelType, PermissionFlagsBits } from 'discord.js';
import { Store } from '../automod/db.js';
import config from '../automod/config.js';
import { canModerate } from '../automod/permissions.js';
import { TOGGLEABLE } from '../automod/automod.js';
import Embeds from '../utils/embeds.js';

const LABELS = {
  wordFilter: 'Word / slur filter',
  solicitation: 'Solicitation / suggestive filter',
  inviteFilter: 'Invite-link filter',
  linkFilter: 'Link / scam / NSFW filter',
  antiMention: 'Anti mention-spam',
  antiCaps: 'Anti-caps',
  zalgo: 'Zalgo / obfuscation filter',
  duplicate: 'Duplicate-message filter',
  antiSpam: 'Anti-spam (flood)',
  antiRaid: 'Anti-raid',
  accountAge: 'Account-age gate',
  advisory: 'Advisory nudges (no punishment)',
};

const MODULE_CHOICES = TOGGLEABLE.map((m) => ({ name: LABELS[m] ?? m, value: m }));

function denied(interaction) {
  return interaction.reply({
    embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
    flags: MessageFlags.Ephemeral,
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure the auto-moderation system.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable or disable a module.')
        .addStringOption((o) => o.setName('module').setDescription('Which module').setRequired(true).addChoices(...MODULE_CHOICES))
        .addBooleanOption((o) => o.setName('enabled').setDescription('On/off — omit to flip current state'))
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show which modules are on/off.'))
    .addSubcommand((s) =>
      s
        .setName('logchannel')
        .setDescription('Set the channel auto-mod actions are logged to.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Log channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),

  async execute(interaction) {
    if (!canModerate(interaction)) return denied(interaction);
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'status') {
      const lines = TOGGLEABLE.map((m) => {
        const on = Store.isModuleEnabled(guildId, m, config.defaults.modules[m]);
        return `${on ? '🟢' : '🔴'} **${LABELS[m] ?? m}** — ${on ? 'enabled' : 'disabled'}`;
      }).join('\n');
      const embed = Embeds.info('🛡️ Auto-Mod status', lines);
      if (Store.getTestMode(guildId)) {
        embed.addFields({ name: '🧪 Test mode', value: '**ON** — violations are deleted + the user is DM\'d, but no strikes/bans. Disable with `/testing enabled:False`.' });
      }
      const logCh = Store.getLogChannel(guildId) || config.bot.defaultLogChannelId;
      embed.addFields({ name: 'Log channel', value: logCh ? `<#${logCh}>` : '_not set_' });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'logchannel') {
      const channel = interaction.options.getChannel('channel', true);
      const me = interaction.guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
        return interaction.reply({
          embeds: [Embeds.error('Cannot use that channel', `I need **View Channel** and **Send Messages** in <#${channel.id}>.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      Store.setLogChannel(guildId, channel.id);
      await channel.send({ embeds: [Embeds.success('Auto-mod log channel set', 'Auto-moderation actions will be logged here.')] }).catch(() => {});
      return interaction.reply({
        embeds: [Embeds.success('Log channel updated', `Auto-mod logs will now go to <#${channel.id}>.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // toggle
    const module = interaction.options.getString('module', true);
    const current = Store.isModuleEnabled(guildId, module, config.defaults.modules[module]);
    const next = interaction.options.getBoolean('enabled') ?? !current;
    Store.setModule(guildId, module, next);
    return interaction.reply({
      embeds: [Embeds.success('Module updated', `**${LABELS[module] ?? module}** is now **${next ? 'enabled 🟢' : 'disabled 🔴'}**.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
