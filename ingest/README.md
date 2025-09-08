# Tiger Slack Ingest

## Overview

The Tiger Slack Ingest app is a Python-based data ingestion service that captures and processes Slack workspace events in real-time.
It serves as the data collection layer for the Tiger Slack project, storing Slack messages, user profiles, channel information, and reactions into a TimescaleDB database for later analysis and AI-powered querying.

## What It Does

### Real-Time Event Processing
- **Slack Socket Mode**: Connects to Slack via WebSocket for real-time event streaming
- **Message Ingestion**: Captures all messages, replies, and threaded conversations
- **User & Channel Sync**: Tracks user profile changes and channel metadata updates
- **Reaction Tracking**: Records emoji reactions added/removed from messages
- **Event Routing**: Intelligently processes different Slack event types (messages, user changes, channel updates, etc.)

### Historical Data Import
- **Slack Export Processing**: Imports historical data from Slack workspace exports
- **Bulk Data Loading**: Processes large datasets with proper error handling and transaction management
- **Schema Migration**: Automatically runs database migrations on startup

### Scheduled Jobs
- **Daily User Sync**: Refreshes user list from Slack API (1 AM daily)
- **Daily Channel Sync**: Updates channel metadata from Slack API (1 AM daily)
- **Advisory Locking**: Prevents duplicate job execution across multiple instances

### Observability & Monitoring
- **Logfire Integration**: Full observability with structured logging and tracing
- **Performance Metrics**: Database query timing, system resource monitoring
- **Error Tracking**: Comprehensive error handling with PostgreSQL diagnostic capture
- **Async Performance**: Built on asyncio for high-throughput event processing

## Key Features

- **High Throughput**: Async processing with connection pooling for handling busy Slack workspaces
- **Fault Tolerance**: Comprehensive error handling and transaction management
- **Data Integrity**: Proper upsert operations and conflict resolution
- **Observability**: Real-time monitoring and debugging via Logfire
- **Scalability**: Designed for production use with advisory locking and resource management

## Architecture

The app is structured around several key modules:

- **`main.py`**: Application entry point with service configuration, signal handling, and database connection pooling
- **`events.py`**: Slack event handlers and database operations for real-time ingestion
- **`jobs.py`**: Scheduled background jobs for periodic synchronization of channels and users
- **`import.py`**: Historical data import from Slack export files
- **Database Layer**: TimescaleDB with dedicated `slack` schema for optimized time-series storage

### Database Schema

The application uses a dedicated `slack` schema in TimescaleDB with the following core tables:

#### Core Data Tables
- **`slack.user`**: Slack workspace users with profiles and metadata
- **`slack.channel`**: Slack channels (public/private) with configuration and membership info
- **`slack.message`**: All messages stored as TimescaleDB hypertable, partitioned by timestamp and segmented by channel for optimal time-series performance
- **`slack.event`**: Raw Slack events for audit trail and debugging purposes

#### Supporting Tables
- **`slack.message_discard`**: Configuration for filtering unwanted message types during ingestion

#### Migration Infrastructure Tables
- **`slack.version`**: Tracks current database schema version and migration timestamps
- **`slack.migration`**: Records applied incremental migrations with content verification

**Notes:**

- Slack messages are uniquely keyed by channel id and message timestamp (ts)
- In the Slack API, `ts` is a text rendering of a numeric value representing seconds past the epoch
- We store `ts` converted to a `timestamptz` value in the database
- The `slack.message_discard` table is used to filter out messages that are not to be stored. Any message that matches at least one jsonpath in rows of this table is discarded.

## Scheduled Jobs

The ingest app includes two automated background jobs that run daily to keep user and channel data synchronized with the Slack API.

### Daily Synchronization Jobs

#### User Synchronization (`load_users`)
- **Schedule**: Daily at 1:00 AM (cron: `0 1 * * *`)
- **Purpose**: Fetches all workspace users from Slack API and updates local database
- **Process**: 
  - Uses Slack Web API `users.list` with pagination
  - Processes up to 999 users per API call
  - Upserts user data using `slack.upsert_user()` stored procedure
  - Handles profile changes, new users, and metadata updates
- **Concurrency Protection**: Uses PostgreSQL advisory lock (`USERS_LOCK_KEY = 5245366294413312`) to prevent duplicate execution

#### Channel Synchronization (`load_channels`)
- **Schedule**: Daily at 1:00 AM (cron: `0 1 * * *`)  
- **Purpose**: Fetches all workspace channels from Slack API and updates local database
- **Process**:
  - Uses Slack Web API `conversations.list` with pagination
  - Processes up to 999 channels per API call
  - Upserts channel data using `slack.upsert_channel()` stored procedure
  - Handles public/private channels, channel renames, and configuration changes
- **Concurrency Protection**: Uses PostgreSQL advisory lock (`CHANNELS_LOCK_KEY = 6801911210587046`) to prevent duplicate execution

### Manual Job Execution

Jobs can be run manually for testing or immediate synchronization:

```bash
# Run both user and channel sync jobs manually
cd ingest
uv run python -m tiger_slack.jobs
```

**How Jobs Work:**

1. **Advisory Locking**: Each job attempts to acquire a PostgreSQL advisory lock before execution
2. **Skip if Running**: If another instance is already running the same job, it exits gracefully
3. **Pagination Handling**: Both jobs handle Slack API pagination automatically using cursors
4. **Error Handling**: Failed API calls and database errors are logged to Logfire for monitoring
5. **Transactional Safety**: Each user/channel update runs in its own transaction for data consistency

**Job Configuration:**
- Jobs are registered using `aiocron.crontab` decorators in `main.py`
- Both jobs share the same 1 AM schedule to minimize API rate limiting impact
- Lock keys are defined as constants in `jobs.py` for coordination

## Historical Data Import

The ingest app can import historical Slack data from workspace exports, allowing you to backfill message history and user/channel data that predates the real-time ingestion setup.

### Slack Export Format

Slack workspace exports follow a specific directory structure:
```
slack-export/
├── users.json          # All workspace users
├── channels.json       # All channels (public/private)
├── channel-name-1/     # Individual channel directories
│   ├── 2023-01-01.json # Daily message files
│   ├── 2023-01-02.json
│   └── ...
├── channel-name-2/
│   └── ...
└── ...
```

### Import Process

The historical import (`import.py`) processes data in three phases:

#### 1. User Import
- **Source**: `users.json` file in export root
- **Process**: Loads all workspace users with full profile data
- **Database**: Uses `slack.upsert_user()` stored procedure
- **Safety**: Handles existing users with upsert logic

#### 2. Channel Import  
- **Source**: `channels.json` file in export root
- **Process**: Loads all channels with metadata and configuration
- **Database**: Uses `slack.upsert_channel()` stored procedure
- **Mapping**: Creates channel name-to-ID mapping for message import

#### 3. Message History Import
- **Source**: Individual JSON files in channel subdirectories
- **Process**: 
  - Iterates through each channel directory
  - Maps channel names to database IDs
  - Processes daily message files chronologically
  - Handles threaded conversations and reactions
- **Database**: Uses optimized bulk insert SQL with conflict resolution
- **Performance**: Processes messages in batches for optimal throughput

### Message Processing Details

The import handles complex Slack message structures:
- **Threading**: Preserves `thread_ts` relationships for conversations
- **Reactions**: Processes emoji reactions and user mappings
- **File Attachments**: Stores file metadata and attachment info
- **Message Types**: Handles regular messages, bot messages, file shares, etc.
- **Conflict Resolution**: Uses `ON CONFLICT (ts, channel_id) DO NOTHING` for idempotent imports

### Running Historical Import

```bash
# Download Slack workspace export from your admin panel
# Extract the ZIP file to a local directory

# Run the import (requires DATABASE_URL environment variable)
cd ingest
uv run python -m tiger_slack.import /path/to/slack-export-directory

# Example:
uv run python -m tiger_slack.import ~/Downloads/slack-export-2024-01-15/

# Or use the just command from project root:
just import-history /path/to/slack-export-directory
```

### Import Features

- **Automatic Schema Migration**: Runs database migrations before import
- **Channel Filtering**: Skips messages from channels not found in database (handles renamed/deleted channels)
- **Progress Logging**: Full Logfire instrumentation for monitoring import progress
- **Error Handling**: Comprehensive error handling with PostgreSQL diagnostic capture
- **Incremental Import**: Safe to run multiple times (duplicate messages are ignored)
- **Performance Optimization**: 
  - Single database connection with transaction batching
  - Minimal memory footprint for large exports
  - Optimized SQL queries for bulk operations

### Import Monitoring

During import, you can monitor progress via:
- **Console Output**: Real-time progress and error messages
- **Logfire Dashboard**: Detailed traces and performance metrics
- **Database Queries**: Check `slack.message`, `slack.user`, and `slack.channel` tables

### Troubleshooting

Common import issues:
- **Missing channels.json**: Warning logged, but import continues with message processing
- **Channel name mismatches**: Channels not in database are skipped with warnings
- **Malformed JSON**: Individual file errors are logged but don't stop the overall import
- **Database constraints**: Constraint violations are captured and logged for review

## Observability with Logfire

The ingest app is fully instrumented with [Logfire](https://logfire.pydantic.dev/), Pydantic's observability platform, providing comprehensive monitoring, tracing, and debugging capabilities.

### What Logfire Provides

- **Distributed Tracing**: End-to-end request tracing across database operations, Slack API calls, and message processing
- **Structured Logging**: Rich, queryable logs with automatic context correlation
- **Performance Monitoring**: Database query timing, system resource usage, and application performance metrics
- **Error Tracking**: Automatic exception capture with full stack traces and contextual information
- **Real-time Dashboards**: Live monitoring of application health and performance

### Instrumentation Coverage

The app automatically instruments:

#### Database Operations
- **PostgreSQL queries** via `logfire.instrument_psycopg()`
- **Connection pool** operations and transaction timing
- **Migration execution** with detailed step-by-step traces
- **Bulk import** operations with progress tracking

#### External API Calls
- **Slack API requests** via `logfire.instrument_httpx()`
- **Rate limiting** and retry behavior
- **WebSocket connections** for real-time event streaming

#### System Performance
- **CPU utilization** (user/system time, core utilization)
- **Memory usage** (virtual/physical memory, process stats)
- **Thread count** and async task monitoring

#### Application Logic
- **Message processing** with event routing and error handling
- **Job execution** including advisory lock acquisition and release
- **Import operations** with file-by-file progress tracking

### Logfire Setup

#### 1. Create Logfire Account

1. Sign up at https://logfire.pydantic.dev/
2. Create a new project for your Tiger Slack deployment

#### 2. Configure Environment Variables
Add to your `.env` file:
```bash
# Logfire configuration
LOGFIRE_TOKEN="pylf_..."              # Write token for sending traces/logs
LOGFIRE_READ_TOKEN="pylf_..."         # Read token for Claude Code MCP queries
LOGFIRE_ENVIRONMENT="dev"             # Logical environment (dev/staging/prod)

# Optional: Custom endpoints (defaults shown)
LOGFIRE_TRACES_ENDPOINT="https://logfire-api.pydantic.dev/v1/traces"
LOGFIRE_LOGS_ENDPOINT="https://logfire-api.pydantic.dev/v1/logs"
```

#### 3. Service Configuration
The app automatically configures Logfire on startup:
- **Service Name**: `tiger-slack-ingest` (configurable via `SERVICE_NAME` env var)
- **Service Version**: Automatically set from `tiger_slack.__version__`
- **Environment**: Uses `LOGFIRE_ENVIRONMENT` for trace organization

### Using Logfire with Claude Code

The Tiger Slack project includes Logfire MCP integration for AI-powered debugging:

```bash
# Setup Logfire MCP for Claude Code access
just setup-logfire-mcp

# Query recent traces in Claude Code
# "Show me traces from the last hour"
# "Are there any errors in message processing?"
# "What's the performance of the user sync job?"
```

### Logfire Best Practices

- **Environment Separation**: Use different `LOGFIRE_ENVIRONMENT` values for dev/staging/prod
- **Retention Policies**: Configure appropriate data retention for your monitoring needs
- **Alert Configuration**: Set up alerts for critical errors and performance degradation
- **Dashboard Customization**: Create custom dashboards for your specific monitoring requirements

## Database Migrations

The ingest app includes a sophisticated database migration system that automatically manages schema changes and ensures data integrity across deployments.

### Migration Architecture

The migration system is built around **`tiger_slack/migrations/runner.py`** and organizes SQL changes into two categories:

- **`incremental/`**: One-time schema changes that are version-controlled and run sequentially
- **`idempotent/`**: Repeatable SQL operations (functions, views, indexes) that can be run multiple times safely

### Migration Process

1. **Automatic Execution**: Migrations run automatically on app startup via `migrate_db()` in `main.py`
2. **Version Management**: Database version is tracked in `slack.version` table and compared against the app version
3. **Advisory Locking**: Uses PostgreSQL advisory locks to prevent concurrent migrations across multiple instances
4. **Sequential Processing**: Incremental migrations must be numbered sequentially (000-, 001-, 002-, etc.) and are executed in that order.

### Migration Types

#### Incremental Migrations (`incremental/`)
- **Purpose**: One-time schema changes that alter database structure
- **Examples**: 
  - `000-timescaledb.sql`: Enable TimescaleDB extension
  - `004-message.sql`: Create hypertable for time-series message storage
- **Execution**: Run once per deployment, tracked in `slack.migration` table
- **Safety**: Cannot be modified after deployment (content changes trigger warnings)

#### Idempotent Migrations (`idempotent/`)
- **Purpose**: Repeatable operations that define current database state
- **Examples**:
  - `002-user.sql`: User-related upsert function
  - `004-message.sql`: Message processing functions
  - `006-user-search.sql`: User-related text search functions
- **Execution**: Run on every startup to ensure schema consistency
- **Safety**: Must be written to handle repeated execution gracefully

### Migration Infrastructure

- **`slack.version`**: Tracks current database version with timestamp
- **`slack.migration`**: Records applied incremental migrations with content hashing - this table tracks which incremental migration files have been executed, stores their content for change detection, and records the app version when they were applied
- **Advisory Locks**: Prevents concurrent migration processing
- **Atomic Migrations**: Migrations are run in a single transaction and either all complete successfully or are all rolled back
- **Rollback Protection**: Prevents downgrades by comparing app version vs. database versions
- **Content Verification**: Detects changes to already-applied incremental migrations
- **Observability**: Full Logfire instrumentation for migration monitoring and debugging

### Migration Process Flow

Here's the chronological flow of how migrations execute:

**Key Steps Explained:**

1. **Startup**: App calls `migrate_db()` during initialization
2. **Coordination**: Acquire PostgreSQL advisory lock to prevent concurrent migration processing
3. **Infrastructure**: Ensure migration tables exist (`slack.version`, `slack.migration`)
4. **Version Check**: Compare app version vs database version to determine if migration needed
5. **Incremental Phase**: Execute new one-time migrations, skip already-applied ones
6. **Idempotent Phase**: Run all repeatable operations to ensure current state
7. **Version Update**: Mark database as current with new version number

### How To Add New Migrations

1. Add one or more SQL files.
   Database changes that must happen exactly once should go in the incremental folder (e.g. adding an index).
   Changes that can be run over and over safely may go in the idempotent folder (e.g. `create or replace function...`)
2. Ensure that the SQL files follow the naming standard (see: `sql_file_number()` in `runner.py`)
3. Ensure that the SQL files are sequentially numbered via prefix with no gaps
4. Increment `__version__` in `tiger_slack/__init__.py`. Migrations won't be applied if the version isn't incremented.

### Running Migrations

Migrations run automatically, but can also be executed manually:

```bash
# Run migrations standalone
cd ingest
uv run python -m tiger_slack.migrations.runner

# Migrations also run automatically when starting the main app
uv run python -m tiger_slack.main
```

## Development

### Getting Started

The ingest service includes a comprehensive `justfile` for development tasks. All commands should be run from the `ingest/` directory.

#### Initial Setup
```bash
# Navigate to ingest directory
cd ingest/

# Install dependencies (including dev dependencies like ruff)
just deps

# Check available commands
just --list
```

#### Development Workflow

1. **Setup and Dependencies**
   ```bash
   just deps          # Install/sync all dependencies
   just tree          # Show dependency tree
   ```

2. **Code Quality Checks**
   ```bash
   just lint          # Run ruff linter checks
   just format        # Check formatting (diff preview)
   just lint-fix      # Fix auto-fixable linting issues  
   just format-fix    # Apply code formatting
   ```

3. **Running the Application**
   ```bash
   just run           # Run the main ingest application
   just migrate       # Run database migrations only
   just jobs          # Run scheduled jobs manually
   ```

4. **Historical Data Import**
   ```bash
   just import /path/to/slack-export/  # Import Slack export data
   ```

5. **Docker Operations**
   ```bash
   just build-image                    # Build Docker image
   just docker-run                     # Build and run with Docker
   just docker-run-env                 # Run with environment file
   ```

6. **Utilities**
   ```bash
   just version       # Show package version
   just build-wheel   # Build Python wheel
   just clean         # Clean build artifacts
   ```

### Recommended Development Flow

1. **Start new work**: `just deps` to ensure dependencies are current
2. **Code changes**: Make your modifications
3. **Quality checks**: `just lint` and `just format` to check for issues
4. **Fix issues**: `just lint-fix` and `just format-fix` to auto-fix
5. **Test locally**: `just run` to test the application
6. **Build verification**: `just build-image` to ensure Docker build works

### Code Quality Standards

The project uses ruff for both linting and formatting.
Refer to [pyproject.toml](/ingest/pyproject.toml) for specifics.

All code should pass `just lint` and `just format` checks before committing.