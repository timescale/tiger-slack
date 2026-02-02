import asyncio
import json
import logging
import re
from collections import deque
from datetime import date, datetime
from pathlib import Path
from typing import Any

import aiofiles
import click
import logfire
import psycopg
import tiktoken
from dotenv import find_dotenv, load_dotenv
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from tiger_slack.constants import SEARCH_CONTENT_FIELD
from tiger_slack.logging_config import setup_logging
from tiger_slack.migrations.runner import migrate_db
from tiger_slack.utils import (
    add_message_embeddings,
    add_message_searchable_content,
    parse_since_flag,
    remove_null_bytes,
)

load_dotenv(dotenv_path=find_dotenv())
setup_logging()

logger = logging.getLogger(__name__)
token_encoder = tiktoken.encoding_for_model("text-embedding-3-small")

MAX_TOKENS_PER_EMBEDDING_REQUEST = 300_000
DESIRED_BATCH_SIZE = 500  # legacy, not sure if legit


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
    pool: AsyncConnectionPool, directory: Path, since: date | None = None
) -> list[tuple[str, Path]]:
    all_files = []
    for channel_dir, channel_id in await channel_dirs(pool, directory):
        for file in channel_dir.glob("*.json"):
            date_match = re.match(r"^(\d{4}-\d{2}-\d{2})\.json$", file.name)
            if date_match:
                file_date_str = date_match.group(1)
                try:
                    file_date = datetime.strptime(file_date_str, "%Y-%m-%d").date()
                    if since is None or file_date >= since:
                        all_files.append((channel_id, file))
                except ValueError:
                    logger.warning(
                        f"Skipping file with invalid date format in filename: {file}",
                        extra={"channel_id": channel_id, "filename": file.name},
                    )
            else:
                logger.warning(
                    f"Skipping file with non-standard filename: {file}",
                    extra={"channel_id": channel_id, "filename": file.name},
                )

    all_files.sort(key=lambda x: x[1].name)

    return all_files


@logfire.instrument("load_users_from_file", extract_args=["file_path"])
async def load_users_from_file(pool: AsyncConnectionPool, file_path: Path) -> None:
    try:
        async with pool.connection() as con, con.cursor() as cur:
            with logfire.span("reading_users_file"):
                users_data = json.loads(file_path.read_text())

            with logfire.span("loading_users", num_users=len(users_data)):
                with logfire.suppress_instrumentation():
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
                with logfire.suppress_instrumentation():
                    for channel in channels_data:
                        async with con.transaction() as _:
                            event = {"channel": channel}
                            await cur.execute(
                                "select * from slack.upsert_channel(%s)",
                                (Jsonb(event),),
                            )
    except Exception as e:
        logger.exception(
            "failed to load channels from file",
            extra={"file_path": file_path, "error": str(e)},
        )
        raise


async def filter_messages(
    pool: AsyncConnectionPool, messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Filter out messages that match discard patterns before embedding."""
    with logfire.suppress_instrumentation():
        async with pool.connection() as con, con.cursor() as cur:
            await cur.execute(
                "select slack.filter_messages(%s)",
                [Jsonb(messages)],
            )
            result = await cur.fetchone()
            if result and result[0]:
                return result[0]
            return []


async def insert_messages(
    pool: AsyncConnectionPool, messages: list[dict[str, Any]]
) -> None:
    with logfire.suppress_instrumentation():
        async with (
            pool.connection() as con,
            con.cursor() as cur,
        ):
            try:
                async with con.transaction() as _:
                    with logfire.suppress_instrumentation():
                        await cur.execute(
                            "select slack.insert_message(%s)",
                            [Jsonb(remove_null_bytes(messages))],
                        )
            except psycopg.Error as e:
                logger.exception(
                    "failed to load json file",
                    extra={"error": str(e)},
                )
                raise


## This is the process
# 1. get file from the file queue
# 2. read all messages from file
# 3. filter out messages (this uses the psql function that uses message_discard)
# 4. add filtered messages to the message_buffer
# 5. iterate over message_buffer, building up a batch of messages to insert (this is based on the token count of each new message  and DESIRED_BATCH_SIZE)
# 6. keep looping until all files are read (when the queue returns None), the message buffer is processed and the current batch is empty
async def process_file_worker(
    pool: AsyncConnectionPool,
    file_queue: asyncio.Queue[tuple[str, Path] | None],
    worker_id: int,
) -> None:
    # the messages to be imported in next batch
    current_message_batch: list[dict[str, Any]] = []

    # the messages to be processed (e.g. ones that were imported via file read)
    # using a deque (double ended queue) instead of a list because a pop(0) in a
    # list is a O(n) operation, rather than the O(1) you get with deque
    message_buffer: deque[dict[str, Any]] = deque([])

    files: list[tuple[str, str]] = []
    token_count = 0

    while True:
        item = await file_queue.get()

        if item is not None:
            channel_id, file = item
            files.append((channel_id, str(file.relative_to(file.parent.parent))))
            try:
                async with aiofiles.open(file) as f:
                    file_content = await f.read()

                raw_messages = json.loads(file_content)

                for message in raw_messages:
                    message["channel"] = channel_id
                    add_message_searchable_content(message)

                # Filter out messages that match discard patterns
                filtered_messages = await filter_messages(pool, raw_messages)

                new_messages = deque(filtered_messages)
                message_buffer += new_messages

            except Exception:
                logfire.exception(f"Failed to load messages from {file}")
        else:
            file_queue.task_done()

        try:
            # this is determined by whether or not the current batches token count
            # is less than the MAX_TOKENS_PER_EMBEDDING_REQUEST count
            should_add_messages_to_current_batch = True

            # this is going to add messages to the current batch if the message's token count
            # plus the current batch's token count does not exceed openai's embedding max per request
            # which is currently 300k for the model we are using
            while len(message_buffer) or len(current_message_batch):
                if len(message_buffer):
                    message = message_buffer.popleft()

                    searchable_content = message[SEARCH_CONTENT_FIELD]

                    tokens_in_message_text = (
                        len(token_encoder.encode(searchable_content))
                        if searchable_content
                        else 0
                    )

                    can_encode_message_in_batch = (
                        token_count + tokens_in_message_text
                    ) < MAX_TOKENS_PER_EMBEDDING_REQUEST

                    if can_encode_message_in_batch:
                        current_message_batch.append(message)
                        token_count += tokens_in_message_text
                    else:
                        message_buffer.appendleft(message)
                        should_add_messages_to_current_batch = False

                ## insert the current batch if:
                # the batch size meets our DESIRED_BATCH_SIZE
                # OR we can't add more messages due to token size
                # OR there are no more files to read and there are no
                # more messages in the buffer
                if (
                    (len(current_message_batch) >= DESIRED_BATCH_SIZE)
                    or (not should_add_messages_to_current_batch)
                    or (item is None and not len(message_buffer))
                ):
                    with logfire.span(
                        "Embedding messages", num_messages=len(current_message_batch)
                    ):
                        await add_message_embeddings(current_message_batch, True)
                    with logfire.span(
                        "loading_messages_batch",
                        worker_id=worker_id,
                        files=files,
                        num_messages=len(current_message_batch),
                    ):
                        await insert_messages(pool, current_message_batch)
                    files = []
                    current_message_batch = []
                    token_count = 0
                    should_add_messages_to_current_batch = True
                # if there are more files to read from and there is nothing else in the buffer
                elif item is not None and not len(message_buffer):
                    break

            # the buffer and current batch are empty and there are no more files to process
            if item is None:
                break
        except Exception:
            logfire.exception("Failed to import messages")


@logfire.instrument("load_messages", extract_args=["directory", "num_workers"])
async def load_messages(
    pool: AsyncConnectionPool,
    directory: Path,
    num_workers: int = 4,
    since: date | None = None,
) -> None:
    files = await channel_files(pool, directory, since)

    with logfire.span(
        "parallel_processing", num_files=len(files), num_workers=num_workers
    ):
        file_queue: asyncio.Queue[tuple[str, Path] | None] = asyncio.Queue()
        for file_data in files:
            await file_queue.put(file_data)

        # Add sentinel values to signal workers to stop
        # Otherwise, the queue.get() will hang indefinitely in each worker
        for _ in range(num_workers):
            await file_queue.put(None)

        async with asyncio.TaskGroup() as tg:
            for worker_id in range(num_workers):
                tg.create_task(
                    process_file_worker(
                        pool,
                        file_queue,
                        worker_id,
                    )
                )


@logfire.instrument("compress_old_messages", extract_args=False)
async def compress_old_messages(pool: AsyncConnectionPool) -> None:
    async with pool.connection() as con, con.cursor() as cur:
        # get the compression policy interval
        await cur.execute("""
              select config->>'compress_after' as compress_after
              from timescaledb_information.jobs
              where proc_name = 'policy_compression'
              and hypertable_schema = 'slack'
              and hypertable_name = 'message'
          """)
        row = await cur.fetchone()
        if not row or not row[0]:
            logger.info("no compression policy set on slack.message")
            return
        compress_after = row[0]  # e.g., "45 days"

        # get a list of chunks to compress
        await cur.execute(
            """
            select public.show_chunks('slack.message', older_than => %s::text::interval)
        """,
            (compress_after,),
        )
        chunks = [row[0] for row in await cur.fetchall()]
        if not chunks:
            logger.info("no chunks from slack.message to compress")
            return

        # compress each chunk
        for chunk in chunks:
            with logfire.span("compressing_chunk", chunk=chunk):
                await cur.execute(
                    """
                      select public.compress_chunk(%s::text::regclass, if_not_compressed => true)
                  """,
                    (chunk,),
                )


@logfire.instrument("run_import")
async def run_import(directory: Path, num_workers: int, since: date | None = None):
    await migrate_db()

    async with AsyncConnectionPool(min_size=1, max_size=num_workers + 1) as pool:
        await pool.wait()

        # Load users from users.json file
        # users_file = directory / "users.json"
        # if users_file.exists():
        #     await load_users_from_file(pool, users_file)
        # else:
        #     logger.warning(
        #         "users.json not found in directory", extra={"directory": directory}
        #     )

        # Load channels from channels.json file
        # channels_file = directory / "channels.json"
        # if channels_file.exists():
        #     await load_channels_from_file(pool, channels_file)
        # else:
        #     logger.warning(
        #         "channels.json not found in directory", extra={"directory": directory}
        #     )

        # Import message history from channel subdirectories
        await load_messages(pool, directory, num_workers, since)


@click.command()
@click.argument(
    "directory",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
)
@click.option(
    "--workers",
    type=int,
    default=5,
    help="Number of parallel workers for processing files (default: 5)",
)
@click.option(
    "--since",
    type=str,
    default=None,
    help="Only import messages since this date. Format: YYYY-MM-DD or duration (e.g., 7M, 30D, 1Y, 4W)",
)
def main(directory: Path, workers: int, since: str | None):
    # Parse the since flag if provided
    since_date: date | None = None
    if since is not None:
        try:
            since_date = parse_since_flag(since)
            logger.info(f"Importing messages since {since_date}")
        except ValueError as e:
            logger.error(str(e))
            raise click.ClickException(str(e))

    asyncio.run(run_import(directory, workers, since_date))


if __name__ == "__main__":
    main()
