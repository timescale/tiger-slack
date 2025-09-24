#!/bin/bash


set -e

echo "Creating Sealed Secrets for tiger-slack ingest & mcp"
echo "==========================================="

# Check if kubeseal is installed
if ! command -v kubeseal &> /dev/null; then
    echo "Error: kubeseal CLI not found. Please install it first:"
    echo "   https://github.com/bitnami-labs/sealed-secrets/releases"
    exit 1
fi

# Check if kubectl is configured
if ! kubectl version --client &> /dev/null; then
    echo "Error: kubectl not found or not configured"
    exit 1
fi

# Check if .env file exists
if [[ ! -f ".env.prod" ]]; then
    echo "Error: .env.prod file not found in current directory"
    echo "   Please create a .env.prod file with necessary variables"
    exit 1
fi

echo "Loading credentials from ..env.prod file..."

# Load environment variables from .env file
set -a  # automatically export all variables
# shellcheck source=.env
source .env.prod
set +a  # stop automatically exporting

# Validate that required variables are set
REQUIRED_VARS=("SLACK_BOT_TOKEN" "SLACK_APP_TOKEN" "LOGFIRE_TOKEN" "PGHOST" "PGUSER" "PGPASSWORD" "SLACK_DOMAIN")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var}" ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    echo "❌ Missing required environment variables in .env file:"
    printf '   %s\n' "${MISSING_VARS[@]}"
    echo ""
    echo "   Please add them to your .env file:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   $var=your_value_here"
    done
    exit 1
fi

# Initialize variables
INGEST_DATABASE_SECRET_OUTPUT=""
MCP_DATABASE_SECRET_OUTPUT=""
INGEST_SLACK_SECRET_OUTPUT=""
INGEST_LOGFIRE_SECRET_OUTPUT=""
MCP_LOGFIRE_SECRET_OUTPUT=""
MCP_TAILSCALE_SECRET_OUTPUT=""

# Ask about database secrets
echo ""
read -p "Do you want to update the database secrets? (y/N): " update_database
if [[ "$update_database" =~ ^[Yy]$ ]]; then
    echo "🔐 Creating database sealed secrets..."

    # Create ingest database secret
    INGEST_DATABASE_SECRET_OUTPUT=$(kubectl -n savannah-system create secret generic tiger-slack-ingest-database-secrets \
      --from-literal=pgDatabase="$PGDATABASE" \
      --from-literal=pgHost="$PGHOST" \
      --from-literal=pgPassword="$PGPASSWORD" \
      --from-literal=pgUser="$PGUSER" \
      --from-literal=pgPort="$PGPORT" \
      --dry-run=client -o yaml | kubeseal -o yaml 2>/dev/null)

    # Create MCP database secret
    MCP_DATABASE_SECRET_OUTPUT=$(kubectl -n savannah-system create secret generic tiger-slack-mcp-database-secrets \
      --from-literal=pgDatabase="$PGDATABASE" \
      --from-literal=pgHost="$PGHOST" \
      --from-literal=pgPassword="$PGPASSWORD" \
      --from-literal=pgUser="$PGUSER" \
      --from-literal=pgPort="$PGPORT" \
      --dry-run=client -o yaml | kubeseal -o yaml 2>/dev/null)

    if [[ -z "$INGEST_DATABASE_SECRET_OUTPUT" || -z "$MCP_DATABASE_SECRET_OUTPUT" ]]; then
        echo "❌ Failed to create database sealed secrets"
        exit 1
    fi
    echo "✅ Database secrets created successfully"
else
    echo "⏭️  Skipping database secrets"
fi

# Ask about Slack secrets
echo ""
read -p "Do you want to update the Slack secrets? (y/N): " update_slack
if [[ "$update_slack" =~ ^[Yy]$ ]]; then
    echo "🔐 Creating Slack sealed secrets..."
    # Only ingest needs Slack secrets
    INGEST_SLACK_SECRET_OUTPUT=$(kubectl -n savannah-system create secret generic tiger-slack-ingest-slack-secrets \
      --from-literal=slackAppToken="$SLACK_APP_TOKEN" \
      --from-literal=slackBotToken="$SLACK_BOT_TOKEN" \
      --dry-run=client -o yaml | kubeseal -o yaml 2>/dev/null)

    if [[ -z "$INGEST_SLACK_SECRET_OUTPUT" ]]; then
        echo "❌ Failed to create Slack sealed secrets"
        exit 1
    fi
    echo "✅ Slack secrets created successfully"
else
    echo "⏭️  Skipping Slack secrets"
fi

# Ask about Logfire secrets
echo ""
read -p "Do you want to update the Logfire secrets? (y/N): " update_logfire
if [[ "$update_logfire" =~ ^[Yy]$ ]]; then
    echo "🔐 Creating Logfire sealed secrets..."

    # Create ingest logfire secret
    INGEST_LOGFIRE_SECRET_OUTPUT=$(kubectl -n savannah-system create secret generic tiger-slack-ingest-logfire-secrets \
      --from-literal=logfireToken="$LOGFIRE_TOKEN" \
      --dry-run=client -o yaml | kubeseal -o yaml 2>/dev/null)

    # Create MCP logfire secret
    MCP_LOGFIRE_SECRET_OUTPUT=$(kubectl -n savannah-system create secret generic tiger-slack-mcp-logfire-secrets \
      --from-literal=logfireToken="$LOGFIRE_TOKEN" \
      --dry-run=client -o yaml | kubeseal -o yaml 2>/dev/null)

    if [[ -z "$INGEST_LOGFIRE_SECRET_OUTPUT" || -z "$MCP_LOGFIRE_SECRET_OUTPUT" ]]; then
        echo "❌ Failed to create Logfire sealed secrets"
        exit 1
    fi
    echo "✅ Logfire secrets created successfully"
else
    echo "⏭️  Skipping Logfire secrets"
fi

# Ask about Tailscale secrets (if TAILSCALE_AUTHKEY is set)
if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
    echo ""
    read -p "Do you want to update the Tailscale secrets? (y/N): " update_tailscale
    if [[ "$update_tailscale" =~ ^[Yy]$ ]]; then
        echo "🔐 Creating Tailscale sealed secrets..."
        # Only MCP needs Tailscale secrets currently
        MCP_TAILSCALE_SECRET_OUTPUT=$(kubectl -n savannah-system create secret generic tiger-slack-mcp-tailscale-secrets \
          --from-literal=authkey="$TAILSCALE_AUTHKEY" \
          --dry-run=client -o yaml | kubeseal -o yaml 2>/dev/null)

        if [[ -z "$MCP_TAILSCALE_SECRET_OUTPUT" ]]; then
            echo "❌ Failed to create Tailscale sealed secrets"
            exit 1
        fi
        echo "✅ Tailscale secrets created successfully"
    else
        echo "⏭️  Skipping Tailscale secrets"
    fi
fi

# Check if at least one secret was created
if [[ -z "$INGEST_DATABASE_SECRET_OUTPUT" && -z "$MCP_DATABASE_SECRET_OUTPUT" && -z "$INGEST_SLACK_SECRET_OUTPUT" && -z "$INGEST_LOGFIRE_SECRET_OUTPUT" && -z "$MCP_LOGFIRE_SECRET_OUTPUT" && -z "$MCP_TAILSCALE_SECRET_OUTPUT" ]]; then
    echo "❌ No secrets were created. Exiting."
    exit 1
fi

echo ""
echo "📝 Extracting encrypted values..."

# Initialize all variables to preserve existing values
PG_DATABASE_ENC=""
PG_HOST_ENC=""
PG_PASSWORD_ENC=""
PG_USER_ENC=""
PG_PORT_ENC=""
SLACK_APP_TOKEN_ENC=""
SLACK_BOT_TOKEN_ENC=""
LOGFIRE_TOKEN_ENC=""
TAILSCALE_AUTHKEY_ENC=""

# Load existing values from dev.yaml if it exists
DEV_YAML="chart/values/dev.yaml"
if [[ -f "$DEV_YAML" ]]; then
    echo "📖 Loading existing values from $DEV_YAML..."
    PG_DATABASE_ENC=$(grep "^  name:" "$DEV_YAML" | sed 's/.*name: *//')
    PG_HOST_ENC=$(grep "^  host:" "$DEV_YAML" | sed 's/.*host: *//')
    PG_PASSWORD_ENC=$(grep "^  password:" "$DEV_YAML" | sed 's/.*password: *//')
    PG_USER_ENC=$(grep "^  user:" "$DEV_YAML" | sed 's/.*user: *//')
    PG_PORT_ENC=$(grep "^  port:" "$DEV_YAML" | sed 's/.*port: *//')
    SLACK_APP_TOKEN_ENC=$(grep "^  appToken:" "$DEV_YAML" | sed 's/.*appToken: *//')
    SLACK_BOT_TOKEN_ENC=$(grep "^  botToken:" "$DEV_YAML" | sed 's/.*botToken: *//')
    LOGFIRE_TOKEN_ENC=$(grep "^  token:" "$DEV_YAML" | sed 's/.*token: *//')
    TAILSCALE_AUTHKEY_ENC=$(grep "^  authkey:" "$DEV_YAML" | sed 's/.*authkey: *//')
fi

# Extract database values (if updated)
if [[ -n "$INGEST_DATABASE_SECRET_OUTPUT" ]]; then
    INGEST_DB_TEMP_FILE=$(mktemp)
    echo "$INGEST_DATABASE_SECRET_OUTPUT" > "$INGEST_DB_TEMP_FILE"
    PG_DATABASE_ENC=$(grep "pgDatabase:" "$INGEST_DB_TEMP_FILE" | sed 's/.*pgDatabase: *//' | tr -d '"')
    PG_HOST_ENC=$(grep "pgHost:" "$INGEST_DB_TEMP_FILE" | sed 's/.*pgHost: *//' | tr -d '"')
    PG_PASSWORD_ENC=$(grep "pgPassword:" "$INGEST_DB_TEMP_FILE" | sed 's/.*pgPassword: *//' | tr -d '"')
    PG_USER_ENC=$(grep "pgUser:" "$INGEST_DB_TEMP_FILE" | sed 's/.*pgUser: *//' | tr -d '"')
    PG_PORT_ENC=$(grep "pgPort:" "$INGEST_DB_TEMP_FILE" | sed 's/.*pgPort: *//' | tr -d '"')
    rm "$INGEST_DB_TEMP_FILE"
fi

# Extract Slack values (if updated)
if [[ -n "$INGEST_SLACK_SECRET_OUTPUT" ]]; then
    INGEST_SLACK_TEMP_FILE=$(mktemp)
    echo "$INGEST_SLACK_SECRET_OUTPUT" > "$INGEST_SLACK_TEMP_FILE"
    SLACK_APP_TOKEN_ENC=$(grep "slackAppToken:" "$INGEST_SLACK_TEMP_FILE" | sed 's/.*slackAppToken: *//' | tr -d '"')
    SLACK_BOT_TOKEN_ENC=$(grep "slackBotToken:" "$INGEST_SLACK_TEMP_FILE" | sed 's/.*slackBotToken: *//' | tr -d '"')
    rm "$INGEST_SLACK_TEMP_FILE"
fi

# Extract Logfire values (if updated)
if [[ -n "$INGEST_LOGFIRE_SECRET_OUTPUT" ]]; then
    INGEST_LOGFIRE_TEMP_FILE=$(mktemp)
    echo "$INGEST_LOGFIRE_SECRET_OUTPUT" > "$INGEST_LOGFIRE_TEMP_FILE"
    LOGFIRE_TOKEN_ENC=$(grep "logfireToken:" "$INGEST_LOGFIRE_TEMP_FILE" | sed 's/.*logfireToken: *//' | tr -d '"')
    rm "$INGEST_LOGFIRE_TEMP_FILE"
fi

# Extract Tailscale values (if updated)
if [[ -n "$MCP_TAILSCALE_SECRET_OUTPUT" ]]; then
    MCP_TAILSCALE_TEMP_FILE=$(mktemp)
    echo "$MCP_TAILSCALE_SECRET_OUTPUT" > "$MCP_TAILSCALE_TEMP_FILE"
    TAILSCALE_AUTHKEY_ENC=$(grep "authkey:" "$MCP_TAILSCALE_TEMP_FILE" | sed 's/.*authkey: *//' | tr -d '"')
    rm "$MCP_TAILSCALE_TEMP_FILE"
fi


echo "✅ Successfully processed encrypted values"
if [[ -n "$INGEST_DATABASE_SECRET_OUTPUT" || -n "$MCP_DATABASE_SECRET_OUTPUT" ]]; then
    echo "   📊 Database values updated:"
    echo "     - pgDatabase: ${PG_DATABASE_ENC:0:20}..."
    echo "     - pgHost: ${PG_HOST_ENC:0:20}..."
    echo "     - pgPassword: ${PG_PASSWORD_ENC:0:20}..."
    echo "     - pgUser: ${PG_USER_ENC:0:20}..."
    echo "     - pgPort: ${PG_PORT_ENC:0:20}..."
fi
if [[ -n "$INGEST_SLACK_SECRET_OUTPUT" ]]; then
    echo "   💬 Slack values updated:"
    echo "     - slackAppToken: ${SLACK_APP_TOKEN_ENC:0:20}..."
    echo "     - slackBotToken: ${SLACK_BOT_TOKEN_ENC:0:20}..."
fi
if [[ -n "$INGEST_LOGFIRE_SECRET_OUTPUT" || -n "$MCP_LOGFIRE_SECRET_OUTPUT" ]]; then
    echo "   🔥 Logfire values updated:"
    echo "     - logfireToken: ${LOGFIRE_TOKEN_ENC:0:20}..."
fi
if [[ -n "$MCP_TAILSCALE_SECRET_OUTPUT" ]]; then
    echo "   🔗 Tailscale values updated:"
    echo "     - authkey: ${TAILSCALE_AUTHKEY_ENC:0:20}..."
fi

# Update dev.yaml files with encrypted values
INGEST_DEV_YAML="charts/tiger-slack-ingest/values/dev.yaml"
MCP_DEV_YAML="charts/tiger-slack-mcp/values/dev.yaml"

echo ""
echo "📝 Updating dev.yaml files with encrypted values..."

# Create ingest dev.yaml
echo "   📊 Creating $INGEST_DEV_YAML..."
mkdir -p "$(dirname "$INGEST_DEV_YAML")"
cat > "$INGEST_DEV_YAML" << EOF
database:
  host: $PG_HOST_ENC
  port: $PG_PORT_ENC
  name: $PG_DATABASE_ENC
  user: $PG_USER_ENC
  password: $PG_PASSWORD_ENC
slack:
  appToken: $SLACK_APP_TOKEN_ENC
  botToken: $SLACK_BOT_TOKEN_ENC
logfire:
  token: $LOGFIRE_TOKEN_ENC
EOF

# Create mcp dev.yaml
echo "   🔗 Creating $MCP_DEV_YAML..."
mkdir -p "$(dirname "$MCP_DEV_YAML")"
cat > "$MCP_DEV_YAML" << EOF
database:
  host: $PG_HOST_ENC
  port: $PG_PORT_ENC
  name: $PG_DATABASE_ENC
  user: $PG_USER_ENC
  password: $PG_PASSWORD_ENC
logfire:
  token: $LOGFIRE_TOKEN_ENC
tailscale:
  authkey: $TAILSCALE_AUTHKEY_ENC
EOF

echo "✅ Successfully updated dev.yaml files for both charts"
echo ""
echo "🎯 Next steps:"
echo "   1. Review the updated dev.yaml files"
echo "   2. Commit the changes to your repository"
echo "   3. Deploy using:"
echo "      helm upgrade --install tiger-slack-ingest charts/tiger-slack-ingest/ -f charts/tiger-slack-ingest/values/dev.yaml"
echo "      helm upgrade --install tiger-slack-mcp charts/tiger-slack-mcp/ -f charts/tiger-slack-mcp/values/dev.yaml"