-- ensure a suitable version of timescaledb is installed
do $block$
begin
    -- is timescaledb installed?
    perform 
    from pg_extension
    where extname = 'timescaledb'
    ;
    if found then
        -- yes! a supported version?
        perform
        from
        (
            select
              x.parts[1]::int as major
            , x.parts[2]::int as minor
            , x.parts[3]::int as patch
            from
            (
                select string_to_array(x.extversion, '.') parts
                from pg_extension x
                where x.extname = 'timescaledb'
            ) x
        ) x
        where
        (
            (x.major = 2 and x.minor = 22 and x.patch >= 1)
            or (x.major = 2 and x.minor > 22)
            or (x.major > 2)
        )
        ;
        if not found then
            raise exception 'timescaledb extension version 2.22.1 or greater is required. please upgrade';
        end if;
    else
        -- no. is it available in a version we support?
        perform
        from
        (
            select
              x.parts[1]::int as major
            , x.parts[2]::int as minor
            , x.parts[3]::int as patch
            from
            (
                select string_to_array(x.version, '.') parts
                from pg_available_extension_versions x
                where x.name = 'timescaledb'
            ) x
        ) x
        where 
        (
            (x.major = 2 and x.minor = 22 and x.patch >= 1)
            or (x.major = 2 and x.minor > 22)
            or (x.major > 2)
        )
        ;
        if found then
            create extension if not exists timescaledb with schema public;
        else
            raise exception 'timescaledb extension version 2.22.1 or greater is required but not available';
        end if;
    end if
    ;
end
$block$;
