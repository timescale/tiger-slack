import { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import {
  Channel,
  type Message,
  ServerContext,
  zChannel,
  zUser,
} from '../types.js';
import { findChannel } from '../util/findChannel.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { getMessageFields } from '../util/messageFields.js';

const inputSchema = {
  channelName: z
    .string()
    .describe(
      'The Slack channel to fetch messages for. Can be the channel id or name. Returns an error if multiple channels match.',
    ),
  includeFiles: z
    .boolean()
    .describe(
      'Specifies if file attachment metadata should be included. It is recommended to enable as it provides extra context for the thread.',
    ),
  includePermalinks: z
    .boolean()
    .describe(
      'An optional parameter to determine whether or not permalinks should be added to every message. This adds to token cost and should not be used unless explicitly requested.',
    ),
  lookbackInterval: z
    .string()
    .min(0)
    .nullable()
    .describe(
      'An optional lookback interval, to specify how far back to fetch messages before now. Defaults to 1 week. Format is a PostgreSQL interval, e.g. "7 days", "1 month", "3 hours".',
    ),
  limit: z.coerce
    .number()
    .min(1)
    .nullable()
    .describe('The maximum number of messages to return. Defaults to 1000.'),
} as const;

const outputSchema = {
  channel: zChannel.describe('The channel info and content.'),
  users: z
    .record(z.string(), zUser)
    .describe(
      'A mapping of user IDs to user details for all users involved in the conversations.',
    ),
} as const;

export const getRecentConversationsInChannelFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ pgPool }) => ({
  name: 'get_recent_conversations_in_channel',
  method: 'get',
  route: '/recent-conversations-in-channel',
  config: {
    title: 'Get Recent Conversations in Channel',
    description:
      'Fetches recent messages in a specific Slack channel, organized into conversations with threading context.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    channelName,
    includeFiles,
    includePermalinks,
    lookbackInterval,
    limit,
  }): Promise<{
    channel: z.infer<typeof zChannel>;
    users: Record<string, z.infer<typeof zUser>>;
  }> => {
    const channels = await findChannel(pgPool, channelName);
    if (channels.length === 0) {
      throw new Error(`No channel found matching "${channelName}"`);
    }
    let [targetChannel] = channels;
    if (channels.length > 1) {
      const exact = channels.find((c) => c.name === channelName);
      if (!exact) {
        throw new Error(
          `Multiple channels found matching "${channelName}": ${channels.map((c) => c.name).join(', ')}`,
        );
      }
      targetChannel = exact;
    }

    const client = await pgPool.connect();
    try {
      // Get messages in the channel within the lookback period
      const result = await client.query<Message>(
        /* sql */ `
SELECT
  ${getMessageFields({ includeFiles })}
FROM slack.message
WHERE channel_id = $1
  AND ts >= (NOW() - $2::INTERVAL)
ORDER BY ts DESC
LIMIT $3`,
        [targetChannel.id, lookbackInterval || '1w', limit || 1000],
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
