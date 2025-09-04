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

# MCP Configuration for Claude Code
configure-logfire-mcp:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Configuring Logfire MCP for Claude Code..."
    
    # Source environment variables
    if [ -f .env ]; then
        set -a
        source .env
        set +a
    fi
    
    # Ensure .claude directory exists
    mkdir -p .claude
    
    # Create Claude Code MCP configuration for Logfire
    cat > .claude/logfire_mcp_config.json << EOF
    {
      "mcpServers": {
        "logfire": {
          "command": "python",
          "args": ["-m", "logfire", "mcp"],
          "env": {
            "LOGFIRE_TOKEN": "${LOGFIRE_TOKEN}"
          }
        }
      }
    }
    EOF
    
    echo "✅ Logfire MCP configured in .claude/mcp_config.json"
    echo "💡 Use: claude mcp connect .claude/mcp_config.json"

configure-tiger-slack-mcp:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Configuring Tiger Slack MCP server for Claude Code..."
    
    # Source environment variables
    if [ -f .env ]; then
        set -a
        source .env
        set +a
    fi
    
    # Ensure .claude directory exists  
    mkdir -p .claude
    
    # Get absolute path to project
    PROJECT_PATH=$(pwd)
    
    # Set defaults for optional vars
    LOGFIRE_TRACES_ENDPOINT=${LOGFIRE_TRACES_ENDPOINT:-https://logfire-api.pydantic.dev/v1/traces}
    LOGFIRE_LOGS_ENDPOINT=${LOGFIRE_LOGS_ENDPOINT:-https://logfire-api.pydantic.dev/v1/logs}
    
    # Create Claude Code MCP configuration for Tiger Slack server
    cat > .claude/tiger_slack_mcp_config.json << EOF
    {
      "mcpServers": {
        "tiger-slack": {
          "command": "node", 
          "args": ["${PROJECT_PATH}/mcp/dist/index.js", "stdio"],
          "env": {
            "PGHOST": "localhost",
            "PGDATABASE": "tiger_slack", 
            "PGPORT": "5432",
            "PGUSER": "postgres",
            "PGPASSWORD": "",
            "SLACK_DOMAIN": "${SLACK_DOMAIN}",
            "LOGFIRE_TOKEN": "${LOGFIRE_TOKEN}",
            "LOGFIRE_TRACES_ENDPOINT": "${LOGFIRE_TRACES_ENDPOINT}",
            "LOGFIRE_LOGS_ENDPOINT": "${LOGFIRE_LOGS_ENDPOINT}"
          }
        }
      }
    }
    EOF
    
    echo "✅ Tiger Slack MCP configured in .claude/tiger_slack_mcp_config.json"
    echo "💡 Use: claude mcp connect .claude/tiger_slack_mcp_config.json"
    echo "📋 Make sure Docker services are running: just up"

# Connect to MCP servers in Claude Code
connect-logfire-mcp:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f .claude/logfire_mcp_config.json ]; then
        echo "❌ Logfire MCP config not found. Run: just configure-logfire-mcp"
        exit 1
    fi
    echo "🔌 Adding Logfire MCP server to Claude Code..."
    claude mcp add-json -s project logfire "$(cat .claude/logfire_mcp_config.json | jq -c '.mcpServers.logfire')"
    echo "✅ Added Logfire MCP server!"

connect-tiger-slack-mcp:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f .claude/tiger_slack_mcp_config.json ]; then
        echo "❌ Tiger Slack MCP config not found. Run: just configure-tiger-slack-mcp"
        exit 1
    fi
    echo "🔌 Adding Tiger Slack MCP server to Claude Code..."
    claude mcp add-json -s project tiger-slack "$(cat .claude/tiger_slack_mcp_config.json | jq -c '.mcpServers."tiger-slack"')"
    echo "✅ Added Tiger Slack MCP server!"
    echo "📊 Traces will appear in Logfire dashboard"