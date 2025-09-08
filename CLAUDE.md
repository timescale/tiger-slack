# Tiger Slack - AI-Powered Slack Analytics Platform

This project provides AI-accessible Slack workspace analytics through real-time data ingestion, TimescaleDB storage, and MCP (Model Context Protocol) integration for Claude Code.

## Architecture Overview

- **`ingest/`** - Python service for real-time Slack event ingestion and historical data import
- **`mcp/`** - TypeScript MCP server providing AI-accessible APIs for Slack data analysis  
- **TimescaleDB** - Time-series database optimized for Slack message storage and analytics
- **Docker Compose** - Local development environment with all services

## Development Commands

### Service Management
```bash
just up              # Start all services (TimescaleDB, ingest, MCP server)
just down            # Stop all services  
just logs            # View service logs
just restart         # Restart all services
just reset           # Reset with fresh volumes
just nuclear-reset   # Complete rebuild (destroys all data)
```

### Database Access
```bash
just psql            # Connect to TimescaleDB via psql
```

### MCP Integration Setup
```bash
just setup-logfire-mcp        # Add Logfire MCP to Claude Code
just setup-tiger-slack-mcp    # Add Tiger Slack MCP to Claude Code
```

## Service-Specific Commands

### Ingest Service (`ingest/`)
```bash
cd ingest/
just deps                    # Install/sync dependencies
just run                     # Run ingest service locally
just migrate                 # Run database migrations
just jobs                    # Run scheduled sync jobs manually
just import /path/to/export  # Import Slack workspace export
just lint && just format    # Code quality checks
just build-image             # Build Docker image
```

### MCP Server (`mcp/`)
```bash
cd mcp/
npm run build               # Build TypeScript to JavaScript
npm run watch               # Watch for changes and rebuild automatically
npm run start               # Start MCP server using stdio transport
npm run prepare             # Build project for publishing
npm run inspector           # Test with MCP Inspector
```

## Configuration

### Required Environment Variables (.env)
```bash
# Slack API credentials
SLACK_BOT_TOKEN="xoxb-..."
SLACK_APP_TOKEN="xapp-..."
SLACK_DOMAIN="your-workspace"

# Database connection
DATABASE_URL="postgres://postgres@localhost:5432/tiger_slack"

# Logfire observability
LOGFIRE_TOKEN="pylf_..."           # Write token for traces/logs
LOGFIRE_READ_TOKEN="pylf_..."      # Read token for Claude Code MCP
LOGFIRE_ENVIRONMENT="development"
```

## Key Features

### Real-Time Data Pipeline
- Socket Mode connection for live Slack events
- Message ingestion with threading and reactions
- Daily user/channel synchronization jobs
- Historical data import from workspace exports

### AI-Accessible Analytics
- Channel and user browsing with search
- Recent conversation analysis with threading context
- User activity tracking across workspace
- Message thread exploration
- Automatic permalink generation

### Observability & Monitoring
- Full Logfire instrumentation across all services
- Database query performance monitoring
- Real-time error tracking and debugging
- Claude Code integration for AI-powered log analysis

## Database Schema

- **`slack.message`** - TimescaleDB hypertable for time-series message storage
- **`slack.user`** - Workspace users with profiles
- **`slack.channel`** - Channel metadata and configuration
- **`slack.event`** - Raw Slack events for audit trail

## Development Workflow

1. **Setup**: Copy `.env.sample` to `.env` and configure credentials
2. **Start Services**: `just up` to launch TimescaleDB, ingest, and MCP server
3. **Verify Setup**: `just logs` to check service health
4. **Connect Claude**: `just setup-tiger-slack-mcp` for AI access
5. **Import Data**: `just import /path/to/slack-export` for historical analysis

## Testing & Quality

### Ingest Service
- Ruff for linting and formatting (`just lint`, `just format`)
- Database migration testing (`just migrate`)
- Docker build verification (`just build-image`)

### MCP Server  
- TypeScript compilation (`npm run build`)
- MCP Inspector testing (`npm run inspector`)
- Integration testing via Claude Code

#### Code Style Guidelines
- Use ES modules with `.js` extension in import paths
- Strictly type all functions and variables with TypeScript
- Follow zod schema patterns for tool input validation
- Prefer async/await over callbacks and Promise chains
- Use camelCase for variables/functions, PascalCase for types/classes, UPPER_CASE for constants
- Handle errors with try/catch blocks and provide clear error messages

## Common Tasks

### Analyze Recent Conversations
Ask Claude: "Show me recent conversations in #engineering channel"

### Track User Activity
Ask Claude: "Find all conversations with @john from the last week"

### Debug Issues
Ask Claude: "Are there any errors in the ingest service logs?"

### Performance Monitoring
Ask Claude: "What's the database query performance for message ingestion?"

## Troubleshooting

### Service Issues
```bash
just logs              # Check service logs
just restart           # Restart problematic services
just nuclear-reset     # Full environment rebuild
```

### Database Issues
```bash
just psql              # Direct database access
cd ingest && just migrate  # Manual migration run
```

### MCP Connection Issues
```bash
just setup-tiger-slack-mcp    # Re-setup MCP server
cd mcp && npm run inspector   # Test MCP functionality
```

## Security Notes

- Database user `readonly_mcp_user` for MCP server (read-only access)
- Logfire tokens separate for write (ingest) and read (Claude Code)
- Slack tokens require appropriate bot scopes for workspace access
- No secrets stored in MCP configuration (uses containerized HTTP transport)