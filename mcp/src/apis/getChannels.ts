import { z } from 'zod';
import { ServerContext, zChannel } from '../types.js';
import { ApiFactory } from '../shared/boilerplate/src/types.js';

const inputSchema = {
  id: z
    .string()
    .optional()
    .describe('The Slack channel id (e.g. C123ABC456) of a single channel to retrieve.'),
  keyword: z
    .string()
    .min(0)
    .optional()
    .describe(
      'Keyword used to find channels where the name (e.g. #team-tootsie-roll) contains the given keyword. This is case insensitive.',
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
    description: 'Retrieves one or more channels within the Slack workspace',
    inputSchema,
    outputSchema,
  },
  fn: async ({ id, keyword }): Promise<{ results: z.infer<typeof zChannelWithoutMessages>[] }> => {
    const args: string[] = []

    let query = `
    SELECT id, channel_name, topic, purpose
    FROM slack.channel
    WHERE NOT is_archived
    `
    
    if (id) {
      query += `
      AND id = $1
      `
      args.push(id)
    } else if (keyword) {
      query += `
      AND channel_name ilike $1
      `
      args.push(`%${keyword}%`)
    }
    
    const res = await pgPool.query(query, args);

    return {
      results: res.rows.map((row: any) => ({
        id: row.id,
        name: row.channel_name,
        topic: row.topic,
        purpose: row.purpose,
      })),
    };
  },
  pickResult: (r) => r.results,
});
