--008-message-search.sql

-----------------------------------------------------------------------
-- slack.get_thread_stats
create or replace function slack.get_thread_stats
( _channel_id text
, _thread_ts timestamptz
) 
returns table
( num_msgs int8
, min_ts timestamptz
, max_ts timestamptz
, length interval
)
as $func$
    select
      count(1) as num_msgs
    , min(m.ts) as min_ts
    , max(m.ts) as max_ts
    , max(m.ts) - min(m.ts) as length
    from slack.message m
    where m.channel_id = _channel_id
    and m.thread_ts = _thread_ts
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.get_thread_by_range
create or replace function slack.get_thread_by_range
( _channel_id text
, _thread_ts timestamptz
, _time_range tstzrange default null
) returns setof slack.message
as $func$
    select *
    from slack.message m
    where m.channel_id = _channel_id
    and m.thread_ts = _thread_ts
    and m.ts <@ _time_range
    order by m.ts
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.get_thread_from_end
create or replace function slack.get_thread_from_end
( _channel_id text
, _thread_ts timestamptz
, _limit int8 default 10
) returns setof slack.message
as $func$
    with x as
    (
        select *
        from slack.message m
        where m.channel_id = _channel_id
        and m.thread_ts = _thread_ts
        order by m.ts desc
        limit _limit
    )
    select *
    from x
    order by x.ts asc
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.get_channel_by_range
create or replace function slack.get_channel_by_range
( _channel_id text
, _range tstzrange default tstzrange((now() - interval '1h'), now(), '[)')
, _limit int8 default 10
) returns setof slack.message
as $func$
    with x as
    (
        select *
        from slack.message m
        where m.channel_id = _channel_id
        and m.ts <@ _range
        order by m.ts desc
        limit _limit
    )
    select *
    from x
    order by x.ts asc
$func$ language sql stable security invoker
;