import { Pool } from 'pg';

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
  const res = await pgPool.query(
    /* sql */ `
SELECT id, name, topic, purpose
  FROM slack.channel
  WHERE
    (
      id = $1
      OR channel_name = $1
      OR channel_name ILIKE $2
    )`,
    [channelName, `%${channelName}%`],
  );
  return res.rows.map((row: any) => ({
    id: row.id,
    name: row.channel_name,
    topic: row.topic,
    purpose: row.purpose,
  }));
};
