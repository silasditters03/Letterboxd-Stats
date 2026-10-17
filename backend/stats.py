"""Pure statistics: no HTTP calls, database access, or UI imports."""
from collections import Counter, defaultdict
from datetime import date

from .models import Export, Film


def _film_view(film: Film, metadata: dict) -> dict:
    return {
        "title": film.title,
        "year": film.year,
        "rating": film.rating or 0,
        "play_count": film.play_count,
        "poster_url": metadata.get("poster_url"),
        "vote_average": metadata.get("vote_average", 0),
    }


def _leaderboards(groups, role):
    people = []

    for name, films in groups.items():
        rated = [
            film for film in films
            if film["rating"] > 0
        ]

        average = (
            round(
                sum(film["rating"] for film in rated)
                / len(rated),
                2,
            )
            if rated
            else 0
        )

        people.append(
            {
                "id": f"{role}:{name}",
                "name": name,
                "total_count": sum(
                    film["play_count"] for film in films
                ),
                "unique_count": len(films),
                "count": len(rated),
                "avg_rating": average,
                # Keep every watched film on the person's profile.
                "films": sorted(
                    films,
                    key=lambda film: (
                        film["rating"],
                        film["play_count"],
                    ),
                    reverse=True,
                ),
            }
        )

    most_watched = sorted(
        people,
        key=lambda person: person["total_count"],
        reverse=True,
    )[:10]

    most_unique = sorted(
        people,
        key=lambda person: person["unique_count"],
        reverse=True,
    )[:10]

    highest_rated = sorted(
        (
            person for person in people
            if person["count"] >= 3
        ),
        key=lambda person: (
            person["avg_rating"],
            person["count"],
        ),
        reverse=True,
    )[:10]

    return most_watched, most_unique, highest_rated


def calculate_stats(
    export: Export,
    metadata: dict[tuple[str, int], dict],
) -> dict:
    """Missing metadata never removes imported rating or year totals."""
    directors = defaultdict(list)
    actors = defaultdict(list)
    years = defaultdict(list)
    countries = defaultdict(list)
    languages = defaultdict(list)

    genres = Counter()
    ratings = Counter(
        {
            step / 2: 0
            for step in range(1, 11)
        }
    )

    minutes = 0
    enriched = []
    differences = []

    for film in export.films:
        details = metadata.get(film.key) or {}
        view = _film_view(film, details)

        if film.year:
            years[film.year].append(view)

        if film.rating:
            ratings[round(film.rating * 2) / 2] += 1

        minutes += (
            (details.get("runtime") or 0)
            * film.play_count
        )

        for name in set(details.get("directors", [])):
            directors[name].append(view)

        for name in set(details.get("actors", [])):
            actors[name].append(view)

        for name in set(details.get("countries", [])):
            countries[name].append(view)

        for name in set(details.get("languages", [])):
            languages[name].append(view)

        genres.update(set(details.get("genres", [])))

        if details:
            enriched.append((film, details))

        if (
            film.rating
            and details.get("vote_count", 0) >= 50
            and details.get("vote_average", 0) > 0
        ):
            average = details["vote_average"] / 2

            differences.append(
                {
                    "title": film.title,
                    "year": film.year,
                    "user_rating": film.rating,
                    "tmdb_rating": round(average, 1),
                    "diff": film.rating - average,
                    "poster_url": details.get("poster_url"),
                }
            )

    top_films = []

    for film in export.top_films:
        details = metadata.get(film.key) or {}

        top_films.append(
            {
                **_film_view(film, details),
                "director": next(
                    iter(details.get("directors", [])),
                    "Unknown",
                ),
            }
        )

    milestones = {}

    def milestone(name, item, suffix=None):
        if not item:
            milestones[name] = {
                "text": "N/A",
                "poster_url": None,
            }
            return

        film, details = item

        value = (
            suffix
            if suffix is not None
            else film.year
        )

        milestones[name] = {
            "title": film.title,
            "year": film.year,
            "text": f"{film.title} ({value})",
            "poster_url": details.get("poster_url"),
        }

    dated = []

    for item in enriched:
        try:
            release_date = date.fromisoformat(
                item[1].get("release_date") or ""
            )
            dated.append((release_date, item))
        except ValueError:
            pass

    milestone(
        "newest_film",
        max(dated, key=lambda entry: entry[0])[1]
        if dated
        else None,
    )

    milestone(
        "oldest_film",
        min(dated, key=lambda entry: entry[0])[1]
        if dated
        else None,
    )

    milestone(
        "most_popular",
        max(
            enriched,
            key=lambda item: item[1].get("vote_count", 0),
        )
        if enriched
        else None,
    )

    milestone(
        "most_obscure",
        min(
            enriched,
            key=lambda item: item[1].get("vote_count", 0),
        )
        if enriched
        else None,
    )

    vetted = [
        item for item in enriched
        if (
            item[1].get("vote_count", 0) >= 50
            and item[1].get("vote_average", 0) > 0
        )
    ]

    vetted = vetted or [
        item for item in enriched
        if item[1].get("vote_average", 0) > 0
    ]

    for name, selector in (
        ("highest_rating", max),
        ("lowest_rating", min),
    ):
        item = (
            selector(
                vetted,
                key=lambda entry: entry[1]["vote_average"],
            )
            if vetted
            else None
        )

        suffix = (
            f"{item[1]['vote_average'] / 2:.1f}★"
            if item
            else None
        )

        milestone(name, item, suffix)

    features = [
        item for item in enriched
        if (
            item[1].get("media_type", "movie") == "movie"
            and item[1].get("runtime", 0) > 0
        )
    ]

    longest = (
        max(
            features,
            key=lambda item: item[1]["runtime"],
        )
        if features
        else None
    )

    milestone(
        "longest_film",
        longest,
        f"{longest[1]['runtime']} min"
        if longest
        else None,
    )

    diary = [
        (film, watched)
        for film, watched in export.diary
        if watched
    ]

    recent = (
        max(
            diary,
            key=lambda entry: entry[1],
        )[0]
        if diary
        else None
    )

    milestone(
        "recent_watch",
        (
            recent,
            metadata.get(recent.key) or {},
        )
        if recent
        else None,
    )

    diary_counts = Counter(
        film.key for film, _ in export.diary
    )

    rewatches = {
        film.key: film
        for film in export.films
        if film.play_count > 1
    }

    for film, _ in export.diary:
        if diary_counts[film.key] > 1:
            rewatches[film.key] = Film(
                film.title,
                film.year,
                film.rating,
                diary_counts[film.key],
            )

    rewatched = (
        max(
            rewatches.values(),
            key=lambda film: film.play_count,
        )
        if rewatches
        else None
    )

    milestone(
        "most_rewatched",
        (
            rewatched,
            metadata.get(rewatched.key) or {},
        )
        if rewatched
        else None,
        f"{rewatched.play_count}x"
        if rewatched
        else None,
    )

    yearly = []

    if years:
        for year in range(min(years), max(years) + 1):
            films = years.get(year, [])

            rated = [
                film["rating"]
                for film in films
                if film["rating"] > 0
            ]

            yearly.append(
                {
                    "year": year,
                    "count": sum(
                        film["play_count"] for film in films
                    ),
                    "avg_rating": (
                        round(sum(rated) / len(rated), 2)
                        if rated
                        else 0
                    ),
                    "films": sorted(
                        films,
                        key=lambda film: (
                            film["rating"],
                            film["play_count"],
                        ),
                        reverse=True,
                    ),
                }
            )

    (
        director_total,
        director_unique,
        director_rated,
    ) = _leaderboards(directors, "director")

    (
        actor_total,
        actor_unique,
        actor_rated,
    ) = _leaderboards(actors, "actor")

    return {
        "username": export.username,
        "avatar_url": None,
        "total_watched": len(export.films),
        "total_hours": round(minutes / 60, 1),
        "total_countries": len(countries),
        "total_directors": len(directors),
        "enriched_count": len(enriched),
        "top_20": top_films,
        "top_directors_total": director_total,
        "top_directors_unique": director_unique,
        "top_actors_total": actor_total,
        "top_actors_unique": actor_unique,
        "top_rated_directors_list": director_rated,
        "top_rated_actors_list": actor_rated,
        "yearly_stats": yearly,
        "genre_stats": [
            {
                "Genre": name,
                "Count": count,
            }
            for name, count in genres.most_common(15)
        ],
        "rating_dist": [
            {
                "rating": rating,
                "count": count,
            }
            for rating, count in sorted(ratings.items())
        ],
        "country_stats": [
            {
                "Country": name,
                "Count": len(films),
                "films": films,
            }
            for name, films in countries.items()
        ],
        "language_stats": sorted(
            [
                {
                    "Language": name,
                    "Count": len(films),
                    "films": films,
                }
                for name, films in languages.items()
            ],
            key=lambda item: item["Count"],
            reverse=True,
        ),
        "milestones": milestones,
        "differences": {
            "positive": sorted(
                (
                    item for item in differences
                    if item["diff"] > 0
                ),
                key=lambda item: item["diff"],
                reverse=True,
            )[:10],
            "negative": sorted(
                (
                    item for item in differences
                    if item["diff"] < 0
                ),
                key=lambda item: item["diff"],
            )[:10],
        },
    }