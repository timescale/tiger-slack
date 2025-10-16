import asyncio
import logging
import re
from pathlib import Path

import logfire
from dotenv import find_dotenv, load_dotenv
from psycopg import AsyncConnection, AsyncCursor
from semver import Version

from tiger_slack import __migrations_version__
from tiger_slack.logging_config import setup_logging

logger = logging.getLogger(__name__)

SHARED_LOCK_KEY = 9373348629322944
MAX_LOCK_ATTEMPTS = 10
LOCK_SLEEP_SECONDS = 10


@logfire.instrument("try_migration_lock", extract_args=False)
async def try_migration_lock(cur: AsyncCursor) -> bool:
    """Attempt to acquire transaction-level advisory lock for migration"""
    await cur.execute(
        "select pg_try_advisory_xact_lock(%s::bigint)", (SHARED_LOCK_KEY,)
    )
    row = await cur.fetchone()
    if not row:
        raise Exception(
            "attempting to get an advisory lock for migration failed to return a row"
        )
    return bool(row[0])


async def retry_migration_lock(cur: AsyncCursor) -> None:
    """Attempt to acquire transaction-level advisory lock for migration with retries"""
    for i in range(1, MAX_LOCK_ATTEMPTS + 1):
        locked = await try_migration_lock(cur)
        if locked:
            break
        if i == MAX_LOCK_ATTEMPTS:
            logger.error(
                f"failed to get an advisory lock to check database version after {i} attempts"
            )
            raise RuntimeError("Could not acquire migration lock")
        logger.info(
            f"sleeping {LOCK_SLEEP_SECONDS} seconds before another lock attempt"
        )
        await asyncio.sleep(LOCK_SLEEP_SECONDS)


@logfire.instrument("install_timescaledb")
async def install_timescaledb() -> None:
    """Ensures that a suitable version of the timescaledb extension is installed
    
    This must happen in a separate db connection.
    """
    async with (
        await AsyncConnection.connect() as con,
        con.cursor() as cur,
        con.transaction() as _,
    ):
        # Try to acquire migration lock
        await retry_migration_lock(cur)
        # ensure that a suitable version of the timescaledb extension is installed
        sql = Path(__file__).parent.joinpath("sql", "timescaledb.sql").read_text()
        await cur.execute(sql)


@logfire.instrument("run_init", extract_args=False)
async def run_init(cur: AsyncCursor) -> None:
    """Initialize migration infrastructure tables"""
    sql = Path(__file__).parent.joinpath("sql", "init.sql").read_text()
    await cur.execute(sql)


async def get_db_version(cur: AsyncCursor) -> Version:
    """Get current database version"""
    await cur.execute("select version from slack.version")
    row = await cur.fetchone()
    assert row is not None
    ver = Version.parse(str(row[0]))
    return ver


@logfire.instrument("is_migration_required", extract_args=["target_version"])
async def is_migration_required(cur: AsyncCursor, target_version: Version) -> bool:
    """Check if migration is required"""
    db_version = await get_db_version(cur)
    if target_version < db_version:
        logger.error(
            f"target version ({target_version}) is older than the database ({db_version})! aborting"
        )
        raise ValueError(
            f"Cannot downgrade from version {db_version} to {target_version}"
        )
    return target_version > db_version


def sql_file_number(path: Path) -> int:
    """Extract number from SQL filename"""
    pattern = r"^(\d{3})-[a-z][a-z-]*\.sql$"
    match = re.match(pattern, path.name)
    if not match:
        logger.error(f"{path} file name does not match the pattern {pattern}")
        raise ValueError(f"Invalid filename pattern: {path.name}")
    return int(match.group(1))


def check_sql_file_order(paths: list[Path]) -> None:
    """Verify SQL files are in sequential order"""
    prev = -1
    for path in paths:
        this = sql_file_number(path)
        if this == 999:
            break
        if this != prev + 1:
            logger.error(f"sql files must be strictly ordered: {path.name}")
            raise ValueError(f"SQL files not in sequential order at {path.name}")
        prev = this


async def run_incremental(cur: AsyncCursor, target_version: Version) -> None:
    """Run incremental migrations"""
    migration_template = (
        Path(__file__).parent.joinpath("sql", "migration.sql").read_text()
    )
    incremental = Path(__file__).parent.joinpath("incremental")
    paths = [path for path in incremental.glob("*.sql")]
    paths.sort()
    check_sql_file_order(paths)

    for path in paths:
        with logfire.span("incremental_sql", script=path.name):
            sql = migration_template.format(
                migration_name=path.name,
                migration_body=path.read_text(),
                version=str(target_version),
            )
            await cur.execute(sql)


async def run_idempotent(cur: AsyncCursor) -> None:
    """Run idempotent SQL that can run multiple times"""
    idempotent = Path(__file__).parent.joinpath("idempotent")
    paths = [path for path in idempotent.glob("*.sql")]
    paths.sort()
    check_sql_file_order(paths)

    for path in paths:
        with logfire.span("idempotent_sql", script=path.name):
            sql = path.read_text()
            await cur.execute(sql)


@logfire.instrument("set_version", extract_args=["version"])
async def set_version(cur: AsyncCursor, version: Version) -> None:
    """Update database version"""
    await cur.execute(
        "update slack.version set version = %s, at = clock_timestamp()", (str(version),)
    )


@logfire.instrument("migrate_db", extract_args=False)
async def migrate_db() -> None:
    """Run database migrations"""
    target_version = Version.parse(__migrations_version__)

    # ensure a suitable version of timescaledb is installed
    # use a separate db connection for this so GUC changes take effect
    await install_timescaledb()

    async with (
        await AsyncConnection.connect() as con,
        con.cursor() as cur,
        con.transaction() as _,
    ):
        # Try to acquire migration lock
        await retry_migration_lock(cur)

        # Initialize migration infrastructure
        await run_init(cur)

        # Check if migration is required
        if not await is_migration_required(cur, target_version):
            logger.info("no migration required. app and db are compatible.")
            return

        logger.info(f"database migration to version {target_version} required...")

        # Run migrations
        await run_incremental(cur, target_version)
        await run_idempotent(cur)
        await set_version(cur, target_version)

    logger.info(f"database migration to version {target_version} complete")


async def main():
    """Run database migrations CLI"""

    # Load environment variables and setup logging
    load_dotenv(dotenv_path=find_dotenv(usecwd=True))
    setup_logging()

    logger.info("Starting database migration...")
    await migrate_db()
    logger.info("Database migration completed successfully")


if __name__ == "__main__":
    asyncio.run(main())
