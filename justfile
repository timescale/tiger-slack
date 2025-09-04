# Docker Compose lifecycle commands
up:
    docker compose up -d

down:
    docker compose down

build:
    docker compose build

logs:
    docker compose logs -f

restart:
    docker compose restart

# Database commands
psql:
    docker compose exec db psql -U postgres -d tiger_slack

# Full reset
reset: down
    docker compose down -v
    docker compose up -d

# MCP Server Setup for Claude Code
setup-logfire-mcp:
    #!/usr/bin/env bash
    set -euo pipefail

    # Source environment variables
    if [ -f .env ]; then
        set -a
        source .env
        set +a
    fi
    
    # Check if LOGFIRE_READ_TOKEN is set
    if [ -z "${LOGFIRE_READ_TOKEN:-}" ]; then
        echo "❌ LOGFIRE_READ_TOKEN not found in .env file"
        echo "💡 Add: LOGFIRE_READ_TOKEN=\"your-token\" to your .env file"
        exit 1
    fi
    
    claude mcp add -s project logfire -e LOGFIRE_READ_TOKEN="${LOGFIRE_READ_TOKEN}" -- uvx logfire-mcp@latest

setup-tiger-slack-mcp:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔌 Setting up Tiger Slack MCP server in Claude Code..."
    echo "📋 Make sure Docker services are running: just up"
    
    claude mcp add -s project --transport http tiger-slack http://localhost:3000/mcp
    
    echo "✅ Added Tiger Slack MCP server with project scope!"
    echo "🔗 Connects via HTTP to containerized MCP server (no secrets in config)"
    echo "📊 Traces will appear in Logfire dashboard"
