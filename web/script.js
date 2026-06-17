let selectedFilePath = "";

// 1. Hook up the UI elements
const browseBtn = document.getElementById('browse-btn');
const generateBtn = document.getElementById('generate-btn');
const fileLabel = document.getElementById('file-label');
const statusLabel = document.getElementById('status-label');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.getElementById('progress-container');

// 2. Handle Browsing for the Zip
browseBtn.addEventListener('click', async () => {
    // Ask Python to open a native file dialog!
    let path = await eel.get_file_path()();
    
    if (path) {
        selectedFilePath = path;
        // Extract just the file name from the long path
        let fileName = path.split('/').pop().split('\\').pop(); 
        fileLabel.innerText = `Selected: ${fileName}`;
        
        generateBtn.disabled = false;
        generateBtn.classList.remove('disabled');
        statusLabel.innerText = "Data loaded! Ready to analyze...";
        statusLabel.style.color = "var(--green)";
    }
});

// 3. This function is exposed to Python so Python can update the progress bar!
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
    statusLabel.innerText = "Starting data fetch...";
    statusLabel.style.color = "var(--orange)";
    
    // Tell Python to crunch the numbers
    let response = await eel.process_data(selectedFilePath)();
    
    if (response.status === "success") {
        buildDashboard(response.data);
    } else {
        statusLabel.innerText = `Error: ${response.message}`;
        statusLabel.style.color = "red";
    }
});

// 5. Draw the Dashboard
function buildDashboard(stats) {
    // Hide upload, show dashboard
    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
    
    // Fill Top Stats
    document.getElementById('stat-total').innerText = stats.total_watched;
    document.getElementById('stat-hours').innerText = stats.total_hours;
    document.getElementById('stat-countries').innerText = stats.total_countries;
    document.getElementById('stat-directors').innerText = stats.total_directors;
    
    // Build Poster Grid
    const grid = document.getElementById('poster-grid');
    grid.innerHTML = ""; // Clear just in case
    
    stats.top_20.forEach((film, index) => {
        const isTop4 = index < 4;
        const card = document.createElement('div');
        
        // CSS automatically handles the sizes based on these classes!
        card.className = `poster-card ${isTop4 ? 'large' : 'small'}`;
        
        let overlayText = `${film.Name} (${Math.floor(film.Year)})<br>Dir: ${film.director || 'Unknown'}`;
        
        if (film.poster_url) {
            // If we have an image, let the browser render it
            card.innerHTML = `
                <img src="${film.poster_url}" class="poster-img" alt="${film.Name}">
                <div class="poster-overlay">${overlayText}</div>
            `;
        } else {
            // Fallback for missing posters
            card.innerHTML = `
                <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px;">
                    ${film.Name}
                </div>
                <div class="poster-overlay">${overlayText}</div>
            `;
        }
        
        grid.appendChild(card);
    });
}

// --- Tab Switching Logic ---
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all tabs and contents
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => {
            c.classList.remove('active');
            c.classList.add('hidden');
        });
        
        // Add active class to the clicked tab
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        const targetContent = document.getElementById(targetId);
        targetContent.classList.remove('hidden');
        targetContent.classList.add('active');
    });
});

// --- Update the buildDashboard Function ---
// (Inside your existing buildDashboard function, add this right at the bottom)

function buildDashboard(stats) {
    // ... [Keep all your existing buildDashboard code for Top 20 up here] ...

    // NEW: Build the Actor Leaderboard
    const actorsList = document.getElementById('actors-list');
    actorsList.innerHTML = "";
    stats.top_actors_list.forEach((actor, index) => {
        actorsList.innerHTML += `
            <div class="leaderboard-item">
                <span class="leaderboard-name">${index + 1}. ${actor.name}</span>
                <span class="leaderboard-count">${actor.count} films</span>
            </div>
        `;
    });

    // NEW: Build the Director Leaderboard
    const directorsList = document.getElementById('directors-list');
    directorsList.innerHTML = "";
    stats.top_directors_list.forEach((director, index) => {
        directorsList.innerHTML += `
            <div class="leaderboard-item">
                <span class="leaderboard-name">${index + 1}. ${director.name}</span>
                <span class="leaderboard-count">${director.count} films</span>
            </div>
        `;
    });
}