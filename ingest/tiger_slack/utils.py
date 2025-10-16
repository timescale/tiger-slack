import re
from typing import TypeVar

import logfire
from psycopg import sql
from psycopg_pool import AsyncConnectionPool

T = TypeVar("T")


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
            return re.sub(r'(?<!\\)\\u0000', '', obj)
        else:
            return obj.replace("\x00", "")  # type: ignore[return-value]
    elif isinstance(obj, list):
        return [remove_null_bytes(item) for item in obj]  # type: ignore[return-value]
    elif isinstance(obj, dict):
        return {key: remove_null_bytes(value) for key, value in obj.items()}  # type: ignore[return-value]
    return obj
