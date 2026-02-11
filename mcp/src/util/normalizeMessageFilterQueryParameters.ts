import type { Pool } from 'pg';
import type { MessageFilter } from '../types.js';
import { convertTsToTimestamp } from './formatTs.js';
import { getChannelIds } from './getChannelIds.js';

export const normalizeMessageFilterQueryParameters = async (
  pgPool: Pool,
  messageFilters: MessageFilter[],
): Promise<MessageFilter[]> => {
  const channelIds = await getChannelIds(
    pgPool,
    messageFilters.map((x) => x.channel),
  );

  if (channelIds === null || channelIds.length === 0) {
    throw new Error('You must pass at least one existing channel id');
  }

  const normalized = messageFilters.reduce<MessageFilter[]>(
    (acc, curr, index) => {
      acc.push({
        channel: channelIds[index] || '',
        ts: convertTsToTimestamp(curr.ts),
      });
      return acc;
    },
    [],
  );

  return normalized;
};
