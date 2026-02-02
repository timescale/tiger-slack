#!/usr/bin/env python3
"""
Backfill searchable_content field and re-embed messages with attachments.

This script uses a two-phase approach for optimal performance:

PHASE 1: Rows WITHOUT attachments (fast path)
- Uses pure SQL UPDATE to set searchable_content = text
- No client-side processing or API calls needed
- Processes thousands of rows per second

PHASE 2: Rows WITH attachments (slow path)
- Fetches rows to client
- Generates searchable_content (text + attachment metadata)
- Re-embeds using OpenAI API (since existing embeddings are text-only)
- Updates rows with new searchable_content and embedding

The script is naturally resumable - if interrupted, just run it again and it will
continue from where it left off (processing only rows where searchable_content IS NULL).

Usage:
  # Run the backfill
  python backfill_searchable_content.py --batch-size 1000

  # Use dummy embeddings for testing (doesn't call OpenAI API)
  python backfill_searchable_content.py --batch-size 1000 --use-dummy-embeddings
"""

import asyncio
import time
from datetime import datetime

import click
from dotenv import find_dotenv, load_dotenv
from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from tiger_slack.utils import add_message_embeddings, add_message_searchable_content

load_dotenv(dotenv_path=find_dotenv(usecwd=False))


async def get_total_count(conn: AsyncConnection) -> int:
    """Get total count of rows to backfill."""
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM slack.message_vanilla WHERE searchable_content IS NULL"
        )
        result = await cur.fetchone()
        return result[0] if result else 0


async def get_count_without_attachments(conn: AsyncConnection) -> int:
    """Get count of rows without attachments that need backfilling."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT COUNT(*)
            FROM slack.message_vanilla
            WHERE searchable_content IS NULL
              AND (attachments IS NULL OR jsonb_array_length(attachments) = 0)
            """
        )
        result = await cur.fetchone()
        return result[0] if result else 0


async def backfill_without_attachments(conn: AsyncConnection, batch_size: int) -> int:
    """
    Backfill rows without attachments by setting searchable_content = text.
    This is done entirely in SQL for maximum performance.
    Returns number of rows updated.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE slack.message_vanilla
            SET searchable_content = text
            WHERE (ts, channel_id) IN (
                SELECT ts, channel_id
                FROM slack.message_vanilla
                WHERE searchable_content IS NULL
                  AND (attachments IS NULL OR jsonb_array_length(attachments) = 0)
                ORDER BY channel_id, ts
                LIMIT %s
            )
            """,
            (batch_size,),
        )
        rows_updated = cur.rowcount or 0
        await conn.commit()
        return rows_updated


async def backfill_batch_with_attachments(
    conn: AsyncConnection,
    batch_size: int,
    use_dummy_embeddings: bool = False,
) -> int:
    """
    Backfill a single batch of rows WITH attachments. Returns number of rows updated.

    This function:
    1. Selects rows where searchable_content IS NULL AND attachments exist
    2. Generates searchable_content for each message
    3. Re-embeds messages (since existing embeddings are text-only)
    4. Updates the database
    """
    # Fetch a batch of messages with attachments that need backfilling
    fetch_query = """
        SELECT
            ts,
            channel_id,
            text,
            attachments
        FROM slack.message_vanilla
        WHERE searchable_content IS NULL
          AND attachments IS NOT NULL
          AND jsonb_array_length(attachments) > 0
        ORDER BY channel_id, ts
        LIMIT %s
    """

    async with conn.cursor() as cur:
        await cur.execute(fetch_query, (batch_size,))
        rows = await cur.fetchall()

        if not rows:
            return 0

        # Convert rows to message dictionaries
        messages = []
        for row in rows:
            message = {
                "ts": str(row[0].timestamp()),  # Convert datetime to timestamp
                "channel": row[1],
                "text": row[2],
                "attachments": row[3],  # This is already parsed JSONB
            }
            messages.append(message)

        # Generate searchable_content for all messages
        for message in messages:
            add_message_searchable_content(message)

        # Re-embed only messages that have attachments
        messages_to_embed = [msg for msg in messages if msg.get("attachments")]

        if messages_to_embed:
            click.echo(
                f"  Re-embedding {len(messages_to_embed)} messages with attachments "
                f"(out of {len(messages)} total)"
            )
            await add_message_embeddings(
                messages_to_embed, use_dummy_embeddings=1.0 if use_dummy_embeddings else None
            )

        # Update the database
        update_query = """
            UPDATE slack.message_vanilla
            SET
                searchable_content = %s,
                embedding = COALESCE((%s)::text::vector(1536), embedding)
            WHERE ts = to_timestamp(%s) AND channel_id = %s
        """

        updates = []
        for message in messages:
            # Convert embedding list to vector format if present
            embedding = None
            if "embedding" in message:
                # Convert list to JSONB for vector cast
                embedding = Jsonb(message["embedding"])

            updates.append((
                message.get("searchable_content"),
                embedding,
                float(message["ts"]),
                message["channel"],
            ))

        await cur.executemany(update_query, updates)
        await conn.commit()

        return len(updates)


async def run_backfill(
    batch_size: int,
    use_dummy_embeddings: bool = False,
) -> None:
    """Run the backfill with batching."""

    conn = await AsyncConnection.connect()

    try:
        # Get initial counts
        total_count = await get_total_count(conn)
        count_without_attachments = await get_count_without_attachments(conn)
        count_with_attachments = total_count - count_without_attachments

        click.echo("="*60)
        click.echo("Backfill Summary:")
        click.echo(f"  Total rows to backfill: {total_count:,}")
        click.echo(f"  Without attachments: {count_without_attachments:,} (fast path)")
        click.echo(f"  With attachments: {count_with_attachments:,} (requires re-embedding)")
        click.echo(f"  Batch size: {batch_size:,}")
        if use_dummy_embeddings:
            click.echo("  Using dummy embeddings (not calling OpenAI API)")
        click.echo("="*60)

        if total_count == 0:
            click.echo("No rows to backfill!")
            return

        total_rows_updated = 0
        start_time_overall = datetime.now()

        # Phase 1: Fast path for rows without attachments
        if count_without_attachments > 0:
            click.echo("\n" + "="*60)
            click.echo("PHASE 1: Backfilling rows WITHOUT attachments (SQL only)")
            click.echo("="*60)

            batch_num = 1
            while True:
                remaining = await get_count_without_attachments(conn)
                if remaining == 0:
                    break

                start_time = datetime.now()
                click.echo(
                    f"\nBatch {batch_num}: Processing up to {batch_size:,} rows "
                    f"({remaining:,} remaining)..."
                )

                rows_updated = await backfill_without_attachments(conn, batch_size)
                elapsed = (datetime.now() - start_time).total_seconds()
                total_rows_updated += rows_updated

                rows_per_sec = rows_updated / elapsed if elapsed > 0 else 0
                click.echo(
                    f"✓ Updated {rows_updated:,} rows in {elapsed:.2f}s "
                    f"({rows_per_sec:.0f} rows/sec)"
                )

                batch_num += 1
                time.sleep(1)  # Shorter sleep for fast path

            click.echo(f"\n✓ Phase 1 complete: {total_rows_updated:,} rows updated")

        # Phase 2: Slow path for rows with attachments (requires re-embedding)
        remaining_with_attachments = await get_total_count(conn)
        if remaining_with_attachments > 0:
            click.echo("\n" + "="*60)
            click.echo("PHASE 2: Backfilling rows WITH attachments (requires re-embedding)")
            click.echo("="*60)

            batch_num = 1
            while True:
                remaining = await get_total_count(conn)
                if remaining == 0:
                    break

                start_time = datetime.now()
                click.echo(
                    f"\nBatch {batch_num}: Processing up to {batch_size:,} rows "
                    f"({remaining:,} remaining)..."
                )

                rows_updated = await backfill_batch_with_attachments(
                    conn, batch_size, use_dummy_embeddings
                )

                elapsed = (datetime.now() - start_time).total_seconds()
                total_rows_updated += rows_updated

                rows_per_sec = rows_updated / elapsed if elapsed > 0 else 0
                click.echo(
                    f"✓ Updated {rows_updated:,} rows in {elapsed:.2f}s "
                    f"({rows_per_sec:.0f} rows/sec)"
                )

                batch_num += 1
                time.sleep(5)  # Longer sleep for slow path with API calls

        # Final summary
        elapsed_overall = (datetime.now() - start_time_overall).total_seconds()
        click.echo("\n" + "="*60)
        click.echo("Backfill complete!")
        click.echo(f"Total rows updated: {total_rows_updated:,}")
        click.echo(f"Total time: {elapsed_overall:.2f}s")
        if elapsed_overall > 0:
            click.echo(f"Average: {total_rows_updated/elapsed_overall:.0f} rows/sec")
        click.echo("="*60)

    finally:
        await conn.close()


@click.command()
@click.option(
    "--batch-size",
    type=int,
    default=1000,
    help="Number of rows to process per batch (default: 1000)",
)
@click.option(
    "--use-dummy-embeddings",
    is_flag=True,
    help="Use dummy embeddings instead of calling OpenAI API (for testing)",
)
def main(batch_size: int, use_dummy_embeddings: bool) -> None:
    """Backfill searchable_content and re-embed messages with attachments."""

    asyncio.run(run_backfill(batch_size, use_dummy_embeddings))


if __name__ == "__main__":
    main()
