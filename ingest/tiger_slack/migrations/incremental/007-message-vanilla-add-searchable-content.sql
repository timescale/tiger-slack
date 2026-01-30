--007-message-vanilla-add-searchable-content.sql

-- this adds searchable content column, this column will have the bm25 index
-- and the embedding will be based off of it

alter table slack.message_vanilla add column searchable_content text;