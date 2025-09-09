from typing import Any

import logfire
from psycopg import AsyncCursor
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from slack_sdk.web.async_client import AsyncWebClient
from slack_sdk.web.async_slack_response import AsyncSlackResponse
from tiger_slack.utils import get_connection_info

# Advisory lock keys for job coordination
USERS_LOCK_KEY = 5245366294413312
CHANNELS_LOCK_KEY = 6801911210587046


def get_response_data(response: AsyncSlackResponse) -> dict[str, Any]:
    if isinstance(response.data, dict):
        return response.data
    else:
        logfire.error(
            "unexpected response data type from slack api",
            data_type=type(response.data).__name__,
            response_status=response.status_code,
        )
        raise TypeError(
            f"expected dict response from slack api, got {type(response.data)}"
        )


@logfire.instrument("try_job_lock", extract_args=["shared_lock_key"])
async def try_lock(cur: AsyncCursor, shared_lock_key: int) -> bool:
    await cur.execute(
        "select pg_try_advisory_xact_lock(%s::bigint)", (shared_lock_key,)
    )
    row = await cur.fetchone()
    if not row:
        raise Exception(
            "attempting to get an advisory lock for job failed to return a row"
        )
    return bool(row[0])


@logfire.instrument("load_users", extract_args=False)
async def load_users(client: AsyncWebClient, pool: AsyncConnectionPool) -> None:
    try:
        async with pool.connection() as con, con.cursor() as cur:
            # make sure no one else is already running the job
            if not await try_lock(cur, USERS_LOCK_KEY):
                return
            args = {"limit": 999}
            while True:
                with logfire.span("users_list"):
                    response: AsyncSlackResponse = await client.users_list(**args)
                    data = get_response_data(response)
                    ok = data.get("ok")
                    if not ok:
                        raise Exception("response from users_list was not 'ok'")
                with logfire.span(
                    "loading_users", num_users=len(data.get("members", []))
                ):
                    for user in data.get("members", []):
                        async with con.transaction() as _:
                            event = {"user": user}
                            await cur.execute(
                                "select * from slack.upsert_user(%s)", (Jsonb(event),)
                            )
                if "response_metadata" in data:
                    next_cursor = data["response_metadata"].get("next_cursor")
                    if next_cursor:
                        args["cursor"] = next_cursor
                        continue
                break
    except Exception as _:
        logfire.exception("failed to load users")


@logfire.instrument("load_channels", extract_args=False)
async def load_channels(client: AsyncWebClient, pool: AsyncConnectionPool) -> None:
    try:
        async with pool.connection() as con, con.cursor() as cur:
            # make sure no one else is already running the job
            if not await try_lock(cur, CHANNELS_LOCK_KEY):
                return
            args = {"limit": 999}
            while True:
                with logfire.span("conversations_list"):
                    response: AsyncSlackResponse = await client.conversations_list(
                        **args
                    )
                    data = get_response_data(response)
                    ok = data.get("ok")
                    if not ok:
                        raise Exception("response from conversations_list was not 'ok'")
                with logfire.span(
                    "loading_channels", num_channels=len(data.get("channels", []))
                ):
                    for channel in data.get("channels", []):
                        async with con.transaction() as _:
                            event = {"channel": channel}
                            await cur.execute(
                                "select * from slack.upsert_channel(%s)",
                                (Jsonb(event),),
                            )
                if "response_metadata" in data:
                    next_cursor = data["response_metadata"].get("next_cursor")
                    logfire.info(f"next_cursor: {next_cursor}")
                    if next_cursor:
                        args["cursor"] = next_cursor
                        continue
                break
    except Exception as _:
        logfire.exception("failed to upsert channels")


if __name__ == "__main__":
    import asyncio
    import os

    from dotenv import find_dotenv, load_dotenv

    from tiger_slack import __version__

    load_dotenv(dotenv_path=find_dotenv(usecwd=True))

    logfire.configure(
        service_name=os.getenv("SERVICE_NAME", "tiger-slack-ingest"),
        service_version=__version__,
    )
    logfire.instrument_psycopg()

    conn_info = get_connection_info()
    slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
    assert slack_bot_token is not None, (
        "SLACK_BOT_TOKEN environment variable is missing!"
    )

    client = AsyncWebClient(token=slack_bot_token)

    async def main():
        async with AsyncConnectionPool(conn_info, min_size=1, max_size=1) as pool:
            await pool.wait()
            await load_users(client, pool)
            await load_channels(client, pool)

    asyncio.run(main())
