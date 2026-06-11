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
    "metodologia": false,
};

document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initRefreshButton();
    initFooterMeta();

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
