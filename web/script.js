// --- GLOBAL DATA STORES ---
let selectedFile = null;
window.personData = {}; 
window.yearData = {};   
window.globalStats = null; 

let countChartInstance = null;
let ratingChartInstance = null;
let genreChartInstance = null;
let ratingDistChartInstance = null;
let vectorMapInstance = null; // Used to track map rendering state

let currentGridFilms = [];
let currentGridId = "";

const languageToCountryCode = {
    "English": "us", "Japanese": "jp", "French": "fr", "Korean": "kr", "Spanish": "es", "Italian": "it", 
    "German": "de", "Mandarin": "cn", "Cantonese": "hk", "Russian": "ru", "Portuguese": "br", "Hindi": "in",
    "Arabic": "sa", "Swedish": "se", "Danish": "dk", "Dutch": "nl", "Polish": "pl", "Turkish": "tr", 
    "Persian": "ir", "Norwegian": "no", "Finnish": "fi", "Thai": "th", "Indonesian": "id", "Vietnamese": "vn",
    "Greek": "gr", "Czech": "cz", "Hungarian": "hu", "Hebrew": "il", "Tagalog": "ph", "Romanian": "ro", 
    "Ukrainian": "ua", "Malayalam": "in", "Tamil": "in", "Telugu": "in", "Bengali": "in", "Urdu": "pk"
};

// --- ANIMATION HELPER ---
function transitionScreen(hideId, showId, callback) {
    const hideEl = document.getElementById(hideId);
    const showEl = document.getElementById(showId);

    hideEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    hideEl.style.opacity = '0';
    hideEl.style.transform = 'translateY(15px)';

    setTimeout(() => {
        hideEl.classList.add('hidden');
        hideEl.classList.remove('active');
        
        showEl.classList.remove('hidden');
        showEl.classList.add('active');
        
        showEl.style.opacity = '0';
        showEl.style.transform = 'translateY(15px)';
        void showEl.offsetWidth; // force reflow
        
        showEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        showEl.style.opacity = '1';
        showEl.style.transform = 'translateY(0)';

        if (callback) callback();
    }, 200);
}

// --- FILE UPLOAD ---
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const generateBtn = document.getElementById('generate-btn');
const statusLabel = document.getElementById('status-label');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.getElementById('progress-container');

fileInput.addEventListener('change', (event) => {
    selectedFile = event.target.files[0];
    if (selectedFile) {
        fileLabel.innerText = `Selected: ${selectedFile.name}`;
        generateBtn.disabled = false;
        generateBtn.classList.remove('disabled');
        statusLabel.innerText = "File staged! Ready to process.";
        statusLabel.style.color = "var(--green)";
    }
});

eel.expose(updateProgress);
function updateProgress(current, total) {
    let percentage = (current / total) * 100;
    progressBar.style.width = percentage + '%';
    statusLabel.innerText = `Fetching TMDb data... (${current}/${total})`;
}

generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.classList.add('disabled');
    progressContainer.classList.remove('hidden');
    statusLabel.innerText = "Uploading zip file to local engine...";
    statusLabel.style.color = "var(--orange)";
    
    const formData = new FormData();
    formData.append("file", selectedFile);
    
    try {
        let uploadRes = await fetch('/upload', { method: 'POST', body: formData });
        if (uploadRes.ok) {
            statusLabel.innerText = "Starting parallel data fetch...";
            let response = await eel.process_data()();
            if (response.status === "success") {
                buildDashboard(response.data);
            } else {
                statusLabel.innerText = `Error: ${response.message}`;
                statusLabel.style.color = "red";
            }
        } else {
            statusLabel.innerText = "Error uploading file.";
            statusLabel.style.color = "red";
        }
    } catch (err) {
        statusLabel.innerText = `Upload Error: ${err.message}`;
        statusLabel.style.color = "red";
    }
});

// --- SORTING ENGINE ---
function sortAndRenderGrid(sortType) {
    let sorted = [...currentGridFilms];
    if (sortType === 'rating') {
        sorted.sort((a, b) => b.rating - a.rating || b.play_count - a.play_count);
    } else if (sortType === 'avg_rating') {
        sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    } else if (sortType === 'newest') {
        sorted.sort((a, b) => b.year - a.year);
    } else if (sortType === 'oldest') {
        sorted.sort((a, b) => a.year - b.year);
    }

    const grid = document.getElementById(currentGridId);
    let htmlContent = ""; // PERFORMANCE FIX 3: Prevent DOM Thrashing
    
    sorted.forEach(film => {
        let overlayText = `${film.title}<br>${film.rating > 0 ? film.rating + '★' : ''}`;
        if (film.poster_url) {
            // PERFORMANCE FIX 4: Added loading="lazy"
            htmlContent += `<div class="poster-card small"><img src="${film.poster_url}" class="poster-img" alt="${film.title}" loading="lazy"><div class="poster-overlay">${overlayText}</div></div>`;
        } else {
            htmlContent += `<div class="poster-card small"><div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.title}</div><div class="poster-overlay">${overlayText}</div></div>`;
        }
    });
    grid.innerHTML = htmlContent;
}

document.querySelectorAll('.sort-dropdown').forEach(dropdown => {
    dropdown.addEventListener('change', (e) => {
        sortAndRenderGrid(e.target.value);
    });
});

// --- HELPER HTML ---
function generateTooltipHTML(person) {
    let topFilms = person.films ? person.films.slice(0, 10) : (person.top_films ? person.top_films.slice(0, 10) : []);
    let totalFilms = person.films ? person.films.length : (person.top_films ? person.top_films.length + (person.remaining || 0) : 0);
    let remaining = Math.max(0, totalFilms - 10);
    
    let postersHTML = topFilms.map(film => {
        let titleTag = `${film.title}${film.rating > 0 ? ` (${film.rating}★)` : ''}`;
        if (film.poster_url) {
            // PERFORMANCE FIX 4: Added loading="lazy"
            return `<img src="${film.poster_url}" class="tooltip-poster" alt="${film.title}" title="${titleTag}" loading="lazy">`;
        } else {
            return `<div class="tooltip-poster-fallback" title="${titleTag}">?</div>`;
        }
    }).join('');

    let moreHTML = remaining > 0 ? `<div class="tooltip-more">+${remaining} more</div>` : '';
    return `<div class="hover-tooltip"><div class="tooltip-posters">${postersHTML}</div>${moreHTML}</div>`;
}

const getOrCreateChartTooltip = (chart) => {
    let tooltipEl = chart.canvas.parentNode.querySelector('div.chartjs-custom-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'chartjs-custom-tooltip';
        tooltipEl.style.background = '#14181c';
        tooltipEl.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        tooltipEl.style.padding = '10px';
        tooltipEl.style.borderRadius = '8px';
        tooltipEl.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.8)';
        tooltipEl.style.position = 'absolute';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.transform = 'translate(-50%, 0)';
        tooltipEl.style.transition = 'opacity 0.2s ease, top 0.2s ease, left 0.2s ease';
        tooltipEl.style.zIndex = 1000;
        tooltipEl.style.width = 'max-content';
        chart.canvas.parentNode.appendChild(tooltipEl);
    }
    return tooltipEl;
};

const customChartTooltipHandler = (context) => {
    const { chart, tooltip } = context;
    const tooltipEl = getOrCreateChartTooltip(chart);

    if (tooltip.opacity === 0) {
        tooltipEl.style.opacity = 0;
        return;
    }

    if (tooltip.body) {
        const year = tooltip.title[0];
        const yData = window.yearData[year];
        const datasetLabel = tooltip.dataPoints[0].dataset.label; 
        const barColor = tooltip.dataPoints[0].dataset.backgroundColor; 
        
        if (!yData || !yData.films || yData.films.length === 0) {
            tooltipEl.innerHTML = `<div style="color: #89a; font-size: 0.9em; font-weight: bold; text-align: center;"><span style="color: ${barColor};">${year}</span><br>0 films</div>`;
        } else {
            let topFilms = yData.films.slice(0, 4); 
            let remaining = Math.max(0, yData.films.length - 4);
            
            let postersHTML = topFilms.map(film => {
                let titleTag = `${film.title}${film.rating > 0 ? ` (${film.rating}★)` : ''}`;
                if (film.poster_url) {
                    // PERFORMANCE FIX 4: Added loading="lazy"
                    return `<img src="${film.poster_url}" class="tooltip-poster" alt="${film.title}" title="${titleTag}" loading="lazy">`;
                } else {
                    return `<div class="tooltip-poster-fallback" title="${titleTag}">?</div>`;
                }
            }).join('');

            let moreHTML = remaining > 0 ? `<div class="tooltip-more" style="margin-top: 5px;">+${remaining} more</div>` : '';
            let metricText = datasetLabel === 'Films Watched' ? `${yData.count} films` : `★ ${yData.avg_rating}`;

            tooltipEl.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold; color: #fff; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
                    <span style="color: ${barColor}; font-size: 1.1em;">${year}</span> 
                    <span style="color: #89a; font-size: 0.85em; font-weight: normal; margin-left: 5px;">${metricText}</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(${Math.min(4, yData.films.length)}, 1fr); gap: 5px;">${postersHTML}</div>
                ${moreHTML}
            `;
        }
    }

    const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
    tooltipEl.style.opacity = 1;
    tooltipEl.style.left = positionX + tooltip.caretX + 'px';
    
    let finalTop = positionY + tooltip.caretY - tooltipEl.offsetHeight - 15;
    if (finalTop < 0) finalTop = positionY + tooltip.caretY + 15;
    tooltipEl.style.top = finalTop + 'px';
};

function drawMap(countryData) {
    if (vectorMapInstance) {
        document.getElementById('regions_div').innerHTML = "";
    }

    const nameToCode = {
        "United States": "US", "United States of America": "US", "Canada": "CA", "United Kingdom": "GB",
        "France": "FR", "Germany": "DE", "Japan": "JP", "South Korea": "KR", "Italy": "IT",
        "Spain": "ES", "India": "IN", "China": "CN", "Australia": "AU", "Brazil": "BR",
        "Mexico": "MX", "Russia": "RU", "Sweden": "SE", "Denmark": "DK", "Ireland": "IE",
        "New Zealand": "NZ", "Netherlands": "NL", "Norway": "NO", "Poland": "PL",
        "Argentina": "AR", "Belgium": "BE", "Switzerland": "CH", "Austria": "AT",
        "Finland": "FI", "Czech Republic": "CZ", "Hungary": "HU", "Greece": "GR",
        "Turkey": "TR", "Taiwan": "TW", "Hong Kong": "HK", "South Africa": "ZA",
        "Iran": "IR", "Chile": "CL", "Colombia": "CO", "Portugal": "PT", "Romania": "RO",
        "Israel": "IL", "Thailand": "TH", "Indonesia": "ID", "Philippines": "PH"
    };

    let mapValues = {};
    let codeToName = {}; 

    if (countryData) {
        countryData.forEach(c => {
            let code = nameToCode[c.Country] || c.Country;
            mapValues[code] = c.Count;
            codeToName[code] = c.Country; 
        });
    }

    vectorMapInstance = new jsVectorMap({
        selector: '#regions_div',
        map: 'world',
        backgroundColor: 'transparent',
        zoomOnScroll: false,
        regionStyle: {
            initial: { fill: '#0a170f', stroke: 'rgba(255,255,255,0.1)', strokeWidth: 0.5 },
            hover: { fill: '#40bcf4', fillOpacity: 1 }
        },
        visualizeData: { scale: ['#184226', '#00E054'], values: mapValues },
        onRegionTooltipShow(event, tooltip, code) {
            let count = mapValues[code] || 0;
            let countryName = tooltip.text();
            if (countryName === "United States") countryName = "USA";

            tooltip.text(
                `<div style="text-align: center;">
                    <div style="font-weight: bold; color: #fff; font-size: 14px; margin-bottom: 5px;">${countryName}</div>
                    <div style="color: #9ab; font-size: 12px;">Films watched: ${count}</div>
                </div>`, 
                true
            );
        },
        onRegionClick(event, code) {
            let countryName = codeToName[code];
            if (countryName && mapValues[code] > 0) {
                showCountryProfile(countryName);
            }
        }
    });
}

function renderCastList(containerId, data, icon, countKey) {
    const listEl = document.getElementById(containerId);
    if (!listEl) return;
    
    let htmlContent = ""; // PERFORMANCE FIX 3: Prevent DOM Thrashing
    
    data.forEach((person, index) => {
        let personId = person.name.replace(/[^a-zA-Z0-9]/g, '-'); 
        window.personData[personId] = person;
        // PERFORMANCE FIX 4: Added loading="lazy"
        let avatarHTML = person.image_url 
            ? `<img src="${person.image_url}" class="leaderboard-avatar" alt="${person.name}" loading="lazy">` 
            : `<div class="leaderboard-avatar-fallback">${icon}</div>`;
            
        let countLabel = `${person[countKey]} films`;
        htmlContent += `
            <div class="leaderboard-item" onclick="showProfile('${personId}')">
                <div class="leaderboard-left">
                    ${avatarHTML}
                    <span class="leaderboard-name">${index + 1}. ${person.name}</span>
                </div>
                <span class="leaderboard-count">${countLabel}</span>
                ${generateTooltipHTML(person)}
            </div>
        `;
    });
    
    listEl.innerHTML = htmlContent;
}

// --- CORE APP ---
function buildDashboard(stats) {
    window.globalStats = stats;
    transitionScreen('upload-screen', 'dashboard-screen');

    const welcomeUser = document.getElementById('welcome-username');
    const welcomeAvatar = document.getElementById('welcome-avatar');
    
    if (stats.username && stats.username !== "User") {
        welcomeUser.innerText = stats.username.charAt(0).toUpperCase() + stats.username.slice(1);
    } else { welcomeUser.innerText = "Cinephile"; }

    if (stats.avatar_url) {
        welcomeAvatar.src = stats.avatar_url;
        welcomeAvatar.style.display = "block";
    }

    document.getElementById('stat-total').innerText = stats.total_watched;
    document.getElementById('stat-hours').innerText = stats.total_hours;
    document.getElementById('stat-countries').innerText = stats.total_countries;
    document.getElementById('stat-directors').innerText = stats.total_directors;

    const grid = document.getElementById('poster-grid');
    let gridHtml = ""; // PERFORMANCE FIX 3
    stats.top_20.forEach((film, index) => {
        const isTop4 = index < 4;
        let overlayText = `${film.Name} (${Math.floor(film.Year)})<br>Dir: ${film.director || 'Unknown'}`;
        if (film.poster_url) {
            // PERFORMANCE FIX 4
            gridHtml += `<div class="poster-card ${isTop4 ? 'large' : 'small'}"><img src="${film.poster_url}" class="poster-img" alt="${film.Name}" loading="lazy"><div class="poster-overlay">${overlayText}</div></div>`;
        } else {
            gridHtml += `<div class="poster-card ${isTop4 ? 'large' : 'small'}"><div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.Name}</div><div class="poster-overlay">${overlayText}</div></div>`;
        }
    });
    grid.innerHTML = gridHtml;

    if (stats.milestones) {
        const mGrid = document.getElementById('milestone-grid');
        let mGridHtml = ""; // PERFORMANCE FIX 3
        
        const mConfig = [
            { title: "MOST RECENT WATCH", key: "recent_watch" },
            { title: "NEWEST FILM WATCHED", key: "newest_film" },
            { title: "OLDEST FILM WATCHED", key: "oldest_film" },
            { title: "MOST REWATCHED", key: "most_rewatched" },
            { title: "MOST OBSCURE", key: "most_obscure" },
            { title: "MOST POPULAR", key: "most_popular" },
            { title: "HIGHEST AVERAGE RATING", key: "highest_rating" },
            { title: "LOWEST AVERAGE RATING", key: "lowest_rating" },
            { title: "LONGEST RUNTIME", key: "longest_film" }
        ];

        mConfig.forEach(m => {
            let data = stats.milestones[m.key]; 
            let posterSrc = data && data.poster_url ? data.poster_url : "https://via.placeholder.com/140x210/2c3440/89a?text=?";
            let textValue = data && data.text ? data.text : "N/A";

            // PERFORMANCE FIX 4: Add loading="lazy" to milestone images
            mGridHtml += `
                <div class="stat-card" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 20px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); box-sizing: border-box;">
                    <span style="font-size: 11px; color: #89a; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; display: block; margin-bottom: 12px;">${m.title}</span>
                    <img src="${posterSrc}" loading="lazy" style="width: 100px; height: 150px; object-fit: cover; border-radius: 6px; box-shadow: 0 8px 16px rgba(0,0,0,0.4); margin-bottom: 12px; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <div style="font-weight: bold; font-size: 14px; color: white; line-height: 1.4; max-width: 100%; overflow: hidden; text-overflow: ellipsis;">
                        ${textValue}
                    </div>
                </div>
            `;
        });
        mGrid.innerHTML = mGridHtml;
    }

    if (stats.differences) {
        const renderDiffs = (container, data, isPositive) => {
            if (!container) return;
            let diffHtml = ""; // PERFORMANCE FIX 3
            data.forEach((m, index) => {
                // PERFORMANCE FIX 4
                let posterHTML = `<img src="${m.poster_url || 'https://via.placeholder.com/45x68/2c3440/89a?text=?'}" loading="lazy" style="width: 45px; height: 68px; border-radius: 4px; object-fit: cover;">`;
                let sign = isPositive ? "+" : "";
                let diffLabel = `${sign}${m.diff.toFixed(1)} ★`;
                let color = isPositive ? "#00E054" : "#ff8000";
                
                diffHtml += `
                    <div class="leaderboard-item" style="cursor: default;">
                        <div class="leaderboard-left">
                            ${posterHTML}
                            <div style="display: flex; flex-direction: column; justify-content: center;">
                                <span class="leaderboard-name" style="margin-bottom: 4px;">${index + 1}. ${m.title} (${m.year})</span>
                                <span style="font-size: 12px; color: #89a;">You: ${m.user_rating}★ | TMDB: ${m.tmdb_rating}★</span>
                            </div>
                        </div>
                        <span class="leaderboard-count" style="color: ${color}; background: rgba(255,255,255,0.05); font-weight: bold;">${diffLabel}</span>
                    </div>
                `;
            });
            container.innerHTML = diffHtml;
        };
        renderDiffs(document.getElementById('diff-positive-list'), stats.differences.positive, true);
        renderDiffs(document.getElementById('diff-negative-list'), stats.differences.negative, false);
    }

    const toggle = document.getElementById('rewatch-toggle');
    toggle.checked = false; 
    toggle.onchange = function() {
        const isTotal = toggle.checked;
        renderCastList('actors-list', isTotal ? stats.top_actors_total : stats.top_actors_unique, '👤', isTotal ? 'total_count' : 'unique_count');
        renderCastList('directors-list', isTotal ? stats.top_directors_total : stats.top_directors_unique, '🎬', isTotal ? 'total_count' : 'unique_count');
    };
    toggle.onchange();

    const ratedConfig = [
        { id: 'rated-actors-list', data: stats.top_rated_actors_list, icon: '👤', isRated: true },
        { id: 'rated-directors-list', data: stats.top_rated_directors_list, icon: '🎬', isRated: true }
    ];
    ratedConfig.forEach(cfg => {
        const listEl = document.getElementById(cfg.id);
        if (!listEl) return;
        let ratedHtml = ""; // PERFORMANCE FIX 3
        cfg.data.forEach((person, index) => {
            let personId = person.name.replace(/[^a-zA-Z0-9]/g, '-'); 
            window.personData[personId] = person;
            // PERFORMANCE FIX 4
            let avatarHTML = person.image_url ? `<img src="${person.image_url}" class="leaderboard-avatar" alt="${person.name}" loading="lazy">` : `<div class="leaderboard-avatar-fallback">${cfg.icon}</div>`;
            let countLabel = `★ ${person.avg_rating} <span style="font-size: 0.8em; opacity: 0.7;">(${person.count})</span>`;
            ratedHtml += `
                <div class="leaderboard-item" onclick="showProfile('${personId}')">
                    <div class="leaderboard-left">
                        ${avatarHTML}
                        <span class="leaderboard-name">${index + 1}. ${person.name}</span>
                    </div>
                    <span class="leaderboard-count">${countLabel}</span>
                    ${generateTooltipHTML(person)}
                </div>
            `;
        });
        listEl.innerHTML = ratedHtml;
    });

    const langListEl = document.getElementById('languages-list');
    const extraLangEl = document.getElementById('extra-languages');
    const toggleLangBtn = document.getElementById('toggle-languages-btn');

    if (langListEl && extraLangEl && toggleLangBtn && stats.language_stats) {
        let mainLangHtml = ""; // PERFORMANCE FIX 3
        let extraLangHtml = "";
        
        if (stats.language_stats.length <= 10) {
            toggleLangBtn.style.display = "none";
        } else {
            toggleLangBtn.style.display = "block";
        }

        stats.language_stats.forEach((lang, index) => {
            let code = languageToCountryCode[lang.Language];
            let safeLangName = lang.Language.replace(/'/g, "\\'");
            // PERFORMANCE FIX 4
            let iconHTML = code ? `<img src="https://flagcdn.com/w40/${code}.png" style="width: 24px; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.5);" alt="${lang.Language} flag" loading="lazy">` : `<span style="font-size: 18px; color: #89a;">🌐</span>`;
            
            let itemHTML = `
                <div class="leaderboard-item" onclick="showLanguageProfile('${safeLangName}')">
                    <div class="leaderboard-left">
                        <div style="width: 30px; display: flex; justify-content: center; align-items: center;">${iconHTML}</div>
                        <span class="leaderboard-name">${index + 1}. ${lang.Language}</span>
                    </div>
                    <span class="leaderboard-count">${lang.Count} films</span>
                </div>
            `;
            if (index < 10) { mainLangHtml += itemHTML; } 
            else { extraLangHtml += itemHTML; }
        });
        
        langListEl.innerHTML = mainLangHtml;
        extraLangEl.innerHTML = extraLangHtml;

        toggleLangBtn.onclick = function() {
            if (extraLangEl.classList.contains('hidden')) {
                extraLangEl.classList.remove('hidden');
                toggleLangBtn.innerText = "Show Less ↑";
            } else {
                extraLangEl.classList.add('hidden');
                toggleLangBtn.innerText = "Show More ↓";
            }
        };
    }

    // --- CHART ENGINE ---
    Chart.defaults.color = '#89a';
    
    if (stats.yearly_stats && stats.yearly_stats.length > 0) {
        const years = stats.yearly_stats.map(d => d.year);
        const counts = stats.yearly_stats.map(d => d.count);
        const ratings = stats.yearly_stats.map(d => d.avg_rating);
        stats.yearly_stats.forEach(y => { window.yearData[y.year] = y; });

        if (countChartInstance) countChartInstance.destroy();
        if (ratingChartInstance) ratingChartInstance.destroy();

        const baseChartOptions = { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { display: false }, tooltip: { enabled: false, position: 'nearest', external: customChartTooltipHandler } }, 
            scales: { 
                x: { grid: { display: false } }, 
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } } 
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    showYearProfile(years[index]);
                }
            },
            onHover: (event, elements) => {
                event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            }
        };

        countChartInstance = new Chart(document.getElementById('yearCountChart').getContext('2d'), {
            type: 'bar',
            data: { labels: years, datasets: [{ data: counts, backgroundColor: '#00E054', borderRadius: 4 }] },
            options: baseChartOptions
        });

        const ratingOptions = JSON.parse(JSON.stringify(baseChartOptions));
        ratingOptions.scales.y.max = 5;
        ratingOptions.plugins.tooltip.external = baseChartOptions.plugins.tooltip.external;
        ratingOptions.onClick = baseChartOptions.onClick; 
        ratingOptions.onHover = baseChartOptions.onHover;

        ratingChartInstance = new Chart(document.getElementById('yearRatingChart').getContext('2d'), {
            type: 'bar',
            data: { labels: years, datasets: [{ data: ratings, backgroundColor: '#40bcf4', borderRadius: 4 }] },
            options: ratingOptions
        });
    }

    if (stats.genre_stats && stats.genre_stats.length > 0) {
        if (genreChartInstance) genreChartInstance.destroy();
        const genreLabels = stats.genre_stats.map(g => g.Genre);
        const genreData = stats.genre_stats.map(g => g.Count);
        const colors = ['#00E054', '#40bcf4', '#ff8000', '#9b59b6', '#e74c3c', '#f1c40f', '#1abc9c', '#3498db', '#e67e22', '#2ecc71', '#89a', '#ffffff'];

        genreChartInstance = new Chart(document.getElementById('genreChart').getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: genreLabels,
                datasets: [{ data: genreData, backgroundColor: colors, borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#89a', boxWidth: 12 } }
                }
            }
        });
    }

    if (stats.rating_dist && stats.rating_dist.length > 0) {
        if (ratingDistChartInstance) ratingDistChartInstance.destroy();
        const rLabels = stats.rating_dist.map(r => r.rating + "★");
        const rData = stats.rating_dist.map(r => r.count);

        ratingDistChartInstance = new Chart(document.getElementById('ratingCurveChart').getContext('2d'), {
            type: 'bar',
            data: { labels: rLabels, datasets: [{ data: rData, backgroundColor: '#ff8000', borderRadius: 4, barPercentage: 0.9, categoryPercentage: 1.0 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } }
                }
            }
        });
    }
}

// --- SCREEN RENDERING ---
function showProfile(personId) {
    const person = window.personData[personId];
    if (!person) return;
    
    document.getElementById('profile-name').innerText = person.name;
    document.getElementById('profile-bio').innerText = person.biography || "No biography data available for this person.";
    const imgEl = document.getElementById('profile-image');
    if (person.image_url) { imgEl.src = person.image_url; imgEl.style.display = "block"; } else { imgEl.style.display = "none"; }

    currentGridFilms = person.films || person.top_films || [];
    currentGridId = 'profile-movies-grid';
    document.getElementById('sort-profile').value = 'rating';
    sortAndRenderGrid('rating');
    
    transitionScreen('dashboard-screen', 'profile-screen', () => window.scrollTo(0, 0));
}

function showYearProfile(year) {
    const yData = window.yearData[year];
    if (!yData || !yData.films || yData.films.length === 0) return; 

    document.getElementById('year-title').innerText = year;
    document.getElementById('year-subtitle').innerText = year;
    document.getElementById('year-stats').innerText = `${yData.count} films watched • ★ ${yData.avg_rating} Avg Rating`;

    currentGridFilms = yData.films;
    currentGridId = 'year-movies-grid';
    document.getElementById('sort-year').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen('dashboard-screen', 'year-screen', () => window.scrollTo(0, 0));
}

function showCountryProfile(countryName) {
    const cData = window.globalStats.country_stats.find(c => c.Country === countryName);
    if (!cData || !cData.films || cData.films.length === 0) return;

    let displayTitle = countryName === "United States of America" ? "United States" : countryName;
    document.getElementById('country-title').innerText = displayTitle;
    document.getElementById('country-stats').innerText = `${cData.Count} films watched`;

    currentGridFilms = cData.films;
    currentGridId = 'country-movies-grid';
    document.getElementById('sort-country').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen('dashboard-screen', 'country-screen', () => window.scrollTo(0, 0));
}

function showLanguageProfile(languageName) {
    const lData = window.globalStats.language_stats.find(l => l.Language === languageName);
    if (!lData || !lData.films || lData.films.length === 0) return;

    document.getElementById('language-title').innerText = languageName;
    document.getElementById('language-stats').innerText = `${lData.Count} films watched`;

    currentGridFilms = lData.films;
    currentGridId = 'language-movies-grid';
    document.getElementById('sort-language').value = 'rating';
    sortAndRenderGrid('rating');

    transitionScreen('dashboard-screen', 'language-screen', () => window.scrollTo(0, 0));
}

// --- NAVIGATION LISTENERS ---
document.getElementById('back-to-dashboard').addEventListener('click', () => { transitionScreen('profile-screen', 'dashboard-screen'); });
document.getElementById('back-to-dashboard-from-year').addEventListener('click', () => { transitionScreen('year-screen', 'dashboard-screen'); });
document.getElementById('back-to-dashboard-from-country').addEventListener('click', () => { transitionScreen('country-screen', 'dashboard-screen'); });
document.getElementById('back-to-dashboard-from-language').addEventListener('click', () => { transitionScreen('language-screen', 'dashboard-screen'); });

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const targetId = btn.getAttribute('data-target');
        const targetContent = document.getElementById(targetId);
        const currentContent = document.querySelector('.tab-content.active');
        
        if (currentContent) {
            currentContent.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            currentContent.style.opacity = '0';
            currentContent.style.transform = 'translateY(15px)';
            
            setTimeout(() => {
                currentContent.classList.remove('active');
                currentContent.classList.add('hidden');
                
                targetContent.classList.remove('hidden');
                targetContent.classList.add('active');
                targetContent.style.opacity = '0';
                targetContent.style.transform = 'translateY(15px)';
                void targetContent.offsetWidth; // Reflow
                
                targetContent.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                targetContent.style.opacity = '1';
                targetContent.style.transform = 'translateY(0)';
                
                if (targetId === 'map-tab' && window.globalStats) {
                    drawMap(window.globalStats.country_stats);
                    // Slight delay to ensure element geometry is final for jsVectorMap calculations
                    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                }
            }, 200);
        }
    });
});