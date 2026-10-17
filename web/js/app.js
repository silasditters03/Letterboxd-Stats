import { state } from './state.js';
import { buildDashboard } from './dashboard.js';

const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const generateBtn = document.getElementById('generate-btn');
const statusLabel = document.getElementById('status-label');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.getElementById(
    'progress-container',
);

fileInput.addEventListener('change', event => {
    state.selectedFile = event.target.files[0];

    generateBtn.disabled = !state.selectedFile;

    generateBtn.classList.toggle(
        'disabled',
        !state.selectedFile,
    );

    if (
        state.selectedFile
        && !state.selectedFile.name.toLowerCase().endsWith('.zip')
    ) {
        state.selectedFile = null;

        generateBtn.disabled = true;
        generateBtn.classList.add('disabled');

        statusLabel.textContent = 'Please choose a .zip export.';
        return;
    }

    if (state.selectedFile) {
        fileLabel.innerText = (
            `Selected: ${state.selectedFile.name}`
        );

        generateBtn.disabled = false;
        generateBtn.classList.remove('disabled');

        statusLabel.innerText = 'File staged! Ready to process.';
        statusLabel.style.color = 'var(--green)';
    } else {
        fileLabel.textContent = 'No file selected';
        statusLabel.textContent = '';
    }
});

eel.expose(updateProgress);

function updateProgress(current, total) {
    const percentage = (
        total > 0
            ? Math.min(100, (current / total) * 100)
            : 100
    );

    progressBar.style.width = `${percentage}%`;

    statusLabel.innerText = (
        `Fetching TMDb data... (${current}/${total})`
    );
}

generateBtn.addEventListener('click', async () => {
    if (!state.selectedFile) {
        return;
    }

    fileInput.disabled = true;

    progressBar.style.width = '0%';

    generateBtn.disabled = true;
    generateBtn.classList.add('disabled');

    progressContainer.classList.remove('hidden');

    statusLabel.innerText = 'Uploading zip file to local engine...';
    statusLabel.style.color = 'var(--orange)';

    const formData = new FormData();
    formData.append('file', state.selectedFile);

    try {
        const uploadResponse = await fetch('/upload', {
            method: 'POST',
            body: formData,
        });

        if (uploadResponse.ok) {
            statusLabel.innerText = 'Starting parallel data fetch...';

            const response = await eel.process_data()();

            if (response.status === 'success') {
                buildDashboard(response.data);
            } else {
                statusLabel.innerText = (
                    `Error: ${response.message}`
                );

                statusLabel.style.color = 'red';
            }
        } else {
            statusLabel.innerText = 'Error uploading file.';
            statusLabel.style.color = 'red';
        }
    } catch (error) {
        statusLabel.innerText = (
            `Upload Error: ${error.message}`
        );

        statusLabel.style.color = 'var(--orange)';
    } finally {
        fileInput.disabled = false;

        generateBtn.disabled = !state.selectedFile;

        generateBtn.classList.toggle(
            'disabled',
            !state.selectedFile,
        );

        progressContainer.classList.add('hidden');
    }
});