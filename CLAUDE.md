# Tiger Slack Development Guidelines

## Project Overview

This is a Slack integration project with TimescaleDB backend and MCP server for AI interaction. The project consists of:

- **Python app** (`db/`): Slack event processing and data ingestion with Logfire observability
- **TypeScript MCP server** (`mcp/`): AI-accessible API for Slack data queries
- **Docker Compose**: Local development environment
- **Git submodules**: MCP boilerplate dependency

## Architecture & Technology Stack

- **Database**: TimescaleDB (PostgreSQL + TimescaleDB extension)
- **Python**: uv package manager, Logfire for observability, psycopg for database
- **TypeScript**: Node.js 22, OpenTelemetry for tracing, Express for HTTP
- **Observability**: Logfire (Pydantic's observability platform)
- **Development**: Docker Compose, just command runner
- **AI Integration**: MCP (Model Context Protocol) for Claude Code

## Build & Development Commands

**Service Management:**
- `just up` - Start all Docker services
- `just down` - Stop services
- `just build` - Build/rebuild containers
- `just logs` - View service logs
- `just psql` - Connect to database

**MCP Configuration:**
- `just configure-tiger-slack-mcp` - Generate MCP config
- `just connect-tiger-slack-mcp` - Connect to Claude Code
- `just configure-logfire-mcp` - Configure Logfire MCP
- `just connect-logfire-mcp` - Connect Logfire MCP

**Development:**
- TypeScript: `cd mcp && npm run build && npm run start`
- Python: Located in `db/` with uv package management

## Code Style & Conventions

**Python (db/):**
- Use `uv` for dependency management
- Follow Logfire instrumentation patterns
- Use async/await for database operations
- Type hints required for all functions
- Use psycopg for PostgreSQL connections

**TypeScript (mcp/):**
- Use ES modules with `.js` extensions in imports
- Strict TypeScript typing required
- Follow OpenTelemetry instrumentation patterns
- Use Express for HTTP server
- 2-space indentation, trailing commas

**Docker & Infrastructure:**
- Multi-stage Docker builds preferred
- Environment variables for configuration
- Project-scoped MCP configuration
- No secrets in git (use .env files)

## Environment Configuration

**Required Environment Variables:**
```bash
SLACK_BOT_TOKEN="xoxb-..."
SLACK_APP_TOKEN="xapp-..."
SLACK_DOMAIN="workspace-name"
LOGFIRE_TOKEN="pylf_..."
LOGFIRE_ENVIRONMENT="development"
LOGFIRE_TRACES_ENDPOINT="https://logfire-api.pydantic.dev/v1/traces"
LOGFIRE_LOGS_ENDPOINT="https://logfire-api.pydantic.dev/v1/logs"
```

**File Structure:**
- `.env` - Local environment variables (ignored by git)
- `.env.sample` - Template for environment setup
- `.mcp.json` - Active MCP configuration (ignored by git)
- `.claude/` - MCP configuration templates (can be committed)

## Git Submodules

This project uses git submodules for MCP boilerplate:
- **Location**: `mcp/src/shared/boilerplate`
- **Repository**: `git@github.com:timescale/mcp-boilerplate-node`
- **Commands**: `git submodule update --init --recursive`

## Testing & Verification

**MCP Server Testing:**
1. Start services: `just up`
2. Configure MCP: `just configure-tiger-slack-mcp && just connect-tiger-slack-mcp`
3. Test in Claude Code: Ask "What Slack channels are available?"
4. Verify traces in Logfire dashboard

**Database Testing:**
- Use `just psql` for direct database access
- Check Docker logs: `just logs`
- Reset environment: `just reset`

## Observability & Debugging

**Logfire Integration:**
- Both Python and TypeScript send traces to Logfire
- Database queries, HTTP requests, and MCP calls are traced
- Real-time observability for debugging and performance monitoring

**Common Debug Commands:**
```bash
# Check service status
docker compose ps

# View specific service logs
docker compose logs mcp-server
docker compose logs app

# Test MCP connectivity
claude mcp list

# Database connectivity
just psql
```

## Security Considerations

- Never commit `.env` or `.mcp.json` files (contain secrets)
- Use project-scoped MCP configuration for team development
- Logfire tokens should be kept secure
- Database uses trust authentication for local development only

## Deployment Notes

- MCP server runs on port 3000 (mapped from internal 3001)
- Database accessible on localhost:5432
- All services configured for Logfire observability
- Git submodules must be initialized in deployment environments

## Integration Points

**Claude Code Integration:**
- Uses stdio MCP protocol for AI queries
- Provides Slack data access tools
- Generates Logfire traces for observability
- Project-scoped configuration for team use

**Slack Integration:**
- Python app processes Slack events
- Stores data in TimescaleDB
- MCP server provides AI-accessible queries
- Permalink generation for message links