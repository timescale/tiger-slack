import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import {
  type Message,
  type ServerContext,
  type zChannel,
  zConversationsResults,
  type zUser,
} from '../types.js';
import { addChannelInfo } from '../util/addChannelInfo.js';
import { convertTsToTimestamp } from '../util/formatTs.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { selectExpandedMessages } from '../util/selectExpandedMessages.js';

const inputSchema = {
  ts: z
    .string()
    .describe(
      'The timestamp of the target Slack message to fetch context for.',
    ),
  channel: z
    .string()
    .describe('The ID of the channel the message was posted in.'),
  includeFiles: z
    .boolean()
    .describe(
      'Specifies if file attachment metadata should be included. It is recommended to enable as it provides extra context for the thread.',
    ),
  limit: z.coerce
    .number()
    .min(1)
    .nullable()
    .describe('The maximum number of messages to return. Defaults to 1000.'),
  window: z.coerce
    .number()
    .min(0)
    .nullable()
    .describe(
      'The window of context around the target messages to include. Defaults to 5.',
    ),
} as const;

const outputSchema = { ...zConversationsResults.shape } as const;

export const getMessageContextFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ pgPool }) => ({
  name: 'get_message_context',
  method: 'get',
  route: '/message-context',
  config: {
    title: 'Get Message Context',
    description:
      'Fetches the context of a specific message in Slack, including replies and related messages by other users, organized into channels and conversations.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    ts,
    channel,
    includeFiles,
    window,
    limit,
  }): Promise<{
    channels: Record<string, z.infer<typeof zChannel>>;
    users: Record<string, z.infer<typeof zUser>>;
  }> => {
    const client = await pgPool.connect();
    try {
      const result = await client.query<Message>(
        selectExpandedMessages(
          /* sql */ `
SELECT ${getMessageFields({ includeFiles, coerceType: false })} FROM slack.message
WHERE ts = $1 AND channel_id = $2
LIMIT 1
`,
          '$3',
          '$4',
          includeFiles,
        ),
        [convertTsToTimestamp(ts), channel, window || 5, limit || 1000],
      );

      const { channels, involvedUsers } = messagesToTree(result.rows);
      await addChannelInfo(client, channels);
      const users = await getUsersMap(client, involvedUsers);

      return {
        channels,
        users,
      };
    } finally {
      client.release();
    }
  },
});
