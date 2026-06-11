/**
 * Configurazione globale Dashboard Energia Italia
 *
 * Definisce le costanti utilizzate dal front-end per il caricamento
 * dei dati dal Google Sheet pubblicato come CSV.
 *
 * Il Google Sheet è popolato automaticamente dai workflow ETL
 * (GitHub Actions). Vedere cartella `scripts/` per i dettagli.
 */

const CONFIG = {
  // Identificatore del Google Sheet master
  GSHEET_ID: "1nab9JxvFGXcuV5gaMlTapJZ787J_yyYGP1QDHXXcCco",

  // URL base per recupero CSV tramite gviz (preferibile a "pubhtml"
  // perché restituisce dati strutturati senza HTML di contorno)
  CSV_BASE_URL: function (sheetName) {
    return `https://docs.google.com/spreadsheets/d/${this.GSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  },

  // Mappa dei nomi tab del Google Sheet
  TABS: {
    prezzi_carburanti_provinciale: "prezzi_carburanti_provinciale",
    prezzi_carburanti_nazionale_storico: "prezzi_carburanti_nazionale_storico",
    pun_zonale: "pun_zonale",
    psv_gas: "psv_gas",
    consumi_elettrici_provinciale: "consumi_elettrici_provinciale",
    consumi_gas_provinciale_stimato: "consumi_gas_provinciale_stimato",
    prezzi_finali_arera: "prezzi_finali_arera",
    anagrafica_province: "anagrafica_province",
    metadati_aggiornamento: "metadati_aggiornamento",
  },

  // Percorsi asset locali
  TOPOJSON_PROVINCE: "assets/data/italy-provinces.topojson",

  // Mapping zone GME → regioni (per visualizzazione prezzi elettricità sulla mappa)
  ZONE_GME_REGIONI: {
    NORD: ["Piemonte", "Valle d'Aosta", "Lombardia", "Trentino-Alto Adige",
           "Veneto", "Friuli-Venezia Giulia", "Liguria", "Emilia-Romagna"],
    CNOR: ["Toscana", "Umbria", "Marche"],
    CSUD: ["Lazio", "Abruzzo", "Campania"],
    SUD:  ["Molise", "Puglia", "Basilicata"],
    SICI: ["Sicilia"],
    SARD: ["Sardegna"],
    CALA: ["Calabria"],
  },

  // Macro-aree ISTAT
  MACRO_AREE: {
    "Nord": ["Piemonte", "Valle d'Aosta", "Lombardia", "Trentino-Alto Adige",
             "Veneto", "Friuli-Venezia Giulia", "Liguria", "Emilia-Romagna"],
    "Centro": ["Toscana", "Umbria", "Marche", "Lazio"],
    "Sud e Isole": ["Abruzzo", "Molise", "Campania", "Puglia", "Basilicata",
                    "Calabria", "Sicilia", "Sardegna"],
  },

  // Eventi storici da marcare nei grafici serie storica
  EVENTI_STORICI: [
    { data: "2022-02-24", label: "Scoppio guerra Ucraina", colore: "#dc2626" },
    { data: "2022-03-22", label: "Primo taglio accise carburanti", colore: "#16a34a" },
    { data: "2022-12-31", label: "Fine taglio accise 2022", colore: "#f59e0b" },
    { data: "2026-02-28", label: "Scoppio guerra Iran", colore: "#dc2626" },
    { data: "2026-03-19", label: "Taglio accise -0,20 €/l", colore: "#16a34a" },
    { data: "2026-05-02", label: "Rimodulazione accise -0,05 €/l benzina", colore: "#f59e0b" },
  ],

  // Versione e ultimo deploy
  VERSION: "0.5.1-alpha",
  REPO_URL: "https://github.com/poggig1971/dashboard-energia-italia",
};

// Esporta in modalità compatibile con browser
if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
}
