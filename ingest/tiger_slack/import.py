import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator
from pathlib import Path

import click
import logfire
import psycopg
from dotenv import find_dotenv, load_dotenv
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from tiger_slack.logging_config import setup_logging
from tiger_slack.migrations.runner import migrate_db

load_dotenv(dotenv_path=find_dotenv(usecwd=True))
setup_logging()

logger = logging.getLogger(__name__)


@logfire.instrument("get_channel_name_to_id_mapping", extract_args=False)
async def get_channel_name_to_id_mapping(pool: AsyncConnectionPool) -> dict[str, str]:
    async with pool.connection() as con, con.cursor() as cur:
        await cur.execute("""\
            select
              channel_name
            , id
            from slack.channel
        """)
        return {row[0]: row[1] for row in await cur.fetchall()}


@logfire.instrument("channel_dirs", extract_args=["directory"])
async def channel_dirs(
    pool: AsyncConnectionPool, directory: Path
) -> list[tuple[Path, str]]:
    name_to_id = await get_channel_name_to_id_mapping(pool)
    dirs = []
    for d in [
        d for d in directory.iterdir() if d.is_dir() and not d.name.startswith("FC:")
    ]:
        channel_name = d.name
        channel_id = name_to_id.get(channel_name)
        if channel_id is None:
            logger.warning(f"found no channel id for: {channel_name}")
            continue
        dirs.append((d, channel_id))
    dirs.sort()
    return dirs


async def channel_files(
    pool: AsyncConnectionPool, directory: Path
) -> AsyncGenerator[tuple[str, Path, str]]:
    all_files = []
    for channel_dir, channel_id in await channel_dirs(pool, directory):
        for file in channel_dir.glob("*.json"):
            all_files.append((channel_id, file))

    all_files.sort(key=lambda x: x[1].name)

    for channel_id, file in all_files:
        yield channel_id, file, file.read_text()


@logfire.instrument("load_users_from_file", extract_args=["file_path"])
async def load_users_from_file(pool: AsyncConnectionPool, file_path: Path) -> None:
    try:
        async with pool.connection() as con, con.cursor() as cur:
            with logfire.span("reading_users_file"):
                users_data = json.loads(file_path.read_text())

            with logfire.span("loading_users", num_users=len(users_data)):
                for user in users_data:
                    async with con.transaction() as _:
                        event = {"user": user}
                        await cur.execute(
                            "select * from slack.upsert_user(%s)", (Jsonb(event),)
                        )
    except Exception as e:
        logger.exception(
            "failed to load users from file",
            extra={"file_path": file_path, "error": str(e)},
        )
        raise


@logfire.instrument("load_channels_from_file", extract_args=["file_path"])
async def load_channels_from_file(pool: AsyncConnectionPool, file_path: Path) -> None:
    try:
        async with pool.connection() as con, con.cursor() as cur:
            with logfire.span("reading_channels_file"):
                channels_data = json.loads(file_path.read_text())

            with logfire.span("loading_channels", num_channels=len(channels_data)):
                for channel in channels_data:
                    async with con.transaction() as _:
                        event = {"channel": channel}
                        await cur.execute(
                            "select * from slack.upsert_channel(%s)", (Jsonb(event),)
                        )
    except Exception as e:
        logger.exception(
            "failed to load channels from file",
            extra={"file_path": file_path, "error": str(e)},
        )
        raise


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
, o->>'channel_id'
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


async def insert_messages(pool: AsyncConnectionPool, content: str) -> None:
    async with (
        pool.connection() as con,
        con.cursor() as cur,
    ):
        try:
            async with con.transaction() as _:
                with logfire.suppress_instrumentation():
                    await cur.execute(
                        MESSAGE_SQL, dict(json=content)
                    )
        except psycopg.Error as e:
            logger.exception(
                "failed to load json file",
                extra={"error": str(e)},
            )
            raise


@logfire.instrument("load_messages", extract_args=["directory"])
async def load_messages(pool: AsyncConnectionPool, directory: Path) -> None:
    buffer = ""
    item_count = 0
    async for channel_id, file, content in channel_files(pool, directory):
        num_elements = len(re.findall(r"^    {$", content, re.MULTILINE))
        content = re.sub(
            r"^    {$",
            f'    {{\n        "channel_id": "{channel_id}",',
            content,
            flags=re.MULTILINE,
        )
        if len(buffer) == 0:
            buffer = content
        else:
            buffer = buffer.rstrip("]") + "," + content.lstrip("[")
        item_count += num_elements
        if item_count >= 500:
            with logfire.span(
                "loading_messages_batch",
                channel_id=channel_id,
                file=file,
                num_messages=item_count,
            ):
                await insert_messages(pool, buffer)
            buffer = ""
            item_count = 0

    if len(buffer) > 0:
        with logfire.span(
            "loading_messages_final_batch",
            num_messages=item_count,
        ):
            await insert_messages(pool, buffer)


@logfire.instrument("run_import")
async def run_import(directory: Path):
    async with AsyncConnectionPool(min_size=1, max_size=1) as pool:
        await pool.wait()

        async with pool.connection() as con:
            await migrate_db(con)

        # Load users from users.json file
        users_file = directory / "users.json"
        if users_file.exists():
            await load_users_from_file(pool, users_file)
        else:
            logger.warning(
                "users.json not found in directory", extra={"directory": directory}
            )

        # Load channels from channels.json file
        channels_file = directory / "channels.json"
        if channels_file.exists():
            await load_channels_from_file(pool, channels_file)
        else:
            logger.warning(
                "channels.json not found in directory", extra={"directory": directory}
            )

        # Import message history from channel subdirectories
        await load_messages(pool, directory)


@click.command()
@click.argument(
    "directory",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
)
def main(directory: Path):
    asyncio.run(run_import(directory))


if __name__ == "__main__":
    main()
