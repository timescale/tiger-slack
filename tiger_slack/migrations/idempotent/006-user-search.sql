--006-user-search.sql

-----------------------------------------------------------------------
-- slack.find_user_by_email
create or replace function slack.find_user_by_email(_email text) returns slack."user"
as $func$
    select *
    from slack."user" u
    where u.email = _email
    limit 1
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.search_user_by_email
create or replace function slack.search_user_by_user_name(_pattern text) returns setof slack."user"
as $func$
    select *
    from slack."user" u
    where regexp_like(u.email, _pattern, 'i')
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.find_user_by_user_name
create or replace function slack.find_user_by_user_name(_user_name text) returns slack."user"
as $func$
    select *
    from slack."user" u
    where u.user_name = _user_name
    limit 1
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.search_user_by_user_name
create or replace function slack.search_user_by_user_name(_pattern text) returns setof slack."user"
as $func$
    select *
    from slack."user" u
    where regexp_like(u.user_name, _pattern, 'i')
$func$ language sql stable security invoker
;

-----------------------------------------------------------------------
-- slack.search_user_by_names
create or replace function slack.search_user_by_names(_pattern text) returns setof slack."user"
as $func$
    select *
    from slack."user" u
    where regexp_like(u.user_name, _pattern, 'i')
    or regexp_like(u.real_name, _pattern, 'i')
    or regexp_like(u.display_name, _pattern, 'i')
    or regexp_like(u.real_name_normalized, _pattern, 'i')
    or regexp_like(u.display_name_normalized, _pattern, 'i')
$func$ language sql stable security invoker
;