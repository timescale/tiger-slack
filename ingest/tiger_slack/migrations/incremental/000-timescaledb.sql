create extension if not exists timescaledb with schema public;

do $block$
declare
    _sql text;
begin
    _sql = format($$alter database %I set timescaledb.enable_chunk_skipping = on;$$, current_database());
    execute _sql;
end
$block$;
