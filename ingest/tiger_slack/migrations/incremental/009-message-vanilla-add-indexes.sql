--009-message-vanilla-add-indexes.sql

-- this adds searchable content column, this column will have the bm25 index
-- and the embedding will be based off of it

drop index if exists slack.message_vanilla_text_bm25_idx;
drop index if exists slack.message_vanilla_text_vector_idx;

SET max_parallel_maintenance_workers = 4;
SET maintenance_work_mem = '2GB';

create index if not exists message_vanilla_searchable_content_bm25_idx on slack.message_vanilla using bm25(searchable_content) with (text_config='english');
create index if not exists message_vanilla_searchable_content_vector_idx on slack.message_vanilla using diskann (embedding vector_cosine_ops);