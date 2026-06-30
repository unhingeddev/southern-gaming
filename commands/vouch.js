// commands/vouch.js
// Let a customer submit a vouch/review. Builds the rich "Customer Vouch" card and
// posts it to the configured vouch channel (falling back to the current channel).
// Anyone can use it; a cooldown guards against spam.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import logger from '../utils/logger.js';

export default {
  // A longer cooldown since this posts publicly.
  cooldown: 30,

  data: new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Leave a vouch/review for your purchase.')
    .addStringOption((o) =>
      o.setName('product').setDescription('What did you purchase?').setRequired(true).setMaxLength(256)
    )
    .addIntegerOption((o) =>
      o
        .setName('rating')
        .setDescription('Your rating out of 5')
        .setRequired(true)
        .addChoices(
          { name: '⭐ 1', value: 1 },
          { name: '⭐⭐ 2', value: 2 },
          { name: '⭐⭐⭐ 3', value: 3 },
          { name: '⭐⭐⭐⭐ 4', value: 4 },
          { name: '⭐⭐⭐⭐⭐ 5', value: 5 }
        )
    )
    .addStringOption((o) =>
      o.setName('review').setDescription('Your review').setRequired(true).setMaxLength(1000)
    )
    .addAttachmentOption((o) =>
      o.setName('image').setDescription('Optional screenshot/proof image')
    )
    .setDMPermission(false),

  async execute(interaction) {
    const product = interaction.options.getString('product', true).trim();
    const rating = interaction.options.getInteger('rating', true);
    const review = interaction.options.getString('review', true).replaceAll('\\n', '\n').trim();
    const image = interaction.options.getAttachment('image');

    // Only accept actual images as the attachment.
    let imageUrl;
    if (image) {
      if (image.contentType?.startsWith('image/')) {
        imageUrl = image.url;
      } else {
        return interaction.reply({
          embeds: [Embeds.error('Invalid image', 'The attachment must be an image file.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Resolve the target channel: configured vouch channel, else current channel.
    const settings = Store.getGuild(interaction.guildId);
    let channel = interaction.channel;
    if (settings?.vouch_channel_id) {
      const configured = await interaction.client.channels
        .fetch(settings.vouch_channel_id)
        .catch(() => null);
      if (configured?.isTextBased?.()) channel = configured;
    }

    const embed = Embeds.vouch({
      productName: product,
      message: review,
      rating,
      vouchBy: `<@${interaction.user.id}>`,
      authorName: interaction.member?.displayName ?? interaction.user.username,
      authorIconUrl: interaction.user.displayAvatarURL(),
      createdAt: Date.now(),
      imageUrl,
    });

    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error(`Failed to post /vouch to ${channel?.id}: ${err.message}`);
      return interaction.reply({
        embeds: [
          Embeds.error(
            'Could not post vouch',
            'I could not post in the vouch channel. An admin should check my permissions there.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    logger.info(`Vouch submitted by ${interaction.user.tag} for "${product}" (${rating}★).`);
    return interaction.reply({
      embeds: [
        Embeds.success('Thanks for your vouch!', `Your review was posted in <#${channel.id}>. 💚`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
