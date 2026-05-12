/**
 * Map Module - Dashboard Energia Italia
 *
 * Renderizza una mappa choropleth provinciale d'Italia usando D3.js + TopoJSON.
 * Fonte TopoJSON: Openpolis (https://github.com/openpolis/geojson-italy)
 *                 Confini ISTAT, licenza CC-BY 4.0.
 *
 * API pubblica:
 *   ItalyMap.init(containerSelector)         → inizializza
 *   ItalyMap.update(dataBySigla, options)    → aggiorna i colori
 *   ItalyMap.highlightProvince(sigla)        → evidenzia una provincia
 *   ItalyMap.filterByMacroArea(macroArea)    → filtra Nord/Centro/Sud
 */

const ItalyMap = (function () {
    // URL del TopoJSON province italiane
    const TOPOJSON_URL = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/topojson/limits_IT_provinces.topo.json";

    let svg = null;
    let g = null;
    let topoData = null;
    let currentData = {};
    let currentField = null;
    let onProvinceHover = null;
    let onProvinceClick = null;
    let macroAreaFilter = null;
    let provinceMacroMap = {}; // sigla → macro_area

    // Dimensioni di base (usate per il viewBox SVG, scalabile)
    const WIDTH = 600;
    const HEIGHT = 720;

    /**
     * Inizializza la mappa nel container specificato.
     */
    async function init(containerSelector, options = {}) {
        const container = d3.select(containerSelector);
        if (container.empty()) {
            console.error(`[ItalyMap] Container ${containerSelector} non trovato`);
            return;
        }

        onProvinceHover = options.onHover || null;
        onProvinceClick = options.onClick || null;
        provinceMacroMap = options.provinceMacroMap || {};

        // Crea SVG con viewBox per essere responsive
        svg = container
            .append("svg")
            .attr("id", "map-svg")
            .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
            .attr("preserveAspectRatio", "xMidYMid meet");

        g = svg.append("g").attr("class", "map-provinces");

        // Carica TopoJSON
        try {
            console.log(`[ItalyMap] Caricamento TopoJSON da ${TOPOJSON_URL}`);
            topoData = await d3.json(TOPOJSON_URL);
            console.log("[ItalyMap] TopoJSON caricato");
            renderProvinces();
        } catch (err) {
            console.error("[ItalyMap] Errore caricamento TopoJSON:", err);
            container.append("div")
                .attr("class", "error-message")
                .text("Impossibile caricare la mappa. Verificare connessione.");
        }
    }

    /**
     * Disegna le province (una sola volta dopo il caricamento del TopoJSON).
     */
    function renderProvinces() {
        if (!topoData) return;

        // Estrai le features dal TopoJSON
        // openpolis usa l'oggetto "provinces" come layer principale
        const objKey = Object.keys(topoData.objects)[0];
        const features = topojson.feature(topoData, topoData.objects[objKey]).features;

        // Proiezione adattata all'Italia
        const projection = d3.geoMercator().fitSize([WIDTH, HEIGHT], {
            type: "FeatureCollection",
            features: features,
        });
        const path = d3.geoPath().projection(projection);

        g.selectAll("path.map-svg-province")
            .data(features)
            .enter()
            .append("path")
            .attr("class", "map-svg-province no-data")
            .attr("d", path)
            .attr("data-sigla", d => getSigla(d))
            .on("mouseover", function (event, d) {
                const sigla = getSigla(d);
                if (onProvinceHover) onProvinceHover(sigla, event);
            })
            .on("mousemove", function (event, d) {
                const sigla = getSigla(d);
                if (onProvinceHover) onProvinceHover(sigla, event);
            })
            .on("mouseout", function () {
                if (onProvinceHover) onProvinceHover(null);
            })
            .on("click", function (event, d) {
                const sigla = getSigla(d);
                if (onProvinceClick) onProvinceClick(sigla);
            });
    }

    /**
     * Estrae la sigla provincia dalle properties del TopoJSON Openpolis.
     * Le properties tipiche sono: prov_acr, prov_name, prov_istat_code, reg_name, ecc.
     */
    function getSigla(feature) {
        const p = feature.properties || {};
        // Openpolis usa "prov_acr" per la sigla a 2 lettere
        return (p.prov_acr || p.prov_name || "").toUpperCase().slice(0, 2);
    }

    /**
     * Aggiorna i colori delle province in base ai dati forniti.
     * @param {Object} dataBySigla - { "TO": 1.95, "MI": 1.93, ... }
     * @param {Object} options - { colorScheme, legendLabel, unit }
     */
    function update(dataBySigla, options = {}) {
        if (!g) return;
        currentData = dataBySigla || {};

        const values = Object.values(currentData).filter(v => v != null && !isNaN(v));
        if (values.length === 0) {
            // Nessun dato: tutte grigie
            g.selectAll("path.map-svg-province")
                .attr("class", "map-svg-province no-data")
                .style("fill", "#e5e7eb");
            removeLegend();
            return;
        }

        const min = d3.min(values);
        const max = d3.max(values);

        // Scala colore: YlOrRd (giallo → rosso = più costoso)
        const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
            .domain([min, max]);

        g.selectAll("path.map-svg-province")
            .each(function (d) {
                const sigla = getSigla(d);
                const value = currentData[sigla];
                const sel = d3.select(this);

                if (value == null || isNaN(value)) {
                    sel.attr("class", "map-svg-province no-data")
                        .style("fill", "#e5e7eb");
                } else {
                    sel.attr("class", "map-svg-province")
                        .style("fill", colorScale(value));
                }
            });

        // Applica filtro macro-area se attivo
        applyMacroAreaFilter();

        // Aggiorna legenda
        renderLegend(min, max, colorScale, options.legendLabel || "", options.unit || "");
    }

    /**
     * Disegna la legenda colorata in basso a sinistra.
     */
    function renderLegend(min, max, colorScale, label, unit) {
        removeLegend();
        const container = d3.select("#map-svg").node().parentNode;
        const legend = d3.select(container)
            .append("div")
            .attr("class", "map-legend");

        if (label) legend.append("div").style("font-weight", "600").text(label);

        // Crea gradiente CSS
        const stops = [];
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const v = min + (max - min) * (i / steps);
            stops.push(colorScale(v));
        }
        legend.append("div")
            .attr("class", "legend-gradient")
            .style("background", `linear-gradient(to right, ${stops.join(",")})`);

        legend.append("div")
            .attr("class", "legend-labels")
            .html(`<span>${formatValue(min)} ${unit}</span><span>${formatValue(max)} ${unit}</span>`);
    }

    function removeLegend() {
        d3.select("#map-svg").node()?.parentNode &&
            d3.select(d3.select("#map-svg").node().parentNode)
                .selectAll(".map-legend")
                .remove();
    }

    function formatValue(v) {
        if (v == null || isNaN(v)) return "n.d.";
        return v.toFixed(3).replace(".", ",");
    }

    /**
     * Filtra l'opacità per macro-area (Nord/Centro/Sud+Isole o null = tutte).
     */
    function filterByMacroArea(macroArea) {
        macroAreaFilter = macroArea;
        applyMacroAreaFilter();
    }

    function applyMacroAreaFilter() {
        if (!g) return;
        g.selectAll("path.map-svg-province").each(function (d) {
            const sigla = getSigla(d);
            const macro = provinceMacroMap[sigla];
            const dimmed = macroAreaFilter && macro !== macroAreaFilter;
            d3.select(this).classed("dimmed", dimmed);
        });
    }

    /**
     * Filtra l'opacità per un set arbitrario di sigle (es. tutte le province di una regione).
     * Passando null, ripristina tutte.
     */
    /**
     * Filtra l'opacità per un set arbitrario di sigle (es. tutte le province di una regione).
     * Passando null, ripristina tutte.
     */
    function filterByProvinceSet(sigleSet) {
        if (!g) return;
        if (!sigleSet || sigleSet.length === 0) {
            g.selectAll("path.map-svg-province").classed("dimmed", false);
            return;
        }
        const set = new Set(sigleSet);
        g.selectAll("path.map-svg-province").each(function (d) {
            const sigla = getSigla(d);
            d3.select(this).classed("dimmed", !set.has(sigla));
        });
    }
    /**
     * Evidenzia una provincia (callback da classifica).
     */
    function highlightProvince(sigla) {
        if (!g) return;
        g.selectAll("path.map-svg-province")
            .style("stroke", function (d) {
                return getSigla(d) === sigla ? "#1e3a8a" : null;
            })
            .style("stroke-width", function (d) {
                return getSigla(d) === sigla ? 2 : null;
            });
    }

    return {
        init,
        update,
        filterByMacroArea,
        filterByProvinceSet,
        highlightProvince,
    };
})();

window.ItalyMap = ItalyMap;
