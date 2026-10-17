"""Read Letterboxd CSV exports without extracting the ZIP to disk."""
import csv
import io
import math
from collections import Counter
from datetime import date
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from .models import Export, Film

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_EXPANDED_BYTES = 250 * 1024 * 1024


def _year(value: str) -> int:
    try:
        result = int(float(value))
        return result if 0 < result < 10000 else 0
    except (ValueError, TypeError, OverflowError):
        return 0


def _rating(value: str) -> float | None:
    try:
        number = float(value)

        if math.isfinite(number) and 0.5 <= number <= 5:
            return number

        return None

    except (ValueError, TypeError):
        return None


def _key(row: dict) -> tuple[str, int]:
    return (
        (row.get("Name") or "").strip(),
        _year(row.get("Year")),
    )


def read_export(path: str | Path) -> Export:
    """Validate CSV columns and normalize film identity at import time."""
    if Path(path).stat().st_size > MAX_UPLOAD_BYTES:
        raise ValueError("Please upload an export smaller than 100 MB.")

    try:
        with ZipFile(path) as archive:
            infos = archive.infolist()

            if (
                len(infos) > 10000
                or sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES
            ):
                raise ValueError("The expanded export is too large.")

            names = archive.namelist()

            if len(names) != len(set(names)):
                raise ValueError("The ZIP contains duplicate file names.")

            def read_csv(name, required=(), skip=0):
                if name not in names:
                    return []

                with archive.open(name) as raw:
                    stream = io.TextIOWrapper(
                        raw,
                        encoding="utf-8-sig",
                        newline="",
                    )

                    for _ in range(skip):
                        next(stream, None)

                    reader = csv.DictReader(stream)

                    if not set(required).issubset(reader.fieldnames or []):
                        raise ValueError(
                            f"{name} is missing columns: "
                            f"{', '.join(required)}."
                        )

                    return list(reader)

            if "watched.csv" not in names:
                raise ValueError(
                    "The export must contain watched.csv at the ZIP root."
                )

            watched = read_csv("watched.csv", ("Name", "Year"))

            ratings = {
                _key(row): _rating(row.get("Rating"))
                for row in read_csv(
                    "ratings.csv",
                    ("Name", "Year", "Rating"),
                )
            }

            diary_rows = read_csv(
                "diary.csv",
                ("Name", "Year", "Watched Date"),
            )

            counts = Counter(_key(row) for row in diary_rows)

            def film(key):
                return Film(
                    *key,
                    ratings.get(key),
                    max(1, counts[key]),
                )

            keys = list(
                dict.fromkeys(
                    _key(row)
                    for row in watched
                    if _key(row)[0]
                )
            )

            films = [film(key) for key in keys]
            diary = []

            for row in diary_rows:
                try:
                    watched_date = date.fromisoformat(
                        row.get("Watched Date", "")
                    )
                except ValueError:
                    watched_date = None

                if _key(row)[0]:
                    diary.append((film(_key(row)), watched_date))

            profiles = read_csv("profile.csv")
            profile = profiles[0] if profiles else {}

            username = (
                (profile.get("Username") or "User").strip()
                or "User"
            )

            favorites = []

            for index in range(1, 5):
                title = (
                    profile.get(f"Favorite Film {index} Name") or ""
                ).strip()

                if title:
                    favorites.append(
                        film(
                            (
                                title,
                                _year(
                                    profile.get(
                                        f"Favorite Film {index} Year"
                                    )
                                ),
                            )
                        )
                    )

            likes = {
                _key(row)
                for row in read_csv(
                    "likes/movies.csv",
                    ("Name", "Year"),
                )
            }

            top_films = None

            for name in names:
                if not (
                    name.startswith("lists/")
                    and name.endswith(".csv")
                ):
                    continue

                with archive.open(name) as raw:
                    header = []

                    for _ in range(10):
                        line = raw.readline().decode("utf-8-sig")
                        header.append(line)

                        if line.startswith("Position,"):
                            break

                is_topstats = any(
                    "topstats" in line.lower()
                    for line in header
                )

                if is_topstats and header[-1].startswith("Position,"):
                    rows = read_csv(
                        name,
                        ("Name", "Year"),
                        skip=len(header) - 1,
                    )

                    top_films = [
                        film(_key(row))
                        for row in rows[:20]
                        if _key(row)[0]
                    ]

                    if top_films:
                        break

            if not top_films:
                favorite_keys = {
                    favorite.key for favorite in favorites
                }

                ranked = sorted(
                    (
                        item
                        for item in films
                        if item.key not in favorite_keys
                    ),
                    key=lambda item: (
                        counts[item.key],
                        item.key in likes,
                        item.rating or 0,
                    ),
                    reverse=True,
                )

                top_films = (favorites + ranked)[:20]

            return Export(
                films=films,
                top_films=top_films,
                username=username,
                diary=diary,
            )

    except (
        BadZipFile,
        UnicodeDecodeError,
        csv.Error,
        RuntimeError,
    ) as exc:
        raise ValueError(
            "Please select a valid, unencrypted Letterboxd export ZIP."
        ) from exc