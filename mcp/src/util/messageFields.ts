type SemanticSearchParams = {
  type: 'semantic';
  dimensions?: number;
  embeddingVariable: string; // expecting variable index placeholders e.g. $1
  rankAlias: string;
};

type KeywordSearchParams = {
  type: 'keyword';
  searchKeywordVariable: string; // expecting variable index placeholders e.g. $1
  rankAlias: string;
};

type SearchParams = SemanticSearchParams | KeywordSearchParams;

type MessageFieldsParams = {
  coerceType?: boolean;
  messageTableAlias?: string;
  includeFiles?: boolean;
  rankingMethod?: string;
};

export const getSearchMethod = (search: SearchParams) =>
  search.type === 'keyword'
    ? `text <@> to_bm25query('${search.searchKeywordVariable}', 'slack.message_text_bm25_idx')`
    : `embedding <=> ${search.embeddingVariable}::vector(${search.dimensions || 1536})`;

// provide overloading signatures so we can return an array or comma joined string
export function getMessageFields(
  params: MessageFieldsParams & { flattenToString?: true },
): string;
export function getMessageFields(
  params: MessageFieldsParams & { flattenToString: false },
): string[];
export function getMessageFields(params: MessageFieldsParams): string;

export function getMessageFields({
  coerceType = true,
  flattenToString = true,
  rankingMethod,
  messageTableAlias,
  includeFiles,
}: MessageFieldsParams & { flattenToString?: boolean }): string | string[] {
  const res = [
    `ts${coerceType ? '::text' : ''}`,
    'channel_id',
    'text',
    'user_id',
    `thread_ts${coerceType ? '::text' : ''}`,
    ...(includeFiles ? [`files${coerceType ? '::jsonb' : ''}`] : []),
    ...(rankingMethod
      ? [`ROW_NUMBER() OVER (ORDER BY ${rankingMethod}) AS rank`]
      : []),
  ].map((x) => `${messageTableAlias ? `${messageTableAlias}.${x}` : x}`);

  return flattenToString ? res.join(',') : res;
}

// this will take an array of fields and create an
// array of coalesced fields for each of the input fields
// if the fields have a type, will cast the result to that type
//
// Example
// Inputs: ["name::text", "age"], "a", "b"
// Outputs: ["COALESCE(a.name, b.name)::text as name", "COALESCE(a.age, b.age) as age"]
export const coalesce = (
  fields: string[],
  firstTableAlias: string,
  secondTableAlias: string,
): string[] => {
  return fields.reduce<string[]>((acc, curr) => {
    const [fieldName, fieldType] = curr.split('::');
    acc.push(
      `COALESCE(${firstTableAlias}.${fieldName}, ${secondTableAlias}.${fieldName})${fieldType ? `::${fieldType}` : ''} as ${fieldName}`,
    );
    return acc;
  }, []);
};
