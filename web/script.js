let selectedFile = null;
window.personData = {}; // Stores deep info (bio, full filmography) for quick loading
let countChartInstance = null;
let ratingChartInstance = null;

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

// 3. Progress Bar Connection
eel.expose(updateProgress);
function updateProgress(current, total) {
    let percentage = (current / total) * 100;
    progressBar.style.width = percentage + '%';
    statusLabel.innerText = `Fetching TMDb data... (${current}/${total})`;
}

// 4. Handle Generating Stats (HTTP POST)
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

// 5. Helper: Generate the Interactive Tooltip
function generateTooltipHTML(person) {
    // We only want the top 10 for the hover pop-up
    let topFilms = person.films.slice(0, 10);
    let remaining = Math.max(0, person.films.length - 10);
    
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

// 6. Build and Display the Dashboard Panels
function buildDashboard(stats) {
    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
    
    document.getElementById('stat-total').innerText = stats.total_watched;
    document.getElementById('stat-hours').innerText = stats.total_hours;
    document.getElementById('stat-countries').innerText = stats.total_countries;
    document.getElementById('stat-directors').innerText = stats.total_directors;
    
    // Render Top 20 Posters Grid
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

    // --- BUILD HISTOGRAMS ---
    const years = stats.yearly_stats.map(d => d.year);
    const counts = stats.yearly_stats.map(d => d.count);
    const ratings = stats.yearly_stats.map(d => d.avg_rating);

    // 1. Destroy old charts if they exist
    if (countChartInstance) countChartInstance.destroy();
    if (ratingChartInstance) ratingChartInstance.destroy();

    // 2. Letterboxd Green Count Chart
    const ctxCount = document.getElementById('yearCountChart').getContext('2d');
    countChartInstance = new Chart(ctxCount, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Films Watched',
                data: counts,
                backgroundColor: '#00E054', // Letterboxd Green
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#89a' } },
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#89a' } }
            }
        }
    });

    // 3. Orange Rating Chart
    const ctxRating = document.getElementById('yearRatingChart').getContext('2d');
    ratingChartInstance = new Chart(ctxRating, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Avg Rating',
                data: ratings,
                backgroundColor: '#ff8000', // Orange
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#89a' } },
                y: { beginAtZero: true, max: 5, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#89a' } }
            }
        }
    });

    // Populate Most Watched Actors
    const actorsList = document.getElementById('actors-list');
    actorsList.innerHTML = "";
    stats.top_actors_list.forEach((actor, index) => {
        let personId = actor.name.replace(/[^a-zA-Z0-9]/g, '-'); 
        window.personData[personId] = actor;

        let avatarHTML = actor.image_url ? `<img src="${actor.image_url}" class="leaderboard-avatar" alt="${actor.name}">` : `<div class="leaderboard-avatar-fallback">👤</div>`;
        actorsList.innerHTML += `
            <div class="leaderboard-item" onclick="showProfile('${personId}')">
                <div class="leaderboard-left">
                    ${avatarHTML}
                    <span class="leaderboard-name">${index + 1}. ${actor.name}</span>
                </div>
                <span class="leaderboard-count">${actor.count} films</span>
                ${generateTooltipHTML(actor)}
            </div>
        `;
    });

    // Populate Most Watched Directors
    const directorsList = document.getElementById('directors-list');
    directorsList.innerHTML = "";
    stats.top_directors_list.forEach((director, index) => {
        let personId = director.name.replace(/[^a-zA-Z0-9]/g, '-'); 
        window.personData[personId] = director;

        let avatarHTML = director.image_url ? `<img src="${director.image_url}" class="leaderboard-avatar" alt="${director.name}">` : `<div class="leaderboard-avatar-fallback">🎬</div>`;
        directorsList.innerHTML += `
            <div class="leaderboard-item" onclick="showProfile('${personId}')">
                <div class="leaderboard-left">
                    ${avatarHTML}
                    <span class="leaderboard-name">${index + 1}. ${director.name}</span>
                </div>
                <span class="leaderboard-count">${director.count} films</span>
                ${generateTooltipHTML(director)}
            </div>
        `;
    });

    // Populate Highest Rated Actors
    const ratedActorsList = document.getElementById('rated-actors-list');
    if (ratedActorsList) {
        ratedActorsList.innerHTML = "";
        stats.top_rated_actors_list.forEach((actor, index) => {
            let personId = actor.name.replace(/[^a-zA-Z0-9]/g, '-'); 
            window.personData[personId] = actor;

            let avatarHTML = actor.image_url ? `<img src="${actor.image_url}" class="leaderboard-avatar" alt="${actor.name}">` : `<div class="leaderboard-avatar-fallback">👤</div>`;
            ratedActorsList.innerHTML += `
                <div class="leaderboard-item" onclick="showProfile('${personId}')">
                    <div class="leaderboard-left">
                        ${avatarHTML}
                        <span class="leaderboard-name">${index + 1}. ${actor.name}</span>
                    </div>
                    <span class="leaderboard-count">★ ${actor.avg_rating} <span style="font-size: 0.8em; opacity: 0.7;">(${actor.count})</span></span>
                    ${generateTooltipHTML(actor)}
                </div>
            `;
        });
    }

    // Populate Highest Rated Directors
    const ratedDirectorsList = document.getElementById('rated-directors-list');
    if (ratedDirectorsList) {
        ratedDirectorsList.innerHTML = "";
        stats.top_rated_directors_list.forEach((director, index) => {
            let personId = director.name.replace(/[^a-zA-Z0-9]/g, '-'); 
            window.personData[personId] = director;

            let avatarHTML = director.image_url ? `<img src="${director.image_url}" class="leaderboard-avatar" alt="${director.name}">` : `<div class="leaderboard-avatar-fallback">🎬</div>`;
            ratedDirectorsList.innerHTML += `
                <div class="leaderboard-item" onclick="showProfile('${personId}')">
                    <div class="leaderboard-left">
                        ${avatarHTML}
                        <span class="leaderboard-name">${index + 1}. ${director.name}</span>
                    </div>
                    <span class="leaderboard-count">★ ${director.avg_rating} <span style="font-size: 0.8em; opacity: 0.7;">(${director.count})</span></span>
                    ${generateTooltipHTML(director)}
                </div>
            `;
        });
    }
}

// 7. Profile Screen Logic
function showProfile(personId) {
    const person = window.personData[personId];
    if (!person) return;

    // Switch Screens
    document.getElementById('dashboard-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('profile-screen').classList.remove('hidden');
    document.getElementById('profile-screen').classList.add('active');

    // Populate Bio Info
    document.getElementById('profile-name').innerText = person.name;
    document.getElementById('profile-bio').innerText = person.biography || "No biography data available for this person.";
    
    const imgEl = document.getElementById('profile-image');
    if (person.image_url) {
        imgEl.src = person.image_url;
        imgEl.style.display = "block";
    } else {
        imgEl.style.display = "none";
    }

    // Paint the full movie grid
    const grid = document.getElementById('profile-movies-grid');
    grid.innerHTML = "";
    person.films.forEach(film => {
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
    
    // Scroll to the top of the new page
    window.scrollTo(0, 0); 
}

// 8. Back Button Event
document.getElementById('back-to-dashboard').addEventListener('click', () => {
    document.getElementById('profile-screen').classList.remove('active');
    document.getElementById('profile-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
});

// 9. Tab Navigation Logic Control
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => {
            c.classList.remove('active');
            c.classList.add('hidden');
        });
        
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        const targetContent = document.getElementById(targetId);
        targetContent.classList.remove('hidden');
        targetContent.classList.add('active');
    });
});