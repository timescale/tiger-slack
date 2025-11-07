export const getMessageFields = ({
  allowTypeCoercion = true,
  messageTableAlias,
  includeFiles,
}: {
  allowTypeCoercion?: boolean;
  messageTableAlias?: string;
  includeFiles?: boolean;
}): string =>
  [
    'ts::text',
    'channel_id',
    'text',
    'user_id',
    'thread_ts::text',
    ...(includeFiles ? ['files::jsonb'] : []),
  ]
    .map((x) => {
      const column = allowTypeCoercion ? x : x.replace(/::.+$/, '');
      return `${messageTableAlias ? `${messageTableAlias}.${column}` : column}`;
    })
    .join(',');
