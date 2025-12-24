import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import { type Message, type ServerContext, zChannel, zUser } from '../types.js';
import { addChannelInfo } from '../util/addChannelInfo.js';
import { findUser } from '../util/findUser.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { selectExpandedMessages } from '../util/selectExpandedMessages.js';

const inputSchema = {
  username: z
    .string()
    .describe(
      'The Slack user to fetch messages for. Can be the id, username, real name, display name, or email. Returns an error if multiple users match.',
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
  timestampStart: z.coerce
    .date()
    .nullable()
    .describe(
      'Optional start date for the message range. Defaults to rangeEnd - 1w.',
    ),
  timestampEnd: z.coerce
    .date()
    .nullable()
    .describe(
      'Optional end date for the message range. Defaults to the current time.',
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

const outputSchema = {
  channels: z
    .record(z.string(), zChannel)
    .describe('A mapping of channel IDs to channel info and content.'),
  users: z
    .record(z.string(), zUser)
    .describe(
      'A mapping of user IDs to user details for all users involved in the conversations.',
    ),
} as const;

export const getConversationsWithUserFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ pgPool }) => ({
  name: 'get_conversations_with_user',
  method: 'get',
  route: '/conversations-with-user',
  config: {
    title: 'Get Conversations with User',
    description:
      'Fetches messages authored by a specific user in Slack, including the context of related messages by other users, organized into channels and conversations.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    username,
    includeFiles,
    includePermalinks,
    limit,
    timestampStart,
    timestampEnd,
    window,
  }): Promise<{
    channels: Record<string, z.infer<typeof zChannel>>;
    users: Record<string, z.infer<typeof zUser>>;
  }> => {
    const users = await findUser(pgPool, username);
    if (users.length === 0) {
      throw new Error(`No user found matching "${username}"`);
    }
    let [targetUser] = users;
    if (users.length > 1) {
      const exact = users.find((c) => c.user_name === username);
      if (!exact) {
        throw new Error(
          `Multiple users found matching "${username}": ${users.map((u) => u.user_name).join(', ')}`,
        );
      }

      targetUser = exact;
    }

    if (!targetUser?.id) {
      throw new Error(`No user id found matching "${username}"`);
    }

    const client = await pgPool.connect();
    try {
      const result = await client.query<Message>(
        selectExpandedMessages(
          /* sql */ `
  SELECT ${getMessageFields({ includeFiles, coerceType: false })} FROM slack.message
  WHERE user_id = $1 
    AND (($2::TIMESTAMPTZ IS NULL AND ts >= (NOW() - interval '1 week')) OR ts >= $2::TIMESTAMPTZ)
    AND ($3::TIMESTAMPTZ IS NULL OR ts <= $3::TIMESTAMPTZ)
  ORDER BY ts DESC
  LIMIT $5
`,
          '$4',
          '$5',
          includeFiles,
        ),
        [
          targetUser.id,
          timestampStart?.toISOString(),
          timestampEnd?.toISOString(),
          window || 5,
          limit || 1000,
        ],
      );

      const { channels, involvedUsers } = messagesToTree(
        result.rows,
        includePermalinks || false,
      );
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
