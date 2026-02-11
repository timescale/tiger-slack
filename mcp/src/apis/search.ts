import type { ApiFactory, InferSchema } from '@tigerdata/mcp-boilerplate';
import type { QueryResult } from 'pg';
import { z } from 'zod';
import {
  type Message,
  type ServerContext,
  zCommonSearchFilters,
  zMessage,
} from '../types.js';
import { generatePermalink } from '../util/addMessageLinks.js';
import { findChannel } from '../util/findChannel.js';
import { findUser } from '../util/findUser.js';
import { getMessageKey } from '../util/getMessageKey.js';
import { getMessageFields } from '../util/messageFields.js';
import { normalizeMessageTs } from '../util/messagesToTree.js';
import { getChannelIds } from '../util/getChannelIds.js';

const inputSchema = {
  ...zCommonSearchFilters.extend({
    limit: z.coerce
      .number()
      .min(1)
      .nullable()
      .describe('The maximum number of messages to return. Defaults to 20.'),
    timestampStart: z.coerce
      .date()
      .nullable()
      .describe(
        'Optional start date for the message range. Defaults to null, which means that search will be against all historic messages.',
      ),
  }).shape,
  channels: z
    .string()
    .array()
    .nullable()
    .describe('Optionally filter search on channels. Can use ids or names.'),
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

const outputSchema = {
  messages: z.array(zMessage).describe('Messages matching search.'),
} as const;

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
      'Hybrid search across Slack messages using semantic (vector) and keyword (BM25) search with configurable weighting. Returns messages organized by channel and conversation with optional filtering by users, channels, and time range. Search matches the message text, as well as contents of the attachments.',
    inputSchema,
    outputSchema,
  },
  fn: async ({
    channels: channelsToFilterOn,
    includeFiles,
    includePermalinks,
    keyword,
    limit: passedLimit,
    semanticWeight: passedSemanticWeight,
    timestampStart,
    timestampEnd,
    users: senderUsersToFilterOn,
  }): Promise<InferSchema<typeof outputSchema>> => {
    const semanticWeight = passedSemanticWeight ?? 0.7;
    const useSemanticSearch = semanticWeight > 0;
    const useKeywordSearch = semanticWeight < 1;

    const limit = passedLimit || 20;

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
    const channelIdsToFilterOn = await getChannelIds(
      pgPool,
      channelsToFilterOn,
    );

    const createQuery = async (type: 'semantic' | 'keyword') =>
      pgPool.query<Message>(
        `SELECT 
          ${getMessageFields({ includeFiles, coerceType: true })} 
        FROM slack.message_vanilla
        WHERE text != ''
          AND (($1::TEXT[] IS NULL) OR (user_id = ANY($1)))
          AND (($2::TEXT[] IS NULL) OR (channel_id = ANY($2)))
          AND (($3::TIMESTAMPTZ IS NULL AND ts >= (NOW() - interval '1 week')) OR ts >= $3::TIMESTAMPTZ)
          AND ($4::TIMESTAMPTZ IS NULL OR ts <= $4::TIMESTAMPTZ)
        ORDER BY ${type === 'semantic' ? `embedding <=> $5::vector(1536)` : `text <@> to_bm25query($5::text, 'slack.message_vanilla_searchable_content_bm25_idx')`}
        LIMIT $6`,
        [
          userIdsToFilterOn,
          channelIdsToFilterOn,
          timestampStart?.toISOString(),
          timestampEnd?.toISOString(),
          type === 'semantic' ? JSON.stringify(embedding?.embedding) : keyword,
          limit * 3,
        ],
      );

    const resultsPromises: (Promise<QueryResult<Message>> | null)[] = [
      useKeywordSearch ? createQuery('keyword') : null,
      useSemanticSearch ? createQuery('semantic') : null,
    ];

    const results = await Promise.all(resultsPromises);

    const [keywordResults, semanticResults] = results.map((x) => x?.rows);

    if (!keywordResults) {
      return {
        messages: getResultMessages(semanticResults, limit, includePermalinks),
      };
    }

    if (!semanticResults) {
      return {
        messages: getResultMessages(keywordResults, limit, includePermalinks),
      };
    }

    // if we have semantic + keyword results, let's use reciprocal ranking fusion
    // to combine the results together

    // we will use this to combine the scores from keyword and semantic.
    // since the score is a combination of the ranking from both sets, we will use dictionaries
    // with {ts}{channel_id} key so that we can maintain a o(n) runtime, rather than o(n^2) if
    // we were to iterate over one list and find the same key in the other list
    const scores: Record<string, number> = {};
    const keyToMessage: Record<string, Message> = {};

    semanticResults.forEach((message, index) => {
      const key = getMessageKey(message);

      scores[key] = (scores[key] || 0) + semanticWeight * (1 / (60 + index));
      keyToMessage[key] = message;
    });

    keywordResults.forEach((message, index) => {
      const key = getMessageKey(message);

      keyToMessage[key] = message;
      scores[key] =
        (scores[key] || 0) + (1 - semanticWeight) * (1 / (60 + index));
    });

    // sort the dictionary by the score in descending order
    const sorted = Object.entries(scores).sort(([, aScore], [, bScore]) => {
      if (aScore === bScore) return 0;
      return aScore > bScore ? -1 : 1;
    });

    return {
      messages:
        sorted.slice(0, limit).map(([key]) => {
          // biome-ignore lint/style/noNonNullAssertion: keyToMessage[key] is always going to be set
          const message = normalizeMessageTs(keyToMessage[key]!);
          message.permalink = includePermalinks
            ? generatePermalink(message)
            : message.permalink;
          return message;
        }) || [],
    };
  },
});

const getResultMessages = (
  messages: Message[] | undefined,
  limit: number,
  includePermalinks: boolean,
): Message[] =>
  messages?.slice(0, limit).map((message) => {
    message.permalink = includePermalinks
      ? generatePermalink(message)
      : message.permalink;
    return normalizeMessageTs(message);
  }) || [];
