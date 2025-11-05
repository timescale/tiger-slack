import { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import { ServerContext, User, zUser } from '../types.js';

const inputSchema = {
  includeBots: z
    .boolean()
    .describe('If true, will include users that are bots.'),
  includeTimezone: z
    .boolean()
    .describe(
      'If true, includes the time zone for each user. Not needed for most cases.',
    ),
  keyword: z
    .string()
    .min(0)
    .nullable()
    .describe(
      'Keyword to use to find partial matches on users. Will return users whose id (e.g. U0736TW20), name, real_name_normalized, or display_name_normalized contain the given keyword. This is case insensitive.',
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
    description: 'Retrieves all users in the Slack workspace',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    includeBots,
    includeTimezone,
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

    const res = await pgPool.query<User>(
      /* sql */ `
SELECT ${fields.join(', ')}
  FROM slack.user
  WHERE NOT deleted
  ${includeBots ? '' : 'AND NOT is_bot'}  
    AND (
      $1::text IS NULL
      OR id ILIKE $1
      OR real_name_normalized ILIKE $1
      OR display_name_normalized ILIKE $1
      OR real_name ILIKE $1
      OR display_name ILIKE $1
      OR user_name ILIKE $1
    )
`,
      [keyword ? `%${keyword}%` : null],
    );

    return {
      results: res.rows,
    };
  },
  pickResult: (r) => r.results,
});
