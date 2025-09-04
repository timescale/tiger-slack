import { Pool, PoolClient } from 'pg';
import { User } from '../types.js';

export const getUsersMap = async (
  client: PoolClient | Pool,
  ids: Iterable<string>,
): Promise<Record<string, User>> => {
  const usersResult = await client.query<User>(
    /* sql */ `
SELECT id, name, real_name, display_name, email, is_bot
  FROM slack.user
  WHERE id = ANY($1)
`,
    [Array.from(ids)],
  );
  return usersResult.rows.reduce(
    (acc, user) => {
      acc[user.id] = user;
      return acc;
    },
    {} as Record<string, User>,
  );
};
