// --- GLOBAL DATA STORES ---
let selectedFile = null;
window.personData = {}; 
window.yearData = {};   
window.globalStats = null; 
let countChartInstance = null;
let ratingChartInstance = null;

// --- FLAG DICTIONARY (ISO Codes for FlagCDN) ---
const languageToCountryCode = {
    "English": "us", "Japanese": "jp", "French": "fr", "Korean": "kr",
    "Spanish": "es", "Italian": "it", "German": "de", "Mandarin": "cn",
    "Cantonese": "hk", "Russian": "ru", "Portuguese": "br", "Hindi": "in",
    "Arabic": "sa", "Swedish": "se", "Danish": "dk", "Dutch": "nl",
    "Polish": "pl", "Turkish": "tr", "Persian": "ir", "Norwegian": "no",
    "Finnish": "fi", "Thai": "th", "Indonesian": "id", "Vietnamese": "vn",
    "Greek": "gr", "Czech": "cz", "Hungarian": "hu", "Hebrew": "il",
    "Tagalog": "ph", "Romanian": "ro", "Ukrainian": "ua", "Malayalam": "in",
    "Tamil": "in", "Telugu": "in", "Bengali": "in", "Urdu": "pk"
};

// 1. Hook up the UI elements
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const generateBtn = document.getElementById('generate-btn');
const statusLabel = document.getElementById('status-label');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.getElementById('progress-container');

// 2. Safely stage the file
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

// 3. Progress Bar Connection (Exposed to Python)
eel.expose(updateProgress);
function updateProgress(current, total) {
    let percentage = (current / total) * 100;
    progressBar.style.width = percentage + '%';
    statusLabel.innerText = `Fetching TMDb data... (${current}/${total})`;
}

// 4. Handle Generating Stats
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

// 5. Helper: Generate Leaderboard Tooltips
function generateTooltipHTML(person) {
    let topFilms = person.films ? person.films.slice(0, 10) : (person.top_films ? person.top_films.slice(0, 10) : []);
    let totalFilms = person.films ? person.films.length : (person.top_films ? person.top_films.length + (person.remaining || 0) : 0);
    let remaining = Math.max(0, totalFilms - 10);
    
    let postersHTML = topFilms.map(film => {
        let titleTag = `${film.title}${film.rating > 0 ? ` (${film.rating}★)` : ''}`;
        if (film.poster_url) {
            return `<img src="${film.poster_url}" class="tooltip-poster" alt="${film.title}" title="${titleTag}">`;
        } else {
            return `<div class="tooltip-poster-fallback" title="${titleTag}">?</div>`;
        }
    }).join('');

    let moreHTML = remaining > 0 ? `<div class="tooltip-more">+${remaining} more</div>` : '';

    return `
        <div class="hover-tooltip">
            <div class="tooltip-posters">${postersHTML}</div>
            ${moreHTML}
        </div>
    `;
}

// --- Custom Chart.js HTML Tooltip Logic ---
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
                    return `<img src="${film.poster_url}" class="tooltip-poster" alt="${film.title}" title="${titleTag}">`;
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


// --- INTERACTIVE MAP DRAWING LOGIC (jsVectorMap) ---
function drawMap(countryData) {
    const container = document.getElementById('regions_div');
    container.innerHTML = ""; 

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

    new jsVectorMap({
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


// 6. Main Dashboard Building Function
function buildDashboard(stats) {
    window.globalStats = stats;

    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
    
    // --- Set Welcome Section ---
    const welcomeUser = document.getElementById('welcome-username');
    const welcomeAvatar = document.getElementById('welcome-avatar');
    
    if (stats.username && stats.username !== "User") {
        welcomeUser.innerText = stats.username;
    } else {
        welcomeUser.innerText = "Cinephile";
    }

    if (stats.avatar_url) {
        welcomeAvatar.src = stats.avatar_url;
        welcomeAvatar.style.display = "block";
    } else {
        welcomeAvatar.style.display = "none";
    }

    document.getElementById('stat-total').innerText = stats.total_watched;
    document.getElementById('stat-hours').innerText = stats.total_hours;
    document.getElementById('stat-countries').innerText = stats.total_countries;
    document.getElementById('stat-directors').innerText = stats.total_directors;
    
    // Render Top 20 Posters
    const grid = document.getElementById('poster-grid');
    grid.innerHTML = ""; 
    stats.top_20.forEach((film, index) => {
        const isTop4 = index < 4;
        const card = document.createElement('div');
        card.className = `poster-card ${isTop4 ? 'large' : 'small'}`;
        let overlayText = `${film.Name} (${Math.floor(film.Year)})<br>Dir: ${film.director || 'Unknown'}`;
        
        if (film.poster_url) {
            card.innerHTML = `<img src="${film.poster_url}" class="poster-img" alt="${film.Name}"><div class="poster-overlay">${overlayText}</div>`;
        } else {
            card.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.Name}</div><div class="poster-overlay">${overlayText}</div>`;
        }
        grid.appendChild(card);
    });

    // Populate Leaderboards
    const listConfig = [
        { id: 'actors-list', data: stats.top_actors_list, icon: '👤' },
        { id: 'directors-list', data: stats.top_directors_list, icon: '🎬' },
        { id: 'rated-actors-list', data: stats.top_rated_actors_list, icon: '👤', isRated: true },
        { id: 'rated-directors-list', data: stats.top_rated_directors_list, icon: '🎬', isRated: true }
    ];

    listConfig.forEach(cfg => {
        const listEl = document.getElementById(cfg.id);
        if (!listEl) return;
        
        listEl.innerHTML = "";
        cfg.data.forEach((person, index) => {
            let personId = person.name.replace(/[^a-zA-Z0-9]/g, '-'); 
            window.personData[personId] = person;

            let avatarHTML = person.image_url 
                ? `<img src="${person.image_url}" class="leaderboard-avatar" alt="${person.name}">` 
                : `<div class="leaderboard-avatar-fallback">${cfg.icon}</div>`;
                
            let countLabel = cfg.isRated 
                ? `★ ${person.avg_rating} <span style="font-size: 0.8em; opacity: 0.7;">(${person.count})</span>` 
                : `${person.count} films`;
            
            listEl.innerHTML += `
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
    });

    // --- Populate Languages Leaderboard with Images & Toggle ---
    const langListEl = document.getElementById('languages-list');
    const extraLangEl = document.getElementById('extra-languages');
    const toggleLangBtn = document.getElementById('toggle-languages-btn');

    if (langListEl && extraLangEl && toggleLangBtn && stats.language_stats) {
        langListEl.innerHTML = "";
        extraLangEl.innerHTML = "";
        
        if (stats.language_stats.length <= 10) {
            toggleLangBtn.style.display = "none";
        } else {
            toggleLangBtn.style.display = "block";
        }

        stats.language_stats.forEach((lang, index) => {
            let code = languageToCountryCode[lang.Language];
            let safeLangName = lang.Language.replace(/'/g, "\\'");
            
            let iconHTML = code 
                ? `<img src="https://flagcdn.com/w40/${code}.png" style="width: 24px; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.5);" alt="${lang.Language} flag">`
                : `<span style="font-size: 18px; color: #89a;">🌐</span>`;
            
            let itemHTML = `
                <div class="leaderboard-item" onclick="showLanguageProfile('${safeLangName}')">
                    <div class="leaderboard-left">
                        <div style="width: 30px; display: flex; justify-content: center; align-items: center;">
                            ${iconHTML}
                        </div>
                        <span class="leaderboard-name">${index + 1}. ${lang.Language}</span>
                    </div>
                    <span class="leaderboard-count">${lang.Count} films</span>
                </div>
            `;

            if (index < 10) {
                langListEl.innerHTML += itemHTML;
            } else {
                extraLangEl.innerHTML += itemHTML;
            }
        });

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

    // Build Interactive Histograms
    if (stats.yearly_stats && stats.yearly_stats.length > 0) {
        const years = stats.yearly_stats.map(d => d.year);
        const counts = stats.yearly_stats.map(d => d.count);
        const ratings = stats.yearly_stats.map(d => d.avg_rating);

        stats.yearly_stats.forEach(y => { window.yearData[y.year] = y; });

        if (countChartInstance) countChartInstance.destroy();
        if (ratingChartInstance) ratingChartInstance.destroy();

        const baseChartOptions = { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { display: false },
                tooltip: { enabled: false, position: 'nearest', external: customChartTooltipHandler }
            }, 
            scales: { 
                x: { grid: { display: false }, ticks: { color: '#89a' } }, 
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#89a' } } 
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
            data: { labels: years, datasets: [{ label: 'Films Watched', data: counts, backgroundColor: '#00E054', borderRadius: 4 }] },
            options: baseChartOptions
        });

        const ratingOptions = JSON.parse(JSON.stringify(baseChartOptions));
        ratingOptions.scales.y.max = 5;
        ratingOptions.plugins.tooltip.external = baseChartOptions.plugins.tooltip.external;
        ratingOptions.onClick = baseChartOptions.onClick; 
        ratingOptions.onHover = baseChartOptions.onHover;

        ratingChartInstance = new Chart(document.getElementById('yearRatingChart').getContext('2d'), {
            type: 'bar',
            data: { labels: years, datasets: [{ label: 'Avg Rating', data: ratings, backgroundColor: '#ff8000', borderRadius: 4 }] },
            options: ratingOptions
        });
    }
}

// 7. Profile Wiki Screen Logic
function showProfile(personId) {
    const person = window.personData[personId];
    if (!person) return;

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('active');
    document.getElementById('profile-screen').classList.remove('hidden');
    document.getElementById('profile-screen').classList.add('active');

    document.getElementById('profile-name').innerText = person.name;
    document.getElementById('profile-bio').innerText = person.biography || "No biography data available for this person.";
    
    const imgEl = document.getElementById('profile-image');
    if (person.image_url) {
        imgEl.src = person.image_url;
        imgEl.style.display = "block";
    } else {
        imgEl.style.display = "none";
    }

    const grid = document.getElementById('profile-movies-grid');
    grid.innerHTML = "";
    
    const filmsToRender = person.films || person.top_films || []; 
    filmsToRender.forEach(film => {
        const card = document.createElement('div');
        card.className = `poster-card small`;
        let overlayText = `${film.title}<br>${film.rating > 0 ? film.rating + '★' : ''}`;
        
        if (film.poster_url) {
            card.innerHTML = `<img src="${film.poster_url}" class="poster-img" alt="${film.title}"><div class="poster-overlay">${overlayText}</div>`;
        } else {
            card.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.title}</div><div class="poster-overlay">${overlayText}</div>`;
        }
        grid.appendChild(card);
    });
    
    window.scrollTo(0, 0); 
}

// 8. Year Wiki Screen Logic
function showYearProfile(year) {
    const yData = window.yearData[year];
    if (!yData || !yData.films || yData.films.length === 0) return; 

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('active');
    document.getElementById('year-screen').classList.remove('hidden');
    document.getElementById('year-screen').classList.add('active');

    document.getElementById('year-title').innerText = year;
    document.getElementById('year-subtitle').innerText = year;
    document.getElementById('year-stats').innerText = `${yData.count} films watched • ★ ${yData.avg_rating} Avg Rating`;

    const grid = document.getElementById('year-movies-grid');
    grid.innerHTML = "";
    
    yData.films.forEach(film => {
        const card = document.createElement('div');
        card.className = `poster-card small`;
        let overlayText = `${film.title}<br>${film.rating > 0 ? film.rating + '★' : ''}`;
        
        if (film.poster_url) {
            card.innerHTML = `<img src="${film.poster_url}" class="poster-img" alt="${film.title}"><div class="poster-overlay">${overlayText}</div>`;
        } else {
            card.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.title}</div><div class="poster-overlay">${overlayText}</div>`;
        }
        grid.appendChild(card);
    });
    
    window.scrollTo(0, 0); 
}

// 8.5 Country Wiki Screen Logic
function showCountryProfile(countryName) {
    const cData = window.globalStats.country_stats.find(c => c.Country === countryName);
    if (!cData || !cData.films || cData.films.length === 0) return;

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('active');
    document.getElementById('country-screen').classList.remove('hidden');
    document.getElementById('country-screen').classList.add('active');

    let displayTitle = countryName === "United States of America" ? "United States" : countryName;

    document.getElementById('country-title').innerText = displayTitle;
    document.getElementById('country-stats').innerText = `${cData.Count} films watched`;

    const grid = document.getElementById('country-movies-grid');
    grid.innerHTML = "";
    
    cData.films.forEach(film => {
        const card = document.createElement('div');
        card.className = `poster-card small`;
        let overlayText = `${film.title}<br>${film.rating > 0 ? film.rating + '★' : ''}`;
        
        if (film.poster_url) {
            card.innerHTML = `<img src="${film.poster_url}" class="poster-img" alt="${film.title}"><div class="poster-overlay">${overlayText}</div>`;
        } else {
            card.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.title}</div><div class="poster-overlay">${overlayText}</div>`;
        }
        grid.appendChild(card);
    });
    
    window.scrollTo(0, 0); 
}

// 8.7 Language Wiki Screen Logic
function showLanguageProfile(languageName) {
    const lData = window.globalStats.language_stats.find(l => l.Language === languageName);
    if (!lData || !lData.films || lData.films.length === 0) return;

    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('active');
    document.getElementById('language-screen').classList.remove('hidden');
    document.getElementById('language-screen').classList.add('active');

    document.getElementById('language-title').innerText = languageName;
    document.getElementById('language-stats').innerText = `${lData.Count} films watched`;

    const grid = document.getElementById('language-movies-grid');
    grid.innerHTML = "";
    
    lData.films.forEach(film => {
        const card = document.createElement('div');
        card.className = `poster-card small`;
        let overlayText = `${film.title}<br>${film.rating > 0 ? film.rating + '★' : ''}`;
        
        if (film.poster_url) {
            card.innerHTML = `<img src="${film.poster_url}" class="poster-img" alt="${film.title}"><div class="poster-overlay">${overlayText}</div>`;
        } else {
            card.innerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">${film.title}</div><div class="poster-overlay">${overlayText}</div>`;
        }
        grid.appendChild(card);
    });
    
    window.scrollTo(0, 0); 
}

// 9. Back Button Events
document.getElementById('back-to-dashboard').addEventListener('click', () => {
    document.getElementById('profile-screen').classList.add('hidden');
    document.getElementById('profile-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
});

document.getElementById('back-to-dashboard-from-year').addEventListener('click', () => {
    document.getElementById('year-screen').classList.add('hidden');
    document.getElementById('year-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
});

document.getElementById('back-to-dashboard-from-country').addEventListener('click', () => {
    document.getElementById('country-screen').classList.add('hidden');
    document.getElementById('country-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
});

document.getElementById('back-to-dashboard-from-language').addEventListener('click', () => {
    document.getElementById('language-screen').classList.add('hidden');
    document.getElementById('language-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
});

// 10. Tab Navigation Control & Map Trigger
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => { 
            c.classList.remove('active'); 
            c.classList.add('hidden'); 
        });
        
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        const targetContent = document.getElementById(targetId);
        targetContent.classList.remove('hidden');
        targetContent.classList.add('active');

        if (targetId === 'map-tab' && window.globalStats) {
            drawMap(window.globalStats.country_stats);
        }
    });
});