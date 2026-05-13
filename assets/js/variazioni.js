/**
 * Tab Variazioni % — Dashboard Energia Italia
 *
 * Calcola e visualizza le variazioni percentuali dei prezzi di:
 * - Carburanti (benzina, gasolio, GPL, metano) - granularità settimanale provinciale
 * - Elettricità tutela ARERA - granularità trimestrale nazionale (sezione separata)
 *
 * Logica "si popola da sola":
 * - Se ci sono <2 settimane di dati carburanti, mostra placeholder informativo
 * - Selettore periodo: settimana / 4 settimane / 13 settimane / custom
 * - Preset disabilitati automaticamente se mancano i dati
 *
 * Sorgenti:
 * - tab "prezzi_carburanti_provinciale" (settimanale × provincia)
 * - tab "prezzi_finali_arera" (trimestrale, filtro tipo_dato=elettricita_tutela_2700)
 */

const VariazioniTab = (function () {

    const TAB_CARBURANTI = "prezzi_carburanti_provinciale";
    const TAB_ARERA = "prezzi_finali_arera";
    const TIPO_DATO_ARERA = "elettricita_tutela_2700";

    const CARBURANTI = [
        { key: "benzina_self_eur_l", label: "Benzina (self)", unita: "€/l", colore: "#1e3a8a" },
        { key: "gasolio_self_eur_l", label: "Gasolio (self)", unita: "€/l", colore: "#dc2626" },
        { key: "gpl_eur_l",          label: "GPL",            unita: "€/l", colore: "#16a34a" },
        { key: "metano_eur_kg",      label: "Metano",         unita: "€/kg", colore: "#f59e0b" },
    ];

    const COMPONENTI_ELETTRICITA = [
        { key: "valore",          label: "Totale",         primary: true },
        { key: "materia_energia", label: "Materia energia" },
        { key: "trasporto",       label: "Trasporto"       },
        { key: "oneri_sistema",   label: "Oneri sistema"   },
        { key: "imposte",         label: "Imposte"         },
    ];

    const TRIM_ORDER = { "I": 1, "II": 2, "III": 3, "IV": 4 };

    // Stato modulo
    let _carburantiData = null;       // tutti i record carburanti
    let _settimaneDisponibili = [];   // array di date lunedì YYYY-MM-DD ordinate
    let _areraData = null;            // tutti i record ARERA elettricità
    let _initialized = false;

    // Stato UI
    let _selectedPeriodo = "settimana"; // "settimana" | "4settimane" | "13settimane" | "custom"
    let _customDataFrom = null;
    let _customDataTo = null;
    let _selectedProvincia = null;    // sigla o null per "tutta Italia"
    let _selectedRegione = null;      // nome regione o null

    async function init() {
        if (_initialized) return;
        const container = document.getElementById("tab-variazioni");
        if (!container) {
            console.error("[VariazioniTab] Container #tab-variazioni non trovato");
            return;
        }
        container.innerHTML = '<div class="loading">Caricamento dati per analisi variazioni...</div>';

        try {
            // Carica entrambe le fonti in parallelo
            const [carburanti, arera] = await Promise.all([
                DataLoader.loadTab(TAB_CARBURANTI).catch(() => []),
                DataLoader.loadTab(TAB_ARERA).catch(() => []),
            ]);

            _carburantiData = carburanti;
            _settimaneDisponibili = estraiSettimaneDisponibili(carburanti);

            _areraData = arera
                .filter(r => r.tipo_dato === TIPO_DATO_ARERA)
                .map(normalizzaRecordArera)
                .filter(r => r.valore !== null && r.anno && r.trim)
                .sort(comparaArera);

            renderLayout(container);
            renderSezioneCarburanti();
            renderSezioneElettricita();
            _initialized = true;

        } catch (err) {
            console.error("[VariazioniTab] Errore:", err);
            container.innerHTML = renderError(
                "Impossibile caricare i dati. Riprovare con il pulsante &#x21bb;. " +
                `Dettaglio: <code>${escapeHtml((err && err.message) || String(err))}</code>`
            );
        }
    }

    // ============================================================
    // PARSING DATI
    // ============================================================

    function estraiSettimaneDisponibili(records) {
        const s = new Set();
        records.forEach(r => {
            if (r.data_settimana) s.add(String(r.data_settimana));
        });
        return Array.from(s).sort();  // ordine crescente
    }

    function normalizzaRecordArera(r) {
        const periodoStr = String(r.periodo || "").trim();
        const m = periodoStr.match(/^(IV|III|II|I)\s+(\d{4})$/);
        return {
            periodo: periodoStr,
            trim: m ? m[1] : null,
            anno: m ? parseInt(m[2], 10) : null,
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

    function toNum(v) {
        if (v === null || v === undefined || v === "") return null;
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }

    // ============================================================
    // LAYOUT GENERALE
    // ============================================================

    function renderLayout(container) {
        container.innerHTML = `
            <div class="var-header">
                <h2 class="var-title">Variazioni dei prezzi</h2>
                <p class="var-subtitle">
                    Confronto periodi: media provinciale carburanti (settimanale)
                    e tutela elettricità (trimestrale).
                </p>
            </div>

            <div class="var-controls">
                <div class="var-control-group">
                    <span class="var-control-label">Periodo di confronto:</span>
                    <div class="var-radio-group" id="var-periodo-group">
                        ${renderPeriodoButton("settimana", "Settimana precedente", 2)}
                        ${renderPeriodoButton("4settimane", "4 settimane fa", 5)}
                        ${renderPeriodoButton("13settimane", "13 settimane fa", 14)}
                        ${renderPeriodoButton("custom", "Personalizzato", 2)}
                    </div>
                </div>
                <div class="var-control-group var-custom-dates" id="var-custom-dates" style="display:none">
                    <span class="var-control-label">Da:</span>
                    <input type="date" id="var-date-from">
                    <span class="var-control-label">a:</span>
                    <input type="date" id="var-date-to">
                </div>
            </div>

            <div class="var-status-bar" id="var-status-bar"></div>

            <!-- SEZIONE CARBURANTI -->
            <div class="var-section">
                <h3 class="var-section-title">
                    Carburanti — confronto provinciale
                    <span class="var-section-source">Fonte: MIMIT · IODL 2.0</span>
                </h3>
                <div id="var-carburanti-content"></div>
            </div>

            <!-- SEZIONE ELETTRICITA -->
            <div class="var-section">
                <h3 class="var-section-title">
                    Elettricità tutela — confronto trimestrale
                    <span class="var-section-source">Fonte: ARERA · Trimestrale</span>
                </h3>
                <div id="var-elettricita-content"></div>
            </div>

            <div class="fonte-dato">
                <strong>Note:</strong>
                Le variazioni carburanti si basano sulla media provinciale settimanale del prezzo
                self-service rilevato da MIMIT (oltre 22.000 impianti).
                Le variazioni elettricità si riferiscono al servizio di tutela per consumatore
                domestico tipo (3 kW · 2.700 kWh/anno) pubblicato trimestralmente da ARERA.
                Una variazione positiva indica un aumento del prezzo.
            </div>
        `;

        // Wiring eventi
        document.querySelectorAll('input[name="var-periodo"]').forEach(input => {
            input.addEventListener("change", onPeriodoChange);
        });
        const dateFrom = document.getElementById("var-date-from");
        const dateTo = document.getElementById("var-date-to");
        if (dateFrom && dateTo) {
            dateFrom.addEventListener("change", onCustomDateChange);
            dateTo.addEventListener("change", onCustomDateChange);
            // Default custom: prima settimana → ultima settimana
            if (_settimaneDisponibili.length > 0) {
                dateFrom.value = _settimaneDisponibili[0];
                dateTo.value = _settimaneDisponibili[_settimaneDisponibili.length - 1];
            }
        }
    }

    function renderPeriodoButton(value, label, minSettimane) {
        const disabled = _settimaneDisponibili.length < minSettimane;
        const checked = (value === _selectedPeriodo) ? "checked" : "";
        const disAttr = disabled ? "disabled" : "";
        const id = `var-periodo-${value}`;
        const tooltip = disabled
            ? `data-tooltip="Richiede almeno ${minSettimane} settimane di dati"`
            : "";
        return `
            <label for="${id}" class="var-radio-label ${disabled ? 'disabled' : ''}" ${tooltip}>
                <input type="radio" name="var-periodo" id="${id}" value="${value}" ${checked} ${disAttr}>
                <span>${label}</span>
            </label>
        `;
    }

    function onPeriodoChange(e) {
        _selectedPeriodo = e.target.value;
        const customDates = document.getElementById("var-custom-dates");
        if (customDates) {
            customDates.style.display = (_selectedPeriodo === "custom") ? "flex" : "none";
        }
        renderSezioneCarburanti();
    }

    function onCustomDateChange() {
        const dateFrom = document.getElementById("var-date-from");
        const dateTo = document.getElementById("var-date-to");
        _customDataFrom = dateFrom.value || null;
        _customDataTo = dateTo.value || null;
        if (_selectedPeriodo === "custom") {
            renderSezioneCarburanti();
        }
    }

    // ============================================================
    // SEZIONE CARBURANTI
    // ============================================================

    function renderSezioneCarburanti() {
        const container = document.getElementById("var-carburanti-content");
        const statusBar = document.getElementById("var-status-bar");
        if (!container || !statusBar) return;

        const n = _settimaneDisponibili.length;

        // Stato dati: aggiorna sempre la status bar
        statusBar.innerHTML = renderStatusBar(n);

        // Se meno di 2 settimane, mostra placeholder
        if (n < 2) {
            container.innerHTML = renderPlaceholderCarburanti(n);
            return;
        }

        // Determina settimana corrente e settimana di confronto
        const periodo = determinaPeriodoCarburanti();
        if (!periodo) {
            container.innerHTML = `
                <div class="var-empty">
                    Periodo selezionato non disponibile con i dati attuali.
                    Provare un periodo più breve.
                </div>
            `;
            return;
        }

        const { settimanaCorrente, settimanaConfronto, label } = periodo;

        // Calcola le variazioni per ogni carburante (Italia o filtro)
        const variazioniGlobali = calcolaVariazioniGlobali(settimanaCorrente, settimanaConfronto);

        // Top province per variazione (sul primo carburante con dati)
        const topProvince = calcolaTopProvince(settimanaCorrente, settimanaConfronto);

        container.innerHTML = `
            <div class="var-period-info">
                Confronto <strong>${formatDateIT(settimanaCorrente)}</strong> vs
                <strong>${formatDateIT(settimanaConfronto)}</strong>
                <span class="var-period-label">(${label})</span>
            </div>

            <div class="var-kpi-grid">
                ${variazioniGlobali.map(v => renderKpiVariazione(v)).join("")}
            </div>

            ${renderClassificaProvince(topProvince, settimanaCorrente, settimanaConfronto)}
        `;
    }

    function renderStatusBar(nSettimane) {
        if (nSettimane === 0) {
            return `
                <div class="var-status var-status-warning">
                    ⚠ Nessun dato carburanti disponibile sul foglio. Verificare l'esecuzione dell'ETL MIMIT.
                </div>
            `;
        }
        if (nSettimane === 1) {
            const sett = _settimaneDisponibili[0];
            const prossimaSett = aggiungiSettimane(sett, 1);
            return `
                <div class="var-status var-status-info">
                    📊 Disponibile <strong>1 settimana</strong> di dati carburanti (${formatDateIT(sett)}).
                    Prima variazione settimanale calcolabile dal <strong>${formatDateIT(prossimaSett)}</strong>.
                    La pagina si aggiornerà automaticamente al completarsi della prossima settimana.
                </div>
            `;
        }
        const prima = _settimaneDisponibili[0];
        const ultima = _settimaneDisponibili[nSettimane - 1];
        return `
            <div class="var-status var-status-ok">
                ✓ Disponibili <strong>${nSettimane} settimane</strong> di dati carburanti
                (dal ${formatDateIT(prima)} al ${formatDateIT(ultima)}).
            </div>
        `;
    }

    function renderPlaceholderCarburanti(nSettimane) {
        if (nSettimane === 0) {
            return `<div class="var-empty">Nessun dato disponibile.</div>`;
        }
        const sett = _settimaneDisponibili[0];
        const prossima = aggiungiSettimane(sett, 1);
        return `
            <div class="var-empty">
                <div class="var-empty-title">Variazioni in raccolta</div>
                <div class="var-empty-desc">
                    Per calcolare una variazione settimanale servono almeno
                    <strong>2 settimane</strong> di rilevazioni.
                    Attualmente è disponibile la settimana del <strong>${formatDateIT(sett)}</strong>.
                </div>
                <div class="var-empty-desc">
                    Prima variazione settimanale: <strong>${formatDateIT(prossima)}</strong>.
                    La pagina si popolerà automaticamente.
                </div>
            </div>
        `;
    }

    function determinaPeriodoCarburanti() {
        const n = _settimaneDisponibili.length;
        if (n < 2) return null;
        const ultima = _settimaneDisponibili[n - 1];

        if (_selectedPeriodo === "settimana") {
            return {
                settimanaCorrente: ultima,
                settimanaConfronto: _settimaneDisponibili[n - 2],
                label: "settimanale",
            };
        }
        if (_selectedPeriodo === "4settimane") {
            if (n < 5) return null;
            return {
                settimanaCorrente: ultima,
                settimanaConfronto: _settimaneDisponibili[n - 5],
                label: "4 settimane",
            };
        }
        if (_selectedPeriodo === "13settimane") {
            if (n < 14) return null;
            return {
                settimanaCorrente: ultima,
                settimanaConfronto: _settimaneDisponibili[n - 14],
                label: "13 settimane",
            };
        }
        if (_selectedPeriodo === "custom") {
            if (!_customDataFrom || !_customDataTo) return null;
            if (_customDataFrom >= _customDataTo) return null;
            // Trova le settimane più vicine
            const sConf = trovaSettimanaPiuVicina(_customDataFrom);
            const sCorr = trovaSettimanaPiuVicina(_customDataTo);
            if (!sConf || !sCorr || sConf === sCorr) return null;
            return {
                settimanaCorrente: sCorr,
                settimanaConfronto: sConf,
                label: "intervallo personalizzato",
            };
        }
        return null;
    }

    function trovaSettimanaPiuVicina(dataStr) {
        // Restituisce la settimana esatta se esiste, altrimenti la più vicina
        if (_settimaneDisponibili.includes(dataStr)) return dataStr;
        // Trova quella minore-uguale più alta, altrimenti la prima maggiore
        let scelta = null;
        for (const s of _settimaneDisponibili) {
            if (s <= dataStr) scelta = s;
            else if (!scelta) scelta = s;
        }
        return scelta;
    }

    function calcolaVariazioniGlobali(settCorr, settConf) {
        // Media nazionale (o filtrata) per ogni carburante, su 2 settimane
        return CARBURANTI.map(c => {
            const valCorr = mediaCarburante(settCorr, c.key);
            const valConf = mediaCarburante(settConf, c.key);
            const delta = (valCorr !== null && valConf !== null) ? valCorr - valConf : null;
            const pct = (delta !== null && valConf > 0) ? (delta / valConf) * 100 : null;
            return {
                ...c,
                valCorr,
                valConf,
                delta,
                pct,
            };
        });
    }

    function mediaCarburante(settimana, campo) {
        // Filtra per settimana, applica eventuale filtro provincia/regione
        let recs = _carburantiData.filter(r => String(r.data_settimana) === settimana);
        if (_selectedProvincia) {
            recs = recs.filter(r => r.provincia_sigla === _selectedProvincia);
        } else if (_selectedRegione) {
            recs = recs.filter(r => r.regione === _selectedRegione);
        }
        const vals = recs.map(r => toNum(r[campo])).filter(v => v !== null && v > 0);
        if (vals.length === 0) return null;
        return vals.reduce((s, v) => s + v, 0) / vals.length;
    }

    function calcolaTopProvince(settCorr, settConf) {
        // Per ogni provincia, calcola variazione % per ogni carburante
        // Restituisce per ogni carburante: top 5 aumenti e top 5 diminuzioni
        const result = {};
        const provinceSet = new Set();
        _carburantiData
            .filter(r => String(r.data_settimana) === settCorr)
            .forEach(r => provinceSet.add(r.provincia_sigla));

        CARBURANTI.forEach(c => {
            const variazioniProv = [];
            provinceSet.forEach(sigla => {
                const recCorr = _carburantiData.find(
                    r => String(r.data_settimana) === settCorr && r.provincia_sigla === sigla
                );
                const recConf = _carburantiData.find(
                    r => String(r.data_settimana) === settConf && r.provincia_sigla === sigla
                );
                if (!recCorr || !recConf) return;
                const vc = toNum(recCorr[c.key]);
                const vp = toNum(recConf[c.key]);
                if (vc === null || vp === null || vp <= 0) return;
                const pct = (vc - vp) / vp * 100;
                variazioniProv.push({
                    sigla,
                    provincia_nome: recCorr.provincia_nome,
                    regione: recCorr.regione,
                    valCorr: vc,
                    valConf: vp,
                    pct,
                });
            });
            variazioniProv.sort((a, b) => b.pct - a.pct);
            result[c.key] = {
                top: variazioniProv.slice(0, 5),
                bottom: variazioniProv.slice(-5).reverse(),
            };
        });
        return result;
    }

    function renderKpiVariazione(v) {
        if (v.valCorr === null || v.valConf === null) {
            return `
                <div class="var-kpi-card">
                    <h4>${escapeHtml(v.label)}</h4>
                    <div class="var-kpi-empty">—</div>
                    <div class="var-kpi-note">Dato non disponibile</div>
                </div>
            `;
        }
        const isUp = v.delta > 0;
        const isDown = v.delta < 0;
        const trendClass = isUp ? "up" : (isDown ? "down" : "neutral");
        const trendIcon = isUp ? "▲" : (isDown ? "▼" : "—");
        const segno = isUp ? "+" : "";
        return `
            <div class="var-kpi-card var-trend-${trendClass}">
                <h4>${escapeHtml(v.label)}</h4>
                <div class="var-kpi-pct">${trendIcon} ${segno}${fmtIT(v.pct, 2)}%</div>
                <div class="var-kpi-value">
                    ${fmtIT(v.valCorr, 4)} ${escapeHtml(v.unita)}
                </div>
                <div class="var-kpi-note">
                    da ${fmtIT(v.valConf, 4)}
                    (${segno}${fmtIT(v.delta, 4)} ${escapeHtml(v.unita)})
                </div>
            </div>
        `;
    }

    function renderClassificaProvince(topProvince, settCorr, settConf) {
        // Mostra solo benzina (carburante più rappresentativo) come default
        const c = CARBURANTI[0]; // benzina
        const dati = topProvince[c.key];
        if (!dati || (dati.top.length === 0 && dati.bottom.length === 0)) {
            return "";
        }
        return `
            <div class="var-classifica">
                <h4 class="var-classifica-title">
                    Province con maggiore variazione — ${escapeHtml(c.label)}
                </h4>
                <div class="var-classifica-grid">
                    <div>
                        <h5 class="var-classifica-section var-trend-up">Top 5 aumenti</h5>
                        <table class="var-classifica-table">
                            <thead>
                                <tr><th>Provincia</th><th>Regione</th><th class="num">Var %</th><th class="num">€/l</th></tr>
                            </thead>
                            <tbody>
                                ${dati.top.map(p => renderRigaProvincia(p, c.unita)).join("")}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <h5 class="var-classifica-section var-trend-down">Top 5 diminuzioni</h5>
                        <table class="var-classifica-table">
                            <thead>
                                <tr><th>Provincia</th><th>Regione</th><th class="num">Var %</th><th class="num">€/l</th></tr>
                            </thead>
                            <tbody>
                                ${dati.bottom.map(p => renderRigaProvincia(p, c.unita)).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    function renderRigaProvincia(p, unita) {
        const segno = p.pct >= 0 ? "+" : "";
        const trendClass = p.pct > 0 ? "up" : (p.pct < 0 ? "down" : "neutral");
        return `
            <tr>
                <td><strong>${escapeHtml(p.sigla)}</strong> ${escapeHtml(p.provincia_nome || "")}</td>
                <td>${escapeHtml(p.regione || "")}</td>
                <td class="num var-trend-${trendClass}">${segno}${fmtIT(p.pct, 2)}%</td>
                <td class="num">${fmtIT(p.valCorr, 4)}</td>
            </tr>
        `;
    }

    // ============================================================
    // SEZIONE ELETTRICITÀ
    // ============================================================

    function renderSezioneElettricita() {
        const container = document.getElementById("var-elettricita-content");
        if (!container) return;

        if (!_areraData || _areraData.length < 2) {
            container.innerHTML = `
                <div class="var-empty">
                    Dati ARERA insufficienti per calcolare variazioni trimestrali.
                </div>
            `;
            return;
        }

        const n = _areraData.length;
        const corrente = _areraData[n - 1];
        const precedente = _areraData[n - 2];
        // Annuale: 4 trimestri prima
        const annuale = (n >= 5) ? _areraData[n - 5] : null;

        container.innerHTML = `
            <div class="var-period-info">
                Trimestre corrente: <strong>${escapeHtml(corrente.periodo)}</strong>
                · Confronto con trimestre precedente <strong>${escapeHtml(precedente.periodo)}</strong>
                ${annuale ? ` e con stesso trimestre anno precedente <strong>${escapeHtml(annuale.periodo)}</strong>` : ""}
            </div>

            <div class="var-elt-grid">
                ${COMPONENTI_ELETTRICITA.map(comp => renderRigaElettricita(comp, corrente, precedente, annuale)).join("")}
            </div>
        `;
    }

    function renderRigaElettricita(comp, corr, prec, ann) {
        const vc = corr[comp.key];
        const vp = prec[comp.key];
        const va = ann ? ann[comp.key] : null;

        const pctTrim = (vc !== null && vp !== null && vp > 0) ? ((vc - vp) / vp * 100) : null;
        const pctAnn = (vc !== null && va !== null && va > 0) ? ((vc - va) / va * 100) : null;

        const primaryClass = comp.primary ? "var-elt-row-primary" : "";

        return `
            <div class="var-elt-row ${primaryClass}">
                <div class="var-elt-label">${escapeHtml(comp.label)}</div>
                <div class="var-elt-value">${fmtIT(vc, 2)} <span class="var-elt-unit">c€/kWh</span></div>
                <div class="var-elt-trend">
                    ${renderTrendCella(pctTrim, "vs trim. prec.")}
                </div>
                <div class="var-elt-trend">
                    ${ann ? renderTrendCella(pctAnn, "vs anno prec.") : '<span class="var-elt-na">—</span>'}
                </div>
            </div>
        `;
    }

    function renderTrendCella(pct, label) {
        if (pct === null) return '<span class="var-elt-na">—</span>';
        const trendClass = pct > 0 ? "up" : (pct < 0 ? "down" : "neutral");
        const icon = pct > 0 ? "▲" : (pct < 0 ? "▼" : "—");
        const segno = pct > 0 ? "+" : "";
        return `
            <span class="var-trend-${trendClass}">
                ${icon} ${segno}${fmtIT(pct, 2)}%
            </span>
            <span class="var-elt-trend-label">${label}</span>
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

    return { init };
})();

window.VariazioniTab = VariazioniTab;
