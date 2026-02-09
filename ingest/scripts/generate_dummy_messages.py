"""Generate dummy Slack messages for testing.

This script generates fake slack.message_vanilla rows with unique timestamps
and static field values. Useful for testing the backfill_searchable_content.py
script and other message processing features.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import click
import logfire
from dotenv import find_dotenv, load_dotenv
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic_ai import Embedder

from tiger_slack.logging_config import setup_logging
from tiger_slack.utils import (
    MockEmbedder,
    add_message_embeddings,
    add_message_searchable_content,
    embedder,
)

load_dotenv(dotenv_path=find_dotenv())
setup_logging()

logger = logging.getLogger(__name__)

# Static values for generated messages
FAKE_CHANNEL_ID = "C01234567890"
FAKE_TEAM = "T01234567890"
FAKE_USER_ID = "U01234567890"
FAKE_TEXT = "This is a fake message for testing purposes."


def generate_message(
    base_time: datetime, offset_seconds: int, with_attachments: bool = False
) -> dict[str, Any]:
    """Generate a single fake message dict.

    Args:
        base_time: Base timestamp to start from
        offset_seconds: Number of seconds to add to base_time for this message
        with_attachments: Whether to include fake attachments
    """
    ts_dt = base_time + timedelta(seconds=offset_seconds)
    ts_str = str(ts_dt.timestamp())

    message = {
        "ts": ts_str,
        "channel": FAKE_CHANNEL_ID,
        "team": FAKE_TEAM,
        "text": FAKE_TEXT,
        "type": "message",
        "user": FAKE_USER_ID,
        "event_ts": ts_str,
        "channel_type": "channel",
        "client_msg_id": str(uuid.uuid4()),
    }

    # Add attachments to every other message for testing
    if with_attachments:
        message["attachments"] = [
            {
                "title": "Fake attachment title",
                "text": "Fake attachment text with some content",
                "fallback": "Fake attachment fallback text",
            }
        ]

    return message


async def insert_dummy_messages(
    pool: AsyncConnectionPool,
    messages: list[dict[str, Any]],
    use_dummy_embeddings: bool = False,
    add_searchable_content: bool = False,
) -> None:
    """Insert generated messages into the database.

    Args:
        pool: Database connection pool
        messages: List of message dicts to insert
        use_dummy_embeddings: If True, use dummy embeddings instead of calling OpenAI
        add_searchable_content: If True, add searchable_content field before insertion
    """
    # Determine dummy embedding value based on add_searchable_content flag
    # If add_searchable_content is True, use 1.0, otherwise use 0.0
    # But only use dummy embeddings if use_dummy_embeddings is True
    mock_embedder: Embedder | None = None
    if use_dummy_embeddings:
        val = 1.0 if add_searchable_content else 0.0
        mock_embedder = MockEmbedder(val)

    # Add searchable_content field to each message if requested
    if add_searchable_content:
        for msg in messages:
            add_message_searchable_content(msg)

    # Add embeddings
    await add_message_embeddings(
        messages,
        field_to_embed=None if add_searchable_content else "text",
        embedder=mock_embedder if mock_embedder else embedder,
    )

    # Insert into database using slack.insert_message function (accepts array)
    with logfire.suppress_instrumentation():
        async with pool.connection() as con, con.cursor() as cur:
            await cur.execute(
                "select slack.insert_message(%s)",
                [Jsonb(messages)],
            )
            await con.commit()

    logger.info(f"Inserted {len(messages)} dummy messages")


async def run_generation(
    count: int,
    with_attachments_pct: int,
    use_dummy_embeddings: bool,
    add_searchable_content: bool,
    batch_size: int,
) -> None:
    """Run the dummy message generation process."""
    if not 0 <= with_attachments_pct <= 100:
        raise click.BadParameter("with-attachments-pct must be between 0 and 100")

    logger.info(
        f"Generating {count} dummy messages "
        f"({with_attachments_pct}% with attachments, "
        f"add_searchable_content={add_searchable_content}, "
        f"use_dummy_embeddings={use_dummy_embeddings})"
    )

    # Use current time as base, and increment by 1 second per message
    base_time = datetime.now(UTC)

    # Generate messages
    messages = []
    for i in range(count):
        # Determine if this message should have attachments
        with_attachments = (i % 100) < with_attachments_pct
        msg = generate_message(base_time, i, with_attachments=with_attachments)
        messages.append(msg)

    # Connect to database
    async with AsyncConnectionPool(
        open=True,
        min_size=1,
        max_size=5,
    ) as pool:
        # Insert in batches
        for i in range(0, len(messages), batch_size):
            batch = messages[i : i + batch_size]
            logger.info(
                f"Inserting batch {i // batch_size + 1} ({len(batch)} messages)"
            )
            await insert_dummy_messages(
                pool, batch, use_dummy_embeddings, add_searchable_content
            )

    logger.info(f"Successfully generated {count} dummy messages")


@click.command()
@click.argument("count", type=int)
@click.option(
    "--with-attachments-pct",
    type=int,
    default=50,
    help="Percentage of messages that should have attachments (0-100)",
)
@click.option(
    "--use-dummy-embeddings",
    is_flag=True,
    default=False,
    help="Use dummy embeddings instead of calling OpenAI API",
)
@click.option(
    "--add-searchable-content",
    is_flag=True,
    default=False,
    help="Add searchable_content field and embeddings to messages before insertion",
)
@click.option(
    "--batch-size",
    type=int,
    default=100,
    help="Number of messages to insert per batch",
)
def main(
    count: int,
    with_attachments_pct: int,
    use_dummy_embeddings: bool,
    add_searchable_content: bool,
    batch_size: int,
) -> None:
    """Generate COUNT dummy messages and insert them into slack.message_vanilla.

    Examples:
        # Generate 1000 messages without searchable_content (for backfill testing)
        python generate_dummy_messages.py 1000

        # Generate 1000 messages with searchable_content and dummy embeddings
        python generate_dummy_messages.py 1000 --add-searchable-content --use-dummy-embeddings

        # Generate 500 messages, 80% with attachments, using real embeddings
        python generate_dummy_messages.py 500 --with-attachments-pct 80 --add-searchable-content

        # Generate 2000 messages in batches of 500
        python generate_dummy_messages.py 2000 --batch-size 500
    """
    asyncio.run(
        run_generation(
            count,
            with_attachments_pct,
            use_dummy_embeddings,
            add_searchable_content,
            batch_size,
        )
    )


if __name__ == "__main__":
    main()
