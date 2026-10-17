"""Coordinate import, metadata, diary pages, and dashboard views."""
from gevent.pool import Pool

from .cache import Cache
from .film_diary import build_film_diaries
from .imports import read_export
from .stats import calculate_stats
from .tmdb import TMDBClient
from .year_filter import filter_dashboard

PERSON_GROUPS = (
    "top_directors_total",
    "top_directors_unique",
    "top_actors_total",
    "top_actors_unique",
    "top_rated_directors_list",
    "top_rated_actors_list",
)


def get_homepage_stats(
    zip_path,
    max_movies_to_fetch=None,
    progress_callback=None,
    dashboard_context=None,
):
    export = read_export(zip_path)

    if max_movies_to_fetch is not None:
        export.films = export.films[:max_movies_to_fetch]

    unique = {
        film.key: film
        for film in export.films + export.top_films
    }

    for film, _ in export.diary:
        unique.setdefault(film.key, film)

    with Cache() as cache:
        client = TMDBClient(cache)
        pool = Pool(8)

        try:
            metadata = {}

            results = pool.imap_unordered(
                lambda key: (
                    key,
                    client.movie(*key),
                ),
                unique,
            )

            for key, details in results:
                metadata[key] = details or {}

                if progress_callback:
                    progress_callback(
                        len(metadata),
                        len(unique),
                    )

            cache.flush()

            if not unique and progress_callback:
                progress_callback(0, 0)

            stats = calculate_stats(
                export,
                metadata,
            )

            stats["film_diaries"] = build_film_diaries(
                zip_path,
                metadata,
            )

            names = {
                person["name"]
                for group in PERSON_GROUPS
                for person in stats[group]
            }

            biographies = dict(
                pool.imap_unordered(
                    lambda name: (
                        name,
                        client.person(name),
                    ),
                    names,
                )
            )

            for group in PERSON_GROUPS:
                for person in stats[group]:
                    person.update(
                        biographies[person["name"]]
                    )

            stats["avatar_url"] = client.avatar(
                export.username
            )

            stats["warnings"] = []

            if client.failures:
                stats["warnings"].append(
                    "Metadata could not be loaded for "
                    f"{len(client.failures)} film(s). "
                    "Ratings and release-year totals still "
                    "include imported films."
                )

            context = {
                "export": export,
                "metadata": metadata,
                "diaries": stats["film_diaries"],
                "all_time": stats,
            }

            if dashboard_context is not None:
                dashboard_context.clear()
                dashboard_context.update(context)

            return filter_dashboard(context)

        finally:
            pool.kill(block=True)
            client.close()