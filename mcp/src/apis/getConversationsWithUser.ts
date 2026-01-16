import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import type { z } from 'zod';
import {
  type Message,
  type ServerContext,
  type zChannel,
  zCommonSearchFilters,
  zConversationsResults,
  type zUser,
  zUserSearchFilters,
  zWindowFilter,
} from '../types.js';
import { addChannelInfo } from '../util/addChannelInfo.js';
import { findUser } from '../util/findUser.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { selectExpandedMessages } from '../util/selectExpandedMessages.js';

const inputSchema = {
  ...zCommonSearchFilters.shape,
  ...zUserSearchFilters.shape,
  ...zWindowFilter.shape,
} as const;

const outputSchema = { ...zConversationsResults.shape } as const;

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
