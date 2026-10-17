"""Build film diary pages from the uploaded Letterboxd export."""
import csv
import io
import json
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile

from .imports import (
    MAX_EXPANDED_BYTES,
    MAX_UPLOAD_BYTES,
    _key,
    _rating,
)


def film_key(title, year):
    """Match JavaScript JSON.stringify([title, year])."""
    return json.dumps(
        [title, year],
        ensure_ascii=False,
        separators=(",", ":"),
    )


class _ReviewText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

        elif not self.hidden:
            if tag in ("br", "p", "div", "blockquote"):
                self.parts.append("\n")
            elif tag == "li":
                self.parts.append("\n• ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

        elif not self.hidden and tag in (
            "p",
            "div",
            "blockquote",
            "li",
        ):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def review_text(value):
    parser = _ReviewText()
    parser.feed(value or "")
    parser.close()

    text = "".join(parser.parts).replace("\r\n", "\n")

    return re.sub(
        r"\n{3,}",
        "\n\n",
        text,
    ).strip()


def _date(value):
    try:
        return date.fromisoformat(
            (value or "").strip()
        ).isoformat()

    except ValueError:
        return None


def _flag(value):
    if value is None or not str(value).strip():
        return None

    return str(value).strip().lower() in (
        "yes",
        "true",
        "1",
        "y",
    )


def _entry(row, source, index):
    return {
        "id": f"{source}:{index}",
        "source": source,
        "watched_date": _date(row.get("Watched Date")),
        "logged_date": _date(row.get("Date")),

        # Historical entry rating, not the current ratings.csv value.
        "rating": _rating(row.get("Rating")),

        "rewatch": _flag(row.get("Rewatch")),
        "review": review_text(row.get("Review")),
        "spoilers": bool(
            _flag(
                row.get("Contains Spoilers")
                or row.get("Spoilers")
            )
        ),
        "url": (
            row.get("Letterboxd URI") or ""
        ).strip(),
    }


def _match_review(entries, review):
    diary = [
        entry
        for entry in entries
        if entry["source"] == "diary"
    ]

    candidates = [
        entry
        for entry in diary
        if (
            not entry["review"]
            or entry["review"] == review["review"]
        )
    ]

    if review["watched_date"]:
        candidates = [
            entry
            for entry in candidates
            if entry["watched_date"] == review["watched_date"]
        ]

    if not candidates:
        return None

    # A unique entry URL can match even if the review was edited later.
    if review["url"]:
        exact = [
            entry
            for entry in diary
            if entry["url"] == review["url"]
        ]

        if len(exact) == 1 and exact[0] in candidates:
            return exact[0]

    if not review["watched_date"]:
        if review["logged_date"]:
            candidates = [
                entry
                for entry in candidates
                if entry["logged_date"] == review["logged_date"]
            ]

        elif len(diary) != 1:
            return None

    elif len(candidates) > 1 and review["logged_date"]:
        same_log = [
            entry
            for entry in candidates
            if entry["logged_date"] == review["logged_date"]
        ]

        if same_log:
            candidates = same_log

    if len(candidates) > 1 and review["rating"] is not None:
        same_rating = [
            entry
            for entry in candidates
            if entry["rating"] == review["rating"]
        ]

        if same_rating:
            candidates = same_rating

    if len(candidates) > 1 and review["rewatch"] is not None:
        same_rewatch = [
            entry
            for entry in candidates
            if entry["rewatch"] == review["rewatch"]
        ]

        if same_rewatch:
            candidates = same_rewatch

    return candidates[0] if len(candidates) == 1 else None


def build_film_diaries(zip_path, metadata=None):
    """Merge diary and review records without duplicating matched watches."""
    metadata = metadata or {}

    if Path(zip_path).stat().st_size > MAX_UPLOAD_BYTES:
        raise ValueError("The export is too large.")

    with ZipFile(zip_path) as archive:
        infos = archive.infolist()

        if (
            len(infos) > 10000
            or sum(info.file_size for info in infos)
            > MAX_EXPANDED_BYTES
        ):
            raise ValueError("The expanded export is too large.")

        names = archive.namelist()

        if len(names) != len(set(names)):
            raise ValueError("The ZIP contains duplicate file names.")

        def rows(name):
            if name not in names:
                return []

            with archive.open(name) as raw:
                reader = csv.DictReader(
                    io.TextIOWrapper(
                        raw,
                        encoding="utf-8-sig",
                        newline="",
                    )
                )

                if not {"Name", "Year"}.issubset(
                    reader.fieldnames or []
                ):
                    raise ValueError(
                        f"{name} must contain Name and Year columns."
                    )

                return list(reader)

        watched = rows("watched.csv")
        ratings = rows("ratings.csv")
        diary_rows = rows("diary.csv")
        reviews = rows("reviews.csv")

    films = {}

    def get_film(row):
        title, year = _key(row)

        if not title:
            return None

        key = film_key(title, year)

        if key not in films:
            details = metadata.get((title, year)) or {}

            films[key] = {
                "title": title,
                "year": year,
                "poster_url": details.get("poster_url"),
                "current_rating": None,
                "entries": [],
                "diary_count": 0,
                "review_count": 0,
            }

        return films[key]

    for row in watched + ratings:
        film = get_film(row)

        if film is not None and "Rating" in row:
            film["current_rating"] = _rating(
                row.get("Rating")
            )

    for index, row in enumerate(diary_rows):
        film = get_film(row)

        if film is not None:
            film["entries"].append(
                _entry(row, "diary", index)
            )
            film["diary_count"] += 1

    for index, row in enumerate(reviews):
        text = review_text(row.get("Review"))

        if not text:
            continue

        film = get_film(row)

        if film is None:
            continue

        review = _entry(row, "review", index)
        review["review"] = text

        target = _match_review(
            film["entries"],
            review,
        )

        if target is not None:
            target["review"] = text
            target["spoilers"] = review["spoilers"]

            if target["rating"] is None:
                target["rating"] = review["rating"]

        else:
            # Preserve ambiguous reviews separately instead of guessing.
            film["entries"].append(review)

    for film in films.values():
        film["review_count"] = sum(
            bool(entry["review"])
            for entry in film["entries"]
        )

        film["entries"].sort(
            key=lambda entry: (
                entry["watched_date"]
                or entry["logged_date"]
                or "",
                entry["logged_date"] or "",
            ),
            reverse=True,
        )

    return films