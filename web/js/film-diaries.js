import { escapeHTML as h, imageURL } from './utils.js';

let diaries = {};
const previews = new Map();
let returnTo = null;

export function setFilmDiaries(stats) {
    diaries = stats.film_diaries || {};
    previews.clear();
    returnTo = null;
}

function remember(film) {
    const title = String(film.title ?? film.Name ?? '').trim();
    const number = Number(film.year ?? film.Year);
    const year = Number.isFinite(number) && number > 0 && number < 10000
        ? Math.trunc(number) : 0;

    if (!title) return null;

    const key = JSON.stringify([title, year]);
    const old = previews.get(key) || {};

    previews.set(key, {
        ...old,
        title,
        year,
        poster_url: film.poster_url || old.poster_url || null,
    });

    return key;
}

export function posterCard(film, size = 'small', overlay = '') {
    const key = remember(film);
    const title = film.title ?? film.Name ?? '';

    const picture = film.poster_url
        ? `<img src="${h(imageURL(film.poster_url))}"
                class="poster-img" alt="" loading="lazy">`
        : `<span class="poster-fallback">${h(title)}</span>`;

    if (!key) {
        return `<div class="poster-card ${size}">${picture}</div>`;
    }

    return `
        <button type="button" class="poster-card ${size}"
                data-film-key="${h(key)}"
                aria-label="View diary for ${h(title)}">
            ${picture}
            <span class="poster-overlay">${overlay || h(title)}</span>
        </button>
    `;
}

export function posterImage(film, imageClass = '') {
    const key = remember(film);
    const image = `
        <img src="${h(imageURL(film.poster_url))}"
             class="${imageClass}" alt="" loading="lazy">
    `;

    if (!key) return image;

    return `
        <button type="button" class="film-poster-link"
                data-film-key="${h(key)}"
                aria-label="View diary for ${h(film.title ?? film.Name)}">
            ${image}
        </button>
    `;
}

function element(tag, text, className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
}

function screen() {
    let page = document.getElementById('film-screen');
    if (page) return page;

    page = document.createElement('section');
    page.id = 'film-screen';
    page.className = 'hidden screen-overlay film-screen';

    page.innerHTML = `
        <button type="button" id="film-back"
                class="btn orange back-button">← Back</button>

        <header class="profile-header film-header">
            <img id="film-poster" class="film-detail-poster" alt="">

            <div class="profile-info">
                <h2 id="film-title" tabindex="-1"></h2>
                <p id="film-summary" class="profile-subtitle"></p>
                <p id="film-current-rating" class="film-current-rating"></p>
            </div>
        </header>

        <h3 class="section-title film-diary-heading">
            Your diary and reviews
        </h3>

        <div id="film-entries"></div>
    `;

    document.body.insertBefore(page, document.querySelector('footer'));
    page.querySelector('#film-back').addEventListener('click', closeFilm);

    return page;
}

function ratingLabel(value) {
    return value === null || value === undefined
        ? 'Unrated' : `${value}★`;
}

function displayDate(value) {
    if (!value) return 'Watch date not exported';

    const date = new Date(`${value}T12:00:00`);

    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat(undefined, {
            dateStyle: 'long',
        }).format(date);
}

export function openFilm(key, trigger = null) {
    const film = diaries[key] || previews.get(key);
    if (!film) return;

    const page = screen();

    const previous = [
        ...document.querySelectorAll('#dashboard-screen, .screen-overlay'),
    ].find(node =>
        node.id !== 'film-screen' &&
        !node.classList.contains('hidden')
    );

    returnTo = {
        id: previous?.id || 'dashboard-screen',
        scroll: window.scrollY,
        trigger,
    };

    document.getElementById('film-title').textContent =
        film.title + (film.year ? ` (${film.year})` : '');

    const image = document.getElementById('film-poster');
    image.src = imageURL(
        film.poster_url || previews.get(key)?.poster_url
    );
    image.alt = `${film.title} poster`;

    const entries = film.entries || [];
    const watches = film.diary_count || 0;
    const reviews = film.review_count || 0;

    document.getElementById('film-summary').textContent =
        (film.view_year ? `Watched in ${film.view_year}: ` : '') +
        `${watches} diary ${watches === 1 ? 'entry' : 'entries'} • ` +
        `${reviews} exported ${reviews === 1 ? 'review' : 'reviews'}`;

    document.getElementById('film-current-rating').textContent =
        `Current overall rating: ${
            film.current_rating == null
                ? 'Not exported'
                : ratingLabel(film.current_rating)
        }`;

    const list = document.getElementById('film-entries');
    list.replaceChildren();

    if (!entries.length) {
        list.appendChild(element(
            'p',
            'No diary entries or reviews for this film were included in this export.',
            'diary-empty'
        ));
    }

    for (const entry of entries) {
        const article = document.createElement('article');
        article.className = 'diary-entry';

        const heading = document.createElement('div');
        heading.className = 'diary-entry-heading';

        heading.appendChild(element(
            'h4',
            displayDate(entry.watched_date)
        ));
        heading.appendChild(element(
            'span',
            ratingLabel(entry.rating),
            'diary-rating'
        ));

        article.appendChild(heading);

        if (entry.rewatch) {
            article.appendChild(element(
                'p',
                '↻ Rewatch',
                'diary-entry-meta'
            ));
        }

        if (entry.logged_date) {
            article.appendChild(element(
                'p',
                `Logged ${displayDate(entry.logged_date)}`,
                'diary-entry-meta'
            ));
        }

        if (entry.source === 'review') {
            article.appendChild(element(
                'p',
                'Exported review — a matching diary entry could not be identified.',
                'diary-entry-meta'
            ));
        }

        if (entry.review) {
            const details = document.createElement('details');
            details.className = 'diary-review';

            details.appendChild(element(
                'summary',
                entry.spoilers
                    ? 'Read review (contains spoilers)'
                    : 'Read review'
            ));

            // Exported reviews are rendered as text, never executable HTML.
            details.appendChild(element(
                'p',
                entry.review,
                'diary-review-body'
            ));

            article.appendChild(details);
        } else {
            article.appendChild(element(
                'p',
                'No review in this export.',
                'diary-entry-meta'
            ));
        }

        list.appendChild(article);
    }

    if (previous) {
        previous.classList.add('hidden');
        previous.classList.remove('active');
    }

    page.classList.remove('hidden');
    page.classList.add('active');

    window.scrollTo(0, 0);
    document.getElementById('film-title').focus({
        preventScroll: true,
    });
}

function closeFilm() {
    const page = document.getElementById('film-screen');

    if (!page || page.classList.contains('hidden') || !returnTo) {
        return;
    }

    page.classList.add('hidden');
    page.classList.remove('active');

    const previous = document.getElementById(returnTo.id);

    if (previous) {
        previous.classList.remove('hidden');
        previous.classList.add('active');
    }

    window.scrollTo(0, returnTo.scroll);

    if (returnTo.trigger?.isConnected) {
        returnTo.trigger.focus({ preventScroll: true });
    }

    returnTo = null;
}

document.addEventListener('click', event => {
    const poster = event.target.closest?.('[data-film-key]');

    if (poster) {
        event.preventDefault();
        openFilm(poster.dataset.filmKey, poster);
    }
});

document.addEventListener('keydown', event => {
    const page = document.getElementById('film-screen');

    if (
        event.key === 'Escape' &&
        page &&
        !page.classList.contains('hidden')
    ) {
        event.preventDefault();
        closeFilm();
    }
});