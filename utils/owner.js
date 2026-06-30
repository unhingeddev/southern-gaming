// utils/owner.js
// Determines whether a user is the bot's owner (or a member of its owning team).
// Used to gate bot-wide commands like /statusadd, since presence is global and
// not something a single server's admin should control for every other server.

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function isBotOwner(interaction) {
  const app = interaction.client.application;
  if (!app) return false;
  // Ensure owner data is populated (cached after first fetch).
  if (!app.owner) await app.fetch().catch(() => {});

  const owner = app.owner;
  if (!owner) return false;

  // Team app: owner is a Team with a members collection.
  if (owner.members) return owner.members.has(interaction.user.id);
  // Single-developer app: owner is a User.
  return owner.id === interaction.user.id;
}
