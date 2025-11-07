export const getMessageFields = ({
  coerceType = true,
  messageTableAlias,
  includeFiles,
}: {
  coerceType?: boolean;
  messageTableAlias?: string;
  includeFiles?: boolean;
}): string =>
  [
    `ts${coerceType ? '::text' : ''}`,
    'channel_id',
    'text',
    'user_id',
    `thread_ts${coerceType ? '::text' : ''}`,
    ...(includeFiles ? [`files${coerceType ? '::jsonb' : ''}`] : []),
  ]
    .map((x) => `${messageTableAlias ? `${messageTableAlias}.${x}` : x}`)
    .join(',');
