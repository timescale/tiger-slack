import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import click
from dotenv import find_dotenv, load_dotenv
from openai import OpenAI
from psycopg_pool import AsyncConnectionPool

from tiger_slack.logging_config import setup_logging

load_dotenv(dotenv_path=find_dotenv(usecwd=True))
setup_logging()

logger = logging.getLogger(__name__)

# Directory structure for batch tracking
BATCH_TRACKING_DIR = Path("./batch_jobs")
INPUTS_DIR = BATCH_TRACKING_DIR / "inputs"
JOBS_DIR = BATCH_TRACKING_DIR / "jobs"
OUTPUTS_DIR = BATCH_TRACKING_DIR / "outputs"
COMPLETED_JOBS_DIR = BATCH_TRACKING_DIR / "completed_jobs"
FAILED_JOBS_DIR = BATCH_TRACKING_DIR / "failed_jobs"


async def configure_database_connection(con: Any) -> None:
    await con.set_autocommit(True)


async def reset_database_connection(con: Any) -> None:
    await con.set_autocommit(True)


async def create_embedding_batches(batch_size: int) -> None:
    """
    Create OpenAI batch embedding jobs for messages without embeddings.

    Args:
        batch_size: Number of messages to process per batch
    """
    pg_min_pool_size = int(os.getenv("PG_MIN_POOL_SIZE", "1"))
    pg_max_pool_size = int(os.getenv("PG_MAX_POOL_SIZE", "5"))
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not openai_api_key:
        raise ValueError("OPENAI_API_KEY environment variable is required")

    openai_client = OpenAI(api_key=openai_api_key)

    # Create directory structure for batch tracking files
    BATCH_TRACKING_DIR.mkdir(exist_ok=True)
    INPUTS_DIR.mkdir(exist_ok=True)
    JOBS_DIR.mkdir(exist_ok=True)

    async with AsyncConnectionPool(
        check=AsyncConnectionPool.check_connection,
        configure=configure_database_connection,
        reset=reset_database_connection,
        name="embed_messages_pool",
        min_size=pg_min_pool_size,
        max_size=pg_max_pool_size,
    ) as pool:
        await pool.wait()

        async with pool.connection() as conn:
            # Server-side cursors require a transaction
            async with conn.transaction():
                # Create a server-side cursor for efficient batch processing
                async with conn.cursor(name="embedding_cursor") as cursor:
                    await cursor.execute(
                        """
                        SELECT ts, channel_id, text
                        FROM slack.message_search
                        WHERE text IS NOT NULL
                          AND text != ''
                          AND embedding IS NULL
                        ORDER BY ts DESC
                        """
                    )

                    batch_num = 0
                    total_messages = 0

                    while True:
                        # Fetch a batch of messages
                        rows = await cursor.fetchmany(size=batch_size)

                        if not rows:
                            logger.info("No more messages to process")
                            break

                        batch_num += 1
                        logger.info(
                            f"Processing batch {batch_num} with {len(rows)} messages"
                        )

                        # Create JSONL file for OpenAI batch API (temporary name)
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        jsonl_filename = (
                            INPUTS_DIR / f"batch_{timestamp}_{batch_num}.jsonl"
                        )

                        with open(jsonl_filename, "w") as f:
                            for row in rows:
                                ts, channel_id, text = row
                                # Create a unique request ID using ts and channel_id
                                request_id = f"request_{channel_id}_{ts.timestamp()}"

                                batch_request = {
                                    "custom_id": request_id,
                                    "method": "POST",
                                    "url": "/v1/embeddings",
                                    "body": {
                                        "model": "text-embedding-3-small",
                                        "input": text,
                                    },
                                }
                                f.write(json.dumps(batch_request) + "\n")

                        logger.info(f"Created JSONL file: {jsonl_filename}")

                        # Upload file to OpenAI using stream
                        with jsonl_filename.open("rb") as f:
                            file_response = openai_client.files.create(
                                file=(jsonl_filename.name, f, "application/jsonl"),
                                purpose="batch"
                            )

                        logger.info(
                            f"Uploaded file to OpenAI: {file_response.id}"
                        )

                        # Rename JSONL file to match input_file_id for easy correlation
                        final_jsonl_filename = INPUTS_DIR / f"{file_response.id}.jsonl"
                        jsonl_filename.rename(final_jsonl_filename)
                        logger.info(f"Renamed JSONL file to: {final_jsonl_filename}")
                        jsonl_filename = final_jsonl_filename

                        # Create batch job
                        batch_response = openai_client.batches.create(
                            input_file_id=file_response.id,
                            endpoint="/v1/embeddings",
                            completion_window="24h",
                        )

                        logger.info(
                            f"Created batch job: {batch_response.id} (status: {batch_response.status})"
                        )

                        # Persist batch information using input_file_id as filename
                        batch_info_file = (
                            JOBS_DIR / f"{file_response.id}.json"
                        )
                        with open(batch_info_file, "w") as f:
                            json.dump(
                                {
                                    "batch_id": batch_response.id,
                                    "input_file_id": file_response.id,
                                    "jsonl_file": str(jsonl_filename),
                                    "created_at": timestamp,
                                    "batch_number": batch_num,
                                    "message_count": len(rows),
                                    "status": batch_response.status,
                                },
                                f,
                                indent=2,
                            )

                        logger.info(f"Saved batch info to: {batch_info_file}")

                        total_messages += len(rows)

                    logger.info(
                        f"Completed! Created {batch_num} batches for {total_messages} messages"
                    )


def check_batches() -> None:
    """
    Check the status of all OpenAI batch jobs.
    """
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not openai_api_key:
        raise ValueError("OPENAI_API_KEY environment variable is required")

    openai_client = OpenAI(api_key=openai_api_key)

    # List all batches
    batches = openai_client.batches.list()

    if not batches.data:
        click.echo("No batch jobs found.")
        return

    click.echo(f"\nFound {len(batches.data)} batch job(s):\n")

    for batch in batches.data:
        click.echo(f"Batch ID: {batch.id}")
        click.echo(f"  Status: {batch.status}")
        click.echo(f"  Created at: {datetime.fromtimestamp(batch.created_at)}")
        click.echo(f"  Endpoint: {batch.endpoint}")
        click.echo(f"  Input file ID: {batch.input_file_id}")

        if batch.output_file_id:
            click.echo(f"  Output file ID: {batch.output_file_id}")

        if batch.error_file_id:
            click.echo(f"  Error file ID: {batch.error_file_id}")

        # Display request counts
        if batch.request_counts:
            click.echo("  Request counts:")
            click.echo(f"    Total: {batch.request_counts.total}")
            click.echo(f"    Completed: {batch.request_counts.completed}")
            click.echo(f"    Failed: {batch.request_counts.failed}")

        click.echo()


def retrieve_completed() -> None:
    """
    Retrieve completed batch results from OpenAI and save them locally.
    """
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not openai_api_key:
        raise ValueError("OPENAI_API_KEY environment variable is required")

    openai_client = OpenAI(api_key=openai_api_key)

    # Ensure directory structure exists
    OUTPUTS_DIR.mkdir(exist_ok=True)
    COMPLETED_JOBS_DIR.mkdir(exist_ok=True)
    FAILED_JOBS_DIR.mkdir(exist_ok=True)

    # List all batches from OpenAI
    batches = openai_client.batches.list()

    if not batches.data:
        click.echo("No batch jobs found.")
        return

    completed_count = 0
    failed_count = 0
    processed_count = 0

    for batch in batches.data:
        # Check if we have a job file for this batch (using input_file_id)
        job_file = JOBS_DIR / f"{batch.input_file_id}.json"

        if not job_file.exists():
            # Skip if we don't have a job file
            if batch.status in ("completed", "failed"):
                logger.info(
                    f"Skipping batch {batch.id} (status: {batch.status}) - no job file found for input {batch.input_file_id}"
                )
            continue

        # Handle failed batches
        if batch.status == "failed":
            failed_count += 1
            logger.warning(
                f"Batch {batch.id} failed (input: {batch.input_file_id})"
            )

            # Read original job data
            with open(job_file, "r") as f:
                job_data = json.load(f)

            # Update with latest batch information
            job_data.update({
                "status": batch.status,
                "error_file_id": batch.error_file_id,
                "errors": batch.errors.model_dump() if batch.errors else None,
                "failed_at": datetime.fromtimestamp(batch.failed_at).isoformat() if batch.failed_at else None,
                "request_counts": batch.request_counts.model_dump() if batch.request_counts else None,
            })

            # Write to failed_jobs directory
            failed_job_file = FAILED_JOBS_DIR / f"{batch.input_file_id}.json"
            with open(failed_job_file, "w") as f:
                json.dump(job_data, f, indent=2)
            logger.info(f"Updated and saved to: {failed_job_file}")

            # Delete original job file
            job_file.unlink()

            processed_count += 1
            continue

        # Only process completed batches
        if batch.status != "completed":
            continue

        completed_count += 1

        # Check if output file exists
        if not batch.output_file_id:
            logger.warning(
                f"Batch {batch.id} is completed but has no output_file_id"
            )
            continue

        # Download the batch output file
        output_filename = OUTPUTS_DIR / f"{batch.input_file_id}.jsonl"

        # Skip if we already downloaded this output
        if output_filename.exists():
            logger.info(
                f"Output file {output_filename} already exists, skipping download"
            )
        else:
            logger.info(
                f"Downloading batch results for {batch.id} (output: {batch.output_file_id})"
            )
            file_content = openai_client.files.content(batch.output_file_id)
            output_filename.write_text(file_content.text)
            logger.info(f"Saved output to: {output_filename}")

        # Read original job data
        with open(job_file) as f:
            job_data = json.load(f)

        # Update with latest batch information
        job_data.update({
            "status": batch.status,
            "output_file_id": batch.output_file_id,
            "completed_at": datetime.fromtimestamp(batch.completed_at).isoformat() if batch.completed_at else None,
            "request_counts": batch.request_counts.model_dump() if batch.request_counts else None,
        })

        # Write to completed_jobs directory
        completed_job_file = COMPLETED_JOBS_DIR / f"{batch.input_file_id}.json"
        with open(completed_job_file, "w") as f:
            json.dump(job_data, f, indent=2)
        logger.info(f"Updated and saved to: {completed_job_file}")

        # Delete original job file
        job_file.unlink()

        processed_count += 1

    click.echo(
        f"\nProcessed {processed_count} batch(es): "
        f"{completed_count} completed, {failed_count} failed"
    )


@click.command()
@click.option(
    "--create-embedding-batch-jobs",
    is_flag=True,
    help="Create OpenAI batch jobs for embedding messages without embeddings",
)
@click.option(
    "--check-batch-status",
    is_flag=True,
    help="Check the status of all OpenAI batch jobs",
)
@click.option(
    "--retrieve-completed-batches",
    is_flag=True,
    help="Retrieve and save completed batch results from OpenAI",
)
@click.option(
    "--batch-size",
    default=1000,
    type=int,
    help="Number of messages to process per batch (default: 1000)",
)
def main(
    create_embedding_batch_jobs: bool,
    check_batch_status: bool,
    retrieve_completed_batches: bool,
    batch_size: int,
) -> None:
    """
    Bulk embedding creation/updating script for slack.message table.

    This script helps backfill the embedding column in the slack.message table
    by creating OpenAI batch embedding jobs.
    """
    if create_embedding_batch_jobs:
        asyncio.run(create_embedding_batches(batch_size))
    elif check_batch_status:
        check_batches()
    elif retrieve_completed_batches:
        retrieve_completed()
    else:
        click.echo("No action specified. Use --help for options.")


if __name__ == "__main__":
    main()
