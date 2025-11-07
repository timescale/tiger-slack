export const getMessageFields = ({
  messageTableAlias,
  includeFiles,
  enableTypeCoercion = true,
}: {
  enableTypeCoercion?: boolean;
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
      const column = enableTypeCoercion ? x : x.replace(/::.+$/, '');

      return `${messageTableAlias ? `${messageTableAlias}.${column}` : column}`;
    })
    .join(',');
