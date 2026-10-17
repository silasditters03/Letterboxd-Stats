"""Normalized records shared by importers, services, and statistics."""
from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class Film:
    title: str
    year: int
    rating: float | None = None
    play_count: int = 1

    @property
    def key(self) -> tuple[str, int]:
        return self.title, self.year


@dataclass
class Export:
    films: list[Film]
    top_films: list[Film]
    username: str = "User"
    diary: list[tuple[Film, date | None]] = field(default_factory=list)