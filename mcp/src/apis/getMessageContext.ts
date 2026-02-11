import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import {
  type Message,
  type ServerContext,
  type zChannel,
  zConversationsResults,
  zIncludeFilters,
  zLimitFilter,
  zMessageFilter,
  type zUser,
} from '../types.js';
import { addChannelInfo } from '../util/addChannelInfo.js';
import { convertTsToTimestamp } from '../util/formatTs.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { selectExpandedMessages } from '../util/selectExpandedMessages.js';
import { getChannelIds } from '../util/getChannelIds.js';

const inputSchema = {
  messageFilters: z
    .array(zMessageFilter)
    .describe('The Slack messages to context for.'),
  ...zLimitFilter.shape,
  ...zIncludeFilters.shape,
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
    includeFiles,
    messageFilters: passedMessageFilters,
    window,
    limit,
  }): Promise<{
    channels: Record<string, z.infer<typeof zChannel>>;
    users: Record<string, z.infer<typeof zUser>>;
  }> => {
    const client = await pgPool.connect();
    const channelIds = await getChannelIds(
      pgPool,
      passedMessageFilters.map((x) => x.channel),
    );

    if (channelIds === null || channelIds.length === 0) {
      throw new Error('You must pass at least one existing channel id');
    }

    const messageFilters = passedMessageFilters.reduce<
      z.infer<typeof zMessageFilter>[]
    >((acc, curr, index) => {
      acc.push({
        channel: channelIds[index] || '',
        ts: convertTsToTimestamp(curr.ts),
      });
      return acc;
    }, []);

    try {
      const result = await client.query<Message>(
        selectExpandedMessages(
          /* sql */ `
SELECT ${getMessageFields({ includeFiles, coerceType: false, messageTableAlias: 'm' })}
FROM slack.message m
INNER JOIN (
  SELECT
    f->>'channel' AS channel_id,
    (f->>'ts')::timestamptz AS ts
  FROM jsonb_array_elements($1::jsonb) AS f
) filters ON m.channel_id = filters.channel_id AND m.ts = filters.ts
`,
          '$2',
          '$3',
          includeFiles,
        ),
        [JSON.stringify(messageFilters), window || 5, limit || 1000],
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
