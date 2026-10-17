import { state } from './state.js';

import {
    escapeHTML as h,
    imageURL,
} from './utils.js';

let countChartInstance = null;
let ratingChartInstance = null;
let genreChartInstance = null;
let ratingDistChartInstance = null;
let vectorMapInstance = null;

function getOrCreateChartTooltip(chart) {
    let tooltipElement = chart.canvas.parentNode.querySelector(
        'div.chartjs-custom-tooltip',
    );

    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'chartjs-custom-tooltip';

        Object.assign(tooltipElement.style, {
            background: '#14181c',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '10px',
            borderRadius: '8px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.8)',
            position: 'absolute',
            pointerEvents: 'none',
            transform: 'translate(-50%, 0)',
            transition: (
                'opacity 0.2s ease, '
                + 'top 0.2s ease, '
                + 'left 0.2s ease'
            ),
            zIndex: 1000,
            width: 'max-content',
        });

        chart.canvas.parentNode.appendChild(tooltipElement);
    }

    return tooltipElement;
}

function customChartTooltipHandler(context) {
    const { chart, tooltip } = context;
    const tooltipElement = getOrCreateChartTooltip(chart);

    if (tooltip.opacity === 0) {
        tooltipElement.style.opacity = 0;
        return;
    }

    if (tooltip.body) {
        const year = tooltip.title[0];
        const yearData = state.years[year];

        const dataset = tooltip.dataPoints[0].dataset;
        const datasetLabel = dataset.label;
        const barColor = dataset.backgroundColor;

        if (
            !yearData
            || !yearData.films
            || yearData.films.length === 0
        ) {
            tooltipElement.innerHTML = `
                <div style="
                    color: #89a;
                    font-size: 0.9em;
                    font-weight: bold;
                    text-align: center;
                ">
                    <span style="color: ${barColor};">
                        ${year}
                    </span>
                    <br>
                    0 films
                </div>
            `;
        } else {
            const topFilms = yearData.films.slice(0, 4);

            const remaining = Math.max(
                0,
                yearData.films.length - 4,
            );

            const postersHTML = topFilms.map(film => {
                const title = (
                    film.title
                    + (film.rating > 0 ? ` (${film.rating}★)` : '')
                );

                if (film.poster_url) {
                    return `
                        <img
                            src="${h(imageURL(film.poster_url))}"
                            class="tooltip-poster"
                            alt="${h(film.title)}"
                            title="${h(title)}"
                            loading="lazy"
                        >
                    `;
                }

                return `
                    <div
                        class="tooltip-poster-fallback"
                        title="${h(title)}"
                    >?</div>
                `;
            }).join('');

            const moreHTML = remaining > 0
                ? `
                    <div class="tooltip-more">
                        +${remaining} more
                    </div>
                `
                : '';

            const metricText = datasetLabel === 'Films Watched'
                ? `${yearData.count} films`
                : `★ ${yearData.avg_rating}`;

            tooltipElement.innerHTML = `
                <div style="
                    margin-bottom: 8px;
                    font-weight: bold;
                    color: #fff;
                    text-align: center;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    padding-bottom: 4px;
                ">
                    <span style="
                        color: ${barColor};
                        font-size: 1.1em;
                    ">
                        ${year}
                    </span>

                    <span style="
                        color: #89a;
                        font-size: 0.85em;
                        font-weight: normal;
                        margin-left: 5px;
                    ">
                        ${metricText}
                    </span>
                </div>

                <div style="
                    display: grid;
                    grid-template-columns:
                        repeat(${Math.min(4, yearData.films.length)}, 1fr);
                    gap: 5px;
                ">
                    ${postersHTML}
                </div>

                ${moreHTML}
            `;
        }
    }

    const {
        offsetLeft: positionX,
        offsetTop: positionY,
    } = chart.canvas;

    tooltipElement.style.opacity = 1;

    tooltipElement.style.left = (
        `${positionX + tooltip.caretX}px`
    );

    let finalTop = (
        positionY
        + tooltip.caretY
        - tooltipElement.offsetHeight
        - 15
    );

    if (finalTop < 0) {
        finalTop = positionY + tooltip.caretY + 15;
    }

    tooltipElement.style.top = `${finalTop}px`;
}

export function drawMap(countryData, onCountryClick) {
    if (vectorMapInstance) {
        vectorMapInstance.destroy();
    }

    const nameToCode = {
        'United States': 'US',
        'United States of America': 'US',
        'Canada': 'CA',
        'United Kingdom': 'GB',
        'France': 'FR',
        'Germany': 'DE',
        'Japan': 'JP',
        'South Korea': 'KR',
        'Italy': 'IT',
        'Spain': 'ES',
        'India': 'IN',
        'China': 'CN',
        'Australia': 'AU',
        'Brazil': 'BR',
        'Mexico': 'MX',
        'Russia': 'RU',
        'Sweden': 'SE',
        'Denmark': 'DK',
        'Ireland': 'IE',
        'New Zealand': 'NZ',
        'Netherlands': 'NL',
        'Norway': 'NO',
        'Poland': 'PL',
        'Argentina': 'AR',
        'Belgium': 'BE',
        'Switzerland': 'CH',
        'Austria': 'AT',
        'Finland': 'FI',
        'Czech Republic': 'CZ',
        'Hungary': 'HU',
        'Greece': 'GR',
        'Turkey': 'TR',
        'Taiwan': 'TW',
        'Hong Kong': 'HK',
        'South Africa': 'ZA',
        'Iran': 'IR',
        'Chile': 'CL',
        'Colombia': 'CO',
        'Portugal': 'PT',
        'Romania': 'RO',
        'Israel': 'IL',
        'Thailand': 'TH',
        'Indonesia': 'ID',
        'Philippines': 'PH',
    };

    const mapValues = {};
    const codeToName = {};

    for (const country of countryData || []) {
        const code = (
            nameToCode[country.Country]
            || country.Country
        );

        mapValues[code] = country.Count;
        codeToName[code] = country.Country;
    }

    vectorMapInstance = new jsVectorMap({
        selector: '#regions_div',
        map: 'world',
        backgroundColor: 'transparent',
        zoomOnScroll: false,

        regionStyle: {
            initial: {
                fill: '#0a170f',
                stroke: 'rgba(255,255,255,0.1)',
                strokeWidth: 0.5,
            },
            hover: {
                fill: '#40bcf4',
                fillOpacity: 1,
            },
        },

        visualizeData: {
            scale: ['#184226', '#00E054'],
            values: mapValues,
        },

        onRegionTooltipShow(event, tooltip, code) {
            const count = mapValues[code] || 0;
            let countryName = tooltip.text();

            if (countryName === 'United States') {
                countryName = 'USA';
            }

            tooltip.text(
                `
                    <div style="text-align: center;">
                        <div style="
                            font-weight: bold;
                            color: #fff;
                            font-size: 14px;
                            margin-bottom: 5px;
                        ">
                            ${h(countryName)}
                        </div>

                        <div style="color: #9ab; font-size: 12px;">
                            Films watched: ${count}
                        </div>
                    </div>
                `,
                true,
            );
        },

        onRegionClick(event, code) {
            const countryName = codeToName[code];

            if (countryName && mapValues[code] > 0) {
                onCountryClick(countryName);
            }
        },
    });
}

export function renderCharts(stats, onYearClick) {
    Chart.defaults.color = '#89a';

    for (const chart of [
        countChartInstance,
        ratingChartInstance,
        genreChartInstance,
        ratingDistChartInstance,
    ]) {
        if (chart) {
            chart.destroy();
        }
    }

    countChartInstance = null;
    ratingChartInstance = null;
    genreChartInstance = null;
    ratingDistChartInstance = null;

    if (stats.yearly_stats && stats.yearly_stats.length > 0) {
        const years = stats.yearly_stats.map(
            item => item.year,
        );

        const counts = stats.yearly_stats.map(
            item => item.count,
        );

        const ratings = stats.yearly_stats.map(
            item => item.avg_rating,
        );

        stats.yearly_stats.forEach(item => {
            state.years[item.year] = item;
        });

        const baseChartOptions = {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    enabled: false,
                    position: 'nearest',
                    external: customChartTooltipHandler,
                },
            },

            scales: {
                x: {
                    grid: {
                        display: false,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255,255,255,0.1)',
                    },
                },
            },

            onClick(event, elements) {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    onYearClick(years[index]);
                }
            },

            onHover(event, elements) {
                event.native.target.style.cursor = (
                    elements.length
                        ? 'pointer'
                        : 'default'
                );
            },
        };

        countChartInstance = new Chart(
            document
                .getElementById('yearCountChart')
                .getContext('2d'),
            {
                type: 'bar',
                data: {
                    labels: years,
                    datasets: [
                        {
                            label: 'Films Watched',
                            data: counts,
                            backgroundColor: '#00E054',
                            borderRadius: 4,
                        },
                    ],
                },
                options: baseChartOptions,
            },
        );

        const ratingOptions = {
            ...baseChartOptions,
            scales: {
                ...baseChartOptions.scales,
                y: {
                    ...baseChartOptions.scales.y,
                    max: 5,
                },
            },
        };

        ratingChartInstance = new Chart(
            document
                .getElementById('yearRatingChart')
                .getContext('2d'),
            {
                type: 'bar',
                data: {
                    labels: years,
                    datasets: [
                        {
                            label: 'Average Rating',
                            data: ratings,
                            backgroundColor: '#40bcf4',
                            borderRadius: 4,
                        },
                    ],
                },
                options: ratingOptions,
            },
        );
    }

    if (stats.genre_stats && stats.genre_stats.length > 0) {
        const labels = stats.genre_stats.map(
            genre => genre.Genre,
        );

        const counts = stats.genre_stats.map(
            genre => genre.Count,
        );

        const colors = [
            '#00E054',
            '#40bcf4',
            '#ff8000',
            '#9b59b6',
            '#e74c3c',
            '#f1c40f',
            '#1abc9c',
            '#3498db',
            '#e67e22',
            '#2ecc71',
            '#89a',
            '#ffffff',
        ];

        genreChartInstance = new Chart(
            document
                .getElementById('genreChart')
                .getContext('2d'),
            {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [
                        {
                            data: counts,
                            backgroundColor: colors,
                            borderWidth: 0,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                color: '#89a',
                                boxWidth: 12,
                            },
                        },
                    },
                },
            },
        );
    }

    if (stats.rating_dist && stats.rating_dist.length > 0) {
        const labels = stats.rating_dist.map(
            rating => `${rating.rating}★`,
        );

        const counts = stats.rating_dist.map(
            rating => rating.count,
        );

        ratingDistChartInstance = new Chart(
            document
                .getElementById('ratingCurveChart')
                .getContext('2d'),
            {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            data: counts,
                            backgroundColor: '#ff8000',
                            borderRadius: 4,
                            barPercentage: 0.9,
                            categoryPercentage: 1.0,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false,
                        },
                    },
                    scales: {
                        x: {
                            grid: {
                                display: false,
                            },
                        },
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(255,255,255,0.1)',
                            },
                        },
                    },
                },
            },
        );
    }
}