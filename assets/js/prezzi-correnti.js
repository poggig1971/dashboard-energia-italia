/**
 * Tab Prezzi Correnti - Dashboard Energia Italia
 *
 * Orchestra la visualizzazione della tab "Prezzi correnti":
 * - Carica i dati carburanti e l'anagrafica
 * - Gestisce i selettori (fonte energetica, macro-area)
 * - Aggiorna la mappa, i KPI e la classifica
 */

const PrezziCorrentiTab = (function () {
    // Stato corrente
    const state = {
        carburante: "benzina",
        macroArea: "italia",
        rankingLimit: 10,
        data: [],
        anagrafica: {},
        provinciaSelezionata: null,
        regioneSelezionata: null,    // nome regione + array sigle se filtro regionale attivo
        regioneSigle: [],
    };

    // Mapping carburante → colonna CSV + label + unità
    const CARBURANTI_INFO = {
        benzina: {
            col: "benzina_self_eur_l",
            label: "Benzina (self-service)",
            unit: "€/l",
        },
        gasolio: {
            col: "gasolio_self_eur_l",
            label: "Gasolio (self-service)",
            unit: "€/l",
        },
        gpl: {
            col: "gpl_eur_l",
            label: "GPL",
            unit: "€/l",
        },
        metano: {
            col: "metano_eur_kg",
            label: "Metano",
            unit: "€/kg",
        },
    };

    /**
     * Inizializzazione: chiamata da app.js quando l'utente apre la tab.
     */
    async function init() {
        try {
            await loadData();
            renderControls();
            await renderMap();
            renderAll();
        } catch (err) {
            console.error("[PrezziCorrenti] Errore inizializzazione:", err);
            showError("Impossibile caricare i dati. Riprova più tardi.");
        }
    }

    /**
     * Carica i dati necessari (prezzi carburanti + anagrafica province).
     */
    async function loadData() {
        const [prezzi, anagrafica] = await Promise.all([
            DataLoader.loadTab("prezzi_carburanti_provinciale"),
            DataLoader.loadTab("anagrafica_province"),
        ]);

        // Costruisci mappa sigla → metadati provincia
        state.anagrafica = {};
        anagrafica.forEach(r => {
            if (r.sigla) {
                state.anagrafica[r.sigla] = {
                    nome: r.nome,
                    regione: r.regione,
                    macro_area: r.macro_area,
                    popolazione: r.popolazione_2024,
                };
            }
        });

        // Mantieni solo l'ultima settimana disponibile
        const settimane = [...new Set(prezzi.map(r => r.data_settimana))].sort();
        const ultimaSettimana = settimane[settimane.length - 1];
        state.data = prezzi.filter(r => r.data_settimana === ultimaSettimana);
        state.dataSettimana = ultimaSettimana;

        console.log(`[PrezziCorrenti] Caricati ${state.data.length} record per settimana ${ultimaSettimana}`);
    }

    /**
     * Render dei controlli (selettori carburante + macro-area).
     */
    function renderControls() {
        const html = `
            <div class="tab-controls" style="margin-bottom: 12px;">
                <div class="control-group" style="flex: 1;">
                    <span class="control-label">Trova provincia:</span>
                    <div id="province-finder-wrap" style="flex: 1; max-width: 400px;"></div>
                </div>
            </div>

            <div id="selected-province-badge" class="selected-province-badge">
                <span class="badge-label">Provincia selezionata:</span>
                <span class="badge-value" id="badge-nome"></span>
                <button id="badge-clear">Mostra tutta Italia ×</button>
            </div>
            <div class="tab-controls">
                <div class="control-group">
                    <span class="control-label">Carburante:</span>
                    <div class="radio-group" id="ctrl-carburante">
                        ${Object.entries(CARBURANTI_INFO).map(([key, info], i) => `
                            <input type="radio" name="carburante" id="carb-${key}" value="${key}" ${i === 0 ? "checked" : ""}>
                            <label for="carb-${key}">${info.label.split(" ")[0]}</label>
                        `).join("")}
                    </div>
                </div>
                <div class="control-group">
                    <span class="control-label">Area:</span>
                    <div class="radio-group" id="ctrl-area">
                        <input type="radio" name="area" id="area-italia" value="italia" checked>
                        <label for="area-italia">Italia</label>
                        <input type="radio" name="area" id="area-nord" value="nord">
                        <label for="area-nord">Nord</label>
                        <input type="radio" name="area" id="area-centro" value="centro">
                        <label for="area-centro">Centro</label>
                        <input type="radio" name="area" id="area-sud" value="sud">
                        <label for="area-sud">Sud e Isole</label>
                    </div>
                </div>
            </div>

            <div class="kpi-grid" id="kpi-cards"></div>

            <div class="map-and-ranking">
                <div class="map-container">
                    <h3 class="map-title" id="map-title">Caricamento mappa...</h3>
                    <p class="map-subtitle" id="map-subtitle"></p>
                    <div id="map-wrapper" style="position: relative;"></div>
                </div>
                <div class="ranking-container">
                    <h3 class="ranking-title">Classifica provinciale</h3>
                    <div class="ranking-filters">
                        <button class="ranking-filter-btn active" data-limit="10">Top 10</button>
                        <button class="ranking-filter-btn" data-limit="20">Top 20</button>
                        <button class="ranking-filter-btn" data-limit="all">Tutte</button>
                    </div>
                    <table class="ranking-table" id="ranking-table"></table>
                </div>
            </div>

            <div class="fonte-dato">
                <strong>Fonte:</strong>
                <a href="https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti" target="_blank" rel="noopener">MIMIT Open Data – Prezzi carburanti praticati</a>
                <span class="tipo-dato">misurato</span><br>
                Aggregazione media provinciale degli impianti self-service attivi sul territorio.
                Licenza dati: <a href="https://www.dati.gov.it/content/italian-open-data-license-v20" target="_blank" rel="noopener">IODL 2.0</a> –
                Settimana di riferimento: <strong id="settimana-rif">${state.dataSettimana || "n.d."}</strong>
            </div>

            <div id="map-tooltip"></div>
        `;
        document.getElementById("tab-prezzi-correnti").innerHTML = html;

        // Event listeners selettori
        document.querySelectorAll('#ctrl-carburante input').forEach(el => {
            el.addEventListener("change", e => {
                state.carburante = e.target.value;
                renderAll();
            });
        });
        document.querySelectorAll('#ctrl-area input').forEach(el => {
            el.addEventListener("change", e => {
                state.macroArea = e.target.value;
                renderAll();
            });
        });
        document.querySelectorAll('.ranking-filter-btn').forEach(btn => {
            btn.addEventListener("click", e => {
                document.querySelectorAll('.ranking-filter-btn').forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const lim = btn.dataset.limit;
                state.rankingLimit = lim === "all" ? null : parseInt(lim);
                renderRanking();
            });
        });

        // Inizializzazione cercatore province
        const provinceList = Object.entries(state.anagrafica).map(([sigla, info]) => ({
            sigla: sigla,
            nome: info.nome,
            regione: info.regione,
            macro_area: info.macro_area,
        })).sort((a, b) => a.nome.localeCompare(b.nome, "it"));

        ProvinceFinder.init("#province-finder-wrap", provinceList, {
            onSelectProvince: handleProvinciaSelezionata,
            onSelectRegione: handleRegioneSelezionata,
            onClear: handleSelezioneRimossa,
        });

        document.getElementById("badge-clear").addEventListener("click", () => {
            ProvinceFinder.reset();
            handleSelezioneRimossa();
        });
    }

    /**
     * Inizializza il componente mappa (chiamato una sola volta).
     */
    async function renderMap() {
        const provinceMacroMap = {};
        Object.entries(state.anagrafica).forEach(([sigla, info]) => {
            provinceMacroMap[sigla] = info.macro_area;
        });

        await ItalyMap.init("#map-wrapper", {
            provinceMacroMap: provinceMacroMap,
            onHover: handleProvinceHover,
            onClick: handleProvinceClick,
        });
    }

    /**
     * Aggiorna tutto: titolo, KPI, mappa, classifica.
     */
    function renderAll() {
        const info = CARBURANTI_INFO[state.carburante];
        document.getElementById("map-title").textContent =
            `Prezzo medio provinciale – ${info.label}`;
        document.getElementById("map-subtitle").textContent =
            `Media impianti per provincia (${info.unit}) – settimana ${state.dataSettimana}`;

        renderKpis();
        updateMap();
        renderRanking();
    }

    /**
     * Calcola e renderizza i 4 KPI (nazionale + 3 macro-aree).
     */
    function renderKpis() {
        const info = CARBURANTI_INFO[state.carburante];
        const col = info.col;

        const all = state.data.map(r => r[col]).filter(v => v != null && !isNaN(v));
        const mediaNazionale = mean(all);

        const macros = ["Nord", "Centro", "Sud e Isole"];
        const medie = macros.map(m => {
            const valori = state.data
                .filter(r => r.macro_area === m)
                .map(r => r[col])
                .filter(v => v != null && !isNaN(v));
            return { area: m, media: mean(valori), n: valori.length };
        });

        const html = `
            <div class="kpi-card">
                <h3>Media Italia</h3>
                <div class="kpi-value">${formatPrice(mediaNazionale)}<span class="kpi-unit">${info.unit}</span></div>
                <div class="kpi-subtitle">${all.length} province rilevate</div>
            </div>
            ${medie.map(m => `
                <div class="kpi-card">
                    <h3>${m.area}</h3>
                    <div class="kpi-value">${formatPrice(m.media)}<span class="kpi-unit">${info.unit}</span></div>
                    <div class="kpi-subtitle">${m.n} province · ${diffNazionale(m.media, mediaNazionale)}</div>
                </div>
            `).join("")}
        `;
        document.getElementById("kpi-cards").innerHTML = html;
    }

    /**
     * Aggiorna i colori della mappa per il carburante e l'area correnti.
     */
    function updateMap() {
        const info = CARBURANTI_INFO[state.carburante];
        const dataBySigla = {};
        state.data.forEach(r => {
            if (r.provincia_sigla && r[info.col] != null) {
                dataBySigla[r.provincia_sigla] = r[info.col];
            }
        });

        ItalyMap.update(dataBySigla, {
            legendLabel: info.label,
            unit: info.unit,
        });

        const macroLabel = {
            italia: null,
            nord: "Nord",
            centro: "Centro",
            sud: "Sud e Isole",
        }[state.macroArea];
        ItalyMap.filterByMacroArea(macroLabel);
    }

    /**
     * Renderizza la tabella classifica.
     */
    function renderRanking() {
        const info = CARBURANTI_INFO[state.carburante];
        const col = info.col;

        let rows = state.data.filter(r => r[col] != null && !isNaN(r[col]));

        // Filtra per macro-area se attivo
        if (state.macroArea !== "italia") {
            const macroLabel = { nord: "Nord", centro: "Centro", sud: "Sud e Isole" }[state.macroArea];
            rows = rows.filter(r => r.macro_area === macroLabel);
        }
        // Filtra per provincia selezionata se attiva
        // Filtra per provincia singola selezionata
        if (state.provinciaSelezionata) {
            rows = rows.filter(r => r.provincia_sigla === state.provinciaSelezionata);
        }

        // Filtra per regione selezionata (mostra solo le province della regione)
        if (state.regioneSelezionata) {
            rows = rows.filter(r => r.regione === state.regioneSelezionata);
        }

        // Ordina per prezzo crescente
        rows.sort((a, b) => a[col] - b[col]);

        // Calcolo media nazionale per la colonna "vs naz"
        const mediaNaz = mean(state.data.map(r => r[col]).filter(v => v != null && !isNaN(v)));

        // Limita
        if (state.rankingLimit) rows = rows.slice(0, state.rankingLimit);

        const html = `
            <thead>
                <tr>
                    <th class="rank-num">#</th>
                    <th>Provincia</th>
                    <th class="num">Prezzo</th>
                    <th class="num">vs Naz.</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((r, i) => {
                    const delta = ((r[col] - mediaNaz) / mediaNaz) * 100;
                    const deltaStr = (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%";
                    const deltaColor = delta < 0 ? "#16a34a" : "#dc2626";
                    return `
                        <tr data-sigla="${r.provincia_sigla}">
                            <td class="rank-num">${i + 1}</td>
                            <td>${r.provincia_nome} <small style="color:#9ca3af">(${r.provincia_sigla})</small></td>
                            <td class="num">${formatPrice(r[col])}</td>
                            <td class="num" style="color:${deltaColor}">${deltaStr}</td>
                        </tr>
                    `;
                }).join("")}
            </tbody>
        `;
        const table = document.getElementById("ranking-table");
        table.innerHTML = html;

        // Hover sulla riga = evidenzia sulla mappa
        table.querySelectorAll("tbody tr").forEach(tr => {
            tr.addEventListener("mouseenter", () => {
                ItalyMap.highlightProvince(tr.dataset.sigla);
            });
            tr.addEventListener("mouseleave", () => {
                ItalyMap.highlightProvince(null);
            });
        });
    }

    /**
     * Tooltip su hover di una provincia sulla mappa.
     */
    function handleProvinceHover(sigla, event) {
        const tooltip = document.getElementById("map-tooltip");
        if (!sigla || !tooltip) {
            if (tooltip) tooltip.style.opacity = 0;
            return;
        }

        const info = CARBURANTI_INFO[state.carburante];
        const provincia = state.data.find(r => r.provincia_sigla === sigla);
        const anagr = state.anagrafica[sigla];

        if (!provincia && !anagr) {
            tooltip.style.opacity = 0;
            return;
        }

        const nome = anagr ? anagr.nome : sigla;
        const regione = anagr ? anagr.regione : "n.d.";
        const prezzo = provincia ? provincia[info.col] : null;
        const nImpianti = provincia ? provincia.n_impianti : null;

        tooltip.innerHTML = `
            <div class="tt-title">${nome} <small>(${sigla})</small></div>
            <div class="tt-row"><span class="tt-label">Regione:</span><span class="tt-value">${regione}</span></div>
            <div class="tt-row"><span class="tt-label">${info.label}:</span><span class="tt-value">${prezzo != null ? formatPrice(prezzo) + " " + info.unit : "n.d."}</span></div>
            ${nImpianti != null ? `<div class="tt-row"><span class="tt-label">Impianti rilevati:</span><span class="tt-value">${nImpianti}</span></div>` : ""}
        `;

        // Posiziona tooltip vicino al cursore
        if (event) {
            const x = event.pageX + 12;
            const y = event.pageY - 10;
            tooltip.style.left = x + "px";
            tooltip.style.top = y + "px";
        }
        tooltip.style.opacity = 1;
    }

    function handleProvinceClick(sigla) {
        // Click sulla mappa = seleziona provincia
        handleProvinciaSelezionata(sigla);
    }

    /**
     * Quando l'utente seleziona una provincia (da finder o click mappa):
     * - mostra il badge in alto
     * - evidenzia la provincia sulla mappa
     * - filtra la classifica a quella sola provincia
     */
    function handleProvinciaSelezionata(sigla) {
        state.provinciaSelezionata = sigla;
        const anagr = state.anagrafica[sigla];
        if (!anagr) return;

        const badge = document.getElementById("selected-province-badge");
        const badgeNome = document.getElementById("badge-nome");
        badgeNome.textContent = `${anagr.nome} (${sigla}) – ${anagr.regione}`;
        badge.classList.add("active");

        ItalyMap.highlightProvince(sigla);
        renderRanking();
    }

    /**
     * Reset selezione provincia.
     */
    /**
     * Quando l'utente seleziona una regione dal finder:
     * - mostra il badge con il nome della regione
     * - filtra mappa e classifica a tutte le province di quella regione
     */
    function handleRegioneSelezionata(nomeRegione, sigleProvince) {
        state.provinciaSelezionata = null;
        state.regioneSelezionata = nomeRegione;
        state.regioneSigle = sigleProvince || [];

        const badge = document.getElementById("selected-province-badge");
        const badgeNome = document.getElementById("badge-nome");
        badgeNome.textContent = `${nomeRegione} (${state.regioneSigle.length} province)`;
        badge.classList.add("active");

        ItalyMap.highlightProvince(null);
        // Sbiadisce tutte le province che NON sono nella regione selezionata
        ItalyMap.filterByProvinceSet(state.regioneSigle);
        renderRanking();
    }

    /**
     * Reset completo della selezione (provincia o regione).
     */
    function handleSelezioneRimossa() {
        state.provinciaSelezionata = null;
        state.regioneSelezionata = null;
        state.regioneSigle = [];
        const badge = document.getElementById("selected-province-badge");
        badge.classList.remove("active");
        ItalyMap.highlightProvince(null);
        ItalyMap.filterByProvinceSet(null); // ripristina tutte
        // Riapplica eventuale filtro macro-area
        applyMacroAreaToMap();
        renderRanking();
    }

    /**
     * Ri-applica il filtro macro-area corrente alla mappa
     * (utile dopo deselezione regione).
     */
    function applyMacroAreaToMap() {
        const macroLabel = {
            italia: null,
            nord: "Nord",
            centro: "Centro",
            sud: "Sud e Isole",
        }[state.macroArea];
        ItalyMap.filterByMacroArea(macroLabel);
    }

    /**
     * Reset chiamato dal pulsante "× Mostra tutta Italia"
     */
    function handleProvinciaDeseleziona() {
        handleSelezioneRimossa();
    }

    // ─── Utility ─────────────────────────────────────────────────────

    function mean(arr) {
        if (!arr || arr.length === 0) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    function formatPrice(v) {
        if (v == null || isNaN(v)) return "n.d.";
        return v.toFixed(3).replace(".", ",");
    }

    function diffNazionale(media, mediaNaz) {
        if (media == null || mediaNaz == null) return "";
        const delta = ((media - mediaNaz) / mediaNaz) * 100;
        const sign = delta >= 0 ? "+" : "";
        return `${sign}${delta.toFixed(1)}% vs media Italia`;
    }

    function showError(msg) {
        const tab = document.getElementById("tab-prezzi-correnti");
        tab.innerHTML = `<div class="error-message">${msg}</div>`;
    }

    return {
        init,
    };
})();

window.PrezziCorrentiTab = PrezziCorrentiTab;
