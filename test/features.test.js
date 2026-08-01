import test from 'node:test';
import assert from 'node:assert/strict';
import { isDirectImageUrl, detectImage } from '../automod/imageFilter.js';
import { parseDuration } from '../utils/duration.js';
import { captureOverwrite } from '../utils/permissionState.js';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= 'test-client';
process.env.ENCRYPTION_KEY ||= '0'.repeat(64);

const { default: stickyCommand } = await import('../commands/sticky.js');
const { Store } = await import('../database/db.js');
const { cancelSticky, postSticky, queueSticky, queueStickyForChannel, stopStickies } = await import('../services/stickies.js');

test('detects direct image URLs but not ordinary links', () => {
  assert.equal(isDirectImageUrl('https://example.com/photo.PNG?x=1'), true);
  assert.equal(isDirectImageUrl('https://example.com/gallery'), false);
  assert.equal(detectImage({ content: 'see https://example.com/a.webp', attachments: new Map(), embeds: [] }).name.includes('webp'), true);
});
test('duration parser rejects partial/invalid strings', () => {
  assert.equal(parseDuration('1h 30m'), 5400);
  assert.equal(parseDuration('tomorrow 1h'), null);
});
test('permission capture preserves allow, deny, and neutral', () => {
  const flags = { has: (bit) => bit === 2048n };
  const channel = { permissionOverwrites: { cache: new Map([['r', { allow: flags, deny: { has: () => false } }]]) } };
  const state = captureOverwrite(channel, 'r');
  assert.equal(state.SendMessages, true);
  assert.equal(state.CreatePublicThreads, null);
});

test('sticky command exposes off while retaining remove', () => {
  const options = stickyCommand.data.toJSON().options;
  const names = options.map((option) => option.name);
  assert.ok(names.includes('off'));
  assert.ok(names.includes('remove'));
  assert.equal(options.find((option) => option.name === 'off').options[0].required, false);
});

test('human messages and explicit bot vouches queue a sticky without bot loops', async () => {
  const originalGetSticky = Store.getSticky;
  const originalSetStickyMessageId = Store.setStickyMessageId;
  let sends = 0;
  const row = { kind: 'text', content: 'Pinned details', message_id: null, delay_seconds: 0.01 };
  const channel = {
    id: 'sticky-test-channel',
    guild: { members: { me: {} } },
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: async () => ({ id: `sticky-${++sends}` }),
  };

  Store.getSticky = () => row;
  Store.setStickyMessageId = () => {};
  try {
    assert.equal(queueSticky({ guildId: 'guild', channelId: channel.id, id: 'human', author: { bot: false }, channel }), true);
    assert.equal(queueSticky({ guildId: 'guild', channelId: channel.id, id: 'ordinary-bot', author: { bot: true }, channel }), false);
    assert.equal(queueStickyForChannel(channel, 'vouch-message'), true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sends, 1);
  } finally {
    stopStickies();
    Store.getSticky = originalGetSticky;
    Store.setStickyMessageId = originalSetStickyMessageId;
  }
});

test('turning a sticky off during a send removes the in-flight orphan', async () => {
  const originalGetSticky = Store.getSticky;
  const originalSetStickyMessageId = Store.setStickyMessageId;
  let finishSend;
  let deleted = 0;
  const row = { kind: 'text', content: 'Pinned details', message_id: null, delay_seconds: 4 };
  const channel = {
    id: 'sticky-race-channel',
    guild: { members: { me: {} } },
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => null },
    send: () => new Promise((resolve) => { finishSend = resolve; }),
  };

  Store.getSticky = () => row;
  Store.setStickyMessageId = () => {};
  try {
    const posting = postSticky(channel, row);
    await new Promise((resolve) => setImmediate(resolve));
    cancelSticky(channel.id);
    finishSend({ id: 'orphan', delete: async () => { deleted += 1; } });
    assert.equal(await posting, null);
    assert.equal(deleted, 1);
  } finally {
    stopStickies();
    Store.getSticky = originalGetSticky;
    Store.setStickyMessageId = originalSetStickyMessageId;
  }
});
