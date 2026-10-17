"""Own SQLite connections and keep generated state outside source files."""
import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Cache:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(
            path
            or os.getenv(
                "LETTERBOXD_DATA_DIR",
                str(ROOT / "data"),
            )
        )

        if path is None:
            self.path /= "tmdb_cache.db"

        self.path.parent.mkdir(parents=True, exist_ok=True)

        bundled_cache = ROOT / "tmdb_cache.db"

        if (
            not self.path.exists()
            and path is None
            and bundled_cache.exists()
        ):
            # Copy the existing cache without modifying the original.
            source_uri = f"{bundled_cache.as_uri()}?mode=ro"

            with sqlite3.connect(source_uri, uri=True) as source:
                with sqlite3.connect(self.path) as destination:
                    source.backup(destination)

        self.connection = sqlite3.connect(self.path)

        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS cache "
            "(key TEXT PRIMARY KEY, data TEXT)"
        )
        self.connection.commit()

    def get(self, key):
        row = self.connection.execute(
            "SELECT data FROM cache WHERE key = ?",
            (key,),
        ).fetchone()

        if row:
            try:
                return json.loads(row[0])
            except json.JSONDecodeError:
                return None

        return None

    def set(self, key, value):
        self.connection.execute(
            "INSERT OR REPLACE INTO cache VALUES (?, ?)",
            (
                key,
                json.dumps(value, allow_nan=False),
            ),
        )

    def flush(self):
        self.connection.commit()

    def close(self):
        self.flush()
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()