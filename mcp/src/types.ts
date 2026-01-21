import type OpenAI from 'openai';
import type { Pool } from 'pg';
import { z } from 'zod';

export interface ServerContext extends Record<string, unknown> {
  openAIClient: OpenAI;
  pgPool: Pool;
}

export const zUser = z.object({
  id: z.string().describe('The Slack user id (e.g. U0736TW20)'),
  // team_id: z.string(),
  user_name: z.string().describe('The unique Slack username.'),
  real_name: z
    .string()
    .nullable()
    .describe(
      'The full name of the user. This may contain diacritics or other special characters.',
    ),
  display_name: z
    .string()
    .nullable()
    .describe(
      'The user-specified display name. This may contain diacritics or other special characters.',
    ),
  // real_name_normalized: z
  //   .string()
  //   .nullable()
  //   .describe(
  //     'The full name of the user, but without only with standard characters e.g. no diacritics or other special characters.',
  //   ),
  // display_name_normalized: z
  //   .string()
  //   .nullable()
  //   .describe(
  //     'The user-specified display name, but without only with standard characters e.g. no diacritics or other special characters.',
  //   ),
  email: z.string().email().nullable(),
  tz: z
    .string()
    .optional()
    .nullable()
    .describe(
      "The user's full time zone name as recognized in the IANA time zone data (e.g. America/Chicago).",
    ),
  // tz_label: z
  //   .string()
  //   .nullable()
  //   .describe("The user's timezone (e.g. Central Daylight Time)."),
  // tz_offset: z.number().nullable(),
  // deleted: z.boolean(),
  is_bot: z.boolean().optional(),
  // updated: z.number(),
});

export type User = z.infer<typeof zUser>;

export const zFile = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    size: z.number().nullish(),
    title: z.string().nullish(),
    mimetype: z.string().nullish(),
    url_private_download: z.string().nullish(),
  })
  .describe('A file associated with a Slack message');

export const zMessage = z.object({
  ts: z.string().describe('The timestamp of the message'),
  channel_id: z
    .string()
    .describe(
      'The Slack channel ID the message was posted in (e.g. C123ABC456)',
    ),
  files: z.array(zFile).optional().nullable(),
  text: z.string().describe('The text content of the message'),
  user_id: z
    .string()
    .nullable()
    .describe('The Slack user ID of the message author (e.g. U012AB345CD)'),
  thread_ts: z.string().nullable().describe('The thread timestamp, if a reply'),
  permalink: z.string().optional().describe('The hyperlink to the message'),
});

export type Message = z.infer<typeof zMessage>;

export const zMessageInThread = z
  .object({
    ...zMessage.shape,
    replies: z.array(zMessage).optional().describe('Replies to this message'),
    reply_count: z
      .number()
      .optional()
      .nullable()
      .describe(
        'Total number of replies to this message. May be greater than the length of `replies` if some replies were outside the context window.',
      ),
  })
  .describe('A Slack message');

export type MessageInThread = z.infer<typeof zMessageInThread>;

export const zChannel = z.object({
  id: z
    .string()
    .describe(
      'The Slack channel ID the message was posted in (e.g. C123ABC456)',
    ),
  name: z.string().describe('The name of the channel'),
  messages: z.array(zMessageInThread).describe('Messages in this channel'),
  topic: z.string().optional().nullable().describe('The channel topic'),
  purpose: z.string().optional().nullable().describe('The channel purpose'),
});

export type Channel = z.infer<typeof zChannel>;

export const zIncludeFilters = z.object({
  includeFiles: z
    .boolean()
    .describe(
      'Specifies if file attachment metadata should be included. It is recommended to enable as it provides extra context for the thread.',
    ),
  includePermalinks: z
    .boolean()
    .describe(
      'Specifies if permalinks should be added to every message. This adds to token cost and should not be used unless explicitly requested.',
    ),
});

export const zCommonSearchFilters = z.object({
  ...zIncludeFilters.shape,
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
});

export const zUserSearchFilters = z.object({
  username: z
    .string()
    .describe(
      'The Slack user to fetch messages for. Can be the id, username, real name, display name, or email. Returns an error if multiple users match.',
    ),
});

export const zChannelSearchFilters = z.object({
  channelName: z
    .string()
    .describe(
      'The Slack channel to fetch messages for. Can be the channel id or name. Returns an error if multiple channels match.',
    ),
});

export const zWindowFilter = z.object({
  window: z.coerce
    .number()
    .min(0)
    .nullable()
    .describe(
      'The window of context around the target messages to include. Defaults to 5.',
    ),
});

export const zConversationsResults = z.object({
  channels: z
    .record(z.string(), zChannel)
    .describe('A mapping of channel IDs to channel info and content.'),
  users: z
    .record(z.string(), zUser)
    .describe(
      'A mapping of user IDs to user details for all users involved in the conversations.',
    ),
});
