/**
 * Tab Elettricità — Dashboard Energia Italia
 *
 * Visualizza i prezzi del servizio di tutela elettricità ARERA per il
 * consumatore domestico tipo (3 kW · 2.700 kWh/anno).
 *
 * Layout:
 * - KPI principale: prezzo finale totale ultimo trimestre disponibile
 * - 4 KPI secondari: scomposizione (materia, trasporto, oneri, imposte) + %
 * - Grafico storico D3: andamento totale 2004 → corrente
 *
 * Sorgente dati: tab `prezzi_finali_arera` del Google Sheet master
 * Filtro: tipo_dato = "elettricita_tutela_2700"
 *
 * Pattern: stessa architettura di PrezziCorrentiTab (init lazy, export
 * su window.ElettricitaTab).
 */

const ElettricitaTab = (function () {

    const TIPO_DATO = "elettricita_tutela_2700";
    const TAB_SHEET = "prezzi_finali_arera";
    const FONTE_URL = "https://www.arera.it/dati-e-statistiche/dettaglio/aggiornamenti-delle-condizioni-di-tutela-elettricita";
    const FONTE_FILE_URL = "https://www.arera.it/fileadmin/allegati/dati/ele/eep35new.xlsx";

    // Ordine cronologico dei trimestri romani all'interno di un anno
    const TRIM_ORDER = { "I": 1, "II": 2, "III": 3, "IV": 4 };

    let _records = null;       // tutti i record filtrati per tipo_dato
    let _initialized = false;

    /**
     * Entry point chiamato da app.js al primo accesso alla tab.
     */
    async function init() {
        if (_initialized) return;
        const container = document.getElementById("tab-elettricita");
        if (!container) {
            console.error("[ElettricitaTab] Container #tab-elettricita non trovato");
            return;
        }
        container.innerHTML = '<div class="loading">Caricamento dati ARERA...</div>';

        try {
            const all = await DataLoader.loadTab(TAB_SHEET);
            _records = all
                .filter(r => r.tipo_dato === TIPO_DATO)
                .map(normalizeRecord)
                .filter(r => r.valore !== null && r.anno && r.trim)
                .sort(compareRecords);

            if (_records.length === 0) {
                container.innerHTML = renderError(
                    "Nessun record trovato per il profilo 2700 kWh nel tab " +
                    `<code>${TAB_SHEET}</code>.`
                );
                return;
            }

            render(container, _records);
            _initialized = true;
        } catch (err) {
            console.error("[ElettricitaTab] Errore caricamento:", err);
            container.innerHTML = renderError(
                "Impossibile caricare i dati ARERA. " +
                "Riprovare con il pulsante &#x21bb; in alto a destra. " +
                `Dettaglio tecnico: <code>${(err && err.message) || err}</code>`
            );
        }
    }

    /**
     * Estrae trimestre romano e anno dalla colonna "periodo" (es. "II 2026" -> {trim:"II", anno:2026}).
     * Restituisce anche valori numerici puliti (DataLoader.cleanValue ha già convertito).
     */
    function normalizeRecord(r) {
        const periodoStr = String(r.periodo || "").trim();
        const m = periodoStr.match(/^(IV|III|II|I)\s+(\d{4})$/);
        const trim = m ? m[1] : null;
        const anno = m ? parseInt(m[2], 10) : null;

        return {
            anno_mese: r.anno_mese,
            periodo: periodoStr,
            trim: trim,
            anno: anno,
            valore: toNum(r.valore),
            materia_energia: toNum(r.materia_energia),
            trasporto: toNum(r.trasporto),
            oneri_sistema: toNum(r.oneri_sistema),
            imposte: toNum(r.imposte),
        };
    }

    function toNum(v) {
        if (v === null || v === undefined || v === "") return null;
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }

    function compareRecords(a, b) {
        if (a.anno !== b.anno) return a.anno - b.anno;
        return TRIM_ORDER[a.trim] - TRIM_ORDER[b.trim];
    }

    // ============================================================
    // RENDERING
    // ============================================================

    function render(container, records) {
        const last = records[records.length - 1];
        const totale = last.valore;
        const componenti = [
            { key: "materia_energia", label: "Materia energia", valore: last.materia_energia },
            { key: "trasporto",       label: "Trasporto e contatore", valore: last.trasporto },
            { key: "oneri_sistema",   label: "Oneri di sistema", valore: last.oneri_sistema },
            { key: "imposte",         label: "Imposte", valore: last.imposte },
        ];

        const html = `
            <div class="elt-header">
                <h2 class="elt-title">
                    Tutela elettricità
                    <span class="elt-subtitle">— consumatore domestico tipo: 3 kW · 2.700 kWh/anno</span>
                </h2>
                <p class="elt-period">
                    Trimestre di riferimento:
                    <strong>${escapeHtml(last.periodo)}</strong>
                    <span class="elt-period-meta">(${trimToMesi(last.trim, last.anno)})</span>
                </p>
            </div>

            <div class="elt-kpi-principal">
                <div class="elt-kpi-principal-card">
                    <div class="elt-kpi-principal-label">Prezzo finale totale</div>
                    <div class="elt-kpi-principal-value">
                        ${fmtIT(totale, 2)}
                        <span class="elt-kpi-principal-unit">c€/kWh</span>
                    </div>
                    <div class="elt-kpi-principal-note">
                        Comprensivo di tutte le componenti (materia, rete, oneri, imposte).
                    </div>
                </div>
            </div>

            <div class="elt-kpi-grid">
                ${componenti.map(c => renderKpiComponente(c, totale)).join("")}
            </div>

            <div class="elt-chart-container">
                <h3 class="elt-chart-title">Andamento storico — prezzo finale totale</h3>
                <p class="elt-chart-subtitle">
                    Serie trimestrale dal Q1 2004 a ${escapeHtml(last.periodo)} ·
                    ${records.length} osservazioni
                </p>
                <div id="elt-chart-svg-container"></div>
                <div class="elt-chart-legend">
                    <span class="elt-legend-item">
                        <span class="elt-legend-line"></span>
                        Prezzo totale c€/kWh
                    </span>
                </div>
            </div>

            <div class="fonte-dato">
                <strong>Fonte:</strong>
                <a href="${FONTE_URL}" target="_blank" rel="noopener">
                    ARERA — Aggiornamenti condizioni di tutela elettricità</a>
                <span class="tipo-dato">Trimestrale</span>
                <br>
                File originale:
                <a href="${FONTE_FILE_URL}" target="_blank" rel="noopener">eep35new.xlsx</a>
                · Profilo: famiglia con 3 kW di potenza impegnata e 2.700 kWh di consumo annuo
                · I prezzi sono espressi in c€/kWh ed includono tutte le componenti tariffarie.
            </div>
        `;

        container.innerHTML = html;
        renderChart(records);
    }

    function renderKpiComponente(c, totale) {
        const pct = (c.valore !== null && totale > 0)
            ? (c.valore / totale * 100)
            : null;
        return `
            <div class="kpi-card elt-kpi-componente">
                <h3>${escapeHtml(c.label)}</h3>
                <div class="kpi-value">
                    ${fmtIT(c.valore, 2)}<span class="kpi-unit"> c€/kWh</span>
                </div>
                <div class="kpi-subtitle">
                    ${pct !== null ? fmtIT(pct, 1) + "% del totale" : ""}
                </div>
            </div>
        `;
    }

    // ============================================================
    // GRAFICO D3 - linea storica
    // ============================================================

    function renderChart(records) {
        const container = document.getElementById("elt-chart-svg-container");
        if (!container || typeof d3 === "undefined") return;

        // Pulisci eventuale grafico precedente
        container.innerHTML = "";

        const margin = { top: 20, right: 28, bottom: 50, left: 50 };
        const containerWidth = container.clientWidth || 800;
        const width = containerWidth - margin.left - margin.right;
        const height = 360 - margin.top - margin.bottom;

        const svg = d3.select(container)
            .append("svg")
            .attr("class", "elt-chart-svg")
            .attr("viewBox", `0 0 ${containerWidth} 360`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .style("width", "100%")
            .style("height", "auto");

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Asse X: indice numerico (0..n-1) per dare spaziatura uniforme,
        // poi le tick mostrano l'anno alla prima occorrenza
        const x = d3.scaleLinear()
            .domain([0, records.length - 1])
            .range([0, width]);

        const yMax = d3.max(records, d => d.valore);
        const y = d3.scaleLinear()
            .domain([0, yMax * 1.08])
            .nice()
            .range([height, 0]);

        // Tick X solo sui primi trimestri di ogni 2 anni
        const tickIndices = [];
        const tickLabels = [];
        const annoTickStep = 2;
        records.forEach((r, i) => {
            if (r.trim === "I" && r.anno % annoTickStep === 0) {
                tickIndices.push(i);
                tickLabels.push(String(r.anno));
            }
        });

        const xAxis = d3.axisBottom(x)
            .tickValues(tickIndices)
            .tickFormat((d, i) => tickLabels[i]);

        const yAxis = d3.axisLeft(y)
            .ticks(6)
            .tickFormat(d => fmtIT(d, 0));

        g.append("g")
            .attr("class", "elt-axis")
            .attr("transform", `translate(0,${height})`)
            .call(xAxis)
            .selectAll("text")
            .style("text-anchor", "end")
            .attr("dx", "-0.6em")
            .attr("dy", "0.4em")
            .attr("transform", "rotate(-45)");

        g.append("g")
            .attr("class", "elt-axis")
            .call(yAxis);

        // Etichetta asse Y
        g.append("text")
            .attr("class", "elt-axis-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -height / 2)
            .attr("y", -36)
            .attr("text-anchor", "middle")
            .text("c€/kWh");

        // Area sotto la linea (sfumatura)
        const area = d3.area()
            .x((d, i) => x(i))
            .y0(height)
            .y1(d => y(d.valore))
            .curve(d3.curveMonotoneX);

        g.append("path")
            .datum(records)
            .attr("class", "elt-chart-area")
            .attr("d", area);

        // Linea principale
        const line = d3.line()
            .x((d, i) => x(i))
            .y(d => y(d.valore))
            .curve(d3.curveMonotoneX);

        g.append("path")
            .datum(records)
            .attr("class", "elt-chart-line")
            .attr("d", line);

        // Annotazione picco massimo
        const peakIdx = d3.maxIndex(records, d => d.valore);
        if (peakIdx >= 0) {
            const peak = records[peakIdx];
            const px = x(peakIdx);
            const py = y(peak.valore);
            g.append("circle")
                .attr("class", "elt-chart-peak-dot")
                .attr("cx", px)
                .attr("cy", py)
                .attr("r", 4);
            g.append("text")
                .attr("class", "elt-chart-peak-label")
                .attr("x", px + 8)
                .attr("y", py - 4)
                .text(`Picco ${peak.periodo}: ${fmtIT(peak.valore, 2)}`);
        }

        // Annotazione ultimo punto
        const lastIdx = records.length - 1;
        const last = records[lastIdx];
        const lx = x(lastIdx);
        const ly = y(last.valore);
        g.append("circle")
            .attr("class", "elt-chart-current-dot")
            .attr("cx", lx)
            .attr("cy", ly)
            .attr("r", 5);
        g.append("text")
            .attr("class", "elt-chart-current-label")
            .attr("x", lx - 6)
            .attr("y", ly - 10)
            .attr("text-anchor", "end")
            .text(`${last.periodo}: ${fmtIT(last.valore, 2)}`);

        // Tooltip su hover (un cerchio invisibile per ogni punto)
        const tooltip = ensureTooltip();
        g.selectAll(".elt-chart-hover-dot")
            .data(records)
            .enter()
            .append("circle")
            .attr("class", "elt-chart-hover-dot")
            .attr("cx", (d, i) => x(i))
            .attr("cy", d => y(d.valore))
            .attr("r", 12)
            .on("mouseover", function (event, d) {
                tooltip
                    .style("opacity", 1)
                    .html(tooltipHtml(d));
            })
            .on("mousemove", function (event) {
                const [mx, my] = d3.pointer(event, document.body);
                tooltip
                    .style("left", (mx + 12) + "px")
                    .style("top", (my - 12) + "px");
            })
            .on("mouseout", function () {
                tooltip.style("opacity", 0);
            });
    }

    function ensureTooltip() {
        let t = d3.select("body").select(".elt-tooltip");
        if (t.empty()) {
            t = d3.select("body").append("div").attr("class", "elt-tooltip");
        }
        return t;
    }

    function tooltipHtml(d) {
        return `
            <div class="elt-tt-title">${escapeHtml(d.periodo)}</div>
            <div class="elt-tt-row">
                <span class="elt-tt-label">Totale</span>
                <span class="elt-tt-value">${fmtIT(d.valore, 2)} c€/kWh</span>
            </div>
            <div class="elt-tt-row">
                <span class="elt-tt-label">Materia</span>
                <span class="elt-tt-value">${fmtIT(d.materia_energia, 2)}</span>
            </div>
            <div class="elt-tt-row">
                <span class="elt-tt-label">Trasporto</span>
                <span class="elt-tt-value">${fmtIT(d.trasporto, 2)}</span>
            </div>
            <div class="elt-tt-row">
                <span class="elt-tt-label">Oneri</span>
                <span class="elt-tt-value">${fmtIT(d.oneri_sistema, 2)}</span>
            </div>
            <div class="elt-tt-row">
                <span class="elt-tt-label">Imposte</span>
                <span class="elt-tt-value">${fmtIT(d.imposte, 2)}</span>
            </div>
        `;
    }

    // ============================================================
    // UTILS
    // ============================================================

    function fmtIT(n, decimali) {
        if (n === null || n === undefined || !Number.isFinite(n)) return "—";
        return n.toLocaleString("it-IT", {
            minimumFractionDigits: decimali,
            maximumFractionDigits: decimali,
        });
    }

    function trimToMesi(trim, anno) {
        const map = {
            "I":   `gennaio–marzo ${anno}`,
            "II":  `aprile–giugno ${anno}`,
            "III": `luglio–settembre ${anno}`,
            "IV":  `ottobre–dicembre ${anno}`,
        };
        return map[trim] || "";
    }

    function escapeHtml(s) {
        if (s === null || s === undefined) return "";
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function renderError(msg) {
        return `<div class="error-message">${msg}</div>`;
    }

    // Re-render del grafico su resize (se la tab è visibile)
    window.addEventListener("resize", function () {
        const section = document.getElementById("tab-elettricita");
        if (section && section.classList.contains("active") && _records) {
            renderChart(_records);
        }
    });

    return { init };
})();

window.ElettricitaTab = ElettricitaTab;
