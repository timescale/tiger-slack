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

reset: down
    docker compose down -v
    docker compose up -d

# Nuclear option: completely destroy all containers, volumes, and networks
nuclear-reset:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "💥 Nuclear reset: destroying everything..."
    docker compose down -v --remove-orphans
    docker system prune -f --volumes
    echo "🔄 Starting fresh..."
    docker compose up -d --build

psql:
    psql -h localhost -p 5432 -U postgres -d tiger_slack

load-channels-and-users:
    docker compose exec app uv run python -m tiger_slack.jobs

# Import historical Slack export data
# Usage: just import-history /path/to/extracted/slack/export
import-history DIRECTORY:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔄 Importing Slack historical data from: {{DIRECTORY}}"
    echo "📋 Make sure you've extracted the Slack export zip file first"
    
    # Source environment variables
    if [ -f .env ]; then
        set -a
        source .env
        set +a
        echo "✅ Loaded environment variables from .env"
    else
        echo "⚠️  No .env file found - using system environment variables"
    fi
    
    # Check if DATABASE_URL is set
    if [ -z "${DATABASE_URL:-}" ]; then
        echo "❌ DATABASE_URL not found in environment"
        echo "💡 Make sure DATABASE_URL is set in your .env file or environment"
        exit 1
    fi
    
    cd db
    uv run python -m tiger_slack.import "{{DIRECTORY}}"
    
    echo "✅ Import completed! Data from {{DIRECTORY}} has been loaded into the database"


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
