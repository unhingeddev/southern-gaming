import test from 'node:test';
import assert from 'node:assert/strict';
import { isDirectImageUrl, detectImage } from '../automod/imageFilter.js';
import { parseDuration } from '../utils/duration.js';
import { captureOverwrite } from '../utils/permissionState.js';

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
