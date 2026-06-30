// automod/decay.js
// Strike decay: drop strike rows untouched for strikeDecayDays. Runs once at
// startup and then daily, via setInterval (no extra dependency).

import { Store } from './db.js';
import config from './config.js';
import logger from '../utils/logger.js';

let timer;

export function startStrikeDecay() {
  const days = config.defaults.strikeDecayDays ?? 30;
  const run = () => {
    try {
      const removed = Store.decayStrikes(days);
      if (removed) logger.info(`[automod] Strike decay: cleared ${removed} stale strike record(s) (>${days}d).`);
    } catch (err) {
      logger.error(`[automod] Strike decay failed: ${err.message}`);
    }
  };
  run();
  timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopStrikeDecay() {
  if (timer) clearInterval(timer);
}

export default { startStrikeDecay, stopStrikeDecay };
