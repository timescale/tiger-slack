import type { ApiFactory, InferSchema } from '@tigerdata/mcp-boilerplate';
import {
  type Message,
  type ServerContext,
  zCommonSearchFilters,
  zConversationsResults,
} from '../types.js';
import { coalesce, getMessageFields } from '../util/messageFields.js';
import { messagesToTree } from '../util/messagesToTree.js';
import { addChannelInfo } from '../util/addChannelInfo.js';
import { getUsersMap } from '../util/getUsersMap.js';
import { findUser } from '../util/findUser.js';
import { findChannel } from '../util/findChannel.js';
import { z } from 'zod';

const inputSchema = {
  ...zCommonSearchFilters.shape,
  channels: z
    .string()
    .array()
    .nullable()
    .describe('Optionally filter search on channels names.'),
  users: z
    .string()
    .array()
    .nullable()
    .describe(
      'Optionally filter search based on the username of the sender of messages.',
    ),
  keyword: z
    .string()
    .min(4)
    .describe(
      'Search query for hybrid search on Slack messages. Will return the messages that match the criterion.',
    ),
  semanticWeight: z
    .number()
    .multipleOf(0.1)
    .min(0)
    .max(1)
    .nullable()
    .describe(
      'Controls the balance between semantic and keyword search. 0 = keyword only, 0.5 = equal mix, 1 = semantic only. Default is 0.7 (favor semantic search).',
    ),
} as const;

const outputSchema = { ...zConversationsResults.shape } as const;

export const searchFactory: ApiFactory<
  ServerContext,
  typeof inputSchema,
  typeof outputSchema
> = ({ openAIClient, pgPool }) => ({
  name: 'search',
  method: 'get',
  route: '/search',
  config: {
    title: 'Search Slack Messages',
    description:
      'Search across Slack messages using semantic (vector) search. Returns messages organized by channel and conversation with optional filtering by users, channels, and time range.',
    // description:
    // 	"Hybrid search across Slack messages using semantic (vector) and keyword (BM25) search with configurable weighting. Returns messages organized by channel and conversation with optional filtering by users, channels, and time range.",
    inputSchema,
    outputSchema,
  },
  fn: async ({
    channels: channelsToFilterOn,
    includeFiles,
    includePermalinks,
    keyword,
    limit: passedLimit,
    timestampStart,
    timestampEnd,
    semanticWeight: passedSemanticWeight,
    users: senderUsersToFilterOn,
  }): Promise<InferSchema<typeof outputSchema>> => {
    // since pg_textsearch is not yet stable for slack.messages
    // we are going to force this to be a full semantic search for now

    const semanticWeight = passedSemanticWeight ?? 1; // passedSemanticWeight ?? 0.7;
    const useSemanticSearch = semanticWeight > 0;
    const useKeywordSearch = semanticWeight < 1;

    const limit = passedLimit || 1000;

    const embedding = useSemanticSearch
      ? (
          await openAIClient.embeddings.create({
            input: keyword,
            model: 'text-embedding-3-small',
            dimensions: 1536,
          })
        ).data[0]
      : null;

    let userIdsToFilterOn: string[] | null = senderUsersToFilterOn ? [] : null;
    if (senderUsersToFilterOn) {
      const userObjs = await Promise.all(
        senderUsersToFilterOn.map((user) => findUser(pgPool, user)),
      );
      userIdsToFilterOn = userObjs.map((u) => u.id);
    }

    let channelIdsToFilterOn: string[] | null = channelsToFilterOn ? [] : null;
    if (channelsToFilterOn) {
      const channelObjs = await Promise.all(
        channelsToFilterOn.map((channel) => findChannel(pgPool, channel)),
      );
      channelIdsToFilterOn = channelObjs.map((u) => u.id);
    }

    const commonFilter = `
     WHERE (($2::TEXT[] IS NULL) OR (user_id = ANY($2)))
          AND (($3::TEXT[] IS NULL) OR (channel_id = ANY($3)))
          AND (($4::TIMESTAMPTZ IS NULL AND ts >= (NOW() - interval '1 week')) OR ts >= $4::TIMESTAMPTZ)
          AND ($5::TIMESTAMPTZ IS NULL OR ts <= $5::TIMESTAMPTZ)
          `;

    const rankAlias = 'rank';

    const query = `WITH semantic_search AS (
        SELECT 
          ${getMessageFields({ includeFiles, coerceType: false, includeRanking: { type: 'semantic', embeddingVariable: '$1', rankAlias } })} FROM slack.message
        ${commonFilter}
        ORDER BY ${rankAlias}
        LIMIT $6
      ),
      keyword_search AS (
        SELECT
          ${getMessageFields({ includeFiles, coerceType: false, includeRanking: { type: 'keyword', searchKeywordVariable: keyword, rankAlias } })} FROM slack.message
        ${commonFilter}
          ORDER BY ${rankAlias}
          LIMIT $7
      )
      SELECT
        ${coalesce(getMessageFields({ includeFiles, flattenToString: false }), 's', 'k').join(',')}
        , ($8 * COALESCE(1.0 / (60 + s.rank), 0.0) +
            (1 - $8) * COALESCE(1.0 / (60 + k.rank), 0.0)) AS combined_score
      FROM semantic_search s
      FULL OUTER JOIN keyword_search k ON s.ts = k.ts AND s.channel_id = k.channel_id
      ORDER BY combined_score DESC
      LIMIT $9
    `;

    const result = await pgPool.query<Message>(
      `WITH semantic_search AS (
        SELECT 
          ${getMessageFields({ includeFiles, coerceType: false, includeRanking: { type: 'semantic', embeddingVariable: '$1', rankAlias } })} FROM slack.message
        ${commonFilter}
        ORDER BY ${rankAlias}
        LIMIT $6
      ),
      keyword_search AS (
        SELECT
          ${getMessageFields({ includeFiles, coerceType: false, includeRanking: { type: 'keyword', searchKeywordVariable: keyword, rankAlias } })} FROM slack.message
        ${commonFilter}
          ORDER BY ${rankAlias}
          LIMIT $7
      )
      SELECT
        ${coalesce(getMessageFields({ includeFiles, flattenToString: false }), 's', 'k').join(',')}
        , ($8 * COALESCE(1.0 / (60 + s.rank), 0.0) +
            (1 - $8) * COALESCE(1.0 / (60 + k.rank), 0.0)) AS combined_score
      FROM semantic_search s
      FULL OUTER JOIN keyword_search k ON s.ts = k.ts AND s.channel_id = k.channel_id
      ORDER BY combined_score DESC
      LIMIT $9
    `,
      [
        embedding?.embedding ? JSON.stringify(embedding?.embedding) : null,
        userIdsToFilterOn,
        channelIdsToFilterOn,
        timestampStart?.toISOString(),
        timestampEnd?.toISOString(),
        useSemanticSearch ? limit * 2 : 0,
        useKeywordSearch ? limit * 2 : 0,
        semanticWeight,
        limit,
      ],
    );

    const { channels, involvedUsers } = messagesToTree(
      result.rows,
      includePermalinks || false,
    );
    await addChannelInfo(pgPool, channels);
    const users = await getUsersMap(pgPool, involvedUsers);

    return {
      channels,
      users,
    };
  },
});
