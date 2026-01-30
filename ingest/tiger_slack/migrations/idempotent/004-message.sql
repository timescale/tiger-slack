--004-message.sql

-----------------------------------------------------------------------
-- slack.filter_messages
-- Returns messages that don't match any discard patterns
-- This allows filtering BEFORE expensive operations like embedding
create or replace function slack.filter_messages(_messages jsonb) returns jsonb
as $func$
    select jsonb_agg(e)
    from jsonb_array_elements(
        case when jsonb_typeof(_messages) != 'array'
            then jsonb_build_array(_messages)
            else _messages
        end
    ) as e
    where not exists (
        select 1
        from slack.message_discard d
        where jsonb_path_match(e, d.match, silent=>true)
    );
$func$ language sql stable security invoker
;


-----------------------------------------------------------------------
-- slack.insert_message
-- this will insert messages into both slack.message (hypertable) and slack.message_vanilla (non-hypertable)
-- message_vanilla gets an embedding and a searchable_content column, whereas message does not
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
    )
    select
      slack.to_timestamptz(e->>'ts')
    , e->>'channel'
    , e->>'team'
    , nullif(e->>'text', '')
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
    from jsonb_array_elements(slack.filter_messages(_event)) as e
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
    , searchable_content
    )
    select
      slack.to_timestamptz(e->>'ts')
    , e->>'channel'
    , e->>'team'
    , nullif(e->>'text', '')
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
    , nullif(e->>'searchable_content', '')
    from jsonb_array_elements(slack.filter_messages(_event)) as e
    on conflict (channel_id, ts) do nothing;
$func$ language sql volatile security invoker
;

-- this updates slack.update_message to use the embedding on the event, itself
create or replace function slack.update_message(_event jsonb) returns void
as $func$
    update slack.message m set
      team = _event->>'team'
    , text = nullif(_event->>'text', '')
    , type = _event->>'type'
    , user_id = _event->>'user'
    , blocks = _event->'blocks'
    , attachments = _event->'attachments'
    , files = _event->'files'
    , app_id = _event->>'app_id'
    , subtype = _event->>'subtype'
    , trigger_id = _event->>'trigger_id'
    , workflow_id = _event->>'workflow_id'
    , display_as_bot = (_event->>'display_as_bot')::boolean
    , upload = (_event->>'upload')::boolean
    , x_files =  _event->'x_files'
    , icons = _event->'icons'
    , language = _event->'language'
    , edited = _event->'edited'
    where (m.ts, m.channel_id) =
    ( slack.to_timestamptz(_event->>'ts')
    , _event->>'channel'
    );

    update slack.message_vanilla m set
         team = _event->>'team'
    , text = nullif(_event->>'text', '')
    , type = _event->>'type'
    , user_id = _event->>'user'
    , blocks = _event->'blocks'
    , attachments = _event->'attachments'
    , files = _event->'files'
    , app_id = _event->>'app_id'
    , subtype = _event->>'subtype'
    , trigger_id = _event->>'trigger_id'
    , workflow_id = _event->>'workflow_id'
    , display_as_bot = (_event->>'display_as_bot')::boolean
    , upload = (_event->>'upload')::boolean
    , x_files =  _event->'x_files'
    , icons = _event->'icons'
    , language = _event->'language'
    , edited = _event->'edited'
    , embedding = (_event->'embedding')::text::vector(1536)
    , searchable_content = nullif(_event->>'searchable_content', '')
    where (m.ts, m.channel_id) =
    ( slack.to_timestamptz(_event->>'ts')
    , _event->>'channel'
    );
$func$ language sql volatile security invoker
;

-----------------------------------------------------------------------
-- slack.delete_message
create or replace function slack.delete_message(_event jsonb) returns void
as $func$
    delete from slack.message m
    where m.ts = slack.to_timestamptz(_event->>'deleted_ts')
    and m.channel_id = _event->>'channel';

    delete from slack.message_vanilla m
    where m.ts = slack.to_timestamptz(_event->>'deleted_ts')
    and m.channel_id = _event->>'channel';
$func$ language sql volatile security invoker
;