# Tiger Slack

**Conversational Memory for AI Slack Bots**

Tiger Slack gives AI assistants the ability to understand and engage with your team's conversations naturally. By providing real-time access to message history and context through a specialized MCP server, it enables AI bots to respond to questions with the same contextual awareness that humans have - understanding references to past discussions, ongoing projects, and team dynamics.

## Overview

This platform enables AI assistants to participate meaningfully in your team's conversations by giving them access to conversational context and history. When someone asks "What did we decide about the deployment?" or "Who was working on the API issue?", an AI bot powered by Tiger Slack can understand these references and provide informed responses, just like a team member would.

Built for teams who want their AI assistants to:
- 🤖 **Understand conversational context** and references to past discussions
- 🔍 **Answer questions about project history** and decisions
- 👥 **Know who's involved** in different topics and threads
- 📝 **Follow ongoing conversations** and provide relevant input
- 🧠 **Build conversational memory** across all team channels

## Architecture

```mermaid
graph TB
    %% External Systems
    S[Slack Workspace]
    C[Claude/LLM Client]
    
    %% Core Components  
    I[Ingest Service<br/>Python]
    D[TimescaleDB<br/>Time-series Database]
    M[MCP/HTTP Server<br/>TypeScript]
    
    %% Data Flow - Ingestion
    S -->|WebSocket Events| I
    S -->|Historical Export| I
    I -->|Store Events| D
    
    %% Data Flow - Analysis
    C -->|MCP Protocol| M
    M -->|SQL Queries| D
    M -->|Structured Data| C
```

## Key Components

### 🔄 **Ingest Service** (`ingest/`)
Python-based real-time data pipeline that:
- Connects to Slack via WebSocket (Socket Mode)
- Captures messages, reactions, user changes, and channel updates
- Imports historical data from Slack workspace exports
- Runs scheduled jobs for user/channel synchronization
- Provides comprehensive observability through Logfire

See the [ingest README.md](/ingest/README.md) for more details.

### 🗄️ **TimescaleDB Database**
Time-series PostgreSQL database optimized for:
- High-throughput message ingestion
- Efficient time-based queries and analytics
- Hypertable partitioning for optimal performance
- Full-text search capabilities across message content

### 🔌 **MCP Server** (`mcp/`)
TypeScript server implementing Model Context Protocol to provide:
- AI-accessible APIs for Slack data analysis
- Channel and user browsing with intelligent filtering
- Conversation retrieval with full threading context
- Message permalink generation
- Real-time performance monitoring

See the [mcp README.md](/mcp/README.md) for more details.

### 📊 **Observability Stack**
Full-stack monitoring through Logfire integration:
- Distributed tracing across all components
- Real-time performance metrics
- Error tracking and debugging
- AI-powered log analysis via Claude Code

## Quick Start

### Interactive Setup (Recommended)
The easiest way to get started is using the interactive setup guide in Claude Code:

```bash
git clone --recurse-submodules git@github.com:timescale/tiger-slack.git
cd tiger-slack
claude
# In Claude Code, ask: "help me setup" or "setup"
```

This will automatically guide you through environment configuration, Slack app creation, service startup, and Claude Code integration.

### Manual Setup
If you prefer to configure manually:

1. **Clone and Setup**
   ```bash
   git clone --recurse-submodules git@github.com:timescale/tiger-slack.git
   cd tiger-slack
   cp .env.sample .env  # Configure your Slack tokens
   ```

2. **Start Services**
   ```bash
   docker compose up -d     # Launch all services via Docker Compose
   docker compose logs -f   # Monitor service health
   ```

3. **Connect to Claude Code**
   To connect to the MCP server running in docker, run:

   ```bash
   claude mcp add -s project --transport http tiger-slack http://localhost:3001/mcp
   ```

   To use the MCP server without docker, run this after building the mcp:

   ```bash
   export PGHOST=localhost
   export PGPORT=5432
   export PGUSER=tsdbadmin
   export PGDATABASE=tsdb
   claude mcp add -s project tiger-slack node /absolute/path/to/tiger-slack/mcp/dist/index.js stdio
   ```

   If you do not use Claude Code, you can use the [@modelcontextprovider/inspector](https://www.npmjs.com/package/@modelcontextprotocol/inspector) by running

   ```bash
   npm run inspector
   ```

   from the ./mcp subdirectory.

4. **Connect to Logfire (Optional)**
   Note: if you do not wish to use Logfire, leave the LOGFIRE_TOKEN variable empty
   To enable AI-powered tracing analysis and debugging:

   ```bash
   claude mcp add -s project logfire -e LOGFIRE_READ_TOKEN="your-token-here" -- uvx logfire-mcp@latest
   ```

5. **Start Analyzing**
   Ask Claude: *"Show me recent conversations in #engineering"*

## Suggested Roll-out Strategy

1. First, use a [manual execution of the user/channel jobs](/ingest/README.md#manual-job-execution) to create the database schema and populate the users and channels.
2. [Deploy the ingest service](/ingest/README.md#running-the-ingest-service) to begin accumulating Slack events in real-time.
3. At some point after you have begun accumulating new Slack events in real time, get a historical export from Slack and load it with [the import process](/ingest/README.md#historical-data-import).

This strategy ensures no gaps in data.

## Docker Management

### Service Lifecycle
```bash
docker compose up -d          # Start all services in background
docker compose down           # Stop all services
docker compose build          # Build all images
docker compose logs -f        # View live logs from all services
docker compose restart        # Restart all services

# Reset with fresh volumes (deletes all data)
docker compose down -v
docker compose up -d

# Nuclear reset (complete cleanup)
docker compose down -v --remove-orphans
docker system prune -f --volumes
docker compose up -d --build
```

### Database Access
```bash
psql -d "postgres://tsdbadmin:password@localhost:5432/tsdb"
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

*Transform your Slack workspace into an intelligent knowledge base with AI-powered analytics and insights.*