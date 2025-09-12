import { z } from 'zod';
import type { Pool } from 'pg';

export interface ServerContext extends Record<string, unknown> {
  pgPool: Pool;
}

export const zUser = z.object({
  id: z.string(),
  // team_id: z.string(),
  user_name: z.string().describe('The unique slack username.'),
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
    .describe("The user's timezone city/location (e.g. America/Chicago)."),
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

const commonMessageFields = {
  ts: z.string().describe('The timestamp of the message'),
  channel_id: z.string().describe('The channel ID the message was posted in'),
  text: z.string().describe('The text content of the message'),
  user_id: z.string().nullable().describe('The user ID of the message author'),
  thread_ts: z.string().nullable().describe('The thread timestamp, if a reply'),
  permalink: z.string().optional().describe('The hyperlink to the message'),
};

export const zMessage = z
  .object({
    ...commonMessageFields,
    replies: z
      .array(z.object(commonMessageFields))
      .optional()
      .describe('Replies to this message'),
    reply_count: z
      .number()
      .optional()
      .nullable()
      .describe(
        'Total number of replies to this message. May be greater than the length of `replies` if some replies were outside the context window.',
      ),
  })
  .describe('A Slack message');

export type Message = z.infer<typeof zMessage>;

export const zChannel = z.object({
  id: z.string().describe('The unique channel ID'),
  name: z.string().describe('The name of the channel'),
  messages: z.array(zMessage).describe('Messages in this channel'),
  topic: z.string().optional().nullable().describe('The channel topic'),
  purpose: z.string().optional().nullable().describe('The channel purpose'),
});

export type Channel = z.infer<typeof zChannel>;
