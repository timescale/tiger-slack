import { PoolClient } from 'pg';
import { Channel } from '../types.js';

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
    if (channels[row.id]) {
      channels[row.id].name = row.channel_name;
      channels[row.id].topic = row.topic;
      channels[row.id].purpose = row.purpose;
    }
  }
};
