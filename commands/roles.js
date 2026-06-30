// commands/roles.js
// Manage this server's named roles (owner / co-owner / staff / buyers / members)
// and the auto-role list (roles automatically given to members when they join).
// Admin only.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';

const ROLE_TYPES = [
  { name: 'Owner', value: 'owner' },
  { name: 'Co-owner', value: 'coowner' },
  { name: 'Staff', value: 'staff' },
  { name: 'Buyers', value: 'buyers' },
  { name: 'Members', value: 'members' },
];

const LABELS = { owner: 'Owner', coowner: 'Co-owner', staff: 'Staff', buyers: 'Buyers', members: 'Members' };

export default {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Configure named roles and the auto-role system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Assign a role to a named slot.')
        .addStringOption((o) =>
          o.setName('type').setDescription('Which named role').setRequired(true).addChoices(...ROLE_TYPES)
        )
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
    )
    .addSubcommand((s) => s.setName('view').setDescription('Show configured roles and auto-roles.'))
    .addSubcommandGroup((g) =>
      g
        .setName('auto')
        .setDescription('Manage roles auto-assigned when members join.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Auto-assign this role to new members.')
            .addRoleOption((o) => o.setName('role').setDescription('Role to auto-assign').setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Stop auto-assigning this role.')
            .addRoleOption((o) => o.setName('role').setDescription('Role to stop auto-assigning').setRequired(true))
        )
        .addSubcommand((s) => s.setName('list').setDescription('List auto-assigned roles.'))
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ── /roles auto add|remove|list ──────────────────────────────────────────
    if (group === 'auto') {
      if (sub === 'list') {
        const ids = Store.getAutoroles(interaction.guildId);
        return interaction.reply({
          embeds: [
            Embeds.info(
              'Auto-roles',
              ids.length ? ids.map((id) => `• <@&${id}>`).join('\n') : '_No auto-roles set._'
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const role = interaction.options.getRole('role', true);

      if (sub === 'add') {
        // Warn if the bot can't actually assign it (role hierarchy).
        const me = interaction.guild.members.me;
        if (role.position >= me.roles.highest.position) {
          return interaction.reply({
            embeds: [
              Embeds.warning(
                'Heads up: role too high',
                `I can save it, but I **won't be able to assign <@&${role.id}>** until my role is ` +
                  `moved above it in Server Settings → Roles.`
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
        Store.addAutorole(interaction.guildId, role.id);
        await audit(interaction, 'Auto-role Added', `<@&${role.id}> will be given to new members.`);
        return interaction.reply({
          embeds: [Embeds.success('Auto-role added', `New members will now receive <@&${role.id}>.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      // remove
      const removed = Store.removeAutorole(interaction.guildId, role.id);
      return interaction.reply({
        embeds: [
          removed
            ? Embeds.success('Auto-role removed', `<@&${role.id}> will no longer be auto-assigned.`)
            : Embeds.warning('Not set', `<@&${role.id}> was not in the auto-role list.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /roles set ────────────────────────────────────────────────────────────
    if (sub === 'set') {
      const type = interaction.options.getString('type', true);
      const role = interaction.options.getRole('role', true);
      Store.setNamedRole(interaction.guildId, type, role.id);
      await audit(interaction, 'Named Role Set', `**${LABELS[type]}** → <@&${role.id}>.`);
      return interaction.reply({
        embeds: [Embeds.success('Role set', `**${LABELS[type]}** is now <@&${role.id}>.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /roles view ─────────────────────────────────────────────────────────
    const named = Store.getNamedRoles(interaction.guildId);
    const autoIds = Store.getAutoroles(interaction.guildId);
    const namedLines = ROLE_TYPES.map(
      (t) => `**${t.name}:** ${named[t.value] ? `<@&${named[t.value]}>` : '_not set_'}`
    ).join('\n');

    return interaction.reply({
      embeds: [
        Embeds.info('Server roles', namedLines).addFields({
          name: 'Auto-assigned on join',
          value: autoIds.length ? autoIds.map((id) => `<@&${id}>`).join(', ') : '_none_',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
