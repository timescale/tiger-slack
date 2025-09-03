--007-channel-search.sql

-----------------------------------------------------------------------
-- slack.find_channel_by_name
create or replace function slack.find_channel_by_name(_channel_name text) returns slack.channel
as $func$
    select *
    from slack.channel c
    where c.channel_name = _channel_name
    limit 1
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.search_channel_by_name
create or replace function slack.search_channel_by_name(_pattern text) returns setof slack.channel
as $func$
    select *
    from slack.channel c
    where regexp_like(c.channel_name, _pattern, 'i')
$func$ language sql stable security invoker
;
