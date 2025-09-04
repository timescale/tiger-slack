import { z } from 'zod';
import { ServerContext, zChannel } from '../types.js';
import { ApiFactory } from '../shared/boilerplate/src/types.js';

const inputSchema = {
  keyword: z
    .string()
    .min(0)
    .nullable()
    .describe(
      'Keyword to use to find partial matches on channels. Will return channels whose id (e.g. C0930RJ40Q0) or name (e.g. #team-tootsie-roll) contain the given keyword. This is case insensitive.',
    ),
} as const;

const { messages, ...common } = zChannel.shape;
const zChannelWithoutMessages = z.object(common);
const outputSchema = {
  results: z.array(zChannelWithoutMessages),
} as const;

export const getChannelsFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema,
  z.infer<(typeof outputSchema)['results']>
> = ({ pgPool }) => ({
  name: 'getChannels',
  method: 'get',
  route: '/channels',
  config: {
    title: 'Get channels',
    description: 'Retrieves all channels within the Slack workspace',
    inputSchema,
    outputSchema,
  },
  fn: async ({ keyword }) => {
    const res = await pgPool.query(
      /* sql */ `
SELECT id, name, topic, purpose
  FROM slack.channel
  WHERE NOT is_archived
  AND (
    $1::text IS NULL OR
    id ILIKE $1 OR
    name ILIKE $1
  )
`,
      [keyword ? `%${keyword}%` : null],
    );

    return {
      results: res.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        topic: row.topic,
        purpose: row.purpose,
      })),
    };
  },
  pickResult: (r) => r.results,
});
