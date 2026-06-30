// services/giveawaySweeper.js
// Periodic sweeper that ends giveaways whose end_at has passed. Mirrors the ticket
// sweeper: using a stored end_at timestamp + a sweeper (instead of setTimeout)
// means pending giveaways finish correctly even after a bot restart.

import { Store } from '../database/db.js';
import { endGiveaway } from './giveaways.js';
import logger from '../utils/logger.js';

const SWEEP_MS = 15 * 1000; // check every 15s so giveaways end promptly

let timer = null;
let running = false;

const nowSec = () => Math.floor(Date.now() / 1000);

/** One sweep across all running giveaways. */
async function sweepOnce(client) {
  if (running) return;
  running = true;
  try {
    const now = nowSec();
    for (const g of Store.getActiveGiveaways()) {
      if (now < g.end_at) continue;
      try {
        await endGiveaway(client, g.id);
      } catch (err) {
        logger.warn(`Giveaway sweep error for #${g.id}: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startGiveawaySweeper(client) {
  if (timer) return;
  timer = setInterval(() => sweepOnce(client), SWEEP_MS);
  timer.unref?.();
  logger.info('Giveaway sweeper started (15s).');
}

export function stopGiveawaySweeper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Giveaway sweeper stopped.');
  }
}
