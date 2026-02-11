import type { ApiFactory } from '@tigerdata/mcp-boilerplate';
import { z } from 'zod';
import {
  type Message,
  type MessageInThread,
  type ServerContext,
  type User,
  zIncludeFilters,
  zMessageFilter,
  zMessageInThread,
  zUser,
} from '../types.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { normalizeMessageFilterQueryParameters } from '../util/normalizeMessageFilterQueryParameters.js';

const inputSchema = {
  ...zIncludeFilters.shape,
  messageFilters: z
    .array(zMessageFilter)
    .describe('The messages to fetch the threads for.'),
} as const;

const outputSchema = {
  messages: z.array(zMessageInThread),
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
    includeFiles,
    includePermalinks,
    messageFilters: passedMessageFilters,
  }): Promise<{
    messages: MessageInThread[];
    users: Record<string, User>;
  }> => {
    const messageFilters = normalizeMessageFilterQueryParameters(
      pgPool,
      passedMessageFilters,
    );

    const result = await pgPool.query<Message>(
      /* sql */ `
      WITH filters AS (
        SELECT
          f->>'channel' AS channel_id,
          (f->>'ts')::timestamptz AS ts
        FROM jsonb_array_elements($1::jsonb) AS f
      )
      SELECT ${getMessageFields({ includeFiles })}
      FROM slack.message m
      WHERE EXISTS (
        SELECT 1 FROM filters f
        WHERE m.channel_id = f.channel_id
          AND (m.thread_ts = f.ts OR m.ts = f.ts)
      )
      ORDER BY ts DESC`, // messagesToTree expects messages in descending order
      [JSON.stringify(messageFilters)],
    );

    const { involvedUsers, channels } = messagesToTree(
      result.rows,
      includePermalinks || false,
    );
    const users = await getUsersMap(pgPool, involvedUsers);

    // Flatten messages from all channels
    const messages = Object.values(channels).flatMap((c) => c.messages);

    return {
      messages,
      users,
    };
  },
});
