-----------------------------------------------------------------------
-- This adds hybrid search capabilities to slack.message

-- if using a TimescaleDB cloud instance, these may need to be
-- added via the console
create extension if not exists vectorscale CASCADE;
create extension if not exists pg_textsearch;

-- pg_textsearch now supports hypertables, but it does not support compression/chunking
-- so we need to disable it and decompress all chunks
perform remove_compression_policy('slack.message');
perform decompress_chunk(c, true) from show_chunks('slack.message', CURRENT_TIMESTAMP, '2000-1-1') c;
alter table slack.message set (timescaledb.compress=false);

-- add column for embeddings
alter table slack.message add column embedding VECTOR(1536);

-- create bm25 and vector indexes
create index message_text_bm25_idx on slack.message using bm25(text) with (text_config='english');
create index message_text_vector_idx on slack.message using hnsw(embedding vector_cosine_ops) with (m = 20, ef_construction = 64);