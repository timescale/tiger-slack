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

**MCP Setup:**
- `just setup-tiger-slack-mcp` - Setup Tiger Slack MCP via HTTP transport (no secrets)
- `just setup-logfire-mcp` - Setup Logfire MCP using official command

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
- HTTP-based MCP transport (secrets stay in containers)
- Project-scoped MCP configuration
- No secrets in git (use .env files)

## Environment Configuration

**Required Environment Variables:**
```bash
SLACK_BOT_TOKEN="xoxb-..."
SLACK_APP_TOKEN="xapp-..."
SLACK_DOMAIN="workspace-name"
LOGFIRE_TOKEN="pylf_..."  # Write token for sending traces/logs
LOGFIRE_READ_TOKEN="pylf_..."  # Read token for Claude Code MCP queries
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
2. Setup MCP servers: `just setup-tiger-slack-mcp && just setup-logfire-mcp`
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

- Never commit `.env` files (contain secrets)
- `.mcp.json` contains no secrets (uses HTTP transport to containers)
- HTTP MCP transport keeps all credentials in Docker environment
- Use project-scoped MCP configuration for team development
- Logfire tokens should be kept secure in `.env` only
- Database uses trust authentication for local development only

## Deployment Notes

- MCP server runs on port 3000 (mapped from internal 3001)
- Database accessible on localhost:5432
- All services configured for Logfire observability
- Git submodules must be initialized in deployment environments

## Integration Points

**Claude Code Integration:**
- Uses HTTP MCP transport to containerized server
- Connects to `http://localhost:3000/mcp` (no secrets in Claude config)
- Provides Slack data access tools via HTTP API
- Generates Logfire traces for observability
- Project-scoped configuration for team use

**Slack Integration:**
- Python app processes Slack events
- Stores data in TimescaleDB
- MCP server provides AI-accessible queries
- Permalink generation for message links