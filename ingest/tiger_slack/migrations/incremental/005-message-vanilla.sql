--005-message-vanilla.sql
-- given some limitations with bm25 + vector indexing on hypertables,
-- we are going to add a vanilla table, as well

-----------------------------------------------------------------------
-- slack.message
create table slack.message_vanilla
( ts timestamptz not null
, channel_id text not null
, team text
, text text
, type text
, user_id text
, blocks jsonb
, event_ts timestamptz
, thread_ts timestamptz
, channel_type text
, client_msg_id uuid
, parent_user_id text
, updated_at timestamptz
, bot_id text
, attachments jsonb
, files jsonb
, app_id text
, subtype text
, trigger_id text
, workflow_id text
, display_as_bot boolean
, upload boolean
, x_files jsonb
, icons jsonb
, language jsonb
, edited jsonb
, reactions jsonb
, embedding VECTOR(1536)
);

create unique index on slack.message_vanilla (channel_id, ts desc);

-- will add other indexes on this table in a subsequent migration, after moving
-- historic messages into this table
