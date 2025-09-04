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
  const res = await pgPool.query<Channel>(
    /* sql */ `
SELECT id, name, topic, purpose
  FROM slack.channel
  WHERE
    (
      id = $1
      OR name = $1
      OR name ILIKE $2
    )`,
    [channelName, `%${channelName}%`],
  );
  return res.rows;
};
