/**
 * Province Finder - Dashboard Energia Italia
 *
 * Componente di ricerca con autocomplete per le 107 province italiane
 * e per le 20 regioni italiane.
 *
 * Eventi emessi via callback:
 *   onSelectProvince(sigla)      - selezionata una provincia
 *   onSelectRegione(nomeRegione) - selezionata una regione (filtra tutte le province di quella regione)
 *   onClear()                    - rimossa qualsiasi selezione
 */

const ProvinceFinder = (function () {
    let province = [];      // {sigla, nome, regione, macro_area}
    let regioni = [];        // {nome, nProvince, sigleProvince:[]}
    let onSelectProvince = null;
    let onSelectRegione = null;
    let onClear = null;
    let highlightedIndex = -1;
    let visibleSuggestions = []; // mix di {type:'prov', ...} e {type:'reg', ...}

    function init(containerSelector, provinceList, callbacks = {}) {
        province = provinceList || [];
        onSelectProvince = callbacks.onSelectProvince || callbacks.onSelect || null;
        onSelectRegione = callbacks.onSelectRegione || null;
        onClear = callbacks.onClear || null;

        // Costruisci la lista delle regioni (deduplicate)
        const regMap = {};
        province.forEach(p => {
            if (!regMap[p.regione]) {
                regMap[p.regione] = {
                    nome: p.regione,
                    macro_area: p.macro_area,
                    sigleProvince: [],
                };
            }
            regMap[p.regione].sigleProvince.push(p.sigla);
        });
        regioni = Object.values(regMap).map(r => ({
            ...r,
            nProvince: r.sigleProvince.length,
        })).sort((a, b) => a.nome.localeCompare(b.nome, "it"));

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
                    placeholder="Cerca provincia o regione (es. Torino, Piemonte, MI...)"
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
                const target = highlightedIndex >= 0
                    ? visibleSuggestions[highlightedIndex]
                    : visibleSuggestions[0];
                if (target) handleSelection(target);
            } else if (e.key === "Escape") {
                hideDropdown();
                input.blur();
            }
        });

        input.addEventListener("focus", e => {
            const query = e.target.value.trim();
            if (query.length > 0) showSuggestions(query);
        });

        document.addEventListener("click", e => {
            if (!e.target.closest(".province-finder")) {
                hideDropdown();
            }
        });

        clearBtn.addEventListener("click", () => {
            input.value = "";
            clearBtn.classList.remove("active");
            hideDropdown();
            if (onClear) onClear();
        });
    }

    function showSuggestions(query) {
        const q = normalize(query);

        // Match province
        const matchProv = province.filter(p => {
            return normalize(p.nome).includes(q)
                || normalize(p.sigla).includes(q);
        }).map(p => ({ type: "prov", ...p }));

        // Match regioni
        const matchReg = regioni.filter(r => {
            return normalize(r.nome).includes(q);
        }).map(r => ({ type: "reg", ...r }));

        // Mix: prima le regioni che matchano (sono raggruppanti), poi le province
        // Ma limitiamo le province a 10 per non saturare il dropdown
        visibleSuggestions = [
            ...matchReg,
            ...matchProv.slice(0, 10),
        ];

        const dropdown = document.getElementById("province-finder-dropdown");

        if (visibleSuggestions.length === 0) {
            dropdown.innerHTML = `<div class="province-suggestion-empty">Nessun risultato per "${query}"</div>`;
            dropdown.classList.add("active");
            return;
        }

        dropdown.innerHTML = visibleSuggestions.map((s, i) => {
            if (s.type === "reg") {
                return `
                    <div class="province-suggestion suggestion-region ${i === highlightedIndex ? "highlighted" : ""}" data-index="${i}">
                        <span>
                            <span class="prov-sigla region-badge">REG</span>
                            <span class="prov-name">${s.nome}</span>
                        </span>
                        <span class="prov-meta">${s.nProvince} province</span>
                    </div>
                `;
            } else {
                return `
                    <div class="province-suggestion ${i === highlightedIndex ? "highlighted" : ""}" data-index="${i}">
                        <span>
                            <span class="prov-sigla">${s.sigla}</span>
                            <span class="prov-name">${s.nome}</span>
                        </span>
                        <span class="prov-meta">${s.regione}</span>
                    </div>
                `;
            }
        }).join("");

        dropdown.classList.add("active");
        highlightedIndex = -1;

        // Click handler
        dropdown.querySelectorAll(".province-suggestion[data-index]").forEach(el => {
            el.addEventListener("click", () => {
                const i = parseInt(el.dataset.index);
                handleSelection(visibleSuggestions[i]);
            });
        });
    }

    function moveHighlight(delta) {
        const items = document.querySelectorAll(".province-suggestion[data-index]");
        if (items.length === 0) return;
        highlightedIndex = Math.max(0, Math.min(items.length - 1, highlightedIndex + delta));
        items.forEach((el, i) => {
            el.classList.toggle("highlighted", i === highlightedIndex);
            if (i === highlightedIndex) el.scrollIntoView({ block: "nearest" });
        });
    }

    function handleSelection(item) {
        const input = document.getElementById("province-finder-input");
        if (item.type === "prov") {
            input.value = item.nome;
            hideDropdown();
            if (onSelectProvince) onSelectProvince(item.sigla);
        } else if (item.type === "reg") {
            input.value = item.nome + " (regione)";
            hideDropdown();
            if (onSelectRegione) onSelectRegione(item.nome, item.sigleProvince);
        }
    }

    function hideDropdown() {
        const dropdown = document.getElementById("province-finder-dropdown");
        if (dropdown) dropdown.classList.remove("active");
        highlightedIndex = -1;
    }

    function normalize(s) {
        return (s || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
    }

    function reset() {
        const input = document.getElementById("province-finder-input");
        const clearBtn = document.getElementById("province-finder-clear");
        if (input) input.value = "";
        if (clearBtn) clearBtn.classList.remove("active");
        hideDropdown();
    }

    return {
        init,
        reset,
    };
})();

window.ProvinceFinder = ProvinceFinder;
