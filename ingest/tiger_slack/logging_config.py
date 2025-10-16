import logging
import os
from logging.config import dictConfig

import logfire

from tiger_slack import __version__


def setup_logging() -> None:
    """Configure Python standard library logging to use logfire as handler."""
    # Only configure logfire if token is available
    logfire.configure(
        console=logfire.ConsoleOptions(verbose=True),
        send_to_logfire='if-token-present',
        service_name=os.getenv("SERVICE_NAME", "tiger-slack-ingest"),
        service_version=__version__,
    )

    # Set up all the logfire instrumentation
    logfire.instrument_psycopg()
    logfire.instrument_system_metrics(
        {
            "process.cpu.time": ["user", "system"],
            "process.cpu.utilization": None,
            "process.cpu.core_utilization": None,
            "process.memory.usage": None,
            "process.memory.virtual": None,
            "process.thread.count": None,
        }
    )

    # Configure standard library logging with logfire handler
    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "handlers": {
                "logfire": {
                    "class": "logfire.LogfireLoggingHandler",
                },
            },
            "root": {
                "handlers": ["logfire"],
                "level": "INFO",
            },
            "loggers": {
                # Suppress noisy third-party loggers if needed
                "urllib3": {"level": "WARNING"},
                "websockets": {"level": "WARNING"},
            },
        }
    )


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance for the given name."""
    return logging.getLogger(name)
