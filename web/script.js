// --- GLOBAL DATA STORES ---
let selectedFile = null;
window.personData = {}; 
window.yearData = {};   
window.globalStats = null; // Used to feed data to the map when the tab is opened
let countChartInstance = null;
let ratingChartInstance = null;

// Initialize Google Charts
google.charts.load('current', { 'packages': ['geochart'] });

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


// --- MAP DRAWING LOGIC ---
function drawMap(countryData) {
    var data = new google.visualization.DataTable();
    data.addColumn('string', 'Country');
    data.addColumn('number', 'Films Watched');
    data.addColumn({'type': 'string', 'role': 'tooltip', 'p': {'html': true}}); // Enables custom HTML Tooltips

    // Comprehensive list of full country names recognized by Google
    const baselineNames = [
        "Afghanistan","Albania","Algeria","American Samoa","Andorra","Angola","Anguilla","Antarctica","Antigua and Barbuda","Argentina","Armenia","Aruba","Australia","Austria","Azerbaijan",
        "The Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bermuda","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi",
        "Cambodia","Cameroon","Canada","Cape Verde","Cayman Islands","Central African Republic","Chad","Chile","China","Colombia","Comoros","CG","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic",
        "Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany",
        "Ghana","Greece","Greenland","Grenada","Guadeloupe","Guam","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland",
        "Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
        "Macao","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Martinique","Mauritania","Mauritius","Mayotte","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro",
        "Montserrat","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Caledonia","New Zealand","Nicaragua","Niger","Nigeria","Niue","Norfolk Island","North Korea","North Macedonia",
        "Northern Mariana Islands","Norway","Oman","Pakistan","Palau","PS","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Pitcairn","Poland","Portugal","Puerto Rico","Qatar",
        "Reunion","Romania","RU","Rwanda","Saint Helena","Saint Kitts and Nevis","Saint Lucia","Saint Pierre and Miquelon","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe",
        "Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","KR","South Sudan","Spain","Sri Lanka","Sudan","Suriname",
        "Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tokelau","Tonga","Trinidad and Barbuda","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine",
        "United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Western Sahara","Yemen","Zambia","Zimbabwe"
    ];

    let mapData = {};
    baselineNames.forEach(name => { mapData[name] = 0; });

    let maxCount = 1;
    if (countryData) {
        countryData.forEach(c => {
            let name = c.Country;
            
            // Fix strict TMDb strings to Google Chart's preferred codes
            if (name === "United States of America") name = "United States";
            if (name === "Russia") name = "RU"; 
            if (name === "South Korea") name = "KR";
            if (name === "Palestine") name = "PS";
            if (name === "Congo") name = "CG";
            if (name === "Bahamas") name = "The Bahamas";
            
            if (mapData[name] !== undefined) {
                mapData[name] = c.Count;
            } else {
                mapData[name] = c.Count; 
            }
            if (c.Count > maxCount) maxCount = c.Count;
        });
    }

    const rows = Object.keys(mapData).map(countryName => {
        const count = mapData[countryName];
        
        // Custom HTML tooltip block
        const tooltipHTML = `
            <div style="background: #445566; padding: 12px 18px; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center; border: 1px solid rgba(255,255,255,0.1); pointer-events: none;">
                <div style="font-weight: bold; color: #fff; margin-bottom: 5px; font-size: 14px;">${countryName === 'United States' ? 'USA' : countryName}</div>
                <div style="color: #9ab; font-size: 12px;">Films watched: ${count}</div>
            </div>
        `;
        return [countryName, count, tooltipHTML];
    });
    
    data.addRows(rows);

    var options = {
        backgroundColor: 'transparent',
        datalessRegionColor: '#0a170f', // Match the '0' color to keep it seamless
        tooltip: { isHtml: true },
        colorAxis: { 
            values: [0, 1, maxCount], 
            // 0 = Darkest Green, 1 = Mid Green, Max = Brightest Light Green
            colors: ['#0a170f', '#184226', '#00E054'] 
        },
        legend: 'none'
    };

    const container = document.getElementById('regions_div');
    var chart = new google.visualization.GeoChart(container);

    // --- UPGRADED: High-Speed Watchdog ---
    const observer = new MutationObserver(() => {
        // 1. Kill the native black floating text instantly
        const titles = container.querySelectorAll('title');
        titles.forEach(t => t.remove());

        // 2. Intercept Google's group highlighting and force it to be Blue
        const paths = container.querySelectorAll('path');
        paths.forEach(p => {
            const sw = p.getAttribute('stroke-width');
            // When Google natively hovers a country, it bumps the stroke-width > 1
            if (sw && parseFloat(sw) > 1) {
                p.style.setProperty('fill', '#40bcf4', 'important');
                p.style.setProperty('stroke', '#40bcf4', 'important');
                p.style.setProperty('stroke-width', '1', 'important'); // Keeps the border clean
            } else {
                // If not hovered, remove our blue and let Google return it to green
                p.style.removeProperty('fill');
                p.style.removeProperty('stroke');
            }
        });
    });

    // We MUST observe 'attributes' so we catch Google changing the stroke-width
    observer.observe(container, { 
        childList: true, 
        subtree: true, 
        attributes: true, 
        attributeFilter: ['stroke-width', 'fill'] 
    });

    chart.draw(data, options);
}


// 6. Main Dashboard Building Function
function buildDashboard(stats) {
    window.globalStats = stats;

    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
    
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
                tooltip: { 
                    enabled: false,
                    position: 'nearest',
                    external: customChartTooltipHandler 
                }
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

        // Draw the map ONLY when the map tab is opened
        if (targetId === 'map-tab' && window.globalStats) {
            drawMap(window.globalStats.country_stats);
        }
    });
});