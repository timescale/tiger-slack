# Tiger Slack

A Slack integration project with TimescaleDB backend and MCP (Model Context Protocol) server for AI interaction.

## Quick Start

1. **Set up environment variables:**
   ```bash
   cp .env.sample .env
   # Edit .env with your Slack tokens and Logfire credentials
   ```

2. **Start services:**
   ```bash
   just up
   ```

3. **Set up MCP servers for Claude Code:**
   ```bash
   just setup-tiger-slack-mcp
   just setup-logfire-mcp
   ```

## Architecture

This project consists of:

- **TimescaleDB**: PostgreSQL with TimescaleDB extension for Slack data storage
- **Python App**: Slack event processing and data ingestion (`db/`)
- **TypeScript MCP Server**: AI-accessible API for Slack data queries (`mcp/`)
- **Logfire Integration**: Observability and tracing for both services

## Environment Setup

### Required Environment Variables

Create a `.env` file from the sample:

```bash
cp .env.sample .env
```

Configure the following variables:

```bash
# Slack API credentials
SLACK_BOT_TOKEN="xoxb-your-bot-token"
SLACK_APP_TOKEN="xapp-your-app-token"
SLACK_DOMAIN="your-workspace-name"

# Logfire configuration (https://logfire.pydantic.dev)
LOGFIRE_TOKEN="pylf_your_write_token_here"  # For sending traces/logs
LOGFIRE_READ_TOKEN="pylf_your_read_token_here"  # For Claude Code MCP queries
LOGFIRE_ENVIRONMENT="development"
LOGFIRE_TRACES_ENDPOINT="https://logfire-api.pydantic.dev/v1/traces"
LOGFIRE_LOGS_ENDPOINT="https://logfire-api.pydantic.dev/v1/logs"
```

## Docker Compose Services

### Available Commands

**Service Management:**
- `just up` - Start all services in detached mode
- `just down` - Stop and remove all containers
- `just build` - Build/rebuild all containers
- `just logs` - Follow logs from all services
- `just restart` - Restart all services
- `just reset` - Full reset: stop containers, remove volumes, and restart fresh

**Database Access:**
- `just psql` - Connect to the TimescaleDB database with psql

**Data Population:**
- `just load-data` - Load current users and channels from Slack API
- `just import-history /path/to/slack-export/` - Import historical Slack export data

### Services

**Database (`db` service):**
- **Image**: TimescaleDB HA (PostgreSQL 17 with TimescaleDB)
- **Port**: `localhost:5432`
- **Database**: `tiger_slack`
- **User**: `postgres` (no password for local dev)

**Python App (`app` service):**
- **Purpose**: Slack event processing and data ingestion
- **Dependencies**: Database, Logfire integration
- **Environment**: Configured with Slack tokens and Logfire

**MCP Server (`mcp-server` service):**
- **Purpose**: TypeScript-based MCP server for AI queries
- **Port**: `localhost:3000` (HTTP transport for Claude Code)
- **Transport**: HTTP-based MCP (no secrets needed in Claude config)
- **Dependencies**: Database, includes full Logfire tracing
- **Built from**: `./mcp/` directory with git submodule dependencies

## MCP Server Setup

The MCP (Model Context Protocol) server allows AI assistants like Claude Code to query your Slack data directly.

### Prerequisites

1. **Install Claude Code**: [Download from Anthropic](https://claude.ai/code)
2. **Start Docker services**: `just up`
3. **Ensure MCP server is built**: The Docker build process handles TypeScript compilation

### Setup Commands

**One-command setup for each MCP server:**
```bash
# Setup Tiger Slack MCP server (connects via HTTP to Docker container)
just setup-tiger-slack-mcp

# Setup Logfire MCP server (for observability queries)  
just setup-logfire-mcp
```

**Key Benefits of HTTP Transport:**
- 🔒 **No secrets in Claude Code config** - all credentials stay in Docker environment
- 🐳 **Tests full Docker setup** - verifies the complete containerized stack
- 🔗 **Simple HTTP connection** - connects to `http://localhost:3000/mcp`
- 🚀 **Production-ready** - mirrors how MCP would work in deployment

### Verify Setup

1. **Check MCP servers are configured:**
   ```bash
   claude mcp list
   ```

2. **Load Slack data:**
   ```bash
   # Load current users and channels
   just load-data
   
   # OR load historical export data (see Data Import section below)
   just import-history /path/to/slack-export/
   ```

3. **Test in Claude Code:**
   - Open Claude Code in this project
   - Ask: "What Slack channels are available?"
   - The MCP server should respond with channel data from your database

### MCP Server Capabilities

The Tiger Slack MCP server provides these tools for AI interaction:

- **Channel queries**: List channels, get channel info
- **User queries**: Find users, get user details  
- **Message queries**: Search messages, get conversations
- **Thread analysis**: Analyze message threads and replies
- **Permalink generation**: Get direct links to Slack messages

### Development & Debugging

**Local TypeScript development:**
```bash
cd mcp/
npm install
npm run build
npm run start  # Runs in stdio mode
```

**HTTP mode for testing:**
```bash
cd mcp/ 
npm run start:http  # Runs on port 3001
```

**Rebuild MCP server:**
```bash
just build  # Rebuilds all Docker containers including MCP server
```

## Data Import

The system supports two ways to populate your database with Slack data:

### Method 1: Load Current Data (`just load-data`)

Load current users and channels from the Slack API:

```bash
# Make sure services are running
just up

# Load all current users and channels
just load-data
```

**What this does:**
- Fetches all users from Slack API using `users.list`
- Fetches all channels from Slack API using `conversations.list`
- Stores data in TimescaleDB with proper indexing
- Uses advisory locks to prevent concurrent execution
- Provides comprehensive Logfire tracing

**Results:**
- All workspace users (active, inactive, bots filtered appropriately)
- All channels (public, private, archived status)
- No historical messages (only current channel/user metadata)

### Method 2: Import Historical Export (`just import-history`)

Import a complete historical Slack workspace export:

```bash
# Step 1: Download Slack export
# Go to your Slack workspace → Settings & administration → Workspace settings
# → Import/Export Data → Export → Start Export → Download the zip file

# Step 2: Extract the zip file to a directory
unzip slack-export.zip -d /path/to/slack-export/

# Step 3: Run the import (this runs on the host, not in container)
just import-history /path/to/slack-export/
```

**What this does:**
- Loads all users and channels (same as Method 1)
- Processes each channel directory in the export
- Imports all historical messages from JSON files
- Reconstructs message threads and reply structures  
- Imports reactions with user mappings
- Handles message attachments, files, and metadata
- Provides detailed progress tracking via Logfire

**Results:**
- Complete workspace history (all messages, threads, reactions)
- Full user and channel metadata
- Message attachments and file references
- Thread conversation structures preserved

**Export Structure Expected:**
```
slack-export/
├── channels.json
├── users.json
├── integration_logs.json
├── general/              # Channel directories
│   ├── 2023-01-01.json  # Daily message files
│   ├── 2023-01-02.json
│   └── ...
├── random/
│   ├── 2023-01-01.json
│   └── ...
└── ...
```

**Performance Notes:**
- Historical imports can take significant time depending on workspace size
- Database uses `ON CONFLICT DO NOTHING` to handle duplicate data safely
- All operations are wrapped in transactions for consistency
- Progress is tracked in real-time via Logfire dashboard

### Verification

After either import method, verify your data:

```bash
# Check data counts
just psql -c "
SELECT 
  (SELECT COUNT(*) FROM slack.user) as users,
  (SELECT COUNT(*) FROM slack.channel) as channels,
  (SELECT COUNT(*) FROM slack.message) as messages;
"

# Test the MCP server
# In Claude Code, ask: "How many Slack users and channels do we have?"
```

## Observability with Logfire

This project integrates with [Logfire](https://logfire.pydantic.dev) for comprehensive observability.

### What Gets Tracked

**Python App (Slack processing):**
- Database queries and performance
- Slack API calls and responses  
- Error tracking and debugging
- System metrics (CPU, memory)

**MCP Server (AI queries):**
- All MCP tool calls from Claude Code
- Database query performance
- HTTP request traces
- Session management and lifecycle events
- OpenTelemetry auto-instrumentation

### Environment Configuration

Both services use the same **Logfire environment** for trace organization:

- **Python App**: Uses `LOGFIRE_ENVIRONMENT` from your `.env` file
- **MCP Server**: Uses `LOGFIRE_ENVIRONMENT` passed through Docker Compose  
- **Container Runtime**: Uses `NODE_ENV=production` for Node.js performance optimization

This separation allows:
- **Production-optimized containers** (NODE_ENV=production)
- **Logical trace grouping** (LOGFIRE_ENVIRONMENT=dev-john, staging, production, etc.)
- **Environment isolation** in the Logfire dashboard

**Example configuration:**
```bash
# In your .env file
LOGFIRE_ENVIRONMENT="dev-john"    # Logfire trace environment
LOGFIRE_TOKEN="pylf_..."          # Write token for sending traces
```

The MCP server automatically inherits your `LOGFIRE_ENVIRONMENT` setting, ensuring all traces from both services appear in the same logical environment in Logfire.

### Viewing Traces

1. **Set up Logfire account**: [https://logfire.pydantic.dev](https://logfire.pydantic.dev)
2. **Configure tokens**: Add `LOGFIRE_TOKEN` to your `.env` file
3. **Start services**: `just up` (services automatically send traces)
4. **Use Claude Code**: Query Slack data to generate traces
5. **View in Logfire**: See real-time traces, metrics, and logs

### Example Traces

When you ask Claude Code "What are the recent messages in #general?":
- **MCP call trace**: Shows the tool invocation
- **Database query trace**: Shows SQL execution time
- **Result formatting trace**: Shows data processing
- **Complete request flow**: End-to-end timing and performance

## Troubleshooting

### Common Issues

**"MCP server not responding" or "No valid session ID provided":**
```bash
# Check if services are running
docker compose ps

# Check MCP server logs  
docker compose logs mcp-server

# Remove and re-add MCP server (fixes stale sessions)
claude mcp remove tiger-slack
just setup-tiger-slack-mcp

# If still failing, rebuild and restart
just build && just up
```

**Session handling notes:**
- MCP server automatically handles stale session IDs from Claude Code restarts
- Instrumentation requires `INSTRUMENT=true` environment variable
- Both HTTP and stdio transports supported (HTTP recommended for production)

**"Database connection failed":**
```bash
# Check database is running
docker compose ps db

# Connect manually to test
just psql

# Reset database
just reset
```

**"Environment variables not loaded":**
```bash
# Verify .env file exists and has correct values
cat .env

# Re-setup MCP servers with fresh env vars
just setup-tiger-slack-mcp
just setup-logfire-mcp
```

**"Git submodule issues":**
```bash
# Initialize submodules
git submodule update --init --recursive

# Rebuild after submodule changes
just build
```

### Support

- **MCP Server Code**: `./mcp/` directory
- **Python App Code**: `./db/` directory  
- **Configuration**: Generated in `.claude/` (committed) and `.mcp.json` (ignored)
- **Logs**: `just logs` for all services
- **Database**: `just psql` for direct access

## Contributing

1. **Fork the repository**
2. **Set up development environment**: Follow Quick Start guide
3. **Make changes**
4. **Test MCP integration**: Ensure Claude Code can query data
5. **Check observability**: Verify traces appear in Logfire
6. **Submit pull request**

### Security Notes

- `.env` file contains secrets - never commit to git
- `.mcp.json` is generated locally - automatically ignored by git  
- **HTTP MCP transport** keeps all secrets in Docker containers (not Claude config)
- Use project-scoped MCP configuration for team development
- Regenerate tokens if accidentally exposed

