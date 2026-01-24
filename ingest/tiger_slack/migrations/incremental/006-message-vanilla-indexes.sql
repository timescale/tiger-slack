--006-message-vanilla-indexes.sql
-- adding indexes onto the new table
-- adding these separately so that migration/backfill was more performant

create extension if not exists vectorscale CASCADE;

create index on slack.message_vanilla (channel_id, thread_ts, ts asc) where thread_ts is not null;
create index on slack.message_vanilla (channel_id, thread_ts, ts desc) where thread_ts is not null;
create index on slack.message_vanilla (user_id, thread_ts, channel_id) where thread_ts is not null;

-- create bm25 and vector indexes
create index message_vanilla_text_bm25_idx on slack.message_vanilla using bm25(text) with (text_config='english');
create index message_vanilla_text_vector_idx on slack.message_vanilla using diskann (embedding vector_cosine_ops);