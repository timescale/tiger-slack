FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1

# Install system dependencies including PostgreSQL client libraries
RUN apt-get update && apt-get install -y \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Set working directory
WORKDIR /app

# Copy uv configuration files and application code (needed for hatchling)
COPY ./ingest/pyproject.toml ./ingest/uv.lock ./ingest/README.md ./
COPY ./ingest/tiger_slack/ ./tiger_slack/

# Install dependencies (now that tiger_slack/__init__.py is available for version detection)
RUN uv sync --frozen

CMD ["uv", "run", "python", "-m", "tiger_slack.main"]