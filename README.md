# Dashboard Energia Italia

Dashboard web pubblica per il monitoraggio dei prezzi e dei consumi energetici in Italia (carburanti, energia elettrica, gas, GPL) a granularità provinciale.

**Elaborazione:** ANCE Piemonte e Valle d'Aosta
**Fonti dati pubbliche:** MASE, MIMIT, Terna, GME, ARERA, Eurostat
**Hosting:** GitHub Pages
**Storage dati:** Google Sheets (auto-popolato via GitHub Actions)

## Architettura
## Funzionalità

- 5 tab analitici: Prezzi correnti, Variazioni %, Spesa stimata, Serie storica, Metodologia
- Mappa choropleth provinciale interattiva (D3.js + TopoJSON ISTAT)
- Selettore Nord / Centro / Sud+Isole
- Serie storica dal 1 gennaio 2022 ad oggi
- Aggiornamento automatico con frequenze differenziate per fonte
- Export PDF lato client (jsPDF + html2canvas)

## Fonti dati e frequenze

| Fonte | Frequenza | Granularità |
|---|---|---|
| MIMIT (carburanti) | Quotidiana | Provinciale (impianti) |
| MASE (carburanti) | Settimanale | Nazionale |
| GME (PUN, PSV) | Giornaliera | Zonale / Nazionale |
| Terna (consumi EE) | Annuale | Provinciale |
| ARERA (prezzi finali) | Trimestrale | Nazionale |
| Eurostat | Semestrale | Nazionale |

## Principi metodologici

- Ogni dato visualizzato riporta: **fonte ufficiale, timestamp ultimo aggiornamento, tipo dato** (misurato / stimato / proxy)
- In assenza di fonte ufficiale: `n.d.` esplicito
- Trasparenza sulle chiavi di downscaling provinciale dove applicate
- Licenze: rispetto IODL 2.0 (MIMIT), termini d'uso GME, citazione obbligatoria fonti

## Licenza dati

Elaborazione su dati pubblici. Licenza dati MIMIT: IODL 2.0. Per usi ufficiali consultare le fonti originali.

## Contatti

ANCE Piemonte e Valle d'Aosta
Direzione: Gianluca Poggi
Email: direzione@ancepiemonte.it