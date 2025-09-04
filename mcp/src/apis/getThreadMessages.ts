import { z } from 'zod';
import { type Message, ServerContext, zMessage, zUser } from '../types.js';
import { ApiFactory } from '../shared/boilerplate/src/types.js';
import { convertTsToTimestamp } from '../util/formatTs.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { getUsersMap } from '../util/getUsersMap.js';

const inputSchema = {
  channel: z
    .string()
    .min(1)
    .describe('The ID of the channel to fetch messages from.'),
  includePermalinks: z
    .boolean()
    .describe(
      'An optional parameter to determine whether or not permalinks should be added to every message. This adds to token cost and should not be used unless explicitly requested.',
    ),
  ts: z
    .string()
    .min(1)
    .describe(
      'The thread timestamp to fetch messages for. This is the ts of the parent message. Use the `thread_ts` field from a known message in the thread.',
    ),
} as const;

const outputSchema = {
  messages: z.array(zMessage),
  users: z
    .record(z.string(), zUser)
    .describe(
      'A mapping of user IDs to user details for all users involved in the conversations.',
    ),
} as const;

export const getThreadMessagesFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ pgPool }) => ({
  name: 'getThreadMessages',
  method: 'get',
  route: '/thread-messages',
  config: {
    title: 'Get Messages in Thread',
    description: 'Fetches messages in a specific thread in Slack.',
    inputSchema,
    outputSchema,
  },
  fn: async ({ channel, includePermalinks, ts }) => {
    const result = await pgPool.query<Message>(
      /* sql */ `
SELECT ts::text, channel, text, m.user, thread_ts::text FROM slack.message m
  WHERE m.channel = $1 AND (m.thread_ts = $2 OR m.ts = $2)
  ORDER BY m.ts ASC`,
      [channel, convertTsToTimestamp(ts)],
    );

    const { involvedUsers, channels } = messagesToTree(
      result.rows,
      includePermalinks || false,
    );
    const users = await getUsersMap(pgPool, involvedUsers);
    const messages = channels[channel]?.messages || [];

    return {
      messages,
      users,
    };
  },
});
