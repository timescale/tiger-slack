import type { Pool } from 'pg';
import type { User } from '../types.js';

export const findUser = async (
  pgPool: Pool,
  username: string,
  includeBots = true,
): Promise<User> => {
  const res = await pgPool.query<User>(
    /* sql */ `
SELECT id, user_name, real_name, display_name, email
  FROM slack.user
  WHERE
    NOT deleted ${!includeBots ? 'AND NOT is_bot' : ''} AND (
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

  const users = res.rows;

  if (users.length === 0) {
    throw new Error(`No user found matching "${username}"`);
  }
  let [targetUser] = users;
  if (users.length > 1) {
    const exact = users.find((c) => c.user_name === username);
    if (!exact) {
      throw new Error(
        `Multiple users found matching "${username}": ${users.map((u) => u.user_name).join(', ')}`,
      );
    }

    targetUser = exact;
  }

  if (!targetUser?.id) {
    throw new Error(`No user id found matching "${username}"`);
  }

  return targetUser;
};
