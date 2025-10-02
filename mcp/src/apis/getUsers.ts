import { z } from 'zod';
import { ServerContext, User, zUser } from '../types.js';
import { ApiFactory } from '../shared/boilerplate/src/types.js';

const inputSchema = {
  includeTimezone: z
    .boolean()
    .default(true)
    .describe(
      'If true, includes the timezones for each user. Defaults to true.',
    ),
  user_id: z
    .string()
    .optional()
    .describe('The Slack user id (e.g. U0736TW20) of a single user to retrieve.'),
  email: z
    .string()
    .optional()
    .describe('The email address of a single user to retrieve.'),
  keyword: z
    .string()
    .min(0)
    .optional()
    .describe(
      'Keyword used to find users where user_name, real_name_normalized, or display_name_normalized contain the given keyword. This is case insensitive.',
    ),
} as const;

const outputSchema = {
  results: z.array(zUser),
} as const;

export const getUsersFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema,
  z.infer<(typeof outputSchema)['results']>
> = ({ pgPool }) => ({
  name: 'get_users',
  method: 'get',
  route: '/users',
  config: {
    title: 'Get users',
    description:
      'Retrieves one or more users in the Slack workspace',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    includeTimezone,
    user_id,
    email,
    keyword,
  }): Promise<{ results: z.infer<typeof zUser>[] }> => {
    const fields = [
      'id',
      'user_name',
      'real_name',
      'display_name',
      'email',
      ...(includeTimezone ? ['tz'] : []),
    ];

    const args: string[] = []
    
    let query = `
    SELECT ${fields.join(', ')}
    FROM slack.user 
    WHERE NOT deleted 
    AND NOT is_bot
    `
    
    if (user_id) {
      query += `
      AND id = $1
      `
      args.push(user_id)
    } else if (email) {
      query += `
      AND email = $1
      `
      args.push(email)
    } else if (keyword) {
      query += `
      AND (
           display_name_normalized ilike $1
        OR real_name_normalized ilike $1
        OR user_name ilike $1
      )
      `
      args.push(`%${keyword}%`)
    }
    
    const res = await pgPool.query<User>(query, args);

    return {
      results: res.rows,
    };
  },
  pickResult: (r) => r.results,
});
