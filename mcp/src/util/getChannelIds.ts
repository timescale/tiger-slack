import type { Pool } from 'pg';
import { findChannel } from './findChannel.js';

export const getChannelIds = async (
  pgPool: Pool,
  channelKeywords: string[] | null,
): Promise<string[] | null> => {
  if (channelKeywords === null) {
    return null;
  }
  let channelIds: string[] | null = channelKeywords ? [] : null;
  if (channelKeywords) {
    const channelObjs = await Promise.all(
      channelKeywords.map((channel) => findChannel(pgPool, channel)),
    );
    channelIds = channelObjs.map((u) => u.id);
  }

  return channelIds;
};
