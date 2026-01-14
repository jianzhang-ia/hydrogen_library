// app.js

const GEO_JSON_URL = 'https://raw.githubusercontent.com/adyliu/china_area/master/china_geo_full.json';
// Or a reliable source. Common one is aliyun or simple maps. 
// https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json is standard.

async function initDashboard() {
    try {
        // 1. Load Data
        const [dataRes, geoRes] = await Promise.all([
            fetch('data/data.json'),
            fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
        ]);

        const data = await dataRes.json();
        const chinaGeo = await geoRes.json();

        // 2. Render KPIs
        renderKPIs(data);

        // 3. Init Map
        initMap(data, chinaGeo);

        // 4. Init Charts
        initCharts(data);

        // 5. Populate Table
        renderTable(data.policies.slice(0, 50)); // Limit initial render

    } catch (e) {
        console.error("Init failed:", e);
        document.querySelector('.container').innerHTML = `<h1>Error Loading Dashboard</h1><p>${e.message}</p>`;
    }
}

function renderKPIs(data) {
    document.getElementById('kpi-total').textContent = data.summary.total_policies;
    document.getElementById('kpi-top-inst').textContent = data.summary.top_instrument.replace(/_/g, ' ');
    document.getElementById('kpi-provinces').textContent = Object.keys(data.provinces).length;
}

function initMap(data, geoJson) {
    // Filter GeoJSON (Remove Taiwan and Dash Lines if present)
    // Note: Aliyun GeoJSON features usually have 'adcode' or 'name'.
    // 100000_full often includes Taiwan (710000) and sometimes islands/dash lines.
    if (geoJson.features) {
        geoJson.features = geoJson.features.filter(f => {
            const name = f.properties.name || "";
            const adcode = f.properties.adcode;
            // Filter Taiwan (710000) and potential dash lines (sometimes separate features or empty names)
            if (name.includes("台湾") || name.includes("Taiwan") || adcode == 710000) return false;
            if (name === "") return false; // often dash lines or separators
            return true;
        });
    }

    const chart = echarts.init(document.getElementById('china-map'));
    echarts.registerMap('china', geoJson);

    // Normalize Data Names for Map Matching
    // Map names are usually "四川省", "北京市". 
    // Our data is "四川省". Should match.
    // But helpful to have a lookup map just in case.

    const provData = [];
    Object.entries(data.provinces).forEach(([name, stats]) => {
        // Try to match name
        provData.push({
            name: name,
            value: stats.count,
            intensity: stats.subsidy_intensity
        });
    });

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                const v = params.value;
                return isNaN(v) ? `${params.name}: 0` : `${params.name}<br/>Policies: ${v}<br/>Subsidies: ${params.data.intensity}`;
            }
        },
        visualMap: {
            min: 0,
            max: 20,
            text: ['High', 'Low'],
            realtime: false,
            calculable: true,
            inRange: {
                color: ['#1e293b', '#38bdf8']
            },
            textStyle: { color: '#fff' }
        },
        series: [
            {
                name: 'Polices',
                type: 'map',
                map: 'china',
                data: provData,
                label: { show: true, color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                itemStyle: {
                    areaColor: '#1e293b',
                    borderColor: '#475569'
                },
                emphasis: {
                    itemStyle: {
                        areaColor: '#0ea5e9',
                        shadowBlur: 10,
                        shadowColor: '#333'
                    },
                    label: { color: '#fff' }
                },
                select: {
                    itemStyle: { areaColor: '#0284c7' }
                }
            }
        ]
    };

    chart.setOption(option);

    // Map Click -> Filter?
    chart.on('click', (params) => {
        if (params.name) {
            filterTableByProvince(params.name);
        }
    });

    window.addEventListener('resize', () => chart.resize());
}

// Global data reference for filtering
let globalPolicies = [];

function initCharts(data) {
    globalPolicies = data.policies;

    // Timeline
    const timelineCtx = document.getElementById('timelineChart').getContext('2d');
    new Chart(timelineCtx, {
        type: 'line',
        data: {
            labels: data.timeline.map(d => d.year),
            datasets: [{
                label: 'New Policies',
                data: data.timeline.map(d => d.count),
                borderColor: '#38bdf8',
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(56, 189, 248, 0.1)'
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { grid: { display: false } }
            }
        }
    });

    // Instruments (Interactive)
    const instCtx = document.getElementById('instrumentChart').getContext('2d');
    // Top Instruments
    const sortedInst = Object.entries(data.global_instruments)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8); // Show top 8

    const instChart = new Chart(instCtx, {
        type: 'bar',
        data: {
            // Labels for display: "Fiscal Purchase Subsidy" -> "Purchase Subsidy"
            labels: sortedInst.map(d => d[0].replace(/_/g, ' ').replace('fiscal ', '').replace('tax ', '')),
            // Keep raw keys for filtering
            rawKeys: sortedInst.map(d => d[0]),
            datasets: [{
                label: 'Count',
                data: sortedInst.map(d => d[1]),
                backgroundColor: '#38bdf8',
                borderRadius: 4,
                hoverBackgroundColor: '#bae6fd'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { grid: { display: false } }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    // Access raw key from data object we monkey-patched
                    const rawKey = instChart.data.rawKeys[index];
                    filterTableByInstrument(rawKey);
                } else {
                    renderTable(globalPolicies.slice(0, 50)); // Reset
                }
            },
            onHover: (event, chartElement) => {
                event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
            }
        }
    });
}

function filterTableByInstrument(instrumentKey) {
    const tableTitle = document.querySelector('.evidence-locker h2');
    tableTitle.textContent = `Policies using: ${instrumentKey.replace(/_/g, ' ')}`;

    const filtered = globalPolicies.filter(p => p.instruments.includes(instrumentKey));
    renderTable(filtered);
}

function filterTableByProvince(provinceName) {
    const tableTitle = document.querySelector('.evidence-locker h2');
    tableTitle.textContent = `Policies in: ${provinceName}`;

    const filtered = globalPolicies.filter(p => p.province === provinceName);
    renderTable(filtered);
}

function renderTable(policies) {
    const tbody = document.getElementById('policy-tbody');
    if (policies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No policies found matching filter.</td></tr>';
        return;
    }

    tbody.innerHTML = policies.map((p, index) => `
        <tr onclick="openModal('${p.id}')">
            <td title="${p.title}">${p.title.length > 35 ? p.title.substring(0, 35) + '...' : p.title}</td>
            <td>${p.province}</td>
            <td>${p.year || '-'}</td>
            <td>${p.instruments.slice(0, 2).map(i => `<span class="tag">${i.split('_').pop()}</span>`).join(' ')}</td>
        </tr>
    `).join('');
}

// Global scope for onclick
window.openModal = function (policyId) {
    const p = globalPolicies.find(x => x.id === policyId);
    if (!p) return;

    document.getElementById('modal-title').textContent = p.title;
    const targetsDiv = document.getElementById('modal-targets');
    const subsidyDiv = document.getElementById('modal-subsidies');
    const instDiv = document.getElementById('modal-instruments');

    // Render Targets
    let targetHtml = '';
    if (p.targets) {
        Object.entries(p.targets).forEach(([k, v]) => {
            if (v && v.value) {
                targetHtml += `
                    <div class="detail-item">
                        <strong>${k.replace('target_', '').replace(/_/g, ' ')}</strong>
                        <div>${v.value} ${k.includes('vehicle') ? 'Vehicles' : ''}</div>
                        ${v.evidence ? `<span class="evidence-quote">"${v.evidence}"</span>` : ''}
                    </div>
                `;
            }
        });
    }
    targetsDiv.innerHTML = targetHtml || '<p>No specific quantitative targets found.</p>';

    // Render Subsidies
    let subHtml = '';
    const allFinance = { ...p.subsidies, ...p.taxes, ...p.rd };
    Object.entries(allFinance).forEach(([k, v]) => {
        if (v && (v.value || v.evidence)) {
            subHtml += `
                <div class="detail-item" style="margin-bottom:0.5rem">
                    <strong>${k.replace(/_/g, ' ')}</strong>
                    <div>${v.value || 'Yes'}</div>
                    ${v.evidence ? `<span class="evidence-quote">"${v.evidence}"</span>` : ''}
                </div>
            `;
        }
    });
    subsidyDiv.innerHTML = subHtml || '<p>No specific financial instruments found.</p>';

    // Other
    let instHtml = '';
    if (p.other && p.other.length > 0) {
        instHtml = p.other.map(i => `<div class="tag" style="margin:5px">${i}</div>`).join('');
    }
    instDiv.innerHTML = instHtml || '<p>None.</p>';

    document.getElementById('modal-overlay').classList.remove('hidden');
};

window.closeModal = function () {
    document.getElementById('modal-overlay').classList.add('hidden');
};

// Close on outside click
window.onclick = function (event) {
    const modal = document.getElementById('modal-overlay');
    if (event.target == modal) {
        closeModal();
    }
}

// Start
document.addEventListener('DOMContentLoaded', initDashboard);
