/**
 * Tab Metodologia — Dashboard Energia Italia
 *
 * Sezione informativa che descrive fonti, pipeline di elaborazione,
 * metodi di aggregazione, limiti dei dati e licenze.
 *
 * Contenuto prevalentemente statico; l'unica parte dinamica è la
 * tabella "Stato aggiornamenti", popolata dal tab `metadati_aggiornamento`
 * del Google Sheet (ultima esecuzione per fonte, con esito).
 *
 * Pattern: stessa architettura di ElettricitaTab / VariazioniTab.
 */

const MetodologiaTab = (function () {

    const TAB_METADATI = "metadati_aggiornamento";

    const URL_MIMIT = "https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti";
    const URL_ARERA = "https://www.arera.it/dati-e-statistiche/dettaglio/aggiornamenti-delle-condizioni-di-tutela-elettricita";
    const URL_OPENPOLIS = "https://github.com/openpolis/geojson-italy";
    const URL_REPO = (window.CONFIG && CONFIG.REPO_URL) || "https://github.com/poggig1971/dashboard-energia-italia";

    let container = null;

    /**
     * Inizializza la tab: render del contenuto statico + caricamento
     * asincrono della tabella aggiornamenti.
     */
    async function init() {
        container = document.getElementById("tab-metodologia");
        if (!container) {
            console.error("[Metodologia] Container non trovato");
            return;
        }

        container.innerHTML = renderContenuto();
        caricaStatoAggiornamenti();
    }

    /**
     * Contenuto statico della sezione.
     */
    function renderContenuto() {
        return `
        <div class="met-wrapper">

            <h2 class="met-title">Metodologia</h2>
            <p class="met-intro">
                La presente sezione descrive le fonti utilizzate, le modalità di elaborazione
                e i limiti dei dati pubblicati nella Dashboard. L'obiettivo è garantire piena
                trasparenza e riproducibilità: il codice sorgente completo della pipeline è
                disponibile nel <a href="${URL_REPO}" target="_blank" rel="noopener">repository pubblico</a>.
            </p>

            <details class="met-block" open>
                <summary>Principi generali</summary>
                <div class="met-block-body">
                    <p>La Dashboard adotta i seguenti principi metodologici:</p>
                    <ul>
                        <li>ogni dato visualizzato riporta la <strong>fonte ufficiale</strong>, il
                            <strong>timestamp dell'ultimo aggiornamento</strong> e il
                            <strong>tipo di dato</strong> (misurato, stimato o proxy);</li>
                        <li>in assenza di una fonte ufficiale il valore è indicato esplicitamente
                            come <code>n.d.</code> (non disponibile), senza interpolazioni arbitrarie;</li>
                        <li>le elaborazioni si limitano ad aggregazioni statistiche elementari
                            (medie, variazioni percentuali); non vengono applicati modelli previsionali;</li>
                        <li>i dati sono pubblicati a fini informativi e di studio: per usi ufficiali
                            occorre consultare direttamente le fonti originali.</li>
                    </ul>
                </div>
            </details>

            <details class="met-block" open>
                <summary>Architettura della pipeline</summary>
                <div class="met-block-body">
                    <p>
                        L'aggiornamento è interamente automatizzato. Script ETL in Python, eseguiti
                        su GitHub Actions con frequenze differenziate per fonte, scaricano i dati
                        dalle fonti ufficiali, li aggregano e li scrivono su un foglio Google Sheets
                        pubblico, che funge da base dati. Il sito (statico, su GitHub Pages) legge
                        i dati dal foglio in formato CSV al momento della consultazione.
                    </p>
                    <pre class="met-pre">Fonti ufficiali (MIMIT, ARERA, ...)
        │  download + aggregazione (ETL Python, GitHub Actions)
        ▼
Google Sheets — foglio master pubblico
        │  lettura CSV (endpoint gviz)
        ▼
Dashboard (GitHub Pages, D3.js)</pre>
                    <p class="met-note">
                        Nota: l'endpoint CSV di Google applica una propria cache lato server;
                        il pulsante di aggiornamento (↻) ricarica i dati ma piccoli ritardi
                        di propagazione (alcuni minuti) sono possibili.
                    </p>
                </div>
            </details>

            <details class="met-block" open>
                <summary>Carburanti — fonte MIMIT</summary>
                <div class="met-block-body">
                    <p>
                        <strong>Fonte:</strong> <a href="${URL_MIMIT}" target="_blank" rel="noopener">MIMIT
                        — Open Data "Carburanti: prezzi praticati e anagrafica degli impianti"</a>
                        (licenza IODL 2.0). File utilizzati: <code>prezzo_alle_8.csv</code>
                        (prezzi comunicati dai gestori, rilevazione delle ore 8:00) e
                        <code>anagrafica_impianti_attivi.csv</code>.
                    </p>
                    <p><strong>Elaborazione</strong> (eseguita quotidianamente):</p>
                    <ul>
                        <li>associazione di ciascun prezzo all'impianto e quindi alla provincia,
                            tramite il codice impianto;</li>
                        <li>per benzina e gasolio si considerano le sole modalità
                            <strong>self-service</strong>; per GPL e metano tutte le modalità;</li>
                        <li>calcolo della <strong>media aritmetica semplice</strong> dei prezzi per
                            provincia e carburante (non ponderata per i volumi erogati, non
                            disponibili nella fonte), con arrotondamento a 4 decimali;</li>
                        <li>il dato è memorizzato con granularità di <strong>settimana ISO</strong>
                            (lunedì come data di riferimento): l'esecuzione quotidiana sovrascrive
                            la settimana corrente, il cui valore corrisponde quindi all'ultima
                            rilevazione giornaliera disponibile;</li>
                        <li>per ogni provincia è riportato il numero di impianti considerati
                            (<code>n_impianti</code>).</li>
                    </ul>
                    <p><strong>Tipo di dato:</strong> misurato (prezzi comunicati dai gestori), aggregato.</p>
                    <p><strong>Limiti noti:</strong> la media non ponderata può differire dal prezzo
                        medio effettivamente pagato; i prezzi sono autodichiarati dai gestori;
                        la serie storica si accumula progressivamente da maggio 2026.</p>
                </div>
            </details>

            <details class="met-block" open>
                <summary>Elettricità — fonte ARERA</summary>
                <div class="met-block-body">
                    <p>
                        <strong>Fonte:</strong> <a href="${URL_ARERA}" target="_blank" rel="noopener">ARERA
                        — Aggiornamenti delle condizioni di tutela elettricità</a>
                        (file <code>eep35new.xlsx</code>, tabella di riferimento per il consumatore tipo).
                    </p>
                    <p>
                        I valori si riferiscono al <strong>consumatore domestico tipo in servizio di
                        maggior tutela</strong> (potenza 3 kW, consumo 2.700 kWh/anno), espressi in
                        <strong>c€/kWh</strong> con frequenza trimestrale, dal 2004 ad oggi. È riportata
                        la scomposizione nelle quattro componenti: materia energia, trasporto e gestione
                        del contatore, oneri di sistema, imposte.
                    </p>
                    <p><strong>Tipo di dato:</strong> misurato (condizioni economiche deliberate da ARERA).</p>
                    <p><strong>Limiti noti:</strong> il dato non rappresenta i prezzi del mercato libero
                        né le condizioni applicate alle utenze non domestiche (es. imprese); ha valore
                        di riferimento per l'andamento generale dei prezzi finali dell'energia elettrica.</p>
                </div>
            </details>

            <details class="met-block" open>
                <summary>Annotazioni eventi nei grafici</summary>
                <div class="met-block-body">
                    <p>
                        Nei grafici delle serie storiche sono annotati eventi rilevanti per il mercato
                        energetico (es. conflitti internazionali, interventi sulle accise), al solo fine
                        di facilitare la lettura. Le date sono tratte da provvedimenti normativi e fonti
                        di cronaca; l'elenco completo è definito nel file di configurazione pubblico
                        (<code>assets/js/config.js</code>).
                    </p>
                </div>
            </details>

            <details class="met-block" open>
                <summary>Stato aggiornamenti</summary>
                <div class="met-block-body">
                    <p>Ultima esecuzione registrata per ciascuna fonte (dal log automatico della pipeline):</p>
                    <div id="met-aggiornamenti">
                        <p class="met-note">Caricamento stato aggiornamenti...</p>
                    </div>
                </div>
            </details>

            <details class="met-block" open>
                <summary>Licenze e citazione</summary>
                <div class="met-block-body">
                    <ul>
                        <li><strong>Dati MIMIT:</strong> licenza
                            <a href="https://www.dati.gov.it/iodl/2.0/" target="_blank" rel="noopener">IODL 2.0</a>;</li>
                        <li><strong>Dati ARERA:</strong> dati pubblici, citazione della fonte obbligatoria;</li>
                        <li><strong>Confini provinciali:</strong>
                            <a href="${URL_OPENPOLIS}" target="_blank" rel="noopener">Openpolis / geojson-italy</a>
                            (CC-BY 4.0, su dati ISTAT);</li>
                        <li><strong>Codice sorgente della Dashboard:</strong> pubblico, disponibile su
                            <a href="${URL_REPO}" target="_blank" rel="noopener">GitHub</a>.</li>
                    </ul>
                    <p>
                        Citazione suggerita: <em>"Elaborazione ANCE Piemonte e Valle d'Aosta su dati
                        MIMIT / ARERA — Dashboard Energia Italia"</em>, con indicazione della data
                        di consultazione.
                    </p>
                </div>
            </details>

        </div>`;
    }

    /**
     * Carica il log aggiornamenti e mostra l'ultima esecuzione per fonte.
     */
    async function caricaStatoAggiornamenti() {
        const target = document.getElementById("met-aggiornamenti");
        if (!target) return;

        try {
            const records = await DataLoader.loadTab(TAB_METADATI);

            // Ultima esecuzione per fonte (i record sono in ordine di append)
            const ultimaPerFonte = {};
            records.forEach(r => {
                if (r && r.fonte) ultimaPerFonte[r.fonte] = r;
            });

            const fonti = Object.keys(ultimaPerFonte);
            if (fonti.length === 0) {
                target.innerHTML = `<p class="met-note">Nessun log di aggiornamento disponibile.</p>`;
                return;
            }

            const righe = fonti.map(f => {
                const r = ultimaPerFonte[f];
                const ok = String(r.esito).toLowerCase() === "ok";
                const badge = ok
                    ? `<span class="met-badge met-badge-ok">ok</span>`
                    : `<span class="met-badge met-badge-err">errore</span>`;
                const nRec = (r.record_caricati != null) ? r.record_caricati : "—";
                return `<tr>
                    <td>${escapeHtml(String(f))}</td>
                    <td>${escapeHtml(String(r.data_ultimo_refresh || "n.d."))}</td>
                    <td class="num">${escapeHtml(String(nRec))}</td>
                    <td>${badge}</td>
                </tr>`;
            }).join("");

            target.innerHTML = `
                <table class="ranking-table met-table">
                    <thead>
                        <tr><th>Fonte</th><th>Ultima esecuzione</th><th>Record</th><th>Esito</th></tr>
                    </thead>
                    <tbody>${righe}</tbody>
                </table>
                <p class="met-note">
                    In caso di esito "errore" il dato visualizzato resta quello dell'ultima
                    esecuzione completata con successo.
                </p>`;
        } catch (err) {
            console.warn("[Metodologia] Stato aggiornamenti non disponibile:", err);
            target.innerHTML = `<p class="met-note">Stato aggiornamenti momentaneamente non disponibile.</p>`;
        }
    }

    /**
     * Escape HTML minimale per i valori provenienti dal foglio dati.
     */
    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    return { init };
})();

window.MetodologiaTab = MetodologiaTab;
