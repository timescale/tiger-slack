import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import {
  type Message,
  type ServerContext,
  zIncludeFilters,
  zMessage,
  zUser,
} from '../types.js';
import { convertTsToTimestamp } from '../util/formatTs.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';

const inputSchema = {
  ...zIncludeFilters.shape,
  channel: z
    .string()
    .min(1)
    .describe('The ID of the channel to fetch messages from.'),

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
  name: 'get_thread_messages',
  method: 'get',
  route: '/thread-messages',
  config: {
    title: 'Get Messages in Thread',
    description: 'Fetches messages in a specific thread in Slack.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    channel,
    includeFiles,
    includePermalinks,
    ts,
  }): Promise<{
    messages: z.infer<typeof zMessage>[];
    users: Record<string, z.infer<typeof zUser>>;
  }> => {
    const result = await pgPool.query<Message>(
      /* sql */ `
  SELECT ${getMessageFields({ includeFiles })} FROM slack.message
  WHERE channel_id = $1 AND (thread_ts = $2 OR ts = $2)
  ORDER BY ts DESC`, // messagesToTree expects messages in descending order
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
