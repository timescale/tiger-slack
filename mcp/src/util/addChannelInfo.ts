import type { PoolClient } from 'pg';
import type { Channel } from '../types.js';

/**
 * Adds channel information to the provided channels map.
 * Mutates the passed object directly.
 * @param client The database client to use for querying
 * @param channels The map of channels to update with additional information
 */
export const addChannelInfo = async (
  client: PoolClient,
  channels: Record<string, Channel>,
): Promise<void> => {
  const channelsResult = await client.query(
    /* sql */ `
SELECT id, channel_name, topic, purpose
  FROM slack.channel
  WHERE id = ANY($1)`,
    [Object.keys(channels)],
  );
  for (const row of channelsResult.rows) {
    const channel = channels[row.id];
    if (!channel) continue;
    channel.name = row.channel_name;
    channel.topic = row.topic;
    channel.purpose = row.purpose;
  }
};
