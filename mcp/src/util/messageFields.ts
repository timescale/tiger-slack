export function getMessageFields({
  coerceType = true,
  includeAttachments = false,
  includeFiles,
  includeSearchableContent = false,
  messageTableAlias,
}: {
  coerceType?: boolean;
  includeAttachments?: boolean;
  includeFiles?: boolean;
  includeSearchableContent?: boolean;
  messageTableAlias?: string;
}): string | string[] {
  const res = [
    `ts${coerceType ? '::text' : ''}`,
    'channel_id',
    'text',
    'user_id',
    `thread_ts${coerceType ? '::text' : ''}`,
    ...(includeAttachments
      ? [`attachments${coerceType ? '::jsonb' : ''}`]
      : []),
    ...(includeFiles ? [`files${coerceType ? '::jsonb' : ''}`] : []),
    ...(includeSearchableContent
      ? [`searchable_content${coerceType ? '::text' : ''}`]
      : []),
  ].map((x) => `${messageTableAlias ? `${messageTableAlias}.${x}` : x}`);

  return res.join(',');
}
