/**
 * App principale Dashboard Energia Italia
 *
 * Gestisce navigazione tab e bootstrap iniziale.
 * Le funzionalità complete verranno aggiunte nelle fasi successive.
 */

document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initFooterMeta();
});

/**
 * Gestione del cambio tab
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
        });
    });
}

/**
 * Popola la versione nel footer da CONFIG
 * In Fase 2 sostituiremo il "last-refresh" con il timestamp reale dal Sheet
 */
function initFooterMeta() {
    const versionEl = document.getElementById("version");
    if (versionEl && window.CONFIG) {
        versionEl.textContent = window.CONFIG.VERSION;
    }

    const refreshEl = document.getElementById("last-refresh");
    if (refreshEl) {
        refreshEl.textContent = "dati in popolamento (Fase 2)";
    }
}