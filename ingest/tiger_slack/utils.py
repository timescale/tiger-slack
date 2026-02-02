import logging
import re
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any, TypeVar

import logfire
from dateutil.relativedelta import relativedelta
from psycopg import sql
from psycopg_pool import AsyncConnectionPool
from pydantic_ai import Embedder

from tiger_slack.constants import SEARCH_CONTENT_FIELD

T = TypeVar("T")


embedder = Embedder("openai:text-embedding-3-small")
logger = logging.getLogger(__name__)


@logfire.instrument("is_table_empty", extract_args=["table_name"])
async def is_table_empty(pool: AsyncConnectionPool, table_name: str) -> bool:
    async with pool.connection() as con, con.cursor() as cur:
        await cur.execute(
            sql.SQL("SELECT EXISTS(SELECT 1 FROM slack.{} LIMIT 1)").format(
                sql.Identifier(table_name)
            )
        )
        row = await cur.fetchone()
        if not row:
            raise Exception(f"Failed to check if table {table_name} is empty")
        return not bool(row[0])


def remove_null_bytes(obj: T, escaped: bool = False) -> T:
    """Recursively remove null bytes from strings in a nested structure.

    When passing in a string read in from a file (such as from a slack export), then
    set `escaped` to True as Python will escape the `\u0000` sequence to `\\u0000`
    when reading the file.

    When passing in an object that comes from an external source (such as Slack's API),
    then set `escaped` to False as the null byte will be an actual null byte (`\x00`).

    Args:
        obj: The input object which can be a string, list, dict, or other types
        escaped: If True, remove escaped null bytes (\\u0000). If False, remove actual null bytes (\x00).
    """
    if isinstance(obj, str):
        if escaped:
            return re.sub(r"(?<!\\)\\u0000", "", obj)
        else:
            # \u0000 is equivalent to \x00 for null byte in Python strings
            return obj.replace("\x00", "")  # type: ignore[return-value]
    elif isinstance(obj, list):
        return [remove_null_bytes(item) for item in obj]  # type: ignore[return-value]
    elif isinstance(obj, dict):
        return {key: remove_null_bytes(value) for key, value in obj.items()}  # type: ignore[return-value]
    return obj


def parse_since_flag(since_str: str) -> date:
    """Parse a --since flag value into a date object.

    Supports two formats:
    1. Absolute date: YYYY-MM-DD (e.g., "2025-01-15")
    2. Duration: <number><unit> where unit is D (days), W (weeks), M (months), or Y (years)
       (e.g., "7M" for 7 months ago, "30D" for 30 days ago)

    Duration calculations are calendar-aware (using dateutil.relativedelta) to handle
    edge cases like varying month lengths and leap years correctly.

    Args:
        since_str: The input string to parse

    Returns:
        A date object representing the cutoff date

    Raises:
        ValueError: If the input string is not in a recognized format
    """
    # Try parsing as absolute date first (YYYY-MM-DD)
    try:
        return datetime.strptime(since_str, "%Y-%m-%d").date()
    except ValueError:
        pass

    # Try parsing as duration (e.g., 7M, 30D, 1Y, 4W)
    duration_match = re.match(r"^(\d+)([DWMY])$", since_str, re.IGNORECASE)
    if duration_match:
        amount = int(duration_match.group(1))
        unit = duration_match.group(2)
        if unit:
            unit = unit.upper()

        today = date.today()

        if unit == "D":
            return today - relativedelta(days=amount)
        elif unit == "W":
            return today - relativedelta(weeks=amount)
        elif unit == "M":
            return today - relativedelta(months=amount)
        elif unit == "Y":
            return today - relativedelta(years=amount)

    # If we get here, the format is invalid
    raise ValueError(
        f"Invalid --since format: '{since_str}'. "
        f"Expected YYYY-MM-DD or duration format like '7M', '30D', '1Y', '4W'"
    )


# this will add searchable content to a message
# It will be formatted like so:
# Text: message.text
# Attachment {index}
# Title: attachment[].title
# Text: attachment[].text
# Fallback: attachment[].fallback
def add_message_searchable_content(message: dict[str, Any]) -> None:
    message[SEARCH_CONTENT_FIELD] = message.get("text", "")
    attachments = message.get("attachments", []) or []

    for index, attachment in enumerate(attachments):
        message[SEARCH_CONTENT_FIELD] += f"\n\nAttachment {index + 1}"

        attachment_title = attachment.get("title")
        attachment_text = attachment.get("text")
        attachment_fallback = attachment.get("fallback")

        if attachment_title:
            message[SEARCH_CONTENT_FIELD] += f"\nTitle: {attachment_title}"
        if attachment_text:
            message[SEARCH_CONTENT_FIELD] += f"\nText: {attachment_text}"
        if (
            attachment_fallback
            and attachment_fallback != attachment_title
            and attachment_fallback != attachment_text
        ):
            message[SEARCH_CONTENT_FIELD] += f"\nFallback: {attachment_fallback}"

    if not message[SEARCH_CONTENT_FIELD]:
        message[SEARCH_CONTENT_FIELD] = None


# this method does two things
# 1. create a searchable_content value, which is a combination of text + attachments
# 2. create an embedding of the value from step 1
async def add_message_embeddings(
    messages: list[dict[str, Any]] | dict[str, Any],
    field_to_embed: str = SEARCH_CONTENT_FIELD,  # field to read content from for embedding
    use_dummy_embeddings: float | None = None,  # if set, use this value for dummy embeddings instead of calling API
) -> None:
    messages = [messages] if not isinstance(messages, list) else messages

    # this is the request that will be sent to the embedder
    text_to_embed: Sequence[str] = []

    # because not all messages should be embedded (e.g. they do not have text)
    # we need to keep track of the message indexes for the embeddings
    index_map: Sequence[int] = []

    for index, message in enumerate(messages):
        content = message.get(field_to_embed)
        if not content:
            continue

        text_to_embed.append(content)
        index_map.append(index)

    if not text_to_embed:
        return
    try:
        embeddings = None
        if use_dummy_embeddings is not None:
            embeddings = [[use_dummy_embeddings] * 1536 for _ in range(len(text_to_embed))]
        else:
            result = await embedder.embed_documents(
                text_to_embed, settings={"dimensions": 1536}
            )
            embeddings = result.embeddings

        for embedding_index, embedding in enumerate(embeddings):
            message_index = index_map[embedding_index]
            messages[message_index]["embedding"] = embedding

    except Exception:
        logger.exception("Could not embed messages", extra={"txt": text_to_embed})
