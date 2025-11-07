import { getMessageFields } from './messageFields.js';

export const selectExpandedMessages = (
  targetMessagesSql: string,
  window: string,
  limit: string,
  includeFiles: boolean,
): string => {
  const fieldsWithMAlias = getMessageFields({
    messageTableAlias: 'm',
    includeFiles,
    allowTypeCoercion: false,
  });

  const fields = getMessageFields({
    includeFiles,
    allowTypeCoercion: false,
  });

  return /* sql */ `
-- Start by selecting the target messages
WITH
target_messages AS (
  ${targetMessagesSql}
),

-- Break the complex OR join into three separate, index-optimized joins
-- Join 1: Messages in same thread as target (m.thread_ts = tm.thread_ts)
thread_same AS (
  SELECT ${fieldsWithMAlias}, tm.ts as target_ts, tm.thread_ts as target_thread_ts
  FROM slack.message m
  INNER JOIN target_messages tm ON m.channel_id = tm.channel_id AND m.thread_ts = tm.thread_ts
  WHERE tm.thread_ts IS NOT NULL
),

-- Join 2: Replies to target message (m.thread_ts = tm.ts)
thread_replies AS (
  SELECT ${fieldsWithMAlias}, tm.ts as target_ts, tm.thread_ts as target_thread_ts  
  FROM slack.message m
  INNER JOIN target_messages tm ON m.channel_id = tm.channel_id AND m.thread_ts = tm.ts
),

-- Join 3: Target is reply to thread root (m.ts = tm.thread_ts)
thread_roots AS (
  SELECT ${fieldsWithMAlias}, tm.ts as target_ts, tm.thread_ts as target_thread_ts
  FROM slack.message m  
  INNER JOIN target_messages tm ON m.channel_id = tm.channel_id AND m.ts = tm.thread_ts
  WHERE tm.thread_ts IS NOT NULL
),

-- Combine all thread context (separate CTE)
thread_context AS (
  SELECT * FROM thread_same
  UNION ALL
  SELECT * FROM thread_replies  
  UNION ALL
  SELECT * FROM thread_roots
),

-- Calculate position relative to target (separate CTE)
thread_context_with_positions AS (
  SELECT 
    ${getMessageFields({ messageTableAlias: 't', includeFiles, allowTypeCoercion: false })}, target_ts, target_thread_ts,
    CASE 
      WHEN ts = target_ts OR ts = target_thread_ts THEN 0
      WHEN ts < target_ts THEN 
        -ROW_NUMBER() OVER (
          PARTITION BY target_ts, CASE WHEN ts < target_ts THEN 1 ELSE 0 END
          ORDER BY ts DESC
        )
      ELSE 
        ROW_NUMBER() OVER (
          PARTITION BY target_ts, CASE WHEN ts > target_ts THEN 1 ELSE 0 END  
          ORDER BY ts ASC
        )
    END as position
  FROM thread_context t
),

-- Filter early to reduce downstream processing
thread_positions_filtered AS (
  SELECT ${fields}
  FROM thread_context_with_positions
  WHERE position BETWEEN -(${window}::int) AND ${window}
),

-- Get channel messages around target channel messages (non-thread) 
channel_context AS (
  SELECT ${fieldsWithMAlias}, tm.ts as target_ts
  FROM slack.message m
  INNER JOIN target_messages tm ON m.channel_id = tm.channel_id
  WHERE (tm.thread_ts IS NULL OR tm.ts = tm.thread_ts)
    AND (m.thread_ts IS NULL OR m.ts = m.thread_ts)
    AND m.ts BETWEEN tm.ts - INTERVAL '1 day' AND tm.ts + INTERVAL '1 day'
),

-- Calculate position and filter immediately
channel_positions_filtered AS (
  SELECT 
    ${fields}
  FROM (
    SELECT 
      c.*,
      CASE 
        WHEN c.ts = c.target_ts THEN 0
        WHEN c.ts < c.target_ts THEN 
          -ROW_NUMBER() OVER (
            PARTITION BY c.target_ts, CASE WHEN c.ts < c.target_ts THEN 1 ELSE 0 END
            ORDER BY c.ts DESC
          )
        ELSE 
          ROW_NUMBER() OVER (
            PARTITION BY c.target_ts, CASE WHEN c.ts > c.target_ts THEN 1 ELSE 0 END  
            ORDER BY c.ts ASC
          )
      END as position
    FROM channel_context c
  ) cp
  WHERE position BETWEEN -(${window}::int) AND ${window}
),

-- Combine with minimal duplication
all_messages AS (
  SELECT DISTINCT ${fields} FROM target_messages
  UNION
  SELECT DISTINCT ${fields} FROM thread_positions_filtered
  UNION
  SELECT DISTINCT ${fields} FROM channel_positions_filtered
),

-- Optimized reply count calculation - only for messages that need it
thread_roots_needing_counts AS (
  SELECT DISTINCT ts, channel_id
  FROM all_messages
  WHERE thread_ts IS NULL OR ts = thread_ts
),
reply_counts AS (
  SELECT 
    tr.ts,
    COUNT(replies.ts) as reply_count
  FROM thread_roots_needing_counts tr
  LEFT JOIN slack.message replies ON replies.thread_ts = tr.ts 
    AND replies.channel_id = tr.channel_id
    AND replies.ts != tr.ts
  GROUP BY tr.ts
)

SELECT 
  ${getMessageFields({ includeFiles, messageTableAlias: 'am' })},
  CASE 
    WHEN am.thread_ts IS NULL OR am.ts = am.thread_ts THEN rc.reply_count
    ELSE NULL
  END::int as reply_count
FROM all_messages am
LEFT JOIN reply_counts rc ON am.ts = rc.ts
ORDER BY am.ts DESC
LIMIT ${limit}`;
};
