import { z } from 'zod';
import { type Message, ServerContext, zChannel, zUser } from '../types.js';
import { findUser } from '../util/findUser.js';
import { selectExpandedMessages } from '../util/selectExpandedMessages.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { addChannelInfo } from '../util/addChannelInfo.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { ApiFactory } from '../shared/boilerplate/src/types.js';

const inputSchema = {
  username: z
    .string()
    .describe(
      'The Slack user to fetch messages for. Can be the id, username, real name, display name, or email. Returns an error if multiple users match.',
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

export const getRecentConversationsWithUserFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ pgPool }) => ({
  name: 'getRecentConversationsWithUser',
  method: 'get',
  route: '/recent-conversations-with-user',
  config: {
    title: 'Get Recent Conversations with User',
    description:
      'Fetches recent messages authored by a specific user in Slack, including the context of related messages by other users, organized into channels and conversations.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    username,
    includePermalinks,
    lookbackInterval,
    limit,
    window,
  }) => {
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

    const client = await pgPool.connect();
    try {
      const result = await client.query<Message>(
        selectExpandedMessages(
          /* sql */ `
  SELECT * FROM slack.message
  WHERE user_id = $1 AND ts >= (NOW() - $2::INTERVAL)
  ORDER BY ts DESC
  LIMIT $4
`,
          '$3',
          '$4',
        ),
        [targetUser.id, lookbackInterval || '1w', window || 5, limit || 1000],
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
