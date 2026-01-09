-----------------------------------------------------------------------
-- This will create a vectorizer that embeds the slack.message table
-- NOTE: at present, this only supports cloud timescale db instances
-- you need to first install pgai onto your service via the cloud and set
-- the open_ai api key

create extension if not exists "ai" VERSION '0.11.2' CASCADE;

select ai.create_vectorizer(
    'slack.message'::regclass,
    name => 'slack_messages_vectorizer',
    loading => ai.loading_column('text'),
    embedding => ai.embedding_openai('text-embedding-3-small', 1536),
    chunking => ai.chunking_none(),
    destination => ai.destination_column('embedding')
);