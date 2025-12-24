import type { ApiFactory, InferSchema } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import { type ServerContext, zChannel } from '../types.js';

const inputSchema = {
  keyword: z
    .string()
    .min(0)
    .nullable()
    .describe(
      'Keyword to use to find partial matches on channels. Will return channels whose id (e.g. C0930RJ40Q0) or name (e.g. #team-tootsie-roll) contain the given keyword. This is case insensitive.',
    ),
} as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  name: 'get_channels',
  method: 'get',
  route: '/channels',
  config: {
    title: 'Get channels',
    description: 'Retrieves all channels within the Slack workspace',
    inputSchema,
    outputSchema,
  },
  fn: async ({ keyword }): Promise<InferSchema<typeof outputSchema>> => {
    const res = await pgPool.query<{
      id: string;
      channel_name: string;
      topic?: string;
      purpose?: string;
    }>(
      /* sql */ `
SELECT id, channel_name, topic, purpose
  FROM slack.channel
  WHERE NOT is_archived
  AND (
    $1::text IS NULL OR
    id ILIKE $1 OR
    channel_name ILIKE $1
  )
`,
      [keyword ? `%${keyword}%` : null],
    );

    return {
      results: res.rows.map((row) => ({
        id: row.id,
        name: row.channel_name,
        topic: row.topic,
        purpose: row.purpose,
      })),
    };
  },
  pickResult: (r) => r.results,
});
