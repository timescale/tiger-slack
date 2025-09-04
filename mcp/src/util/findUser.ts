import { Pool } from 'pg';
import { User } from '../types.js';

export const findUser = async (
  pgPool: Pool,
  username: string,
): Promise<User[]> => {
  const res = await pgPool.query<User>(
    /* sql */ `
SELECT id, user_name, real_name, display_name, email
  FROM slack.user
  WHERE
    NOT deleted AND NOT is_bot AND (
      id = $1
      OR user_name = $1
      OR real_name ILIKE $1
      OR real_name_normalized ILIKE $1
      OR display_name ILIKE $1
      OR display_name_normalized ILIKE $1
      OR email = $1
    )`,
    [username],
  );
  return res.rows;
};
