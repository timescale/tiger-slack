--008-message-recompress-remove-search-related-columns-and-indexes.sql
-- now that slack.message_vanilla is used for hybrid searching, we can drop the
-- related indexes and columns and re-add compression

drop index if exists slack.message_text_bm25_idx;
drop index if exists slack.message_text_vector_idx;

alter table slack.message drop column embedding;
alter table slack.message set (timescaledb.compress = true);

-- this follows the parameters that we have in 003-message.sql
alter table slack.message set (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'channel_id',
  timescaledb.compress_orderby = 'ts desc'
);

ALTER TABLE slack.message SET (
  timescaledb.enable_columnstore = true,
  timescaledb.compress_segmentby = 'channel_id',
  timescaledb.compress_orderby = 'ts desc',
  timescaledb.compress_chunk_time_interval = '7 days',
  timescaledb.sparse_index = 'minmax(thread_ts),minmax(event_ts)'
);

perform remove_compression_policy('slack.message', true);
call add_columnstore_policy('slack.message'::regclass, after => interval '45 days');