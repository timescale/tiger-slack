import type { Pool } from 'pg';

export interface Channel {
  id: string;
  name: string;
  topic?: string;
  purpose?: string;
}

export const findChannel = async (
  pgPool: Pool,
  channelName: string,
): Promise<Channel[]> => {
  const res = await pgPool.query<{
    id: string;
    channel_name: string;
    topic?: string;
    purpose?: string;
  }>(
    /* sql */ `
SELECT id, channel_name, topic, purpose
  FROM slack.channel
  WHERE
    (
      id = $1
      OR channel_name = $1
      OR channel_name ILIKE $2
    )`,
    [channelName, `%${channelName}%`],
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.channel_name,
    topic: row.topic,
    purpose: row.purpose,
  }));
};
