import asyncio
import logging
import os
import signal
from typing import Any

import aiocron
import logfire
from dotenv import find_dotenv, load_dotenv
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool
from slack_bolt.adapter.socket_mode.websockets import AsyncSocketModeHandler
from slack_bolt.app.async_app import AsyncApp

from tiger_slack import jobs
from tiger_slack.events import register_handlers
from tiger_slack.logging_config import setup_logging
from tiger_slack.migrations.runner import migrate_db
from tiger_slack.utils import is_table_empty

load_dotenv(dotenv_path=find_dotenv(usecwd=True))
setup_logging()

logger = logging.getLogger(__name__)


def shutdown_handler(signum: int, _frame: Any):
    signame = signal.Signals(signum).name
    logger.info(f"received {signame}, exiting")
    loop = asyncio.get_running_loop()
    loop.stop()
    exit(0)


def exception_handler(_, context):
    with logfire.span("asyncio loop exception") as _:
        exception = context.get("exception")
        if exception:
            logger.error("asyncio task failed", exc_info=exception, extra=context)
        else:
            logger.error("asyncio task failed", extra=context)


async def configure_database_connection(con: AsyncConnection) -> None:
    await con.set_autocommit(True)


async def reset_database_connection(con: AsyncConnection) -> None:
    await con.set_autocommit(True)


async def main() -> None:
    slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
    assert slack_bot_token is not None, (
        "SLACK_BOT_TOKEN environment variable is missing!"
    )
    slack_app_token = os.getenv("SLACK_APP_TOKEN")
    assert slack_app_token is not None, (
        "SLACK_APP_TOKEN environment variable is missing!"
    )

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    loop = asyncio.get_running_loop()
    loop.set_exception_handler(exception_handler)

    await migrate_db()

    async with AsyncConnectionPool(
        check=AsyncConnectionPool.check_connection,
        configure=configure_database_connection,
        reset=reset_database_connection,
    ) as pool:
        await pool.wait()

        app = AsyncApp(
            token=slack_bot_token,
            ignoring_self_events_enabled=False,
        )

        async def load_users() -> None:
            await jobs.load_users(app.client, pool)

        async def load_channels() -> None:
            await jobs.load_channels(app.client, pool)

        @aiocron.crontab("0 1 * * *")
        async def daily_user_job() -> None:
            await load_users()

        @aiocron.crontab("0 1 * * *")
        async def daily_channel_job() -> None:
            await load_channels()

        if await is_table_empty(pool, "user"):
            await load_users()

        if await is_table_empty(pool, "channel"):
            await load_channels()

        handler = AsyncSocketModeHandler(app, slack_app_token)

        async with asyncio.TaskGroup() as tasks:
            await register_handlers(app, pool)
            tasks.create_task(handler.start_async())


if __name__ == "__main__":
    asyncio.run(main())
