/**
 * App principale Dashboard Energia Italia
 *
 * Orchestra navigazione tab, caricamento dati, bootstrap iniziale.
 *
 * v1.3 (2026-05-13): aggiunto routing per tab Serie storica (Fase 6).
 *                    Rimossa tab "Spesa stimata".
 */

let tabsLoaded = {
    "prezzi-correnti": false,
    "elettricita": false,
    "variazioni": false,
    "serie-storica": false,
    "reportistica": false,
    "metodologia": false,
};

document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initRefreshButton();
    initPrintButton();
    initFooterMeta();
    initTopbarKpis();
    initFonti();

    // Carica subito la prima tab attiva
    loadTab("prezzi-correnti");
});

/**
 * Gestione cambio tab + caricamento lazy del contenuto.
 */
function initTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const targetTab = button.dataset.tab;

            tabButtons.forEach(b => b.classList.remove("active"));
            button.classList.add("active");

            tabContents.forEach(c => c.classList.remove("active"));
            const target = document.getElementById(`tab-${targetTab}`);
            if (target) target.classList.add("active");

            loadTab(targetTab);
        });
    });
}

/**
 * Carica il contenuto di una tab al primo accesso.
 */
function loadTab(tabName) {
    if (tabsLoaded[tabName]) return;

    switch (tabName) {
        case "prezzi-correnti":
            if (window.PrezziCorrentiTab) {
                PrezziCorrentiTab.init();
                tabsLoaded[tabName] = true;
            }
            break;
        case "elettricita":
            if (window.ElettricitaTab) {
                ElettricitaTab.init();
                tabsLoaded[tabName] = true;
            }
            break;
        case "variazioni":
            if (window.VariazioniTab) {
                VariazioniTab.init();
                tabsLoaded[tabName] = true;
            }
            break;
        case "serie-storica":
            if (window.SerieStoricaTab) {
                SerieStoricaTab.init();
                tabsLoaded[tabName] = true;
            }
            break;
        case "reportistica":
            if (window.ReportisticaTab) {
                ReportisticaTab.init();
                tabsLoaded[tabName] = true;
            }
            break;
        case "metodologia":
            if (window.MetodologiaTab) {
                MetodologiaTab.init();
                tabsLoaded[tabName] = true;
            }
            break;
        default:
            console.log(`[App] Tab "${tabName}" non ancora implementata`);
    }
}

/**
 * Bottone refresh: svuota cache e ricarica la tab corrente.
 */
function initRefreshButton() {
    const btn = document.getElementById("btn-refresh");
    if (!btn) return;
    btn.addEventListener("click", () => {
        if (window.DataLoader) DataLoader.clearCache();
        for (const key in tabsLoaded) tabsLoaded[key] = false;
        const activeBtn = document.querySelector(".tab-btn.active");
        if (activeBtn) loadTab(activeBtn.dataset.tab);
        updateLastRefresh();
        initTopbarKpis();
    });
}

/**
 * Footer: versione + ultimo aggiornamento.
 */
async function initFooterMeta() {
    const versionEl = document.getElementById("version");
    if (versionEl && window.CONFIG) {
        versionEl.textContent = window.CONFIG.VERSION;
    }
    updateLastRefresh();
}

async function updateLastRefresh() {
    const el = document.getElementById("last-refresh");
    if (!el) return;
    el.textContent = "caricamento...";
    try {
        const ts = await DataLoader.getLastRefresh("MIMIT-carburanti");
        el.textContent = ts || "n.d.";
    } catch (err) {
        el.textContent = "n.d.";
    }
}


/**
 * Bottone stampa: delega alla stampa del browser.
 * Il foglio @media print nasconde navigazione e controlli.
 */
function initPrintButton() {
    const btn = document.getElementById("btn-print");
    if (btn) btn.addEventListener("click", () => window.print());
}

/* ============================================================
   BADGE KPI DELLA TOPBAR
   Sintesi di copertura e prezzi correnti, calcolata sul tab
   prezzi_carburanti_provinciale. Il badge "settimane mancanti"
   usa la variante rossa: e' un indicatore di qualita' del dato,
   non un valore da leggere come gli altri.
   ============================================================ */

const AppStats = { data: null };

function lunediSuccessivo(iso, settimane) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 7 * settimane);
    return d.toISOString().slice(0, 10);
}

/**
 * Conta i lunedi ISO assenti fra la prima e l'ultima settimana caricata.
 * Serve a rendere visibile un buco nella serie invece di lasciarlo implicito.
 */
function settimaneMancanti(settimane) {
    if (settimane.length < 2) return 0;
    const presenti = new Set(settimane);
    let mancanti = 0, cur = settimane[0];
    const ultima = settimane[settimane.length - 1];
    while (cur < ultima) {
        cur = lunediSuccessivo(cur, 1);
        if (cur < ultima && !presenti.has(cur)) mancanti++;
    }
    return mancanti;
}

function fmtIt(v, dec) {
    if (v == null || isNaN(v)) return "—";
    return v.toFixed(dec == null ? 3 : dec).replace(".", ",");
}

async function initTopbarKpis() {
    const box = document.getElementById("topbar-kpis");
    if (!box || !window.DataLoader) return;

    try {
        const rows = await DataLoader.loadTab("prezzi_carburanti_provinciale");
        const settimane = [...new Set(rows.map(r => String(r.data_settimana)))].sort();
        const ultima = settimane[settimane.length - 1];
        const penultima = settimane[settimane.length - 2];
        const cur = rows.filter(r => String(r.data_settimana) === ultima);
        const prev = rows.filter(r => String(r.data_settimana) === penultima);

        const media = (arr, k) => {
            const v = arr.map(r => r[k]).filter(x => typeof x === "number" && !isNaN(x));
            return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        };
        const benz = media(cur, "benzina_self_eur_l");
        const gas = media(cur, "gasolio_self_eur_l");
        const gasPrev = media(prev, "gasolio_self_eur_l");
        const varGas = (gas != null && gasPrev) ? (gas / gasPrev - 1) * 100 : null;
        const mancanti = settimaneMancanti(settimane);

        AppStats.data = { rows, settimane, ultima, benz, gas, varGas, mancanti };

        const kpi = (val, lab, alert) =>
            `<div class="tb-kpi${alert ? " alert" : ""}"><b>${val}</b><span>${lab}</span></div>`;

        box.innerHTML =
            kpi(cur.length, "PROVINCE") +
            kpi(settimane.length, "SETTIMANE") +
            kpi(fmtIt(benz), "BENZINA €/L") +
            kpi(fmtIt(gas), "GASOLIO €/L") +
            (mancanti > 0 ? kpi(mancanti, "SETT. MANCANTI", true) : "") +
            kpi(varGas == null ? "—" : (varGas > 0 ? "+" : "") + fmtIt(varGas, 2) + "%", "VAR. SETTIMANA");

        const sub = document.getElementById("header-subtitle");
        if (sub) {
            sub.textContent =
                `Prezzi carburanti provinciali · settimana ISO ${formattaData(ultima)} · fonte MIMIT`;
        }
    } catch (err) {
        console.warn("[App] KPI topbar non disponibili:", err);
        box.innerHTML = "";
    }
}

const MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

function formattaData(iso) {
    if (!iso) return "—";
    const p = String(iso).split("-");
    if (p.length !== 3) return String(iso);
    return `${parseInt(p[2], 10)} ${MESI_IT[parseInt(p[1], 10) - 1]} ${p[0]}`;
}

window.AppStats = AppStats;
window.formattaData = formattaData;
window.fmtIt = fmtIt;


/* ============================================================
   BARRA DELLE FONTI IN TESTATA
   Ogni fonte e' raggiungibile con un clic, e accanto sta il link
   al foglio dati in sola lettura: chi legge un numero deve poter
   risalire da dove viene senza chiedere a nessuno.
   ============================================================ */

function initFonti() {
    const box = document.getElementById("header-sources");
    if (!box || !window.CONFIG || !CONFIG.FONTI) return;

    const link = f =>
        `<a href="${f.url}" target="_blank" rel="noopener" title="${f.cosa.replace(/"/g, "&quot;")}">${f.ente}</a>`;

    box.innerHTML =
        `<span class="hs-lab">Fonti dati:</span> ` +
        CONFIG.FONTI.map(link).join(" · ") +
        `<a class="hs-sheet" href="${CONFIG.GSHEET_VIEW_URL()}" target="_blank" rel="noopener"
            title="Apre il foglio Google che alimenta il dashboard, in sola lettura">
           ▤ Foglio dati — sola lettura
         </a>`;
}
