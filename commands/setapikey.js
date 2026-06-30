// commands/setapikey.js
// Securely store a guild's SellAuth API key (encrypted at rest). Admin only.
// The key is accepted via an ephemeral command and never echoed back.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { maskSecret } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setapikey')
    .setDescription('Set this server\'s SellAuth API key (stored encrypted).')
    .addStringOption((o) =>
      o.setName('key').setDescription('Your SellAuth API key').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('shop_id').setDescription('Your SellAuth Shop ID (optional)').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const key = interaction.options.getString('key', true).trim();
    const shopId = interaction.options.getString('shop_id')?.trim();

    if (key.length < 10) {
      return interaction.reply({
        embeds: [Embeds.error('Invalid key', 'That API key looks too short to be valid.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    Store.setApiKey(interaction.guildId, key);
    if (shopId) Store.setShopId(interaction.guildId, shopId);

    // Audit without leaking the secret — only the mask is recorded.
    await audit(
      interaction,
      'API Key Updated',
      `SellAuth API key set (\`${maskSecret(key)}\`)${shopId ? `, shop \`${shopId}\`` : ''}.`
    );

    return interaction.reply({
      embeds: [
        Embeds.success(
          'API key saved',
          `Your SellAuth API key has been encrypted and stored.\n` +
            `Stored value: \`${maskSecret(key)}\`${shopId ? `\nShop ID: \`${shopId}\`` : ''}\n\n` +
            `Run \`/testconnection\` to verify it works.`
        ),
      ],
      flags: MessageFlags.Ephemeral, // never visible to others
    });
  },
};
