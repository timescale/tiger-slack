import os

import logfire
from psycopg import sql
from psycopg_pool import AsyncConnectionPool


@logfire.instrument("is_table_empty", extract_args=["table_name"])
async def is_table_empty(pool: AsyncConnectionPool, table_name: str) -> bool:
    async with pool.connection() as con, con.cursor() as cur:
        await cur.execute(
            sql.SQL("SELECT EXISTS(SELECT 1 FROM slack.{} LIMIT 1)").format(sql.Identifier(table_name))
        )
        row = await cur.fetchone()
        if not row:
            raise Exception(f"Failed to check if table {table_name} is empty")
        return not bool(row[0])


def get_connection_info() -> str:
    host = os.getenv("PGHOST")
    port = os.getenv("PGPORT", 5432)
    user = os.getenv("PGUSER", "postgres")
    password = os.getenv("PASSWORD", "password")
    database = os.getenv("PGDATABASE")

    if host is None and database is None:
        raise Exception("PGHOST AND PGDATABASE environment variables need to be set!")

    return f"host={host} port={port} dbname={database} user={user} password={password}"
