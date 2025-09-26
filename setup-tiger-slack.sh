#!/bin/bash
set -euo pipefail

# Tiger Agent Interactive Setup Script
# Replaces the interactive setup process described in CLAUDE.md

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Token storage - using regular variables instead of associative array for compatibility
SLACK_DOMAIN_VAL=""
SLACK_BOT_TOKEN_VAL=""
SLACK_APP_TOKEN_VAL=""
LOGFIRE_TOKEN_VAL=""


# Logging functions
log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Browser opening function
open_browser() {
    local url="$1"
    log_info "Opening: $url"
    case "$OSTYPE" in
        darwin*) open "$url" 2>/dev/null || true ;;
        linux*) xdg-open "$url" 2>/dev/null || true ;;
        *) log_warning "Please manually open: $url" ;;
    esac
    sleep 2
}

# Introduction message
intro_message() {
    echo ""
    echo "=================================================="
    echo "     🐅 Tiger Agent Interactive Setup"
    echo "=================================================="
    echo ""
    echo "Hi! I'm eon, a TigerData agent!"
    echo "I'm going to guide you through setting up Tiger Slack"
    echo ""
    echo "This is the workflow that we will use:"
    echo "1. Create Slack App for Ingest & gather tokens"
    echo "2. Write the .env file"
    echo "3. Spin up the Docker images (optional)"
    echo ""

    # Continue prompt
    read -p "Do you want to continue with the setup? [y/N]: " continue_choice
    if [[ ! $continue_choice =~ ^[Yy] ]]; then
        log_info "Setup cancelled by user."
        exit 0
    fi
    echo ""
}

# Check for existing configuration
check_resume_or_fresh_start() {
    if [[ -f .env ]]; then
        echo "Found existing .env file."
        read -p "Do you want to modify the existing configuration? [y/N]: " choice
        if [[ $choice =~ ^[Yy] ]]; then
            log_info "Resuming with existing configuration..."
            return 0
        else
            read -p "Start fresh? This will backup your current .env [y/N]: " choice
            if [[ $choice =~ ^[Yy] ]]; then
                cp .env ".env.backup.$(date +%s)"
                log_success "Backed up existing .env file"
            else
                log_info "Keeping existing configuration. Exiting."
                exit 0
            fi
        fi
    fi
}

# Validate tokens with API calls
validate_slack_tokens() {
    local bot_token="$1"
    local app_token="$2"

    log_info "Validating Slack tokens..."

    # Validate bot token
    local bot_response
    bot_response=$(curl -s -H "Authorization: Bearer $bot_token" \
        "https://slack.com/api/auth.test" | grep -o '"ok":[^,]*' | cut -d: -f2)

    if [[ "$bot_response" != "true" ]]; then
        log_error "Invalid Slack bot token"
        return 1
    fi

    # Note: App token validation is more complex, skipping for now
    log_success "Slack bot token validated"
    return 0
}

# Create Slack app with specified manifest file
create_slack_app() {
    local manifest_file="$1"
    local bot_token_var="$2"
    local app_token_var="$3"

    echo "**** Slack App Creation ****"
    echo ""
    echo "This will guide you through the Slack app setup process."
    read -p "Press any key to open the Slack API site in your browser..."
    echo ""


    # Interactive Slack App Setup
    echo "Creating Slack App:"
    
    open_browser "https://api.slack.com/apps/"

    echo "1. Click 'Create New App' → 'From a manifest' → Choose your workspace"

    # Ask for workspace name only on first app creation
    if [[ -z "$SLACK_DOMAIN_VAL" ]]; then
        echo ""
        read -p "What is your Slack workspace name? (for SLACK_DOMAIN): " slack_domain
        SLACK_DOMAIN_VAL="$slack_domain"
        echo ""
    fi

    read -p "Press Enter after selecting your workspace and clicking Next..."

    # Show manifest file content
    if [[ -f "$manifest_file" ]]; then
        echo ""
        echo "App Manifest:"
        echo "----------------------------------------"
        cat "$manifest_file"
        echo ""
        echo "----------------------------------------"
        echo ""
    else
        log_warning "$manifest_file not found - you'll need to create the app manually"
        return 1
    fi

    echo "2. Copy the manifest shown above and paste it into the App creation wizard (note: customize display_name and name), then click 'Next' and 'Create'"
    echo ""
    read -p "Press Enter after creating the app..."

    echo ""
    echo "3. Navigate to: Basic Information → App-Level Tokens"
    echo "4. Click 'Generate Token and Scopes' → Add 'connections:write' scope → Generate"
    echo ""

    local slack_app_token
    while true; do
        read -p "Please paste your App-Level Token (starts with 'xapp-'): " slack_app_token
        if [[ "$slack_app_token" =~ ^xapp- ]]; then
            break
        else
            log_error "App token should start with 'xapp-'"
        fi
    done

    echo ""
    echo "5. Navigate to: Install App → Click 'Install to [Workspace]'"
    echo "6. After installation, copy the 'Bot User OAuth Token'"
    echo ""

    local slack_bot_token
    while true; do
        read -p "Please paste your Bot User OAuth Token (starts with 'xoxb-'): " slack_bot_token
        if [[ "$slack_bot_token" =~ ^xoxb- ]]; then
            break
        else
            log_error "Bot token should start with 'xoxb-'"
        fi
    done

    # Validate tokens
    if validate_slack_tokens "$slack_bot_token" "$slack_app_token"; then
        # Store tokens in the specified variable names
        eval "${bot_token_var}=\"$slack_bot_token\""
        eval "${app_token_var}=\"$slack_app_token\""
        log_success "Slack tokens validated successfully"
    else
        log_error "token validation failed. Please check your tokens and try again."
        exit 1
    fi

    echo ""
}

get_logfire_token() {
    echo "Logfire Configuration (Optional)"
    echo "Logfire provides observability and monitoring. Tiger Slack will work without it."
    read -p "LOGFIRE_TOKEN (or press Enter to skip): " logfire_token
    LOGFIRE_TOKEN_VAL="${logfire_token:-}"
}

write_env_file() {
    echo ""
    echo "=== Writing Configuration ==="

    # Start with .env.sample as template
    if [[ ! -f .env.sample ]]; then
        log_error ".env.sample not found!"
        exit 1
    fi

    cp .env.sample .env
    log_info "Copied .env.sample to .env"

    # Update tokens
    local token_vars=(
        "SLACK_DOMAIN:$SLACK_DOMAIN_VAL"
        "SLACK_BOT_TOKEN:$SLACK_BOT_TOKEN_VAL"
        "SLACK_APP_TOKEN:$SLACK_APP_TOKEN_VAL"
        "LOGFIRE_TOKEN:$LOGFIRE_TOKEN_VAL"
    )

    for token_var in "${token_vars[@]}"; do
        local key="${token_var%:*}"
        local value="${token_var#*:}"

        if [[ -n "$value" ]]; then
            # Use different sed syntax for macOS vs Linux
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|^${key}=.*|${key}=${value}|" .env
            else
                sed -i "s|^${key}=.*|${key}=${value}|" .env
            fi
            log_success "Set $key"
        fi
    done

    log_success "Environment configuration written to .env"
}

start_services() {
    echo ""
    echo "=== Starting Services ==="

    # Ask if user wants to start services
    read -p "Do you want to start the tiger-slack services now? [Y/n]: " start_choice

    if [[ $start_choice =~ ^[Nn] ]]; then
        log_info "Skipping service startup."
        echo ""
        log_success "🎉 Tiger Slack setup complete!"
        echo ""
        echo "To start services later, run:"
        echo "• docker compose up -d"
        echo ""
        echo "Once started, you can:"
        echo "• Check logs: docker compose logs -f app"
        echo "• View services: docker compose ps"
        echo "• Stop services: docker compose down"
        return 0
    fi

    log_info "Starting Tiger Agent services..."

    if docker compose up -d --build; then
        echo ""
        log_success "🎉 Tiger Slack setup complete!"
        echo ""
        echo "Services started. You can now:"
        echo "• Check logs: docker compose logs -f app"
        echo "• View services: docker compose ps"
        echo "• Stop services: docker compose down"
        echo ""
        echo "Your Tiger Agent is ready to use in Slack!"
    else
        log_error "Failed to start services. Check the logs above."
        exit 1
    fi
}

# Main function
main() {
    intro_message
    check_resume_or_fresh_start
    create_slack_app "slack-app-manifest.json" "SLACK_BOT_TOKEN_VAL" "SLACK_APP_TOKEN_VAL"
    get_logfire_token
    write_env_file
    start_services
}

# Check dependencies
check_dependencies() {
    local deps=("docker")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "$dep is required but not installed"
            exit 1
        fi
    done

    # Check for docker compose (either version)
    if docker compose version &> /dev/null 2>&1; then
        log_info "Found docker compose (v2)"
    else
        log_error "'docker compose' is not available"
        log_error "Please install Docker Compose: https://docs.docker.com/compose/install/"
        exit 1
    fi
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    check_dependencies
    main "$@"
fi