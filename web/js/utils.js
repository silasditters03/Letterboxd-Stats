export function escapeHTML(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        })[character],
    );
}

export function imageURL(value) {
    if (value === 'images/poster-placeholder.svg') {
        return value;
    }

    try {
        const url = new URL(value);

        if (url.protocol === 'https:') {
            return url.href;
        }
    } catch {
        // Use the bundled fallback for absent or invalid URLs.
    }

    return 'images/poster-placeholder.svg';
}