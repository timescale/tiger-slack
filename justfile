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