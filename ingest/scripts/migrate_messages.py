#!/usr/bin/env python3
"""
Migrate messages from slack.message to another table in batches.

Usage:
  # Start a new migration
  python migrate_messages.py --dest-table slack.message_vanilla --batch-size 10000

  # Resume a migration from a job file
  python migrate_messages.py --resume migration_job_20240115_120530.json

  # Override batch size when resuming
  python migrate_messages.py --resume migration_job.json --batch-size 5000
"""

import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import click
from dotenv import find_dotenv, load_dotenv
from psycopg import AsyncConnection

load_dotenv(dotenv_path=find_dotenv(usecwd=False))


async def get_total_count(conn: AsyncConnection) -> int:
    """Get total count of rows to migrate."""
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM slack.message"
        )
        result = await cur.fetchone()
        return result[0] if result else 0


async def migrate_batch(
    conn: AsyncConnection,
    dest_table: str,
    offset: int,
    batch_size: int,
) -> int:
    """Migrate a single batch of rows. Returns number of rows inserted."""
    query = f"""
        INSERT INTO {dest_table} (
            ts,
            channel_id,
            team,
            text,
            type,
            user_id,
            blocks,
            event_ts,
            thread_ts,
            channel_type,
            client_msg_id,
            parent_user_id,
            bot_id,
            attachments,
            files,
            app_id,
            subtype,
            trigger_id,
            workflow_id,
            display_as_bot,
            upload,
            x_files,
            icons,
            language,
            edited,
            embedding
        )
        SELECT
            ts,
            channel_id,
            team,
            text,
            type,
            user_id,
            blocks,
            event_ts,
            thread_ts,
            channel_type,
            client_msg_id,
            parent_user_id,
            bot_id,
            attachments,
            files,
            app_id,
            subtype,
            trigger_id,
            workflow_id,
            display_as_bot,
            upload,
            x_files,
            icons,
            language,
            edited,
            embedding
        FROM slack.message
        ORDER BY channel_id, ts
        OFFSET %s
        LIMIT %s
        ON CONFLICT (channel_id, ts) DO NOTHING
    """

    async with conn.cursor() as cur:
        await cur.execute(query, (offset, batch_size))
        await conn.commit()
        return cur.rowcount


def save_job_state(job_file: Path, state: dict[str, Any]) -> None:
    """Save job state to file."""
    with job_file.open("w") as f:
        json.dump(state, f, indent=2)
    click.echo(f"Job state saved to {job_file}")


def load_job_state(job_file: Path) -> dict[str, Any]:
    """Load job state from file."""
    with job_file.open("r") as f:
        return json.load(f)


async def run_migration(
    dest_table: str,
    batch_size: int,
    resume_file: Path | None = None,
) -> None:
    """Run the migration with batching and resume capability."""

    # Load or create job state
    if resume_file:
        click.echo(f"Resuming migration from {resume_file}")
        state = load_job_state(resume_file)
        dest_table = state["dest_table"]
        current_offset = state["current_offset"]
        job_file = resume_file
        click.echo(
            f"Resuming migration to {dest_table} at offset {current_offset}"
        )
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        job_file = Path(f"migration_job_{timestamp}.json")
        current_offset = 0
        state = {
            "dest_table": dest_table,
            "batch_size": batch_size,
            "current_offset": current_offset,
            "started_at": datetime.now().isoformat(),
        }
        save_job_state(job_file, state)
        click.echo(f"Starting new migration to {dest_table}")


    conn = await AsyncConnection.connect()

    try:
        # Get total count
        total_count = await get_total_count(conn)
        click.echo(f"Total rows to migrate: {total_count:,}")
        click.echo(f"Batch size: {batch_size:,}")
        click.echo(f"Starting offset: {current_offset:,}")

        batch_num = (current_offset // batch_size) + 1

        while True:
            start_time = datetime.now()

            click.echo(
                f"\nBatch {batch_num}: Migrating rows {current_offset:,} to "
                f"{current_offset + batch_size:,}..."
            )

            rows_inserted = await migrate_batch(
                conn, dest_table, current_offset, batch_size
            )

            elapsed = (datetime.now() - start_time).total_seconds()

            current_offset += batch_size

            # Update state
            state["current_offset"] = current_offset
            state["last_batch_duration_seconds"] = elapsed
            state["updated_at"] = datetime.now().isoformat()
            save_job_state(job_file, state)

            progress_pct = (current_offset / total_count * 100) if total_count > 0 else 0
            rows_per_sec = rows_inserted / elapsed if elapsed > 0 else 0

            click.echo(
                f"✓ Inserted {rows_inserted:,} rows in {elapsed:.2f}s "
                f"({rows_per_sec:.0f} rows/sec)"
            )
            click.echo(
                f"Progress: {current_offset:,} / {total_count:,} "
                f"({progress_pct:.1f}%)"
            )

            # Check if we've processed all rows based on offset
            if current_offset >= total_count:
                click.echo("\nReached end of source table. Migration complete!")
                state["completed_at"] = datetime.now().isoformat()
                state["status"] = "completed"
                save_job_state(job_file, state)
                break

            batch_num += 1

            # Sleep between batches to avoid overloading the database
            time.sleep(5)


    finally:
        await conn.close()


@click.command()
@click.option(
    "--dest-table",
    type=str,
    help="Destination table name (e.g., slack.message_vanilla). Required for new migrations.",
)
@click.option(
    "--batch-size",
    type=int,
    default=10000,
    help="Number of rows to migrate per batch (default: 10000)",
)
@click.option(
    "--resume",
    type=click.Path(exists=True, path_type=Path),
    help="Resume migration from a job file (e.g., migration_job_20240115.json)",
)
def main(dest_table: str | None, batch_size: int, resume: Path | None) -> None:
    """Migrate messages from slack.message to another table in batches."""

    # Validation
    if resume is None and dest_table is None:
        click.echo(
            "Error: --dest-table is required when starting a new migration",
            err=True,
        )
        click.echo("Use --resume to continue an existing migration", err=True)
        sys.exit(1)

    if resume and dest_table:
        click.echo(
            "Warning: --dest-table is ignored when using --resume "
            "(destination table is loaded from job file)",
            err=True,
        )

    asyncio.run(run_migration(dest_table, batch_size, resume))


if __name__ == "__main__":
    main()
