import asyncio
import os
from pathlib import Path
from typing import AsyncGenerator

import click
import logfire
import psycopg
from dotenv import load_dotenv, find_dotenv
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool
from slack_sdk.web.async_client import AsyncWebClient

from tiger_slack import __version__
from tiger_slack.jobs import load_users, load_channels

load_dotenv(dotenv_path=find_dotenv(usecwd=True))

logfire.configure(
    service_name=os.getenv("SERVICE_NAME", "tiger-slack"),
    service_version=__version__,
)
logfire.instrument_psycopg()

database_url = os.getenv("DATABASE_URL")
assert database_url is not None, "DATABASE_URL environment variable is missing!"
slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
assert slack_bot_token is not None, "SLACK_BOT_TOKEN environment variable is missing!"


@logfire.instrument("get_channel_id", extract_args=["channel_name"])
async def get_channel_id(con: AsyncConnection, channel_name: str) -> str | None:
    async with con.cursor() as cur:
        await cur.execute("""\
            select id
            from slack.channel
            where channel_name = %s
        """, (channel_name,))
        row = await cur.fetchone()
        return row[0] if row else None


@logfire.instrument("channel_dirs", extract_args=["directory"])
async def channel_dirs(pool: AsyncConnectionPool, directory: Path) -> list[tuple[Path, str]]:
    dirs = []
    async with pool.connection() as con:
        for d in [d for d in directory.iterdir() if d.is_dir()]:
            channel_name = d.name
            channel_id = await get_channel_id(con, d.name)
            if channel_id is None:
                logfire.warning(f"found no channel id for: {channel_name}")
                continue
            dirs.append((d, channel_id))
    dirs.sort()
    return dirs


async def channel_files(pool: AsyncConnectionPool, directory: Path) -> AsyncGenerator[tuple[str, Path, str], None]:
    for channel_dir, channel_id in await channel_dirs(pool, directory):
        for file in channel_dir.glob("*.json"):
            yield channel_id, file, file.read_text()


MESSAGE_SQL = """\
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
, reactions
)
select
  slack.to_timestamptz(o->>'ts')
, %(channel_id)s
, o->>'team'
, o->>'text'
, o->>'type'
, o->>'user'
, o->'blocks'
, slack.to_timestamptz(o->>'event_ts')
, slack.to_timestamptz(o->>'thread_ts')
, o->>'channel_type'
, (o->>'client_msg_id')::uuid
, o->>'parent_user_id'
, o->>'bot_id'
, o->'attachments'
, o->'files'
, o->>'app_id'
, o->>'subtype'
, o->>'trigger_id'
, o->>'workflow_id'
, (o->>'display_as_bot')::bool
, (o->>'upload')::bool
, o->'x_files'
, o->'icons'
, o->'language'
, o->'edited'
, r.reactions
from jsonb_array_elements(%(json)s) o
left outer join lateral
(
    select jsonb_agg
    ( jsonb_build_object
      ( 'reaction', r."name"
      , 'user_id', u.user_id
      )
    ) as reactions
    from jsonb_to_recordset(o->'reactions') r("name" text, users jsonb, count bigint)
    inner join lateral jsonb_array_elements_text(r.users) u(user_id) on (true)
    where o->>'type' = 'message'
) r on (true)
where o->>'type' = 'message'
on conflict (ts, channel_id) do nothing
"""


async def load_messages(pool: AsyncConnectionPool, channel_id: str, file: Path, json: str) -> None:
    async with (
        pool.connection() as con,
        con.cursor() as cur,
    ):
        try:
            async with con.transaction() as _:
                with logfire.suppress_instrumentation():
                    await cur.execute(MESSAGE_SQL, dict(channel_id=channel_id, json=json))
        except psycopg.Error as _:
            logfire.exception("failed to load json file", channel_id=channel_id, file=file)


@logfire.instrument("run_import")
async def run_import(directory: Path):
    client = AsyncWebClient(token=slack_bot_token)
    async with AsyncConnectionPool(
            database_url,
            min_size=1,
            max_size=1
    ) as pool:
        await pool.wait()
        await load_users(client, pool)
        await load_channels(client, pool)
        async for channel_id, file, json in channel_files(pool, directory):
            await load_messages(pool, channel_id, file, json)


@click.command()
@click.argument('directory', type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path))
def main(directory: Path):
    asyncio.run(run_import(directory))


if __name__ == "__main__":
    main()
