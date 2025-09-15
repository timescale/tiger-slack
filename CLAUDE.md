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
docker compose up -d          # Start all services (TimescaleDB, ingest, MCP server)
docker compose down           # Stop all services  
docker compose logs -f        # View service logs
docker compose restart        # Restart all services
docker compose down -v && docker compose up -d  # Reset with fresh volumes
docker compose down -v --remove-orphans && docker system prune -f --volumes && docker compose up -d --build  # Complete rebuild (destroys all data)
```

### Database Access
```bash
psql -d "postgres://tsdbadmin:password@localhost:5432/tsdb"  # Connect to TimescaleDB via psql
```

### MCP Integration Setup
```bash
# Add Logfire MCP to Claude Code (requires LOGFIRE_READ_TOKEN in .env)
claude mcp add -s project logfire -e LOGFIRE_READ_TOKEN="your-token-here" -- uvx logfire-mcp@latest

# Add Tiger Slack MCP to Claude Code
claude mcp add -s project --transport http tiger-slack http://localhost:3001/mcp
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
just lint && just format && just typecheck  # Code quality checks
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

# PostgreSQL connection details
PGHOST="db"                    # or "localhost" for local development
PGDATABASE="tsdb"
PGPORT="5432"
PGUSER="tsdbadmin"
PGPASSWORD="password"

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

## Interactive Setup Guide

**Trigger**: When a user asks "help me setup", "setup", or similar setup requests, guide them through this interactive process.

### 1. Environment File Initialization
- Check if `.env` file exists
- If not, copy `.env.sample` to `.env`
- Guide user through filling required variables

### 2. Logfire Setup (Optional)
If `LOGFIRE_TOKEN` is blank in `.env`:
- Ask user: "Would you like to setup Logfire for observability? (optional)"
- If yes:
  - Run: `open https://logfire-us.pydantic.dev/`
  - Instruct: "Create a project and get a write token (format: `pylf_...`)"
  - Prompt user: "Please paste your Logfire write token:"
  - Update `LOGFIRE_TOKEN` in `.env` with provided token
  - Ask: "What environment name? (default: 'development')"
  - Update `LOGFIRE_ENVIRONMENT` in `.env`

### 3. Slack App Creation (Required)
- Ask user: "What would you like to name your bot? (default: 'tigerdata-slack-ingest')"
- Generate and display the custom manifest (DO NOT write to file):

```json
{
  "display_information": {
    "name": "[USER_PROVIDED_NAME]",
    "description": "This bot ingests slack events into a Timescaledb database",
    "background_color": "#000000"
  },
  "features": {
    "bot_user": {
      "display_name": "[KEBAB_CASE_NAME]",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "user": ["channels:history"],
      "bot": [
        "channels:history", "channels:read", "users.profile:read",
        "users:read", "users:read.email", "reactions:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "user_events": ["message.channels"],
      "bot_events": [
        "channel_created", "channel_rename", "message.channels",
        "reaction_added", "reaction_removed", "team_join",
        "user_change", "user_profile_changed"
      ]
    },
    "interactivity": {"is_enabled": true},
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

**Interactive Slack App Setup:**
1. Run: `open https://api.slack.com/apps/`
2. Instruct: "Click 'Create New App' → 'From a manifest' → Choose your workspace"
3. Prompt user: "What is your workspace name? (for SLACK_DOMAIN)"
4. Update `SLACK_DOMAIN` in `.env` with workspace name
5. Instruct: "Paste the manifest above, then click 'Next' and 'Create'"
6. Instruct: "Navigate to: Basic Information → App-Level Tokens"
7. Instruct: "Click 'Generate Token and Scopes' → Add 'connections:write' scope → Generate"
8. Prompt user: "Please paste your App-Level Token (starts with 'xapp-'):"
9. Update `SLACK_APP_TOKEN` in `.env` with provided token
10. Instruct: "Navigate to: Install App → Click 'Install to [Workspace]'"
11. Instruct: "After installation, copy the 'Bot User OAuth Token'"
12. Prompt user: "Please paste your Bot User OAuth Token (starts with 'xoxb-'):"
13. Update `SLACK_BOT_TOKEN` in `.env` with provided token

### 4. Service Startup
Run services and verify health:
```bash
docker compose up -d
docker compose logs -f
```

**Health Check Verification:**
- Database should show "database system is ready to accept connections"
- Ingest service should connect to Slack successfully
- MCP server should start on port 3001

**Troubleshooting:**
- If services fail: `docker compose down && docker compose up -d`
- Check logs: `docker compose logs [service-name]`
- **If you made code changes during troubleshooting**: `docker compose up -d --build`
- For database issues: verify TimescaleDB container is running
- For Slack connection issues: verify tokens in `.env`

### 5. Test MCP Server (Optional)
Ask user: "Would you like to test the MCP server functionality?"

If yes, run the MCP Inspector tool:
```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --method tools/call --tool-name getUsers --tool-arg keyword=" " --tool-arg includeTimezone=true
```

This will test the MCP server by calling the `getUsers` function and should return a list of all users in your Slack workspace with their timezones.

### 6. Claude Code MCP Integration (Optional)
Ask user: "Would you like to integrate this with Claude Code for AI-powered Slack analysis?"

If yes:
```bash
claude mcp add -s project --transport http tiger-slack http://localhost:3001/mcp
```

**Important**: You must restart Claude Code for the MCP server change to take effect.

## Development Workflow

1. **Setup**: Use interactive setup guide above for first-time configuration
2. **Start Services**: `docker compose up -d` to launch TimescaleDB, ingest, and MCP server
3. **Verify Setup**: `docker compose logs -f` to check service health
4. **Connect Claude**: MCP server auto-configured via Docker Compose
5. **Import Data**: `cd ingest && just import /path/to/slack-export` for historical analysis

## Testing & Quality

### Ingest Service
- Ruff for linting and formatting (`just lint`, `just format`)
- Pyright for type checking (`just typecheck`)
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
docker compose logs -f                    # Check service logs
docker compose restart                    # Restart problematic services
docker compose down -v --remove-orphans && docker system prune -f --volumes && docker compose up -d --build  # Full environment rebuild
```

### Database Issues
```bash
just psql              # Direct database access
cd ingest && just migrate  # Manual migration run
```

### MCP Connection Issues
```bash
claude mcp add -s project --transport http tiger-slack http://localhost:3001/mcp  # Re-setup MCP server
cd mcp && npm run inspector   # Test MCP functionality
```

## Security Notes

- Database user `readonly_mcp_user` for MCP server (read-only access)
- Logfire tokens separate for write (ingest) and read (Claude Code)
- Slack tokens require appropriate bot scopes for workspace access
- No secrets stored in MCP configuration (uses containerized HTTP transport)