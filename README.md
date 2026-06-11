# Dashboard Energia Italia

Dashboard web pubblica per il monitoraggio dei prezzi e dei consumi energetici in Italia (carburanti, energia elettrica, gas, GPL) a granularità provinciale.

**Elaborazione:** ANCE Piemonte e Valle d'Aosta
**Fonti dati pubbliche:** MASE, MIMIT, Terna, GME, ARERA, Eurostat
**Hosting:** GitHub Pages
**Storage dati:** Google Sheets (auto-popolato via GitHub Actions)

## Architettura

```
GitHub Actions (ETL Python, schedulati)
        │  scrive via service account
        ▼
Google Sheets (foglio master "Dashboard_Energia_Italia_DATI")
        │  letto come CSV via endpoint gviz
        ▼
Frontend statico su GitHub Pages (HTML + CSS + JS, D3.js per mappa e grafici)
```

## Funzionalità

- 5 tab analitici: Prezzi correnti, Elettricità, Variazioni %, Serie storica, Metodologia
- Mappa choropleth provinciale interattiva (D3.js + TopoJSON, copia locale nel repo con fallback remoto)
- Selettore Nord / Centro / Sud+Isole
- Serie storica ARERA dal 2004; carburanti in accumulo progressivo (settimanale, da maggio 2026)
- Aggiornamento automatico con frequenze differenziate per fonte

## Fonti dati e frequenze

| Fonte | Frequenza | Granularità | Stato ETL |
|---|---|---|---|
| MIMIT (carburanti) | Quotidiana | Provinciale (impianti) | ✅ Attivo (daily) |
| ARERA (prezzi finali tutela) | Trimestrale | Nazionale | ✅ Attivo (mensile) |
| MASE (carburanti) | Settimanale | Nazionale | 🔜 Pianificato |
| GME (PUN, PSV) | Giornaliera | Zonale / Nazionale | 🔜 Pianificato |
| Terna (consumi EE) | Annuale | Provinciale | 🔜 Pianificato |
| Eurostat | Semestrale | Nazionale | 🔜 Pianificato |

## Principi metodologici

- Ogni dato visualizzato riporta: **fonte ufficiale, timestamp ultimo aggiornamento, tipo dato** (misurato / stimato / proxy)
- In assenza di fonte ufficiale: `n.d.` esplicito
- Trasparenza sulle chiavi di downscaling provinciale dove applicate
- Licenze: rispetto IODL 2.0 (MIMIT), termini d'uso GME, citazione obbligatoria fonti

## Licenza dati

Elaborazione su dati pubblici. Licenza dati MIMIT: IODL 2.0. Per usi ufficiali consultare le fonti originali.
Confini provinciali: [Openpolis / geojson-italy](https://github.com/openpolis/geojson-italy) (CC-BY 4.0, su dati ISTAT) — copia locale in `assets/data/italy-provinces.topojson`.

## Contatti

ANCE Piemonte e Valle d'Aosta
Direzione: Gianluca Poggi
Email: direzione@ancepiemonte.it