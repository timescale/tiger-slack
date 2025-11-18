# Tiger Slack MCP Server

## Overview

The Tiger Slack MCP Server is an AI-accessible interface that provides LLMs (like Claude) with powerful tools for querying and analyzing Slack workspace data. Built using the [Model Context Protocol](https://modelcontextprotocol.io/introduction), it acts as a bridge between AI assistants and your Slack database, enabling intelligent conversation analysis, user lookup, and workspace insights.

## What It Does

The MCP server exposes a focused set of tools that allow AI assistants to:

- **Browse Workspace Structure**: List channels and users with intelligent filtering and search
- **Analyze Conversations**: Retrieve recent messages from specific channels with full threading context
- **Track User Activity**: Find conversations involving specific users across the workspace
- **Follow Message Threads**: Access complete threaded conversations with replies and context
- **Generate Slack Links**: Create permalinks to messages for easy navigation

## Key Features

- **Real-time Data Access**: Queries live data from your TimescaleDB-backed Slack database
- **Thread-aware Analysis**: Preserves conversation context and reply relationships
- **User-friendly Output**: Formats messages with usernames, timestamps, and threading structure
- **Flexible Transport**: Supports both stdio and HTTP transport modes
- **Observability Ready**: Built-in OpenTelemetry instrumentation for monitoring and debugging
- **Type-safe API**: Full TypeScript implementation with Zod schema validation

## Architecture

The server connects directly to your Tiger Slack database (populated by the [ingest service](../ingest/README.md)) and provides these core APIs:

- **`getChannels`** - List workspace channels with optional keyword filtering
- **`getUsers`** - List workspace users with profile information and search
- **`getRecentConversationsInChannel`** - Fetch recent messages from a specific channel
- **`getRecentConversationsWithUser`** - Find conversations involving a specific user
- **`getThreadMessages`** - Retrieve all messages in a specific thread
- **`getMessageContext`** - Get contextual messages around a specific message

Each API is designed to provide rich, structured data that AI assistants can easily understand and work with, making Slack data accessible for analysis, search, and insight generation.

## Development

Cloning and running the server locally.

```bash
git clone git@github.com:timescale/tiger-slack.git
```

### Building

Run `npm i` to install dependencies and build the project. Use `npm run watch` to rebuild on changes.

Create a `.env` file based on the `.env.sample` file.

```bash
cp .env.sample .env
```

### Testing

The MCP Inspector is very handy.

```bash
npm run inspector
```

| Field          | Value           |
| -------------- | --------------- |
| Transport Type | `STDIO`         |
| Command        | `node`          |
| Arguments      | `dist/index.js` |

#### Testing in Claude Desktop

Create/edit the file `~/Library/Application Support/Claude/claude_desktop_config.json` to add an entry like the following, making sure to use the absolute path to your local `tiger-slack-mcp-server` project, and real database credentials.

```json
{
  "mcpServers": {
    "tiger-slack": {
      "command": "node",
      "args": [
        "/absolute/path/to/tiger-slack-mcp-server/dist/index.js",
        "stdio"
      ],
      "env": {
        "PGHOST": "x.y.tsdb.cloud.timescale.com",
        "PGDATABASE": "tsdb",
        "PGPORT": "32467",
        "PGUSER": "tsdbadmin",
        "PGPASSWORD": "abc123"
      }
    }
  }
}
```

### Linting

This project uses ESLint for code linting with TypeScript support.

To run the linter:

```bash
npm run lint
```

To automatically fix linting issues where possible:

```bash
npm run lint:fix
```

## Observability with Logfire

The Tiger Slack MCP Server includes comprehensive observability through [Logfire](https://logfire.pydantic.dev/) and OpenTelemetry, providing real-time monitoring of API calls, database queries, and system performance.

### What Gets Traced

The MCP server automatically instruments:

#### MCP Protocol Operations

- **Tool calls** with input parameters and response data
- **Session management** including connection lifecycle
- **Transport layer** (stdio/HTTP) with connection details
- **Error handling** with full stack traces and context

#### Database Operations

- **PostgreSQL queries** with query text, parameters, and timing
- **Connection pooling** operations and resource usage
- **Query performance** metrics and slow query detection
- **Database errors** with detailed diagnostic information

#### System Performance

- **HTTP requests** (when using HTTP transport)
- **Memory usage** and garbage collection metrics
- **CPU utilization** during query processing
- **Response times** for all API endpoints

### Logfire Setup

#### 1. Create Logfire Project

1. Sign up at https://logfire.pydantic.dev/
2. Create a new project for your MCP server deployment
3. Note your project tokens for configuration

#### 2. Configure Environment Variables

Add these variables to your `.env` file:

```bash
# Logfire configuration
LOGFIRE_TOKEN="pylf_..."              # Write token for sending traces/logs
LOGFIRE_ENVIRONMENT="dev"             # Logical environment (dev/staging/prod)

# Optional: Custom service configuration
SERVICE_NAME="tiger-slack-mcp"        # Service name in traces (default)
SERVICE_VERSION="0.1.0"               # Service version (default from package.json)

# Optional: Custom endpoints (defaults shown)
LOGFIRE_TRACES_ENDPOINT="https://logfire-api.pydantic.dev/v1/traces"
LOGFIRE_LOGS_ENDPOINT="https://logfire-api.pydantic.dev/v1/logs"
```

#### 3. Enable Instrumentation

Set the instrumentation flag to enable OpenTelemetry:

```bash
# Enable OpenTelemetry instrumentation
INSTRUMENT=true
```

**Important**: The MCP server only enables instrumentation when `INSTRUMENT=true` is set, preventing unnecessary overhead in production environments where observability isn't needed.

### Alternative: Generic OpenTelemetry Setup

If you prefer to use a different observability backend, the server supports standard OpenTelemetry configuration:

```bash
# OpenTelemetry configuration (alternative to Logfire)
OTEL_EXPORTER_OTLP_ENDPOINT="https://your-otel-collector:4318"
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer your-token"
OTEL_SERVICE_NAME="tiger-slack-mcp"
OTEL_SERVICE_VERSION="0.1.0"
OTEL_RESOURCE_ATTRIBUTES="environment=production"

# Enable instrumentation
INSTRUMENT=true
```
