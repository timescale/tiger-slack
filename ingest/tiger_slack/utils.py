import os


def get_connection_info() -> str:
    host = os.getenv("PGHOST")
    port = os.getenv("PGPORT", 5432)
    user = os.getenv("PGUSER", "postgres")
    password = os.getenv("PASSWORD", "password")
    database = os.getenv("PGDATABASE")

    if host is None and database is None:
        raise Exception("PGHOST AND PGDATABASE environment variables need to be set!")

    return f"host={host} port={port} dbname={database} user={user} password={password}"
