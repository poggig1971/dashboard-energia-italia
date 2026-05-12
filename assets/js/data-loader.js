/**
 * Data Loader - Dashboard Energia Italia
 *
 * Carica i dati dai tab del Google Sheet master via gviz CSV endpoint.
 * Gestisce:
 * - Conversione virgola decimale italiana → punto
 * - Caching in-memory dei dati per evitare ri-richieste inutili
 * - Errori di rete con fallback
 */

const DataLoader = (function () {
    // Cache in-memory dei CSV già caricati
    const cache = {};

    /**
     * Carica un tab del Google Sheet come array di oggetti JS.
     * @param {string} tabName - Nome del tab del Google Sheet (es. "prezzi_carburanti_provinciale")
     * @param {boolean} forceReload - Se true, ignora la cache
     * @returns {Promise<Array<Object>>}
     */
    async function loadTab(tabName, forceReload = false) {
        if (!forceReload && cache[tabName]) {
            return cache[tabName];
        }

        const url = window.CONFIG.CSV_BASE_URL(tabName);
        console.log(`[DataLoader] Caricamento tab "${tabName}" da:`, url);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const csvText = await response.text();
            const records = parseCSV(csvText);
            cache[tabName] = records;
            console.log(`[DataLoader] Tab "${tabName}": ${records.length} record caricati`);
            return records;
        } catch (err) {
            console.error(`[DataLoader] Errore caricamento tab "${tabName}":`, err);
            throw err;
        }
    }

    /**
     * Parsing CSV con gestione della virgola decimale italiana.
     * Usa PapaParse se disponibile, altrimenti parser manuale.
     */
    function parseCSV(csvText) {
        if (typeof Papa !== "undefined") {
            const result = Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                transform: function (value, header) {
                    return cleanValue(value);
                },
            });
            return result.data;
        }
        // Fallback manuale (se PapaParse non è disponibile)
        const lines = csvText.split("\n").filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        return lines.slice(1).map(line => {
            const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
            const obj = {};
            headers.forEach((h, i) => {
                obj[h] = cleanValue(values[i] || "");
            });
            return obj;
        });
    }

    /**
     * Pulisce un valore: trim, gestisce numeri con virgola decimale italiana.
     */
    function cleanValue(v) {
        if (v == null || v === "") return null;
        if (typeof v !== "string") return v;
        const trimmed = v.trim();
        if (trimmed === "" || trimmed === "n.d." || trimmed === "n/a") return null;
        // Tenta conversione numerica solo se sembra un numero
        // (gestisce sia "1234,56" italiano sia "1234.56" inglese)
        if (/^-?\d+([,.]\d+)?$/.test(trimmed)) {
            return parseFloat(trimmed.replace(",", "."));
        }
        // Numero intero senza decimali
        if (/^-?\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }
        return trimmed;
    }

    /**
     * Carica più tab in parallelo.
     * @param {Array<string>} tabNames
     * @returns {Promise<Object>}
     */
    async function loadMultiple(tabNames) {
        const promises = tabNames.map(name => loadTab(name).then(data => [name, data]));
        const results = await Promise.all(promises);
        return Object.fromEntries(results);
    }

    /**
     * Recupera il timestamp dell'ultimo aggiornamento da metadati_aggiornamento.
     * @param {string} fonteFilter - es. "MIMIT-carburanti"
     * @returns {Promise<string|null>}
     */
    async function getLastRefresh(fonteFilter = null) {
        try {
            const records = await loadTab("metadati_aggiornamento");
            const filtered = fonteFilter
                ? records.filter(r => r.fonte === fonteFilter && r.esito === "ok")
                : records.filter(r => r.esito === "ok");
            if (filtered.length === 0) return null;
            // Ultimo per data
            filtered.sort((a, b) => (b.data_ultimo_refresh || "").localeCompare(a.data_ultimo_refresh || ""));
            return filtered[0].data_ultimo_refresh;
        } catch (err) {
            console.warn("[DataLoader] Impossibile recuperare ultimo refresh:", err);
            return null;
        }
    }

    /**
     * Reset della cache (usato dal pulsante refresh).
     */
    function clearCache() {
        for (const key in cache) {
            delete cache[key];
        }
        console.log("[DataLoader] Cache svuotata");
    }

    return {
        loadTab,
        loadMultiple,
        getLastRefresh,
        clearCache,
        parseCSV,
    };
})();

window.DataLoader = DataLoader;
