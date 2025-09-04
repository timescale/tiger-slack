import { z } from 'zod';
import { ServerContext, User, zUser } from '../types.js';
import { ApiFactory } from '../shared/boilerplate/src/types.js';

const inputSchema = {
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
  name: 'getUsers',
  method: 'get',
  route: '/users',
  config: {
    title: 'Get users',
    description:
      'Retrieves all users within the configured GitHub organization',
    inputSchema,
    outputSchema,
  },
  fn: async ({ keyword }) => {
    const res = await pgPool.query<User>(
      /* sql */ `
SELECT id, name, real_name, display_name, email 
  FROM slack.user 
  WHERE NOT deleted 
    AND NOT is_bot
    AND (
      $1::text IS NULL
      OR id ILIKE $1
      OR real_name_normalized ILIKE $1
      OR display_name_normalized ILIKE $1
      OR real_name ILIKE $1
      OR display_name ILIKE $1
      OR name ILIKE $1
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
