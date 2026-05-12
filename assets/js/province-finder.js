/**
 * Province Finder - Dashboard Energia Italia
 *
 * Componente di ricerca con autocomplete per le 107 province italiane.
 * Permette di trovare una provincia digitando il nome, la sigla, o la regione.
 *
 * Eventi emessi via callback:
 *   onSelect(sigla)  - chiamato quando l'utente seleziona una provincia
 *   onClear()        - chiamato quando l'utente svuota la selezione
 */

const ProvinceFinder = (function () {
    let province = [];      // lista oggetti {sigla, nome, regione, macro_area}
    let onSelect = null;
    let onClear = null;
    let currentSelection = null;
    let highlightedIndex = -1;
    let visibleSuggestions = [];

    /**
     * Inizializza il componente nel container indicato.
     * @param {string} containerSelector - es. "#province-finder-wrap"
     * @param {Array} provinceList - array di {sigla, nome, regione, macro_area}
     * @param {Object} callbacks - { onSelect, onClear }
     */
    function init(containerSelector, provinceList, callbacks = {}) {
        province = provinceList || [];
        onSelect = callbacks.onSelect || null;
        onClear = callbacks.onClear || null;

        const container = document.querySelector(containerSelector);
        if (!container) {
            console.error(`[ProvinceFinder] Container ${containerSelector} non trovato`);
            return;
        }

        container.innerHTML = `
            <div class="province-finder">
                <span class="province-finder-icon">🔍</span>
                <input
                    type="text"
                    id="province-finder-input"
                    placeholder="Cerca provincia (es. Torino, Napoli, MI...)"
                    autocomplete="off"
                >
                <button class="province-finder-clear" id="province-finder-clear" title="Pulisci">×</button>
                <div class="province-finder-dropdown" id="province-finder-dropdown"></div>
            </div>
        `;

        attachEvents();
    }

    function attachEvents() {
        const input = document.getElementById("province-finder-input");
        const clearBtn = document.getElementById("province-finder-clear");
        const dropdown = document.getElementById("province-finder-dropdown");

        input.addEventListener("input", e => {
            const query = e.target.value.trim();
            if (query.length === 0) {
                hideDropdown();
                clearBtn.classList.remove("active");
                return;
            }
            clearBtn.classList.add("active");
            showSuggestions(query);
        });

        input.addEventListener("keydown", e => {
            if (!dropdown.classList.contains("active")) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                moveHighlight(1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                moveHighlight(-1);
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (highlightedIndex >= 0 && visibleSuggestions[highlightedIndex]) {
                    selectProvince(visibleSuggestions[highlightedIndex]);
                } else if (visibleSuggestions.length > 0) {
                    selectProvince(visibleSuggestions[0]);
                }
            } else if (e.key === "Escape") {
                hideDropdown();
                input.blur();
            }
        });

        input.addEventListener("focus", e => {
            const query = e.target.value.trim();
            if (query.length > 0) showSuggestions(query);
        });

        // Chiudi dropdown se click fuori
        document.addEventListener("click", e => {
            if (!e.target.closest(".province-finder")) {
                hideDropdown();
            }
        });

        clearBtn.addEventListener("click", () => {
            input.value = "";
            clearBtn.classList.remove("active");
            hideDropdown();
            clearSelection();
        });
    }

    /**
     * Filtra le province in base alla query e mostra il dropdown.
     */
    function showSuggestions(query) {
        const q = normalize(query);

        visibleSuggestions = province.filter(p => {
            return normalize(p.nome).includes(q)
                || normalize(p.sigla).includes(q)
                || normalize(p.regione).includes(q);
        }).slice(0, 12);

        const dropdown = document.getElementById("province-finder-dropdown");

        if (visibleSuggestions.length === 0) {
            dropdown.innerHTML = `<div class="province-suggestion-empty">Nessuna provincia trovata per "${query}"</div>`;
            dropdown.classList.add("active");
            return;
        }

        dropdown.innerHTML = visibleSuggestions.map((p, i) => `
            <div class="province-suggestion ${i === highlightedIndex ? "highlighted" : ""}" data-index="${i}">
                <span>
                    <span class="prov-sigla">${p.sigla}</span>
                    <span class="prov-name">${p.nome}</span>
                </span>
                <span class="prov-meta">${p.regione}</span>
            </div>
        `).join("");

        dropdown.classList.add("active");
        highlightedIndex = -1;

        // Click su suggerimento
        dropdown.querySelectorAll(".province-suggestion[data-index]").forEach(el => {
            el.addEventListener("click", () => {
                const i = parseInt(el.dataset.index);
                selectProvince(visibleSuggestions[i]);
            });
        });
    }

    function moveHighlight(delta) {
        const items = document.querySelectorAll(".province-suggestion[data-index]");
        if (items.length === 0) return;

        highlightedIndex = Math.max(0, Math.min(items.length - 1, highlightedIndex + delta));

        items.forEach((el, i) => {
            el.classList.toggle("highlighted", i === highlightedIndex);
            if (i === highlightedIndex) {
                el.scrollIntoView({ block: "nearest" });
            }
        });
    }

    function selectProvince(provincia) {
        currentSelection = provincia;
        const input = document.getElementById("province-finder-input");
        input.value = provincia.nome;
        hideDropdown();
        if (onSelect) onSelect(provincia.sigla);
    }

    function clearSelection() {
        currentSelection = null;
        if (onClear) onClear();
    }

    function hideDropdown() {
        const dropdown = document.getElementById("province-finder-dropdown");
        if (dropdown) dropdown.classList.remove("active");
        highlightedIndex = -1;
    }

    /**
     * Normalizza una stringa per il confronto:
     * lowercase + rimozione accenti + trim.
     */
    function normalize(s) {
        return (s || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
    }

    /**
     * API esterna per resettare la selezione (es. quando si cambia carburante).
     */
    function reset() {
        const input = document.getElementById("province-finder-input");
        const clearBtn = document.getElementById("province-finder-clear");
        if (input) input.value = "";
        if (clearBtn) clearBtn.classList.remove("active");
        currentSelection = null;
        hideDropdown();
    }

    return {
        init,
        reset,
    };
})();

window.ProvinceFinder = ProvinceFinder;
