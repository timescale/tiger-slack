import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import {
  type Channel,
  type Message,
  type ServerContext,
  zChannel,
  zChannelSearchFilters,
  zCommonSearchFilters,
  zUser,
  zWindowFilter,
} from '../types.js';
import { findChannel } from '../util/findChannel.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';

const inputSchema = {
  ...zCommonSearchFilters.shape,
  ...zChannelSearchFilters.shape,
  ...zWindowFilter.shape,
} as const;

const outputSchema = {
  channel: zChannel.describe('The channel info and content.'),
  users: z
    .record(z.string(), zUser)
    .describe(
      'A mapping of user IDs to user details for all users involved in the conversations.',
    ),
} as const;

export const getConversationsInChannelFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ pgPool }) => ({
  name: 'get_conversations_in_channel',
  method: 'get',
  route: '/conversations-in-channel',
  config: {
    title: 'Get Conversations in Channel',
    description:
      'Fetches messages in a specific Slack channel, organized into conversations with threading context.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    channelName,
    includeFiles,
    includePermalinks,
    timestampStart,
    timestampEnd,
    limit,
  }): Promise<{
    channel: z.infer<typeof zChannel>;
    users: Record<string, z.infer<typeof zUser>>;
  }> => {
    const targetChannel = await findChannel(pgPool, channelName);

    const client = await pgPool.connect();
    try {
      // Get messages in the channel within the lookback period
      const result = await client.query<Message>(
        /* sql */ `
SELECT
  ${getMessageFields({ includeFiles })}
FROM slack.message
WHERE channel_id = $1
  AND (($2::TIMESTAMPTZ IS NULL AND ts >= (NOW() - interval '1 week')) OR ts >= $2::TIMESTAMPTZ)
  AND ($3::TIMESTAMPTZ IS NULL OR ts <= $3::TIMESTAMPTZ)
ORDER BY ts DESC
LIMIT $4`,
        [
          targetChannel.id,
          timestampStart?.toISOString(),
          timestampEnd?.toISOString(),
          limit || 1000,
        ],
      );

      const { involvedUsers, channels } = messagesToTree(
        result.rows,
        includePermalinks || false,
      );

      const channel: Channel = {
        id: targetChannel.id,
        name: targetChannel.name,
        topic: targetChannel.topic,
        purpose: targetChannel.purpose,
        messages: channels[targetChannel.id]?.messages || [],
      };
      const users = await getUsersMap(client, involvedUsers);

      return {
        channel,
        users,
      };
    } finally {
      client.release();
    }
  },
});
