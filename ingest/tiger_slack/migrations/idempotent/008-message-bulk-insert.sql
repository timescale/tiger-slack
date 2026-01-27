--008-message-bulk-insert.sql

-----------------------------------------------------------------------
-- this updates insert_message to accept either an array of messages or
-- a single message

create or replace function slack.insert_message(_event jsonb) returns void
as $func$
    insert into slack.message
    ( ts
    , channel_id
    , team
    , text
    , type
    , user_id
    , blocks
    , event_ts
    , thread_ts
    , channel_type
    , client_msg_id
    , parent_user_id
    , bot_id
    , attachments
    , files
    , app_id
    , subtype
    , trigger_id
    , workflow_id
    , display_as_bot
    , upload
    , x_files
    , icons
    , language
    , edited
    , embedding
    )
    select
      slack.to_timestamptz(e->>'ts')
    , e->>'channel'
    , e->>'team'
    , e->>'text'
    , e->>'type'
    , e->>'user'
    , e->'blocks'
    , slack.to_timestamptz(e->>'event_ts')
    , slack.to_timestamptz(e->>'thread_ts')
    , e->>'channel_type'
    , (e->>'client_msg_id')::uuid
    , e->>'parent_user_id'
    , e->>'bot_id'
    , e->'attachments'
    , e->'files'
    , e->>'app_id'
    , e->>'subtype'
    , e->>'trigger_id'
    , e->>'workflow_id'
    , (e->>'display_as_bot')::boolean
    , (e->>'upload')::boolean
    , e->'x_files'
    , e->'icons'
    , e->'language'
    , e->'edited'
    , (e->'embedding')::text::vector(1536)
    -- this case condition allows us to pass in either an array or a
    -- single instance of a message.
    from jsonb_array_elements(
      case when jsonb_typeof(_event) != 'array'
        then jsonb_build_array(_event)
        else _event
      end
    ) as e
    where not exists
    (
        select 1
        from slack.message_discard d
        where jsonb_path_match(e, d.match, silent=>true)
    )
    on conflict (channel_id, ts) do nothing;

    insert into slack.message_vanilla
    ( ts
    , channel_id
    , team
    , text
    , type
    , user_id
    , blocks
    , event_ts
    , thread_ts
    , channel_type
    , client_msg_id
    , parent_user_id
    , bot_id
    , attachments
    , files
    , app_id
    , subtype
    , trigger_id
    , workflow_id
    , display_as_bot
    , upload
    , x_files
    , icons
    , language
    , edited
    , embedding
    )
    select
      slack.to_timestamptz(e->>'ts')
    , e->>'channel'
    , e->>'team'
    , e->>'text'
    , e->>'type'
    , e->>'user'
    , e->'blocks'
    , slack.to_timestamptz(e->>'event_ts')
    , slack.to_timestamptz(e->>'thread_ts')
    , e->>'channel_type'
    , (e->>'client_msg_id')::uuid
    , e->>'parent_user_id'
    , e->>'bot_id'
    , e->'attachments'
    , e->'files'
    , e->>'app_id'
    , e->>'subtype'
    , e->>'trigger_id'
    , e->>'workflow_id'
    , (e->>'display_as_bot')::boolean
    , (e->>'upload')::boolean
    , e->'x_files'
    , e->'icons'
    , e->'language'
    , e->'edited'
    , (e->'embedding')::text::vector(1536)
    -- this case condition allows us to pass in either an array or a
    -- single instance of a message.
    from jsonb_array_elements(
      case when jsonb_typeof(_event) != 'array'
        then jsonb_build_array(_event)
        else _event
      end
    ) as e
    where not exists
    (
        select 1
        from slack.message_discard d
        where jsonb_path_match(e, d.match, silent=>true)
    )
    on conflict (channel_id, ts) do nothing;
$func$ language sql volatile security invoker
;