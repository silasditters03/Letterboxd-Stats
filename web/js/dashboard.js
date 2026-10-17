import { state } from './state.js';
import {
    setFilmDiaries,
    posterCard,
    posterImage,
} from './film-diaries.js';
import { renderCharts, drawMap } from './charts.js';
import { escapeHTML as h, imageURL } from './utils.js';

const languageToCountryCode = {
    English: 'us',
    Japanese: 'jp',
    French: 'fr',
    Korean: 'kr',
    Spanish: 'es',
    Italian: 'it',
    German: 'de',
    Mandarin: 'cn',
    Cantonese: 'hk',
    Russian: 'ru',
    Portuguese: 'br',
    Hindi: 'in',
    Arabic: 'sa',
    Swedish: 'se',
    Danish: 'dk',
    Dutch: 'nl',
    Polish: 'pl',
    Turkish: 'tr',
    Persian: 'ir',
    Norwegian: 'no',
    Finnish: 'fi',
    Thai: 'th',
    Indonesian: 'id',
    Vietnamese: 'vn',
    Greek: 'gr',
    Czech: 'cz',
    Hungarian: 'hu',
    Hebrew: 'il',
    Tagalog: 'ph',
    Romanian: 'ro',
    Ukrainian: 'ua',
    Malayalam: 'in',
    Tamil: 'in',
    Telugu: 'in',
    Bengali: 'in',
    Urdu: 'pk',
};

function transitionScreen(hideId, showId, callback) {
    const hideEl = document.getElementById(hideId);
    const showEl = document.getElementById(showId);

    hideEl.style.transition =
        'opacity 0.2s ease, transform 0.2s ease';
    hideEl.style.opacity = '0';
    hideEl.style.transform = 'translateY(15px)';

    setTimeout(() => {
        hideEl.classList.add('hidden');
        hideEl.classList.remove('active');

        showEl.classList.remove('hidden');
        showEl.classList.add('active');

        showEl.style.opacity = '0';
        showEl.style.transform = 'translateY(15px)';
        void showEl.offsetWidth;

        showEl.style.transition =
            'opacity 0.3s ease, transform 0.3s ease';
        showEl.style.opacity = '1';
        showEl.style.transform = 'translateY(0)';

        if (callback) callback();
    }, 200);
}

function sortAndRenderGrid(sortType) {
    const sorted = [...state.grid.films];

    if (sortType === 'rating') {
        sorted.sort((a, b) =>
            b.rating - a.rating ||
            b.play_count - a.play_count
        );
    } else if (sortType === 'avg_rating') {
        sorted.sort((a, b) =>
            (b.vote_average || 0) - (a.vote_average || 0)
        );
    } else if (sortType === 'newest') {
        sorted.sort((a, b) => b.year - a.year);
    } else if (sortType === 'oldest') {
        sorted.sort((a, b) => a.year - b.year);
    }

    const grid = document.getElementById(state.grid.id);
    let htmlContent = '';

    sorted.forEach(film => {
        const overlay =
            `${h(film.title)}<br>` +
            `${film.rating > 0 ? film.rating + '★' : ''}`;

        htmlContent += posterCard(film, 'small', overlay);
    });

    grid.innerHTML = htmlContent;
}

// The watch-year selector has its own backend filtering handler.
document.querySelectorAll(
    '.sort-dropdown:not(#watch-year-filter)'
).forEach(dropdown => {
    dropdown.addEventListener('change', event => {
        sortAndRenderGrid(event.target.value);
    });
});

function generateTooltipHTML(person) {
    const topFilms = person.films
        ? person.films.slice(0, 10)
        : (person.top_films || []).slice(0, 10);

    const totalFilms = person.films
        ? person.films.length
        : person.top_films
            ? person.top_films.length + (person.remaining || 0)
            : 0;

    const remaining = Math.max(0, totalFilms - 10);

    const postersHTML = topFilms.map(film => {
        const titleTag =
            `${film.title}` +
            `${film.rating > 0 ? ` (${film.rating}★)` : ''}`;

        if (film.poster_url) {
            return `
                <img src="${h(imageURL(film.poster_url))}"
                     class="tooltip-poster"
                     alt="${h(film.title)}"
                     title="${h(titleTag)}"
                     loading="lazy">
            `;
        }

        return `
            <div class="tooltip-poster-fallback"
                 title="${h(titleTag)}">?</div>
        `;
    }).join('');

    const moreHTML = remaining > 0
        ? `<div class="tooltip-more">+${remaining} more</div>`
        : '';

    return `
        <div class="hover-tooltip">
            <div class="tooltip-posters">${postersHTML}</div>
            ${moreHTML}
        </div>
    `;
}

function renderCastList(containerId, data, icon, countKey) {
    const listEl = document.getElementById(containerId);
    if (!listEl) return;

    let htmlContent = '';

    data.forEach((person, index) => {
        const personId = encodeURIComponent(person.id || person.name);
        state.people[personId] = person;

        const avatarHTML = person.image_url
            ? `
                <img src="${h(imageURL(person.image_url))}"
                     class="leaderboard-avatar"
                     alt="${h(person.name)}" loading="lazy">
            `
            : `<div class="leaderboard-avatar-fallback">${icon}</div>`;

        const countLabel = `${person[countKey]} films`;

        htmlContent += `
            <button type="button" class="leaderboard-item"
                    data-profile="${personId}">
                <div class="leaderboard-left">
                    ${avatarHTML}
                    <span class="leaderboard-name">
                        ${index + 1}. ${h(person.name)}
                    </span>
                </div>
                <span class="leaderboard-count">${countLabel}</span>
                ${generateTooltipHTML(person)}
            </button>
        `;
    });

    listEl.innerHTML = htmlContent;
}

export function buildDashboard(stats, fromUpload = true) {
    updateYearControls(stats);
    setFilmDiaries(stats);

    state.stats = stats;
    state.people = Object.create(null);
    state.years = Object.create(null);

    const notice = document.getElementById('enrichment-notice');
    notice.textContent = (stats.warnings || []).join(' ');
    notice.classList.toggle('hidden', !notice.textContent);

    if (fromUpload) {
        transitionScreen('upload-screen', 'dashboard-screen');
    }

    const welcomeUser = document.getElementById('welcome-username');
    const welcomeAvatar = document.getElementById('welcome-avatar');

    if (stats.username && stats.username !== 'User') {
        welcomeUser.innerText =
            stats.username.charAt(0).toUpperCase() +
            stats.username.slice(1);
    } else {
        welcomeUser.innerText = 'Cinephile';
    }

    welcomeAvatar.style.display = 'none';

    if (stats.avatar_url) {
        welcomeAvatar.src = imageURL(stats.avatar_url);
        welcomeAvatar.style.display = 'block';
    }

    document.getElementById('stat-total').innerText =
        stats.total_watched;
    document.getElementById('stat-hours').innerText =
        stats.total_hours;
    document.getElementById('stat-countries').innerText =
        stats.total_countries;
    document.getElementById('stat-directors').innerText =
        stats.total_directors;

    const grid = document.getElementById('poster-grid');
    let gridHtml = '';

    stats.top_20.forEach((film, index) => {
        const overlay =
            `${h(film.title)} (${Math.floor(film.year)})<br>` +
            `Dir: ${h(film.director || 'Unknown')}`;

        gridHtml += posterCard(
            film,
            index < 4 ? 'large' : 'small',
            overlay
        );
    });

    grid.innerHTML = gridHtml;

    if (stats.milestones) {
        const mGrid = document.getElementById('milestone-grid');
        let mGridHtml = '';

        const mConfig = [
            { title: 'MOST RECENT WATCH', key: 'recent_watch' },
            { title: 'NEWEST FILM WATCHED', key: 'newest_film' },
            { title: 'OLDEST FILM WATCHED', key: 'oldest_film' },
            { title: 'MOST REWATCHED', key: 'most_rewatched' },
            { title: 'MOST OBSCURE', key: 'most_obscure' },
            { title: 'MOST POPULAR', key: 'most_popular' },
            { title: 'HIGHEST AVERAGE RATING', key: 'highest_rating' },
            { title: 'LOWEST AVERAGE RATING', key: 'lowest_rating' },
            { title: 'LONGEST RUNTIME', key: 'longest_film' },
        ];

        mConfig.forEach(m => {
            const data = stats.milestones[m.key];
            const textValue = data && data.text ? data.text : 'N/A';

            mGridHtml += `
                <div class="stat-card milestone-card milestone-layout">
                    <span class="milestone-label">${h(m.title)}</span>
                    ${posterImage(
                        data || {},
                        'milestone-poster milestone-image'
                    )}
                    <div class="milestone-value">${h(textValue)}</div>
                </div>
            `;
        });

        mGrid.innerHTML = mGridHtml;
    }

    if (stats.differences) {
        const renderDiffs = (container, data, isPositive) => {
            if (!container) return;

            let diffHtml = '';

            data.forEach((m, index) => {
                const posterHTML = posterImage(m, 'difference-poster');
                const sign = isPositive ? '+' : '';
                const diffLabel = `${sign}${m.diff.toFixed(1)} ★`;

                diffHtml += `
                    <div class="leaderboard-item static-row">
                        <div class="leaderboard-left">
                            ${posterHTML}
                            <div class="difference-copy">
                                <span class="leaderboard-name difference-title">
                                    ${index + 1}. ${h(m.title)} (${h(m.year)})
                                </span>
                                <span class="difference-meta">
                                    You: ${m.user_rating}★ |
                                    TMDB: ${m.tmdb_rating}★
                                </span>
                            </div>
                        </div>
                        <span class="leaderboard-count difference-score ${
                            isPositive ? 'text-green' : 'text-orange'
                        }">${diffLabel}</span>
                    </div>
                `;
            });

            container.innerHTML = diffHtml;
        };

        renderDiffs(
            document.getElementById('diff-positive-list'),
            stats.differences.positive,
            true
        );

        renderDiffs(
            document.getElementById('diff-negative-list'),
            stats.differences.negative,
            false
        );
    }

    const toggle = document.getElementById('rewatch-toggle');

    if (fromUpload) toggle.checked = false;

    toggle.onchange = function () {
        const isTotal = toggle.checked;

        renderCastList(
            'actors-list',
            isTotal ? stats.top_actors_total : stats.top_actors_unique,
            '👤',
            isTotal ? 'total_count' : 'unique_count'
        );

        renderCastList(
            'directors-list',
            isTotal
                ? stats.top_directors_total
                : stats.top_directors_unique,
            '🎬',
            isTotal ? 'total_count' : 'unique_count'
        );
    };

    toggle.onchange();

    const ratedConfig = [
        {
            id: 'rated-actors-list',
            data: stats.top_rated_actors_list,
            icon: '👤',
        },
        {
            id: 'rated-directors-list',
            data: stats.top_rated_directors_list,
            icon: '🎬',
        },
    ];

    ratedConfig.forEach(cfg => {
        const listEl = document.getElementById(cfg.id);
        if (!listEl) return;

        let ratedHtml = '';

        cfg.data.forEach((person, index) => {
            const personId = encodeURIComponent(
                person.id || person.name
            );

            state.people[personId] = person;

            const avatarHTML = person.image_url
                ? `
                    <img src="${h(imageURL(person.image_url))}"
                         class="leaderboard-avatar"
                         alt="${h(person.name)}" loading="lazy">
                `
                : `
                    <div class="leaderboard-avatar-fallback">
                        ${cfg.icon}
                    </div>
                `;

            const countLabel = `
                ★ ${person.avg_rating}
                <span class="rating-sample">(${person.count})</span>
            `;

            ratedHtml += `
                <button type="button" class="leaderboard-item"
                        data-profile="${personId}">
                    <div class="leaderboard-left">
                        ${avatarHTML}
                        <span class="leaderboard-name">
                            ${index + 1}. ${h(person.name)}
                        </span>
                    </div>
                    <span class="leaderboard-count">${countLabel}</span>
                    ${generateTooltipHTML(person)}
                </button>
            `;
        });

        listEl.innerHTML = ratedHtml;
    });

    const langListEl = document.getElementById('languages-list');
    const extraLangEl = document.getElementById('extra-languages');
    const toggleLangBtn = document.getElementById('toggle-languages-btn');

    if (
        langListEl &&
        extraLangEl &&
        toggleLangBtn &&
        stats.language_stats
    ) {
        let mainLangHtml = '';
        let extraLangHtml = '';

        toggleLangBtn.style.display =
            stats.language_stats.length <= 10 ? 'none' : 'block';

        stats.language_stats.forEach((lang, index) => {
            const code = languageToCountryCode[lang.Language];
            const safeLangName = encodeURIComponent(lang.Language);

            const iconHTML = code
                ? `
                    <img src="https://flagcdn.com/w40/${code}.png"
                         alt="${h(lang.Language)} flag"
                         loading="lazy" class="language-flag">
                `
                : '<span class="language-fallback">🌐</span>';

            const itemHTML = `
                <button type="button" class="leaderboard-item"
                        data-language="${safeLangName}">
                    <div class="leaderboard-left">
                        <div class="language-icon">${iconHTML}</div>
                        <span class="leaderboard-name">
                            ${index + 1}. ${h(lang.Language)}
                        </span>
                    </div>
                    <span class="leaderboard-count">
                        ${lang.Count} films
                    </span>
                </button>
            `;

            if (index < 10) {
                mainLangHtml += itemHTML;
            } else {
                extraLangHtml += itemHTML;
            }
        });

        langListEl.innerHTML = mainLangHtml;
        extraLangEl.innerHTML = extraLangHtml;

        toggleLangBtn.onclick = function () {
            if (extraLangEl.classList.contains('hidden')) {
                extraLangEl.classList.remove('hidden');
                toggleLangBtn.innerText = 'Show Less ↑';
            } else {
                extraLangEl.classList.add('hidden');
                toggleLangBtn.innerText = 'Show More ↓';
            }
        };
    }

    renderCharts(stats, showYearProfile);

    if (
        !fromUpload &&
        document.getElementById('map-tab').classList.contains('active')
    ) {
        drawMap(stats.country_stats, showCountryProfile);
    }
}

function showProfile(personId) {
    const person = state.people[personId];
    if (!person) return;

    document.getElementById('profile-name').innerText = person.name;
    document.getElementById('profile-bio').innerText =
        person.biography ||
        'No biography data available for this person.';

    const imgEl = document.getElementById('profile-image');

    if (person.image_url) {
        imgEl.src = imageURL(person.image_url);
        imgEl.style.display = 'block';
    } else {
        imgEl.style.display = 'none';
    }

    state.grid.films = person.films || person.top_films || [];
    state.grid.id = 'profile-movies-grid';

    document.getElementById('sort-profile').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen(
        'dashboard-screen',
        'profile-screen',
        () => window.scrollTo(0, 0)
    );
}

function showYearProfile(year) {
    const yData = state.years[year];

    if (!yData || !yData.films || yData.films.length === 0) {
        return;
    }

    document.getElementById('year-title').innerText = year;
    document.getElementById('year-subtitle').innerText = year;
    document.getElementById('year-stats').innerText =
        `${yData.count} films watched • ★ ${yData.avg_rating} Avg Rating`;

    state.grid.films = yData.films;
    state.grid.id = 'year-movies-grid';

    document.getElementById('sort-year').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen(
        'dashboard-screen',
        'year-screen',
        () => window.scrollTo(0, 0)
    );
}

function showCountryProfile(countryName) {
    const cData = state.stats.country_stats.find(
        country => country.Country === countryName
    );

    if (!cData || !cData.films || cData.films.length === 0) {
        return;
    }

    const displayTitle = countryName === 'United States of America'
        ? 'United States'
        : countryName;

    document.getElementById('country-title').innerText = displayTitle;
    document.getElementById('country-stats').innerText =
        `${cData.Count} films watched`;

    state.grid.films = cData.films;
    state.grid.id = 'country-movies-grid';

    document.getElementById('sort-country').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen(
        'dashboard-screen',
        'country-screen',
        () => window.scrollTo(0, 0)
    );
}

function showLanguageProfile(languageName) {
    const lData = state.stats.language_stats.find(
        language => language.Language === languageName
    );

    if (!lData || !lData.films || lData.films.length === 0) {
        return;
    }

    document.getElementById('language-title').innerText = languageName;
    document.getElementById('language-stats').innerText =
        `${lData.Count} films watched`;

    state.grid.films = lData.films;
    state.grid.id = 'language-movies-grid';

    document.getElementById('sort-language').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen(
        'dashboard-screen',
        'language-screen',
        () => window.scrollTo(0, 0)
    );
}

document.getElementById('back-to-dashboard').addEventListener(
    'click',
    () => transitionScreen('profile-screen', 'dashboard-screen')
);

document.getElementById('back-to-dashboard-from-year').addEventListener(
    'click',
    () => transitionScreen('year-screen', 'dashboard-screen')
);

document.getElementById('back-to-dashboard-from-country').addEventListener(
    'click',
    () => transitionScreen('country-screen', 'dashboard-screen')
);

document.getElementById('back-to-dashboard-from-language').addEventListener(
    'click',
    () => transitionScreen('language-screen', 'dashboard-screen')
);

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;

        document.querySelectorAll('.tab-btn').forEach(button => {
            button.classList.remove('active');
            button.setAttribute('aria-selected', 'false');
            button.tabIndex = -1;
        });

        btn.setAttribute('aria-selected', 'true');
        btn.tabIndex = 0;
        btn.classList.add('active');

        const targetId = btn.getAttribute('data-target');
        const targetContent = document.getElementById(targetId);
        const currentContent = document.querySelector(
            '.tab-content.active'
        );

        if (currentContent) {
            currentContent.style.transition =
                'opacity 0.2s ease, transform 0.2s ease';
            currentContent.style.opacity = '0';
            currentContent.style.transform = 'translateY(15px)';

            setTimeout(() => {
                currentContent.classList.remove('active');
                currentContent.classList.add('hidden');

                targetContent.classList.remove('hidden');
                targetContent.classList.add('active');

                targetContent.style.opacity = '0';
                targetContent.style.transform = 'translateY(15px)';
                void targetContent.offsetWidth;

                targetContent.style.transition =
                    'opacity 0.3s ease, transform 0.3s ease';
                targetContent.style.opacity = '1';
                targetContent.style.transform = 'translateY(0)';

                if (targetId === 'map-tab' && state.stats) {
                    drawMap(
                        state.stats.country_stats,
                        showCountryProfile
                    );

                    setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 50);
                }
            }, 200);
        }
    });
});

document.addEventListener('click', event => {
    const profile = event.target.closest('[data-profile]');
    if (profile) showProfile(profile.dataset.profile);

    const language = event.target.closest('[data-language]');

    if (language) {
        showLanguageProfile(
            decodeURIComponent(language.dataset.language)
        );
    }
});

const tabs = [...document.querySelectorAll('.tab-btn')];

for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('keydown', event => {
        let next;

        if (event.key === 'ArrowRight') {
            next = (index + 1) % tabs.length;
        }

        if (event.key === 'ArrowLeft') {
            next = (index + tabs.length - 1) % tabs.length;
        }

        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;

        if (next !== undefined) {
            event.preventDefault();
            tabs[next].focus();
            tabs[next].click();
        }
    });
}

function updateYearControls(stats) {
    const selector = document.getElementById('watch-year-filter');

    if (selector) {
        const years = stats.available_years || [];

        selector.innerHTML =
            '<option value="all">All time</option>' +
            years.map(year =>
                `<option value="${h(year)}">${h(year)}</option>`
            ).join('');

        selector.value = stats.selected_year == null
            ? 'all'
            : String(stats.selected_year);

        selector.disabled = years.length === 0;
    }

    const period = document.getElementById('dashboard-period');

    if (period) {
        period.textContent = stats.selected_year == null
            ? 'Here are your all-time cinema statistics.'
            : `Your cinema statistics for films watched in ${stats.selected_year}.`;
    }

    const heading = document.getElementById('top-films-heading');

    if (heading) {
        heading.textContent = stats.selected_year == null
            ? '🏆 Top 20 Films'
            : `🏆 Highest-rated films watched in ${stats.selected_year}`;
    }

    const note = document.getElementById('year-filter-note');

    if (note) {
        note.textContent = stats.filter_note || '';
    }
}

let yearFilterBusy = false;
const watchYearSelector = document.getElementById('watch-year-filter');

if (watchYearSelector) {
    watchYearSelector.addEventListener('change', async () => {
        if (yearFilterBusy || !state.stats) return;

        yearFilterBusy = true;
        watchYearSelector.disabled = true;

        const status = document.getElementById('year-filter-status');
        if (status) status.textContent = 'Updating statistics…';

        try {
            const year = watchYearSelector.value === 'all'
                ? null
                : Number(watchYearSelector.value);

            const response = await eel.filter_year(year)();

            if (response.status !== 'success') {
                throw new Error(
                    response.message ||
                    'The filter could not be applied.'
                );
            }

            buildDashboard(response.data, false);
            if (status) status.textContent = '';
        } catch (error) {
            watchYearSelector.value = state.stats.selected_year == null
                ? 'all'
                : String(state.stats.selected_year);

            if (status) status.textContent = error.message;
        } finally {
            yearFilterBusy = false;
            watchYearSelector.disabled =
                !(state.stats.available_years || []).length;
        }
    });
}