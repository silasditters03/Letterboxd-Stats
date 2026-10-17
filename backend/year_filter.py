"""Build watch-year views from an already imported dataset."""
import re
from datetime import date

from .cache import Cache
from .models import Export, Film
from .stats import calculate_stats

PERSON_GROUPS = (
    "top_directors_total",
    "top_directors_unique",
    "top_actors_total",
    "top_actors_unique",
    "top_rated_directors_list",
    "top_rated_actors_list",
)


def _year(value):
    if value is None or value == "all":
        return None

    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("Choose All time or a year from the list.")

    if (
        not re.fullmatch(r"[0-9]{1,4}", str(value))
        or not 1 <= int(value) <= 9999
    ):
        raise ValueError("Choose All time or a year from the list.")

    return int(value)


def _in_year(entry, year):
    value = entry.get("watched_date")

    return bool(
        value
        and value.startswith(f"{year:04d}-")
    )


def filter_dashboard(context, selected_year=None):
    """Recalculate locally without fetching additional movie data."""
    if not context:
        raise ValueError(
            "Import a Letterboxd export before choosing a year."
        )

    year = _year(selected_year)

    original = context["all_time"]
    diaries = context["diaries"]

    available = sorted(
        {
            watched.year
            for _, watched in context["export"].diary
            if watched
        },
        reverse=True,
    )

    undated = sum(
        1
        for film in diaries.values()
        for entry in film["entries"]
        if (
            entry["source"] == "diary"
            and not entry["watched_date"]
        )
    )

    if year is None:
        logged = sum(
            film["diary_count"]
            for film in diaries.values()
        )

        note = (
            "All-time statistics use your current film ratings."
        )

        if not available:
            note += (
                " No dated diary entries are available "
                "for year filtering."
            )

        return {
            **original,
            "available_years": available,
            "selected_year": None,
            "logged_watches": logged,
            "filter_note": note,
        }

    if year not in available:
        raise ValueError(
            "No diary entries were exported for that watch year."
        )

    films = []
    diary = []
    scoped_diaries = {}

    for key, data in diaries.items():
        entries = [
            entry
            for entry in data["entries"]
            if _in_year(entry, year)
        ]

        watches = [
            entry
            for entry in entries
            if entry["source"] == "diary"
        ]

        if not watches:
            continue

        # Entries are already ordered newest first by film_diary.py.
        # Do not substitute the current ratings.csv value.
        latest = watches[0]

        film = Film(
            data["title"],
            data["year"],
            latest["rating"],
            len(watches),
        )

        films.append(film)

        for entry in watches:
            diary.append(
                (
                    Film(
                        film.title,
                        film.year,
                        entry["rating"],
                    ),
                    date.fromisoformat(
                        entry["watched_date"]
                    ),
                )
            )

        scoped_diaries[key] = {
            **data,
            "entries": [
                dict(entry) for entry in entries
            ],
            "diary_count": len(watches),
            "review_count": sum(
                bool(entry["review"])
                for entry in entries
            ),
            "view_year": year,
        }

    top = sorted(
        films,
        key=lambda film: (
            -(film.rating or 0),
            -film.play_count,
            film.title.casefold(),
            film.year,
        ),
    )[:20]

    view = Export(
        films,
        top,
        context["export"].username,
        diary,
    )

    stats = calculate_stats(
        view,
        context["metadata"],
    )

    stats["film_diaries"] = scoped_diaries
    stats["avatar_url"] = original.get("avatar_url")
    stats["available_years"] = available
    stats["selected_year"] = year
    stats["logged_watches"] = len(diary)

    stats["filter_note"] = (
        f"{len(films)} unique films · "
        f"{len(diary)} logged watches in {year}. "
        "Ratings use each film’s most recent exported "
        "diary entry in this year."
    )

    if undated:
        stats["filter_note"] += (
            f" {undated} undated diary entries are excluded."
        )

    missing = sum(
        not context["metadata"].get(film.key)
        for film in films
    )

    stats["warnings"] = []

    if missing:
        stats["warnings"].append(
            f"Metadata unavailable for {missing} film(s) "
            "in this year."
        )

    # Reuse local biographies; changing years never makes API requests.
    with Cache() as cache:
        details = {}

        for group in PERSON_GROUPS:
            for person in stats[group]:
                name = person["name"]

                if name not in details:
                    details[name] = (
                        cache.get(f"person_details_{name}")
                        or {}
                    )

                person.update(
                    {
                        "image_url": details[name].get(
                            "image_url"
                        ),
                        "biography": details[name].get(
                            "biography",
                            "",
                        ),
                    }
                )

    return stats