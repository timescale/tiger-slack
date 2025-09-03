# Tiger Slack

A Slack integration project with TimescaleDB backend.

## Development

This project uses [just](https://github.com/casey/just) for command management and Docker Compose for local development.

### Available Commands

**Docker Compose lifecycle:**
- `just up` - Start all services in detached mode
- `just down` - Stop and remove all containers
- `just build` - Build/rebuild all containers
- `just logs` - Follow logs from all services
- `just restart` - Restart all services
- `just psql` - Connect to the TimescaleDB database with psql
- `just reset` - Full reset: stop containers, remove volumes, and restart fresh

