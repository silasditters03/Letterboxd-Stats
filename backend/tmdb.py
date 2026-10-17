"""TMDB transport and matching; no statistics or UI dependencies."""
import difflib
import os
import re
from contextlib import contextmanager

import requests
from gevent.queue import LifoQueue
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class AuthenticationError(ValueError):
    pass


def choose_match(candidates, title, year):
    """Rank candidates using title, year, popularity, and vote count."""
    def clean_string(value):
        return re.sub(
            r"[^\w\s]",
            "",
            str(value or "").casefold(),
        ).strip()

    target_clean = clean_string(str(title))
    target_no_spaces = target_clean.replace(" ", "")
    target_year = year or 0

    best_candidate = None
    best_score = -1

    for candidate in candidates:
        is_movie = candidate["media_type"] == "movie"

        candidate_title = candidate.get(
            "title" if is_movie else "name"
        )

        original_title = candidate.get(
            "original_title" if is_movie else "original_name"
        )

        release_date = candidate.get(
            "release_date" if is_movie else "first_air_date"
        )

        candidate_year = 0

        if release_date and len(release_date) >= 4:
            try:
                candidate_year = int(release_date[:4])
            except ValueError:
                pass

        title_clean = clean_string(candidate_title)
        original_clean = clean_string(original_title)

        title_similarity = difflib.SequenceMatcher(
            None,
            target_no_spaces,
            title_clean.replace(" ", ""),
        ).ratio()

        original_similarity = difflib.SequenceMatcher(
            None,
            target_no_spaces,
            original_clean.replace(" ", ""),
        ).ratio()

        similarity = max(
            title_similarity,
            original_similarity,
        )

        exact = (
            target_clean == title_clean
            or target_clean == original_clean
        )

        if exact:
            similarity = 1.0

        prefix = (
            title_clean.startswith(target_clean + " ")
            or original_clean.startswith(target_clean + " ")
        )

        if prefix:
            similarity = max(similarity, 0.95)

        title_weight = similarity * 10000

        if exact:
            title_weight += 2000
        elif prefix:
            title_weight += 1000

        year_delta = (
            abs(candidate_year - target_year)
            if target_year > 0 and candidate_year > 0
            else 999
        )

        if year_delta == 0:
            year_weight = 3000
        elif year_delta == 1:
            year_weight = 2000
        elif year_delta == 2:
            year_weight = 500
        elif year_delta == 999:
            year_weight = 0
        else:
            year_weight = -2000

        popularity_weight = min(
            candidate.get("popularity", 0) * 5,
            1000,
        )

        vote_weight = min(
            candidate.get("vote_count", 0) * 10,
            3000,
        )

        score = (
            title_weight
            + year_weight
            + popularity_weight
            + vote_weight
        )

        if score > best_score:
            best_score = score
            best_candidate = candidate

    if best_candidate:
        return (
            best_candidate["media_type"],
            best_candidate["id"],
            best_candidate.get("poster_path"),
        )

    return None, None, None


class TMDBClient:
    def __init__(self, cache, token=None):
        self.cache = cache

        self.token = (
            token
            if token is not None
            else os.getenv("TMDB_TOKEN", "")
        )

        self._available = LifoQueue(maxsize=8)

        for _ in range(8):
            self._available.put(None)

        self._sessions = []
        self.failures = set()

    @contextmanager
    def _session(self):
        """Borrow one of at most eight reusable HTTP sessions."""
        session = self._available.get()

        try:
            if session is None:
                session = requests.Session()

                retry = Retry(
                    total=2,
                    backoff_factor=0.5,
                    status_forcelist=(
                        429,
                        500,
                        502,
                        503,
                        504,
                    ),
                    allowed_methods=frozenset({"GET"}),
                )

                session.mount(
                    "https://",
                    HTTPAdapter(max_retries=retry),
                )

                self._sessions.append(session)

            yield session

        finally:
            self._available.put(session)

    def _get(self, path, params=None):
        if not self.token:
            raise AuthenticationError(
                "TMDB_TOKEN is missing. Add it to your .env file "
                "to enrich uncached films."
            )

        with self._session() as session:
            response = session.get(
                "https://api.themoviedb.org/3/" + path,
                params=params,
                headers={
                    "accept": "application/json",
                    "authorization": f"Bearer {self.token}",
                },
                timeout=(5, 20),
            )

            if response.status_code in (401, 403):
                raise AuthenticationError(
                    "TMDB rejected the token. "
                    "Check your API Read Access Token."
                )

            response.raise_for_status()
            return response.json()

    def _match(self, title, year):
        candidates = []
        seen = set()

        searches = [
            (
                "movie",
                {
                    "query": title,
                    **(
                        {"primary_release_year": year}
                        if year
                        else {}
                    ),
                },
            )
        ]

        if year:
            searches.append(
                ("movie", {"query": title})
            )

        searches.append(
            ("tv", {"query": title})
        )

        for media, params in searches:
            results = self._get(
                f"search/{media}",
                params,
            ).get("results", [])

            for row in results:
                key = media, row["id"]

                if key not in seen:
                    seen.add(key)
                    candidates.append(
                        {
                            **row,
                            "media_type": media,
                        }
                    )

        return choose_match(candidates, title, year)

    def movie(self, title, year):
        key = f"details_v10_{title}_{year}"
        cached = self.cache.get(key)

        if cached:
            return cached

        try:
            media, identity, poster = self._match(title, year)

            if not media:
                self.failures.add((title, year))
                return None

            data = self._get(
                f"{media}/{identity}",
                {"append_to_response": "credits"},
            )

            credits = data.get("credits", {})
            crew = credits.get("crew", [])

            if media == "tv":
                episode_times = (
                    data.get("episode_run_time") or []
                )

                average_runtime = (
                    sum(episode_times) / len(episode_times)
                    if episode_times
                    else 0
                )

                runtime = int(
                    average_runtime
                    * (data.get("number_of_episodes") or 1)
                )

                directors = [
                    person["name"]
                    for person in data.get("created_by", [])
                ]

                if not directors:
                    directors = [
                        person["name"]
                        for person in crew
                        if person.get("job") in (
                            "Director",
                            "Series Directed By",
                        )
                    ]

            else:
                runtime = data.get("runtime") or 0

                directors = [
                    person["name"]
                    for person in crew
                    if person.get("job") in (
                        "Director",
                        "Co-Director",
                        "Segment Director",
                    )
                ]

            language_code = data.get("original_language")

            language = next(
                (
                    item.get("english_name") or item.get("name")
                    for item in data.get("spoken_languages", [])
                    if item.get("iso_639_1") == language_code
                ),
                None,
            )

            language_fallback = {
                "en": "English",
                "fr": "French",
                "ja": "Japanese",
                "ko": "Korean",
                "es": "Spanish",
                "it": "Italian",
                "de": "German",
                "zh": "Mandarin",
                "cn": "Cantonese",
                "nl": "Dutch",
            }

            language = (
                language
                or language_fallback.get(
                    language_code,
                    (language_code or "").upper(),
                )
            )

            poster = data.get("poster_path") or poster

            result = {
                "runtime": runtime,
                "countries": [
                    item["name"]
                    for item in data.get(
                        "production_countries",
                        [],
                    )
                ],
                "languages": [language] if language else [],
                "genres": [
                    item["name"]
                    for item in data.get("genres", [])
                ],
                "directors": list(dict.fromkeys(directors)),
                "actors": list(
                    dict.fromkeys(
                        item["name"]
                        for item in credits.get("cast", [])
                    )
                ),
                "poster_url": (
                    f"https://image.tmdb.org/t/p/w200{poster}"
                    if poster
                    else None
                ),
                "popularity": data.get("popularity") or 0,
                "vote_average": data.get("vote_average") or 0,
                "vote_count": data.get("vote_count") or 0,
                "media_type": media,
                "release_date": data.get(
                    "release_date"
                    if media == "movie"
                    else "first_air_date"
                ),
            }

            self.cache.set(key, result)
            return result

        except AuthenticationError:
            raise

        except (
            requests.RequestException,
            ValueError,
            KeyError,
            TypeError,
        ):
            self.failures.add((title, year))
            return None

    def person(self, name):
        key = f"person_details_{name}"
        cached = self.cache.get(key)

        if cached:
            return cached

        fallback = {
            "image_url": None,
            "biography": "",
        }

        if not self.token:
            return fallback

        try:
            results = self._get(
                "search/person",
                {"query": name},
            ).get("results", [])

            if results:
                person = self._get(
                    f"person/{results[0]['id']}"
                )

                poster = person.get("profile_path")

                result = {
                    "image_url": (
                        f"https://image.tmdb.org/t/p/w185{poster}"
                        if poster
                        else None
                    ),
                    "biography": person.get("biography", ""),
                }

                self.cache.set(key, result)
                return result

        except AuthenticationError:
            raise

        except (
            requests.RequestException,
            ValueError,
            KeyError,
            TypeError,
        ):
            pass

        return fallback

    def avatar(self, username):
        if not username or username.lower() == "user":
            return None

        try:
            encoded_username = requests.utils.quote(
                username,
                safe="",
            )

            with self._session() as session:
                response = session.get(
                    f"https://letterboxd.com/{encoded_username}/",
                    timeout=(5, 5),
                )

            if response.ok:
                match = re.search(
                    r'<meta\s+property="og:image"\s+content="([^"]+)"',
                    response.text,
                )

                if match and not any(
                    text in match[1]
                    for text in (
                        "mac-icon",
                        "letterboxd-logo",
                    )
                ):
                    return match[1]

        except requests.RequestException:
            pass

        return None

    def close(self):
        for session in self._sessions:
            session.close()