export const getMessageFields = (includeFiles?: boolean): string[] => [
  'ts::text',
  'channel_id',
  'text',
  'm.user_id',
  'thread_ts::text',
  ...(includeFiles ? ['files::jsonb'] : []),
];
