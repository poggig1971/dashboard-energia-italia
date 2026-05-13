/**
 * Tab Serie storica — Dashboard Energia Italia
 *
 * Visualizza serie storiche di:
 * - Elettricità tutela ARERA (90 trimestri 2004 → Q2 2026, già popolata)
 * - Carburanti MIMIT (settimanale, si popola progressivamente)
 *
 * Selettori interattivi:
 * - Granularità (trimestrale/annuale per ARERA; settimanale/mensile per carburanti)
 * - Range temporale (tutto / 10 anni / 5 anni / custom)
 * - Componenti elettricità (totale / + scomposte)
 * - Carburante (benzina / gasolio / GPL / metano) - placeholder finché ETL accumula
 * - Aggregazione carburanti: Italia + 3 macro-aree (4 linee)
 *
 * Annotazioni eventi storici:
 * - 2022-02-24 guerra Ucraina (impatta entrambi)
 * - 2024-07-01 avvio Servizio Tutele Graduali (solo elettricità)
 *
 * Pattern: stessa architettura di ElettricitaTab e VariazioniTab.
 */

const SerieStoricaTab = (function () {

    const TAB_ARERA = "prezzi_finali_arera";
    const TAB_CARBURANTI = "prezzi_carburanti_provinciale";
    const TIPO_DATO_ARERA = "elettricita_tutela_2700";

    const FONTE_ARERA_URL = "https://www.arera.it/dati-e-statistiche/dettaglio/aggiornamenti-delle-condizioni-di-tutela-elettricita";
    const FONTE_MIMIT_URL = "https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti";

    const TRIM_ORDER = { "I": 1, "II": 2, "III": 3, "IV": 4 };

    // Componenti ARERA con colori dedicati
    const COMPONENTI_ARERA = [
        { key: "valore",          label: "Totale",           colore: "#1e3a8a", primary: true  },
        { key: "materia_energia", label: "Materia energia",  colore: "#dc2626", primary: false },
        { key: "trasporto",       label: "Trasporto",        colore: "#16a34a", primary: false },
        { key: "oneri_sistema",   label: "Oneri sistema",    colore: "#f59e0b", primary: false },
        { key: "imposte",         label: "Imposte",          colore: "#7c3aed", primary: false },
    ];

    // Carburanti con colori e unità
    const CARBURANTI = [
        { key: "benzina_self_eur_l", label: "Benzina (self)", colore: "#1e3a8a", unita: "€/l"  },
        { key: "gasolio_self_eur_l", label: "Gasolio (self)", colore: "#dc2626", unita: "€/l"  },
        { key: "gpl_eur_l",          label: "GPL",            colore: "#16a34a", unita: "€/l"  },
        { key: "metano_eur_kg",      label: "Metano",         colore: "#f59e0b", unita: "€/kg" },
    ];

    // Macro-aree per aggregazione carburanti
    const MACRO_AREE = [
        { key: "italia",      label: "Italia",       colore: "#1e3a8a", weight: 3 },
        { key: "nord",        label: "Nord",         colore: "#0ea5e9", weight: 1.5 },
        { key: "centro",      label: "Centro",       colore: "#f59e0b", weight: 1.5 },
        { key: "sud_isole",   label: "Sud e Isole",  colore: "#dc2626", weight: 1.5 },
    ];

    // Eventi storici da annotare
    const EVENTI_STORICI = [
        { data: "2022-02-24", anno: 2022, trim: "I",  label: "Guerra Ucraina",   colore: "#dc2626", carburanti: true,  elettricita: true  },
        { data: "2024-07-01", anno: 2024, trim: "III", label: "Avvio STG",        colore: "#0ea5e9", carburanti: false, elettricita: true  },
    ];

    // Stato modulo
    let _areraRecords = null;
    let _carburantiData = null;
    let _settimaneDisponibili = [];
    let _initialized = false;

    // Stato UI
    let _selectedDataset = "elettricita";    // "elettricita" | "carburanti"
    let _selectedGranularita = "nativa";     // "nativa" | "annuale"
    let _selectedRange = "tutto";            // "tutto" | "10anni" | "5anni" | "custom"
    let _customDataFrom = null;
    let _customDataTo = null;
    let _selectedComponenti = "totale";      // "totale" | "scomposte"
    let _selectedCarburante = "benzina_self_eur_l";

    async function init() {
        if (_initialized) return;
        const container = document.getElementById("tab-serie-storica");
        if (!container) {
            console.error("[SerieStoricaTab] Container #tab-serie-storica non trovato");
            return;
        }
        container.innerHTML = '<div class="loading">Caricamento serie storiche...</div>';

        try {
            const [arera, carburanti] = await Promise.all([
                DataLoader.loadTab(TAB_ARERA).catch(() => []),
                DataLoader.loadTab(TAB_CARBURANTI).catch(() => []),
            ]);

            _areraRecords = arera
                .filter(r => r.tipo_dato === TIPO_DATO_ARERA)
                .map(normalizzaArera)
                .filter(r => r.valore !== null && r.anno && r.trim)
                .sort(comparaArera);

            _carburantiData = carburanti;
            _settimaneDisponibili = estraiSettimaneDisponibili(carburanti);

            renderLayout(container);
            renderGraficoCorrente();
            renderTabellaDati();
            _initialized = true;

        } catch (err) {
            console.error("[SerieStoricaTab] Errore:", err);
            container.innerHTML = renderError(
                "Impossibile caricare le serie storiche. " +
                `Dettaglio: <code>${escapeHtml((err && err.message) || String(err))}</code>`
            );
        }
    }

    // ============================================================
    // PARSING
    // ============================================================

    function normalizzaArera(r) {
        const periodoStr = String(r.periodo || "").trim();
        const m = periodoStr.match(/^(IV|III|II|I)\s+(\d{4})$/);
        return {
            periodo: periodoStr,
            trim: m ? m[1] : null,
            anno: m ? parseInt(m[2], 10) : null,
            anno_mese: r.anno_mese,
            valore: toNum(r.valore),
            materia_energia: toNum(r.materia_energia),
            trasporto: toNum(r.trasporto),
            oneri_sistema: toNum(r.oneri_sistema),
            imposte: toNum(r.imposte),
        };
    }

    function comparaArera(a, b) {
        if (a.anno !== b.anno) return a.anno - b.anno;
        return TRIM_ORDER[a.trim] - TRIM_ORDER[b.trim];
    }

    function estraiSettimaneDisponibili(records) {
        const s = new Set();
        records.forEach(r => {
            if (r.data_settimana) s.add(String(r.data_settimana));
        });
        return Array.from(s).sort();
    }

    function toNum(v) {
        if (v === null || v === undefined || v === "") return null;
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }

    // ============================================================
    // LAYOUT
    // ============================================================

    function renderLayout(container) {
        container.innerHTML = `
            <div class="ss-header">
                <h2 class="ss-title">Serie storica</h2>
                <p class="ss-subtitle">
                    Andamento storico dei prezzi energetici. Selezionare dataset, granularità,
                    intervallo temporale e componenti da visualizzare.
                </p>
            </div>

            <div class="ss-controls">
                <!-- Dataset -->
                <div class="ss-control-group">
                    <span class="ss-control-label">Dataset:</span>
                    <div class="ss-radio-group" id="ss-dataset-group">
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-dataset" value="elettricita" checked>
                            <span>Elettricità ARERA</span>
                        </label>
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-dataset" value="carburanti">
                            <span>Carburanti MIMIT</span>
                        </label>
                    </div>
                </div>

                <!-- Range temporale (comune) -->
                <div class="ss-control-group">
                    <span class="ss-control-label">Periodo:</span>
                    <div class="ss-radio-group" id="ss-range-group">
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-range" value="tutto" checked>
                            <span>Tutto</span>
                        </label>
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-range" value="10anni">
                            <span>10 anni</span>
                        </label>
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-range" value="5anni">
                            <span>5 anni</span>
                        </label>
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-range" value="custom">
                            <span>Personalizzato</span>
                        </label>
                    </div>
                </div>

                <!-- Date custom -->
                <div class="ss-control-group ss-custom-dates" id="ss-custom-dates" style="display:none">
                    <span class="ss-control-label">Da:</span>
                    <input type="number" id="ss-date-from" min="2004" max="2026" placeholder="2004" style="width:90px">
                    <span class="ss-control-label">a:</span>
                    <input type="number" id="ss-date-to" min="2004" max="2026" placeholder="2026" style="width:90px">
                    <span class="ss-control-hint">(solo anno)</span>
                </div>

                <!-- Granularità ARERA -->
                <div class="ss-control-group ss-only-elettricita">
                    <span class="ss-control-label">Granularità:</span>
                    <div class="ss-radio-group" id="ss-gran-group">
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-gran" value="nativa" checked>
                            <span>Trimestrale</span>
                        </label>
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-gran" value="annuale">
                            <span>Annuale</span>
                        </label>
                    </div>
                </div>

                <!-- Componenti ARERA -->
                <div class="ss-control-group ss-only-elettricita">
                    <span class="ss-control-label">Componenti:</span>
                    <div class="ss-radio-group" id="ss-comp-group">
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-comp" value="totale" checked>
                            <span>Solo totale</span>
                        </label>
                        <label class="ss-radio-label">
                            <input type="radio" name="ss-comp" value="scomposte">
                            <span>Totale + scomposte</span>
                        </label>
                    </div>
                </div>

                <!-- Selettore carburante -->
                <div class="ss-control-group ss-only-carburanti" style="display:none">
                    <span class="ss-control-label">Carburante:</span>
                    <div class="ss-radio-group" id="ss-carb-group">
                        ${CARBURANTI.map((c, i) => `
                            <label class="ss-radio-label">
                                <input type="radio" name="ss-carb" value="${c.key}" ${i === 0 ? 'checked' : ''}>
                                <span>${escapeHtml(c.label)}</span>
                            </label>
                        `).join("")}
                    </div>
                </div>
            </div>

            <!-- Status bar -->
            <div class="ss-status-bar" id="ss-status-bar"></div>

            <!-- Grafico -->
            <div class="ss-chart-container">
                <h3 class="ss-chart-title" id="ss-chart-title">Caricamento...</h3>
                <p class="ss-chart-subtitle" id="ss-chart-subtitle"></p>
                <div id="ss-chart-svg-container"></div>
                <div class="ss-chart-legend" id="ss-chart-legend"></div>
            </div>

            <!-- Tabella esportabile -->
            <div class="ss-table-container">
                <div class="ss-table-header">
                    <h3 class="ss-table-title">Dati numerici</h3>
                    <button class="ss-btn-export" id="ss-btn-export-csv">
                        ⬇ Esporta CSV
                    </button>
                </div>
                <div id="ss-table-content"></div>
            </div>

            <div class="fonte-dato">
                <strong>Fonti:</strong>
                <a href="${FONTE_ARERA_URL}" target="_blank" rel="noopener">ARERA</a>
                (tutela elettricità, trimestrale) ·
                <a href="${FONTE_MIMIT_URL}" target="_blank" rel="noopener">MIMIT</a>
                (carburanti, settimanale, licenza IODL 2.0).
                <br>
                Eventi annotati sul grafico: la <strong>guerra in Ucraina</strong> (24/02/2022) ha
                avuto un impatto significativo sui prezzi energetici, in particolare sull'elettricità
                attraverso il prezzo del gas naturale. L'<strong>avvio del Servizio a Tutele Graduali</strong>
                (01/07/2024) ha sostituito il precedente regime di Maggior Tutela per i clienti
                domestici non vulnerabili.
            </div>
        `;

        // Wiring eventi
        document.querySelectorAll('input[name="ss-dataset"]').forEach(input => {
            input.addEventListener("change", onDatasetChange);
        });
        document.querySelectorAll('input[name="ss-range"]').forEach(input => {
            input.addEventListener("change", onRangeChange);
        });
        document.querySelectorAll('input[name="ss-gran"]').forEach(input => {
            input.addEventListener("change", onGranChange);
        });
        document.querySelectorAll('input[name="ss-comp"]').forEach(input => {
            input.addEventListener("change", onCompChange);
        });
        document.querySelectorAll('input[name="ss-carb"]').forEach(input => {
            input.addEventListener("change", onCarbChange);
        });
        document.getElementById("ss-date-from").addEventListener("change", onCustomDateChange);
        document.getElementById("ss-date-to").addEventListener("change", onCustomDateChange);
        document.getElementById("ss-btn-export-csv").addEventListener("click", exportCSV);
    }

    function onDatasetChange(e) {
        _selectedDataset = e.target.value;
        toggleControlVisibility();
        renderGraficoCorrente();
        renderTabellaDati();
    }

    function onRangeChange(e) {
        _selectedRange = e.target.value;
        const custom = document.getElementById("ss-custom-dates");
        if (custom) {
            custom.style.display = (_selectedRange === "custom") ? "flex" : "none";
        }
        renderGraficoCorrente();
        renderTabellaDati();
    }

    function onGranChange(e) {
        _selectedGranularita = e.target.value;
        renderGraficoCorrente();
        renderTabellaDati();
    }

    function onCompChange(e) {
        _selectedComponenti = e.target.value;
        renderGraficoCorrente();
    }

    function onCarbChange(e) {
        _selectedCarburante = e.target.value;
        renderGraficoCorrente();
        renderTabellaDati();
    }

    function onCustomDateChange() {
        const from = parseInt(document.getElementById("ss-date-from").value, 10);
        const to = parseInt(document.getElementById("ss-date-to").value, 10);
        _customDataFrom = Number.isFinite(from) ? from : null;
        _customDataTo = Number.isFinite(to) ? to : null;
        if (_selectedRange === "custom") {
            renderGraficoCorrente();
            renderTabellaDati();
        }
    }

    function toggleControlVisibility() {
        const onlyElt = document.querySelectorAll(".ss-only-elettricita");
        const onlyCarb = document.querySelectorAll(".ss-only-carburanti");
        onlyElt.forEach(el => el.style.display = (_selectedDataset === "elettricita") ? "flex" : "none");
        onlyCarb.forEach(el => el.style.display = (_selectedDataset === "carburanti") ? "flex" : "none");
    }

    // ============================================================
    // RENDERING GRAFICO
    // ============================================================

    function renderGraficoCorrente() {
        if (_selectedDataset === "elettricita") {
            renderGraficoElettricita();
        } else {
            renderGraficoCarburanti();
        }
    }

    function renderGraficoElettricita() {
        const titleEl = document.getElementById("ss-chart-title");
        const subEl = document.getElementById("ss-chart-subtitle");
        const statusEl = document.getElementById("ss-status-bar");

        // Filtra per range temporale
        const records = filtraPerRange(_areraRecords);
        if (records.length === 0) {
            statusEl.innerHTML = `<div class="ss-status ss-status-warning">Nessun dato nel periodo selezionato.</div>`;
            titleEl.textContent = "Elettricità ARERA";
            subEl.textContent = "";
            document.getElementById("ss-chart-svg-container").innerHTML = "";
            document.getElementById("ss-chart-legend").innerHTML = "";
            return;
        }

        // Aggregazione annuale se richiesta
        let datiVisuali = records;
        let labelGranularita = `trimestrale (${records.length} osservazioni)`;
        if (_selectedGranularita === "annuale") {
            datiVisuali = aggregaAnnuale(records);
            labelGranularita = `annuale (${datiVisuali.length} anni)`;
        }

        titleEl.textContent = "Elettricità — Servizio di tutela (consumatore tipo 2.700 kWh/anno)";
        subEl.innerHTML = `
            Serie ${labelGranularita}, dal <strong>${escapeHtml(datiVisuali[0].label)}</strong>
            al <strong>${escapeHtml(datiVisuali[datiVisuali.length-1].label)}</strong>.
            Unità: c€/kWh.
        `;
        statusEl.innerHTML = `<div class="ss-status ss-status-ok">✓ ${_areraRecords.length} trimestri totali disponibili (2004-Q2 2026).</div>`;

        // Determina componenti da plottare
        const componentiAttive = (_selectedComponenti === "scomposte")
            ? COMPONENTI_ARERA
            : COMPONENTI_ARERA.filter(c => c.primary);

        renderChartMultilinea(datiVisuali, componentiAttive, "c€/kWh", EVENTI_STORICI.filter(e => e.elettricita));
        renderLegenda(componentiAttive);
    }

    function renderGraficoCarburanti() {
        const titleEl = document.getElementById("ss-chart-title");
        const subEl = document.getElementById("ss-chart-subtitle");
        const statusEl = document.getElementById("ss-status-bar");

        const carbInfo = CARBURANTI.find(c => c.key === _selectedCarburante);

        if (_settimaneDisponibili.length < 2) {
            const n = _settimaneDisponibili.length;
            titleEl.textContent = `Carburanti MIMIT — ${carbInfo.label}`;
            subEl.textContent = "Serie storica settimanale";
            statusEl.innerHTML = `
                <div class="ss-status ss-status-info">
                    📊 Disponibili ${n} settimane di dati. Per visualizzare una serie storica
                    sono necessarie almeno <strong>2 settimane</strong>.
                    ${n === 1 ? `Prima rilevazione successiva attesa per <strong>${formatDateIT(aggiungiSettimane(_settimaneDisponibili[0], 1))}</strong>.` : ""}
                    Il grafico si popolerà automaticamente.
                </div>
            `;
            document.getElementById("ss-chart-svg-container").innerHTML = `
                <div class="ss-empty-chart">
                    <p>Serie storica in accumulo</p>
                    <p class="ss-empty-chart-note">
                        L'ETL MIMIT aggiunge una nuova settimana ogni lunedì.
                        Tra 4 settimane sarà disponibile il primo mese di storico,
                        tra 13 settimane il primo trimestre, tra 53 settimane il primo anno.
                    </p>
                </div>
            `;
            document.getElementById("ss-chart-legend").innerHTML = "";
            return;
        }

        // Calcola serie aggregate per macro-area
        const settimaneInRange = filtraSettimanePerRange(_settimaneDisponibili);
        if (settimaneInRange.length < 2) {
            statusEl.innerHTML = `<div class="ss-status ss-status-warning">Periodo selezionato non ha sufficienti settimane.</div>`;
            return;
        }

        const datiVisuali = aggregaCarburantiMacroArea(settimaneInRange, _selectedCarburante);

        titleEl.textContent = `Carburanti — ${carbInfo.label}`;
        subEl.innerHTML = `
            Serie settimanale, ${datiVisuali.length} settimane.
            Aggregazione per macro-area (media ponderata per numero impianti).
            Unità: ${escapeHtml(carbInfo.unita)}.
        `;
        statusEl.innerHTML = `<div class="ss-status ss-status-ok">✓ ${_settimaneDisponibili.length} settimane di dati carburanti.</div>`;

        const componentiAttive = MACRO_AREE.map(m => ({
            key: m.key,
            label: m.label,
            colore: m.colore,
            primary: m.key === "italia",
        }));

        renderChartMultilinea(datiVisuali, componentiAttive, carbInfo.unita,
            EVENTI_STORICI.filter(e => e.carburanti));
        renderLegenda(componentiAttive);
    }

    function aggregaAnnuale(records) {
        // Raggruppa per anno e calcola media delle 5 colonne numeriche
        const perAnno = {};
        records.forEach(r => {
            if (!perAnno[r.anno]) perAnno[r.anno] = [];
            perAnno[r.anno].push(r);
        });
        return Object.keys(perAnno).sort().map(anno => {
            const arr = perAnno[anno];
            const media = (campo) => {
                const v = arr.map(x => x[campo]).filter(x => x !== null);
                return v.length === 0 ? null : v.reduce((s, x) => s + x, 0) / v.length;
            };
            return {
                label: anno,
                xKey: parseInt(anno, 10),
                anno: parseInt(anno, 10),
                trim: null,
                valore: media("valore"),
                materia_energia: media("materia_energia"),
                trasporto: media("trasporto"),
                oneri_sistema: media("oneri_sistema"),
                imposte: media("imposte"),
            };
        });
    }

    function aggregaCarburantiMacroArea(settimane, campo) {
        // Per ogni settimana, calcola media ponderata per Italia + 3 macro-aree
        return settimane.map(s => {
            const recs = _carburantiData.filter(r => String(r.data_settimana) === s);
            const result = { label: s, xKey: s };
            // Italia
            result.italia = mediaPonderata(recs, campo);
            // 3 macro-aree
            ["Nord", "Centro", "Sud e Isole"].forEach(area => {
                const recsArea = recs.filter(r => r.macro_area === area);
                const key = (area === "Sud e Isole") ? "sud_isole" : area.toLowerCase();
                result[key] = mediaPonderata(recsArea, campo);
            });
            return result;
        });
    }

    function mediaPonderata(recs, campo) {
        let sumWV = 0, sumW = 0;
        recs.forEach(r => {
            const v = toNum(r[campo]);
            const w = toNum(r.n_impianti);
            if (v !== null && v > 0 && w !== null && w > 0) {
                sumWV += v * w;
                sumW += w;
            }
        });
        return sumW > 0 ? (sumWV / sumW) : null;
    }

    // ============================================================
    // FILTRI RANGE
    // ============================================================

    function filtraPerRange(records) {
        const annoMin = annoMinimoRange();
        const annoMax = annoMassimoRange();
        if (annoMin === null && annoMax === null) return records;
        return records.filter(r => {
            if (annoMin !== null && r.anno < annoMin) return false;
            if (annoMax !== null && r.anno > annoMax) return false;
            return true;
        }).map(r => ({
            ...r,
            label: r.periodo,
            xKey: r.anno + (TRIM_ORDER[r.trim] - 1) * 0.25,
        }));
    }

    function filtraSettimanePerRange(settimane) {
        const annoMin = annoMinimoRange();
        const annoMax = annoMassimoRange();
        if (annoMin === null && annoMax === null) return settimane;
        return settimane.filter(s => {
            const a = parseInt(String(s).substring(0, 4), 10);
            if (annoMin !== null && a < annoMin) return false;
            if (annoMax !== null && a > annoMax) return false;
            return true;
        });
    }

    function annoMinimoRange() {
        const annoCorr = new Date().getFullYear();
        if (_selectedRange === "tutto") return null;
        if (_selectedRange === "10anni") return annoCorr - 10;
        if (_selectedRange === "5anni") return annoCorr - 5;
        if (_selectedRange === "custom") return _customDataFrom;
        return null;
    }

    function annoMassimoRange() {
        if (_selectedRange === "custom") return _customDataTo;
        return null;
    }

    // ============================================================
    // DISEGNO GRAFICO MULTILINEA
    // ============================================================

    function renderChartMultilinea(data, componenti, unita, eventi) {
        const container = document.getElementById("ss-chart-svg-container");
        if (!container || typeof d3 === "undefined") return;
        container.innerHTML = "";

        if (data.length === 0) {
            container.innerHTML = `<div class="ss-empty-chart"><p>Nessun dato nel periodo selezionato.</p></div>`;
            return;
        }

        const margin = { top: 30, right: 32, bottom: 60, left: 60 };
        const containerWidth = container.clientWidth || 800;
        const totalHeight = 420;
        const width = containerWidth - margin.left - margin.right;
        const height = totalHeight - margin.top - margin.bottom;

        const svg = d3.select(container)
            .append("svg")
            .attr("class", "ss-chart-svg")
            .attr("viewBox", `0 0 ${containerWidth} ${totalHeight}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .style("width", "100%")
            .style("height", "auto");

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Scala X: indice numerico per spaziatura uniforme
        const x = d3.scaleLinear()
            .domain([0, data.length - 1])
            .range([0, width]);

        // Scala Y: max di tutti i valori di tutte le componenti
        const yMax = d3.max(data, d => {
            const valori = componenti.map(c => d[c.key]).filter(v => v !== null);
            return valori.length > 0 ? d3.max(valori) : 0;
        });
        const y = d3.scaleLinear()
            .domain([0, yMax * 1.08])
            .nice()
            .range([height, 0]);

        // Tick X dinamici
        const numTicksX = Math.min(8, data.length);
        const tickStep = Math.max(1, Math.floor(data.length / numTicksX));
        const tickIndices = [];
        for (let i = 0; i < data.length; i += tickStep) tickIndices.push(i);
        if (tickIndices[tickIndices.length - 1] !== data.length - 1) {
            tickIndices.push(data.length - 1);
        }

        const xAxis = d3.axisBottom(x)
            .tickValues(tickIndices)
            .tickFormat(i => {
                const d = data[i];
                return d ? String(d.label) : "";
            });

        const yAxis = d3.axisLeft(y)
            .ticks(7)
            .tickFormat(d => fmtIT(d, 0));

        g.append("g")
            .attr("class", "ss-axis")
            .attr("transform", `translate(0,${height})`)
            .call(xAxis)
            .selectAll("text")
            .style("text-anchor", "end")
            .attr("dx", "-0.6em")
            .attr("dy", "0.4em")
            .attr("transform", "rotate(-45)");

        g.append("g")
            .attr("class", "ss-axis")
            .call(yAxis);

        g.append("text")
            .attr("class", "ss-axis-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -height / 2)
            .attr("y", -42)
            .attr("text-anchor", "middle")
            .text(unita);

        // Annotazioni eventi storici (linee verticali)
        eventi.forEach(ev => {
            const idx = trovaIndiceEvento(data, ev);
            if (idx === null || idx < 0 || idx >= data.length) return;
            const evX = x(idx);
            g.append("line")
                .attr("class", "ss-event-line")
                .attr("x1", evX).attr("x2", evX)
                .attr("y1", 0).attr("y2", height)
                .attr("stroke", ev.colore)
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "4,3")
                .attr("opacity", 0.6);
            g.append("text")
                .attr("class", "ss-event-label")
                .attr("x", evX + 4)
                .attr("y", 12)
                .attr("fill", ev.colore)
                .text(ev.label);
        });

        // Disegna una linea per ogni componente
        componenti.forEach(comp => {
            const linea = d3.line()
                .defined(d => d[comp.key] !== null && d[comp.key] !== undefined)
                .x((d, i) => x(i))
                .y(d => y(d[comp.key]))
                .curve(d3.curveMonotoneX);

            g.append("path")
                .datum(data)
                .attr("class", `ss-line ss-line-${comp.primary ? 'primary' : 'secondary'}`)
                .attr("d", linea)
                .attr("stroke", comp.colore)
                .attr("stroke-width", comp.primary ? 2.5 : 1.5)
                .attr("fill", "none");
        });

        // Cerchio sull'ultimo punto della prima linea (totale)
        const primaria = componenti.find(c => c.primary);
        if (primaria) {
            const lastIdx = data.length - 1;
            const lastVal = data[lastIdx][primaria.key];
            if (lastVal !== null) {
                g.append("circle")
                    .attr("class", "ss-current-dot")
                    .attr("cx", x(lastIdx))
                    .attr("cy", y(lastVal))
                    .attr("r", 5)
                    .attr("fill", primaria.colore)
                    .attr("stroke", "white")
                    .attr("stroke-width", 2);
                g.append("text")
                    .attr("class", "ss-current-label")
                    .attr("x", x(lastIdx) - 6)
                    .attr("y", y(lastVal) - 10)
                    .attr("text-anchor", "end")
                    .attr("fill", primaria.colore)
                    .text(`${data[lastIdx].label}: ${fmtIT(lastVal, 2)}`);
            }
        }

        // Tooltip
        const tooltip = ensureTooltip();
        g.selectAll(".ss-chart-hover-dot")
            .data(data)
            .enter()
            .append("circle")
            .attr("class", "ss-chart-hover-dot")
            .attr("cx", (d, i) => x(i))
            .attr("cy", height / 2)
            .attr("r", 12)
            .attr("fill", "transparent")
            .style("cursor", "pointer")
            .on("mouseover", function (event, d) {
                tooltip.style("opacity", 1).html(tooltipHtmlMulti(d, componenti, unita));
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

    function trovaIndiceEvento(data, ev) {
        // Trova l'indice del data point corrispondente all'evento
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            if (d.anno === ev.anno && d.trim === ev.trim) return i;
            if (typeof d.xKey === "string" && d.xKey >= ev.data) return i;
            if (typeof d.xKey === "number" && d.anno === ev.anno) return i;
        }
        return null;
    }

    function renderLegenda(componenti) {
        const el = document.getElementById("ss-chart-legend");
        if (!el) return;
        el.innerHTML = componenti.map(c => `
            <span class="ss-legend-item">
                <span class="ss-legend-line" style="background:${c.colore}"></span>
                ${escapeHtml(c.label)}
            </span>
        `).join("");
    }

    // ============================================================
    // TOOLTIP
    // ============================================================

    function ensureTooltip() {
        let t = d3.select("body").select(".ss-tooltip");
        if (t.empty()) {
            t = d3.select("body").append("div").attr("class", "ss-tooltip");
        }
        return t;
    }

    function tooltipHtmlMulti(d, componenti, unita) {
        return `
            <div class="ss-tt-title">${escapeHtml(d.label)}</div>
            ${componenti.map(c => `
                <div class="ss-tt-row">
                    <span class="ss-tt-dot" style="background:${c.colore}"></span>
                    <span class="ss-tt-label">${escapeHtml(c.label)}</span>
                    <span class="ss-tt-value">${fmtIT(d[c.key], 4)} ${escapeHtml(unita)}</span>
                </div>
            `).join("")}
        `;
    }

    // ============================================================
    // TABELLA + EXPORT CSV
    // ============================================================

    function renderTabellaDati() {
        const container = document.getElementById("ss-table-content");
        if (!container) return;

        if (_selectedDataset === "elettricita") {
            renderTabellaElettricita(container);
        } else {
            renderTabellaCarburanti(container);
        }
    }

    function renderTabellaElettricita(container) {
        let dati = filtraPerRange(_areraRecords);
        if (_selectedGranularita === "annuale") {
            dati = aggregaAnnuale(dati);
        }

        if (dati.length === 0) {
            container.innerHTML = `<p class="ss-table-empty">Nessun dato.</p>`;
            return;
        }

        const componenti = (_selectedComponenti === "scomposte")
            ? COMPONENTI_ARERA
            : COMPONENTI_ARERA.filter(c => c.primary);

        const rows = dati.slice().reverse().slice(0, 50);  // ultimi 50

        container.innerHTML = `
            <p class="ss-table-info">Visualizzati ultimi ${rows.length} di ${dati.length} periodi.</p>
            <table class="ss-table">
                <thead>
                    <tr>
                        <th>Periodo</th>
                        ${componenti.map(c => `<th class="num">${escapeHtml(c.label)} (c€/kWh)</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td><strong>${escapeHtml(r.label || r.periodo)}</strong></td>
                            ${componenti.map(c => `<td class="num">${fmtIT(r[c.key], 4)}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    }

    function renderTabellaCarburanti(container) {
        if (_settimaneDisponibili.length < 2) {
            container.innerHTML = `<p class="ss-table-empty">Storico carburanti non ancora disponibile.</p>`;
            return;
        }

        const settimane = filtraSettimanePerRange(_settimaneDisponibili);
        const dati = aggregaCarburantiMacroArea(settimane, _selectedCarburante);
        const carbInfo = CARBURANTI.find(c => c.key === _selectedCarburante);
        const rows = dati.slice().reverse().slice(0, 50);

        container.innerHTML = `
            <p class="ss-table-info">Visualizzati ultimi ${rows.length} di ${dati.length} settimane. Carburante: ${escapeHtml(carbInfo.label)}.</p>
            <table class="ss-table">
                <thead>
                    <tr>
                        <th>Settimana</th>
                        ${MACRO_AREE.map(m => `<th class="num">${escapeHtml(m.label)} (${carbInfo.unita})</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td><strong>${formatDateIT(r.label)}</strong></td>
                            ${MACRO_AREE.map(m => `<td class="num">${fmtIT(r[m.key], 4)}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    }

    function exportCSV() {
        let csvLines = [];
        let filename = "";

        if (_selectedDataset === "elettricita") {
            let dati = filtraPerRange(_areraRecords);
            if (_selectedGranularita === "annuale") dati = aggregaAnnuale(dati);
            const componenti = (_selectedComponenti === "scomposte")
                ? COMPONENTI_ARERA
                : COMPONENTI_ARERA.filter(c => c.primary);
            const headers = ["Periodo", ...componenti.map(c => `${c.label} (c€/kWh)`)];
            csvLines.push(headers.join(";"));
            dati.forEach(r => {
                const cells = [r.label || r.periodo, ...componenti.map(c => fmtIT(r[c.key], 4))];
                csvLines.push(cells.join(";"));
            });
            filename = `serie_storica_elettricita_${_selectedGranularita}_${nowStamp()}.csv`;
        } else {
            if (_settimaneDisponibili.length < 2) {
                alert("Nessun dato carburanti disponibile per l'esportazione.");
                return;
            }
            const settimane = filtraSettimanePerRange(_settimaneDisponibili);
            const dati = aggregaCarburantiMacroArea(settimane, _selectedCarburante);
            const carbInfo = CARBURANTI.find(c => c.key === _selectedCarburante);
            const headers = ["Settimana", ...MACRO_AREE.map(m => `${m.label} (${carbInfo.unita})`)];
            csvLines.push(headers.join(";"));
            dati.forEach(r => {
                const cells = [r.label, ...MACRO_AREE.map(m => fmtIT(r[m.key], 4))];
                csvLines.push(cells.join(";"));
            });
            filename = `serie_storica_${_selectedCarburante}_${nowStamp()}.csv`;
        }

        const csv = "\ufeff" + csvLines.join("\n");  // BOM per Excel Italia
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function nowStamp() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
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

    function formatDateIT(yyyymmdd) {
        if (!yyyymmdd) return "—";
        const parts = String(yyyymmdd).split("-");
        if (parts.length !== 3) return yyyymmdd;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function aggiungiSettimane(dataStr, n) {
        const d = new Date(dataStr);
        if (isNaN(d.getTime())) return dataStr;
        d.setDate(d.getDate() + 7 * n);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
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

    // Resize handler
    window.addEventListener("resize", function () {
        const section = document.getElementById("tab-serie-storica");
        if (section && section.classList.contains("active") && _initialized) {
            renderGraficoCorrente();
        }
    });

    return { init };
})();

window.SerieStoricaTab = SerieStoricaTab;
