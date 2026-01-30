--008-message-recompress-remove-search-related-columns-and-indexes.sql
-- now that slack.message_vanilla is used for hybrid searching, we can drop the
-- related indexes and columns and re-add compression

drop index if exists slack.message_text_bm25_idx;
drop index if exists slack.message_text_vector_idx;

alter table slack.message drop column embedding;