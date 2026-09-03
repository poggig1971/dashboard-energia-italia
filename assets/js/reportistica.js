/**
 * Scheda Reportistica — Dashboard Energia Italia
 *
 * Genera un rapporto provinciale personalizzabile e stampabile in PDF
 * tramite la stampa del browser (foglio @media print, nessuna dipendenza).
 *
 * Principio sulla granularita' del dato, applicato in tutto il modulo:
 *   provinciale -> regionale -> nazionale
 * Ogni volta che un valore non e' disponibile alla granularita' richiesta si
 * scende di livello e lo si ETICHETTA. I prezzi finali ARERA esistono solo a
 * livello nazionale: in quella sezione non c'e' ripiego possibile e va detto.
 */

const ReportisticaTab = (function () {

    const CARB = [
        { k: "benzina_self_eur_l", lab: "Benzina self service", u: "€/l" },
        { k: "gasolio_self_eur_l", lab: "Gasolio self service", u: "€/l" },
        { k: "gpl_eur_l",          lab: "GPL",                  u: "€/l" },
        { k: "metano_eur_kg",      lab: "Metano",               u: "€/kg" },
    ];

    // Palette categorica dei carburanti, validata con lo strumento della guida
    // dataviz: peggior coppia DeltaE 15,4 in deuteranopia, 18,1 in visione
    // normale, tutte e quattro sopra il contrasto 3:1. Blu e rosso sono gli
    // stessi poli della scala divergente gia' usata altrove.
    const CARB_COL = {
        benzina_self_eur_l: "#1a5c96",
        gasolio_self_eur_l: "#b03a2e",
        gpl_eur_l:          "#c9820b",
        metano_eur_kg:      "#6a3d9a",
    };

    const SEZIONI = [
        ["sintesi",     "Sintesi provinciale"],
        ["confronto",   "Confronto territoriale"],
        ["storico",     "Andamento settimanale"],
        ["variazioni",  "Variazioni nel tempo"],
        ["elettricita", "Contesto elettricità"],
        ["fonti",       "Fonti e accesso ai dati"],
        ["note",        "Note di lettura"],
    ];

    const D = { rows: [], arera: [], anag: [], settimane: [], province: [] };
    const S = {
        sigla: null,
        settimana: null,
        carb: "benzina_self_eur_l",
        focus: false,
        sezioni: Object.fromEntries(SEZIONI.map(([k]) => [k, true])),
    };

    /* ---------------- utilita' ---------------- */

    const num = v => (typeof v === "number" && !isNaN(v)) ? v : null;
    const fmt = (v, d) => v == null ? "—" : v.toFixed(d == null ? 4 : d).replace(".", ",");
    const sgn = (v, d) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d == null ? 2 : d).replace(".", ",");
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    function media(rows, k) {
        const v = rows.map(r => num(r[k])).filter(x => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }
    const settimanaRows = w => D.rows.filter(r => String(r.data_settimana) === w);

    /**
     * Valore per la provincia con ripiego dichiarato.
     * Restituisce { v, livello } con livello in {provinciale, regionale, nazionale}.
     */
    function valoreConRipiego(sigla, w, k) {
        const rows = settimanaRows(w);
        const p = rows.find(r => r.provincia_sigla === sigla);
        if (p && num(p[k]) != null) return { v: num(p[k]), livello: "provinciale" };
        if (p) {
            const reg = media(rows.filter(r => r.regione === p.regione), k);
            if (reg != null) return { v: reg, livello: "regionale" };
        }
        const naz = media(rows, k);
        return { v: naz, livello: naz == null ? null : "nazionale" };
    }

    function posizione(sigla, w, k) {
        const rows = settimanaRows(w).filter(r => num(r[k]) != null)
            .sort((a, b) => num(b[k]) - num(a[k]));
        const i = rows.findIndex(r => r.provincia_sigla === sigla);
        return i < 0 ? null : { pos: i + 1, su: rows.length };
    }

    /* ---------------- bootstrap ---------------- */

    async function init() {
        const host = document.getElementById("tab-reportistica");
        host.innerHTML = '<div class="loading">Caricamento dati per la reportistica...</div>';
        try {
            const res = await DataLoader.loadMultiple([
                "prezzi_carburanti_provinciale", "prezzi_finali_arera", "anagrafica_province",
            ]);
            D.rows = res.prezzi_carburanti_provinciale || [];
            D.arera = res.prezzi_finali_arera || [];
            D.anag = res.anagrafica_province || [];
            D.settimane = [...new Set(D.rows.map(r => String(r.data_settimana)))].sort();
            S.settimana = D.settimane[D.settimane.length - 1];

            const ult = settimanaRows(S.settimana);
            D.province = ult.map(r => ({
                sigla: r.provincia_sigla, nome: r.provincia_nome, regione: r.regione, macro: r.macro_area,
            })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "it"));
            S.sigla = (D.province.find(p => p.sigla === "TO") || D.province[0] || {}).sigla;

            renderShell(host);
            renderReport();
        } catch (err) {
            console.error("[Reportistica]", err);
            host.innerHTML = '<div class="error-message">Impossibile caricare i dati per la reportistica. ' +
                'Verificare la connessione e riprovare con il pulsante Aggiorna.</div>';
        }
    }

    /* ---------------- struttura della scheda ---------------- */

    function renderShell(host) {
        host.innerHTML = `
        <div class="rep-layout">
          <aside class="rep-side no-print">
            <div class="rep-side-title">RAPPORTO</div>

            <label class="rep-lab" for="rep-prov">PROVINCIA OGGETTO DEL RAPPORTO</label>
            <select id="rep-prov" class="rep-sel">
              ${D.province.map(p => `<option value="${esc(p.sigla)}"${p.sigla === S.sigla ? " selected" : ""}>${esc(p.nome)} (${esc(p.sigla)})</option>`).join("")}
            </select>

            <label class="rep-lab" for="rep-week">SETTIMANA DI RIFERIMENTO</label>
            <select id="rep-week" class="rep-sel">
              ${D.settimane.slice().reverse().map(w => `<option value="${w}"${w === S.settimana ? " selected" : ""}>${formattaData(w)}</option>`).join("")}
            </select>

            <div class="rep-lab">GRAFICI</div>
            <label class="rep-check rep-check-focus">
              <input type="checkbox" id="rep-focus"${S.focus ? " checked" : ""}> Focus completo
            </label>
            <p class="rep-hint rep-hint-tight">Tutti i carburanti e l'elettricità, ciascuno con la propria
               scala, più il confronto dei rincari a base 100.</p>

            <label class="rep-lab" for="rep-carb">CARBURANTE DEL GRAFICO SINGOLO</label>
            <select id="rep-carb" class="rep-sel"${S.focus ? " disabled" : ""}>
              ${CARB.map(c => `<option value="${c.k}"${c.k === S.carb ? " selected" : ""}>${c.lab}</option>`).join("")}
            </select>

            <div class="rep-lab">SEZIONI DA INCLUDERE</div>
            <div id="rep-sez">
              ${SEZIONI.map(([k, l]) => `<label class="rep-check"><input type="checkbox" data-sez="${k}"${S.sezioni[k] ? " checked" : ""}> ${l}</label>`).join("")}
            </div>

            <button id="rep-print" class="rep-btn">Stampa o salva in PDF</button>
            <p class="rep-hint">Il pulsante apre la stampa del browser: scegliendo
              «Salva come PDF» si ottiene il rapporto impaginato, senza menu né filtri.
              Per togliere data e numero di pagina ai margini, apri «Altre impostazioni»
              nella finestra di stampa e togli la spunta a «Intestazioni e piè di pagina».</p>
          </aside>

          <div class="rep-sheet" id="rep-sheet"></div>
        </div>`;

        document.getElementById("rep-prov").onchange = e => { S.sigla = e.target.value; renderReport(); };
        document.getElementById("rep-week").onchange = e => { S.settimana = e.target.value; renderReport(); };
        document.getElementById("rep-carb").onchange = e => { S.carb = e.target.value; renderReport(); };
        document.getElementById("rep-focus").onchange = e => {
            S.focus = e.target.checked;
            document.getElementById("rep-carb").disabled = S.focus;
            renderReport();
        };
        document.getElementById("rep-print").onclick = () => window.print();
        host.querySelectorAll("#rep-sez input").forEach(cb => {
            cb.onchange = () => { S.sezioni[cb.dataset.sez] = cb.checked; renderReport(); };
        });
    }

    /* ---------------- rapporto ---------------- */

    function renderReport() {
        const sheet = document.getElementById("rep-sheet");
        const prov = D.province.find(p => p.sigla === S.sigla);
        if (!prov) { sheet.innerHTML = '<div class="error-message">Provincia non trovata.</div>'; return; }

        const oggi = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
        let h = `
          <h1 class="rep-h1">Prezzi dell'energia in provincia di ${esc(prov.nome)}</h1>
          <p class="rep-sub">Carburanti alla settimana del <b>${formattaData(S.settimana)}</b> ·
             ${esc(prov.regione)} · area ${esc(prov.macro)} ·
             elaborazione ANCE Piemonte e Valle d'Aosta su dati MIMIT e ARERA, ${oggi}</p>
          <div class="rep-rule"></div>`;

        if (S.sezioni.sintesi)     h += sezSintesi(prov);
        if (S.sezioni.confronto)   h += sezConfronto(prov);
        if (S.sezioni.storico)     h += (S.focus ? sezStoricoFocus(prov) : sezStorico(prov));
        if (S.sezioni.variazioni)  h += sezVariazioni(prov);
        if (S.sezioni.elettricita) h += sezElettricita();
        if (S.sezioni.fonti)       h += sezFonti();
        if (S.sezioni.note)        h += sezNote(prov);

        sheet.innerHTML = h;
        // Il livello interattivo esiste solo nel grafico singolo: in modalita'
        // focus i pannelli portano etichette diritte e non hanno crocino.
        if (S.sezioni.storico && !S.focus) attivaTooltipGrafico();
    }

    function box(titolo, badge, corpo) {
        return `<section class="rep-box"><h2 class="rep-h2">${titolo}` +
            (badge ? ` <span class="rep-badge">${badge}</span>` : "") +
            `</h2>${corpo}</section>`;
    }

    /* --- 1. sintesi --- */
    function sezSintesi(prov) {
        const rows = settimanaRows(S.settimana);
        const li = CARB.map(c => {
            const r = valoreConRipiego(prov.sigla, S.settimana, c.k);
            if (r.v == null) return `<li>${c.lab}: dato non disponibile.</li>`;
            const naz = media(rows, c.k);
            const d = naz ? (r.v - naz) * 100 : null;
            const pos = r.livello === "provinciale" ? posizione(prov.sigla, S.settimana, c.k) : null;
            const tag = r.livello === "provinciale" ? "" :
                ` <span class="rep-tag">media ${r.livello}</span>`;
            return `<li><b>${c.lab}</b>: <b class="rep-key">${fmt(r.v)} ${c.u}</b>${tag}` +
                // La parola "sopra"/"sotto" porta gia il segno: il numero va in valore
                // assoluto, altrimenti si legge "sotto la media di -0,64" (doppia negazione).
                (d == null ? "" : `, ${d >= 0 ? "sopra" : "sotto"} la media nazionale di <b>${fmt(Math.abs(d), 2)} c€</b>`) +
                (pos ? `, <b>${pos.pos}ª</b> provincia su ${pos.su} per prezzo` : "") + ".</li>";
        }).join("");

        const anag = D.anag.find(a => a.sigla === prov.sigla);
        const pop = anag && num(anag.popolazione_2024);
        const impianti = (rows.find(r => r.provincia_sigla === prov.sigla) || {}).n_impianti;

        return box("In sintesi", null,
            `<ul class="rep-ul">${li}` +
            (pop ? `<li>Popolazione ${pop.toLocaleString("it-IT")} abitanti` +
                (num(impianti) ? `, ${impianti} impianti di distribuzione rilevati` : "") + ".</li>" : "") +
            `</ul>`);
    }

    /* --- 2. confronto territoriale --- */
    function sezConfronto(prov) {
        const rows = settimanaRows(S.settimana);
        const reg = rows.filter(r => r.regione === prov.regione);
        const mac = rows.filter(r => r.macro_area === prov.macro);

        const tr = CARB.map(c => {
            const r = valoreConRipiego(prov.sigla, S.settimana, c.k);
            const vReg = media(reg, c.k), vMac = media(mac, c.k), vIta = media(rows, c.k);
            const pct = (r.v != null && vIta) ? (r.v / vIta - 1) * 100 : null;
            const pos = posizione(prov.sigla, S.settimana, c.k);
            const tag = (r.v != null && r.livello !== "provinciale")
                ? ` <span class="rep-tag">${r.livello}</span>` : "";
            return `<tr>
              <td>${c.lab} <span class="rep-u">(${c.u})</span></td>
              <td class="num hl"><b>${fmt(r.v)}</b>${tag}</td>
              <td class="num">${fmt(vReg)}</td>
              <td class="num">${fmt(vMac)}</td>
              <td class="num">${fmt(vIta)}</td>
              <td class="num ${pct == null ? "" : pct > 0 ? "up" : "dn"}">${pct == null ? "—" : sgn(pct) + "%"}</td>
              <td class="ctr">${pos ? pos.pos + "ª su " + pos.su : "—"}</td>
            </tr>`;
        }).join("");

        return box("Carburanti — confronto territoriale", formattaData(S.settimana),
            `<p class="rep-p">Medie aritmetiche semplici dei prezzi provinciali rilevati nella settimana,
             non ponderate per consumi né per numero di impianti. La posizione è calcolata in ordine
             decrescente di prezzo: 1ª significa la provincia più cara d'Italia.</p>
             <table class="ance-table"><thead><tr>
               <th>Parametro</th><th>${esc(prov.nome)}</th><th>${esc(prov.regione)}</th>
               <th>${esc(prov.macro)}</th><th>Italia</th><th>Scarto % su Italia</th><th>Posizione</th>
             </tr></thead><tbody>${tr}</tbody></table>`);
    }

    /* --- 3. andamento settimanale --- */

    function serieProv(prov, k) {
        return D.settimane.map(w => {
            const r = settimanaRows(w).find(x => x.provincia_sigla === prov.sigla);
            return r ? num(r[k]) : null;
        });
    }
    const serieNaz = k => D.settimane.map(w => media(settimanaRows(w), k));

    /**
     * Focus completo: un pannello per carburante, ciascuno con la PROPRIA scala.
     * Non si possono mettere benzina (circa 2 EUR/l) e GPL (circa 0,77 EUR/l)
     * sullo stesso asse senza schiacciare il secondo, e il metano e' in EUR/kg:
     * unita' diversa, asse diverso per forza. I piccoli multipli risolvono
     * entrambi i problemi tenendo il confronto visivo fra i pannelli.
     */
    function sezStoricoFocus(prov) {
        const mini = CARB.map(c => {
            const a = serieProv(prov, c.k), b = serieNaz(c.k);
            if (a.filter(v => v != null).length < 2) {
                return `<div class="mini"><div class="mini-t">${c.lab} <span class="rep-u">${c.u}</span></div>
                        <div class="mini-empty">dato non disponibile per questa provincia</div></div>`;
            }
            return `<div class="mini"><div class="mini-t">${c.lab} <span class="rep-u">${c.u}</span></div>
                    ${miniLinee(D.settimane, a, b, CARB_COL[c.k])}</div>`;
        }).join("");

        return box("Andamento settimanale — focus completo", "TUTTI I CARBURANTI",
            `<p class="rep-p">Un pannello per carburante, ciascuno con la propria scala: benzina e GPL
             differiscono di oltre un euro al litro e il metano si misura in €/kg, quindi un asse unico
             renderebbe illeggibili le serie più basse. La linea in tinta è ${esc(prov.nome)},
             quella grigia la media nazionale.</p>
             <div class="dv-legend">
               <span><i style="background:#8b97a5"></i>Media Italia</span>
               <span>${esc(prov.nome)} — linea in tinta, un colore per carburante</span>
               <span style="margin-left:auto">${D.settimane.length} settimane</span>
             </div>
             <div class="rep-grid">${mini}</div>`) +
            sezIndicizzato(prov) + sezElettricitaGrafico();
    }

    /**
     * Confronto dei rincari a base 100. Qui l'asse unico e' legittimo proprio
     * perche' i valori non sono piu' prezzi ma numeri indice sulla stessa base:
     * risponde alla domanda "che cosa e' rincarato di piu'", che i valori
     * assoluti non possono mostrare.
     */
    function sezIndicizzato(prov) {
        const serie = CARB.map(c => {
            const v = serieProv(prov, c.k);
            const i0 = v.findIndex(x => x != null);
            if (i0 < 0) return null;
            const base = v[i0];
            return { lab: c.lab, col: CARB_COL[c.k], v: v.map(x => x == null ? null : x / base * 100) };
        }).filter(Boolean);
        if (!serie.length) return "";

        return box("Rincari a confronto — base 100", "NUMERI INDICE",
            `<p class="rep-p">Ogni carburante è posto uguale a 100 nella prima settimana disponibile
             (${formattaData(D.settimane[0])}). La linea che sale più delle altre è quella rincarata di più,
             indipendentemente dal prezzo di partenza.</p>` +
            graficoIndice(D.settimane, serie) +
            `<p class="note-fonte">I numeri indice non sono prezzi: servono a confrontare le variazioni,
             non i livelli. Per i livelli si vedano i pannelli precedenti.</p>`);
    }

    /** Elettricita': serie ARERA trimestrale, nazionale. Frequenza e unita'
        diverse dai carburanti, quindi pannello separato e cosi' etichettato. */
    function sezElettricitaGrafico() {
        const serie = D.arera.filter(r => r.tipo_dato === "elettricita_tutela_2700")
            .sort((a, b) => String(a.anno_mese).localeCompare(String(b.anno_mese)));
        if (serie.length < 2) return "";
        const ult = serie.slice(-16);
        const lab = ult.map(r => String(r.periodo || r.anno_mese));
        const val = ult.map(r => num(r.valore));

        return box("Elettricità — andamento", "DATO NAZIONALE — NON PROVINCIALE",
            `<p class="rep-p">Prezzo finale per il cliente domestico tipo in tutela, 2.700 kWh/anno.
             Serie <b>trimestrale</b> e <b>nazionale</b>: frequenza e unità diverse dai carburanti,
             perciò un pannello a sé. Ultimi ${ult.length} trimestri, valori in c€/kWh.</p>` +
            miniLinee(lab, val, null, "var(--navy)", true) +
            `<p class="note-fonte">Fonte: ARERA. Non esiste disaggregazione provinciale o regionale.</p>`);
    }

    function sezStorico(prov) {
        const c = CARB.find(x => x.k === S.carb);
        const serieP = [], serieN = [];
        D.settimane.forEach(w => {
            const rows = settimanaRows(w);
            const p = rows.find(r => r.provincia_sigla === prov.sigla);
            serieP.push(p ? num(p[S.carb]) : null);
            serieN.push(media(rows, S.carb));
        });
        if (serieP.filter(v => v != null).length < 2) {
            return box("Andamento settimanale", c.lab,
                `<p class="rep-p">Serie troppo corta per essere rappresentata: servono almeno due settimane con dato disponibile.</p>`);
        }
        return box("Andamento settimanale", c.lab,
            `<p class="rep-p">Confronto fra il prezzo della provincia e la media nazionale sulle
             ${D.settimane.length} settimane disponibili. Asse unico, valori in ${c.u}.</p>` +
            graficoLinee(D.settimane, serieP, serieN, esc(prov.nome), c.u) +
            `<p class="note-fonte">Fonte: MIMIT, rilevazione dei prezzi praticati alle ore 8.
             Il valore settimanale è quello dell'ultima esecuzione ETL riuscita della settimana, non una media dei sette giorni.</p>`);
    }

    /* --- 4. variazioni --- */
    function sezVariazioni(prov) {
        const n = D.settimane.length;
        const idx = D.settimane.indexOf(S.settimana);
        const rif = [["Settimana precedente", idx - 1], ["Quattro settimane prima", idx - 4], ["Inizio della serie", 0]];

        const tr = CARB.map(c => {
            const cur = valoreConRipiego(prov.sigla, S.settimana, c.k).v;
            const celle = rif.map(([, i]) => {
                if (i < 0 || i >= n || i === idx) return `<td class="num">—</td>`;
                const old = valoreConRipiego(prov.sigla, D.settimane[i], c.k).v;
                if (cur == null || old == null) return `<td class="num">—</td>`;
                const d = (cur - old) * 100, pc = (cur / old - 1) * 100;
                return `<td class="num ${d > 0 ? "up" : "dn"}">${sgn(d)} c€ <span class="rep-u">(${sgn(pc)}%)</span></td>`;
            }).join("");
            return `<tr><td>${c.lab}</td><td class="num hl">${fmt(cur)} <span class="rep-u">${c.u}</span></td>${celle}</tr>`;
        }).join("");

        return box("Variazioni nel tempo", null,
            `<table class="ance-table"><thead><tr>
               <th>Carburante</th><th>Valore corrente</th>
               ${rif.map(([l, i]) => `<th>vs ${l}${i >= 0 && i < n ? "<br><span class='rep-u'>" + formattaData(D.settimane[i]) + "</span>" : ""}</th>`).join("")}
             </tr></thead><tbody>${tr}</tbody></table>
             <p class="note-fonte">Variazioni in centesimi di euro e in percentuale. Un valore positivo indica un rincaro.</p>`);
    }

    /* --- 5. contesto elettricita' --- */
    function sezElettricita() {
        const serie = D.arera.filter(r => r.tipo_dato === "elettricita_tutela_2700")
            .sort((a, b) => String(a.anno_mese).localeCompare(String(b.anno_mese)));
        if (!serie.length) {
            return box("Contesto elettricità", "DATO NAZIONALE",
                `<p class="rep-p">Serie ARERA non disponibile.</p>`);
        }
        const ult = serie.slice(-6);
        const tr = ult.map(r => `<tr>
            <td>${esc(r.periodo)}</td>
            <td class="num hl"><b>${fmt(num(r.valore), 2)}</b></td>
            <td class="num">${fmt(num(r.materia_energia), 2)}</td>
            <td class="num">${fmt(num(r.trasporto), 2)}</td>
            <td class="num">${fmt(num(r.oneri_sistema), 2)}</td>
            <td class="num">${fmt(num(r.imposte), 2)}</td></tr>`).join("");

        const a = num(ult[ult.length - 2] && ult[ult.length - 2].valore);
        const b = num(ult[ult.length - 1].valore);
        const d = (a && b) ? (b / a - 1) * 100 : null;

        return box("Contesto elettricità", "DATO NAZIONALE — NON PROVINCIALE",
            `<div class="callout"><b>Attenzione alla granularità:</b> ARERA pubblica i prezzi finali
             dell'energia elettrica solo a livello <b>nazionale</b> e con cadenza <b>trimestrale</b>.
             Non esiste un dato provinciale né regionale: la tabella che segue è contesto nazionale
             e non va letta come un dato della provincia di riferimento.</div>
             <table class="ance-table"><thead><tr>
               <th>Trimestre</th><th>Prezzo finale</th><th>Materia energia</th>
               <th>Trasporto</th><th>Oneri di sistema</th><th>Imposte</th>
             </tr></thead><tbody>${tr}</tbody></table>
             <p class="rep-p">Cliente domestico tipo in regime di tutela, 2.700 kWh/anno, valori in c€/kWh.` +
            (d == null ? "" : ` Ultima variazione trimestrale: <b class="${d > 0 ? "up" : "dn"}">${sgn(d)}%</b>.`) +
            ` Dal 2024 la tutela riguarda i soli clienti vulnerabili: sul mercato libero i prezzi possono divergere.</p>
             <p class="note-fonte">Fonte: ARERA, tabella dei prezzi finali dell'energia elettrica per il cliente domestico tipo.</p>`);
    }

    /* --- 6. fonti e accesso ai dati ---
       Gli indirizzi sono scritti per esteso, non nascosti dietro un
       collegamento: sulla copia stampata un href non e' cliccabile e
       un rapporto senza indirizzi visibili non e' verificabile. */
    function sezFonti() {
        const C = window.CONFIG || {};
        const fonti = C.FONTI || [];

        const righe = fonti.map(f => `<tr>
            <td class="nm">${esc(f.ente)}</td>
            <td>${esc(f.cosa)}</td>
            <td><a class="rep-url" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a></td>
          </tr>`).join("");

        const tabelle = [
            ["prezzi_carburanti_provinciale", "prezzi provinciali dei carburanti"],
            ["prezzi_finali_arera", "prezzi finali ARERA dell'energia elettrica"],
            ["anagrafica_province", "anagrafica delle province"],
        ];
        const csv = typeof C.CSV_BASE_URL === "function"
            ? tabelle.map(([t, d]) => `<li>${d} — <a class="rep-url" href="${esc(C.CSV_BASE_URL(t))}" target="_blank" rel="noopener">${esc(C.CSV_BASE_URL(t))}</a></li>`).join("")
            : "";
        const view = typeof C.GSHEET_VIEW_URL === "function" ? C.GSHEET_VIEW_URL() : null;

        return box("Fonti e accesso ai dati", "SOLA LETTURA",
            `<p class="rep-p">Ogni valore di questo rapporto è verificabile alla fonte. Gli indirizzi sono
             riportati per esteso perché restino utilizzabili anche sulla copia stampata.</p>
             <table class="ance-table"><thead><tr>
               <th>Ente</th><th>Che cosa fornisce</th><th>Indirizzo</th>
             </tr></thead><tbody>${righe}</tbody></table>` +
            (view ? `<div class="rep-sheet-box">
               <div class="rep-sheet-t">Foglio dati che alimenta il dashboard — sola lettura</div>
               <a class="rep-url" href="${esc(view)}" target="_blank" rel="noopener">${esc(view)}</a>
               <p class="rep-p" style="margin:9px 0 5px">Le singole tabelle usate in questo rapporto sono
                  scaricabili in formato CSV agli indirizzi seguenti, gli stessi che legge il dashboard:</p>
               <ul class="rep-ul rep-ul-note rep-ul-url">${csv}</ul>
             </div>` : ""));
    }

    /* --- 7. note --- */
    function sezNote(prov) {
        return box("Note di lettura", null, `<ul class="rep-ul rep-ul-note">
          <li>I prezzi dei carburanti provengono dal dataset MIMIT «Prezzi praticati e anagrafica degli impianti»,
              rilevazione delle ore 8, licenza IODL 2.0. Benzina e gasolio sono considerati in modalità self service.</li>
          <li>Il valore settimanale non è la media dei sette giorni: l'ETL gira ogni giorno e sovrascrive la
              settimana ISO in corso, quindi resta il dato dell'ultima esecuzione riuscita di quella settimana.</li>
          <li>Le medie territoriali sono aritmetiche semplici sulle province, non ponderate per popolazione,
              consumi o numero di impianti. Una provincia piccola pesa quanto una grande.</li>
          <li>Il metano non è distribuito in tutte le province. Dove manca il dato provinciale si riporta la media
              regionale, contrassegnata dall'etichetta <span class="rep-tag">regionale</span>; se manca anche quella
              si scende al dato nazionale.</li>
          <li>I prezzi finali dell'energia elettrica sono ARERA, nazionali e trimestrali: non esiste
              disaggregazione provinciale o regionale e nessuna stima viene qui prodotta.</li>
          <li>Provincia del rapporto: ${esc(prov.nome)} (${esc(prov.sigla)}), ${esc(prov.regione)}.
              Settimane disponibili nella serie: ${D.settimane.length}, dalla settimana del
              ${formattaData(D.settimane[0])} a quella del ${formattaData(D.settimane[D.settimane.length - 1])}.</li>
        </ul>`);
    }

    /* ---------------- grafico a linee ---------------- */

    function graficoLinee(labels, sA, sB, nomeA, unita) {
        const W = 760, H = 240, m = { t: 16, r: 96, b: 30, l: 48 };
        const iw = W - m.l - m.r, ih = H - m.t - m.b;
        const tutti = sA.concat(sB).filter(v => v != null);
        let min = Math.min(...tutti), max = Math.max(...tutti);
        const pad = (max - min) * 0.15 || 0.05; min -= pad; max += pad;

        const X = i => m.l + (labels.length === 1 ? iw / 2 : i * iw / (labels.length - 1));
        const Y = v => m.t + ih - (v - min) / (max - min) * ih;
        const path = s => s.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`)
            .filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join(" ");

        const ticks = [min, (min + max) / 2, max].map(v =>
            `<line x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3e8ee"/>
             <text x="${m.l - 7}" y="${Y(v) + 3.5}" text-anchor="end" class="g-ax">${fmt(v, 2)}</text>`).join("");

        // Etichette dell'asse X: una ogni "passo", piu sempre l'ultima. Le intermedie
        // troppo vicine all'ultima vengono scartate, altrimenti si sovrappongono.
        const passo = Math.max(1, Math.ceil(labels.length / 6));
        const ultimo = labels.length - 1;
        const idxLab = labels.map((_, i) => i)
            .filter(i => i === ultimo || (i % passo === 0 && ultimo - i > passo * 0.6));
        const xlab = idxLab.map(i =>
            `<text x="${X(i)}" y="${H - 9}" text-anchor="middle" class="g-ax">${formattaData(labels[i])}</text>`).join("");

        const lastA = [...sA].reverse().findIndex(v => v != null);
        const iA = lastA < 0 ? -1 : sA.length - 1 - lastA;
        const lastB = [...sB].reverse().findIndex(v => v != null);
        const iB = lastB < 0 ? -1 : sB.length - 1 - lastB;

        // Quando provincia e media nazionale quasi coincidono le due etichette
        // di fine serie si sovrappongono: le separo di qualche pixel.
        let dyA = 3.5, dyB = 3.5;
        if (iA >= 0 && iB >= 0 && Math.abs(Y(sA[iA]) - Y(sB[iB])) < 13) {
            const sopra = Y(sA[iA]) <= Y(sB[iB]);
            dyA = sopra ? -3 : 10; dyB = sopra ? 10 : -3;
        }

        const hot = labels.map((w, i) =>
            `<rect class="g-hot" x="${X(i) - iw / (labels.length * 2 || 1)}" y="${m.t}"
                   width="${Math.max(6, iw / labels.length)}" height="${ih}" fill="transparent"
                   data-i="${i}" data-x="${X(i)}"
                   data-t="${esc(formattaData(w))}|${sA[i] == null ? "—" : fmt(sA[i]) + " " + unita}|${sB[i] == null ? "—" : fmt(sB[i]) + " " + unita}"/>`).join("");

        return `<div class="rep-chart">
          <div class="dv-legend">
            <span><i style="background:var(--div-5)"></i>${nomeA}</span>
            <span><i style="background:var(--div-1)"></i>Media Italia</span>
            <span style="margin-left:auto">valori in ${unita}</span>
          </div>
          <svg viewBox="0 0 ${W} ${H}" class="g-svg" role="img"
               aria-label="Andamento settimanale del prezzo a ${nomeA} confrontato con la media italiana">
            ${ticks}${xlab}
            <path d="${path(sB)}" fill="none" stroke="var(--div-1)" stroke-width="2" stroke-linejoin="round"/>
            <path d="${path(sA)}" fill="none" stroke="var(--div-5)" stroke-width="2" stroke-linejoin="round"/>
            ${iA >= 0 ? `<circle cx="${X(iA)}" cy="${Y(sA[iA])}" r="4" fill="var(--div-5)" stroke="#fff" stroke-width="2"/>
              <text x="${X(iA) + 9}" y="${Y(sA[iA]) + dyA}" class="g-lab" fill="var(--div-5)">${fmt(sA[iA], 3)}</text>` : ""}
            ${iB >= 0 ? `<circle cx="${X(iB)}" cy="${Y(sB[iB])}" r="4" fill="var(--div-1)" stroke="#fff" stroke-width="2"/>
              <text x="${X(iB) + 9}" y="${Y(sB[iB]) + dyB}" class="g-lab" fill="var(--div-1)">${fmt(sB[iB], 3)}</text>` : ""}
            <line class="g-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#8b97a5" stroke-dasharray="3 3" opacity="0"/>
            ${hot}
          </svg>
          <div class="g-tip" hidden></div>
        </div>`;
    }

    /**
     * Livello di lettura del grafico: crocino verticale e tooltip.
     * Un grafico HTML e' interattivo per natura; in stampa il livello sparisce
     * e restano le etichette dirette di fine serie.
     */
    function attivaTooltipGrafico() {
        const wrap = document.querySelector(".rep-chart");
        if (!wrap) return;
        const svg = wrap.querySelector(".g-svg");
        const cross = wrap.querySelector(".g-cross");
        const tip = wrap.querySelector(".g-tip");
        if (!svg || !cross || !tip) return;
        const vocLegenda = wrap.querySelector(".dv-legend span");
        const nomeA = vocLegenda ? vocLegenda.textContent.trim() : "Provincia";

        wrap.querySelectorAll(".g-hot").forEach(r => {
            r.addEventListener("mouseenter", () => {
                const [d, a, b] = r.dataset.t.split("|");
                const x = parseFloat(r.dataset.x);
                cross.setAttribute("x1", x); cross.setAttribute("x2", x);
                cross.setAttribute("opacity", "1");
                tip.innerHTML = `<div class="tt-title">${d}</div>
                  <div class="tt-row"><span class="tt-label"><i style="background:var(--div-5)"></i>${nomeA}</span><span class="tt-value">${a}</span></div>
                  <div class="tt-row"><span class="tt-label"><i style="background:var(--div-1)"></i>Media Italia</span><span class="tt-value">${b}</span></div>`;
                tip.hidden = false;
                const box = svg.getBoundingClientRect();
                tip.style.left = Math.min(box.width - 170, Math.max(0, x / 760 * box.width - 80)) + "px";
            });
        });
        svg.addEventListener("mouseleave", () => { cross.setAttribute("opacity", "0"); tip.hidden = true; });
    }

    /* ---------------- grafici del focus completo ---------------- */

    /** Piccolo multiplo: una serie in tinta piu' un riferimento grigio. */
    function miniLinee(labels, sA, sB, colore, larga) {
        const W = larga ? 760 : 372, H = larga ? 200 : 148;
        const m = { t: 12, r: larga ? 60 : 48, b: 20, l: larga ? 46 : 40 };
        const iw = W - m.l - m.r, ih = H - m.t - m.b;
        const tutti = sA.concat(sB || []).filter(v => v != null);
        if (tutti.length < 2) return "";
        let min = Math.min(...tutti), max = Math.max(...tutti);
        const pad = (max - min) * 0.18 || 0.05; min -= pad; max += pad;

        const X = i => m.l + (labels.length === 1 ? iw / 2 : i * iw / (labels.length - 1));
        const Y = v => m.t + ih - (v - min) / (max - min) * ih;
        const path = arr => arr.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`)
            .filter(Boolean).map((pt, i) => (i ? "L" : "M") + pt).join(" ");

        const ticks = [min + pad, max - pad].map(v =>
            `<line x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e6eaef"/>
             <text x="${m.l - 6}" y="${Y(v) + 3}" text-anchor="end" class="g-ax">${fmt(v, larga ? 1 : 2)}</text>`).join("");

        const xl = `<text x="${X(0)}" y="${H - 5}" text-anchor="start" class="g-ax">${formattaData(labels[0]) || esc(labels[0])}</text>
                    <text x="${X(labels.length - 1)}" y="${H - 5}" text-anchor="end" class="g-ax">${formattaData(labels[labels.length - 1]) || esc(labels[labels.length - 1])}</text>`;

        const li = sA.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
        return `<svg viewBox="0 0 ${W} ${H}" class="g-svg" role="img">
            ${ticks}${xl}
            ${sB ? `<path d="${path(sB)}" fill="none" stroke="#8b97a5" stroke-width="1.6"/>` : ""}
            <path d="${path(sA)}" fill="none" stroke="${colore}" stroke-width="2" stroke-linejoin="round"/>
            ${li != null ? `<circle cx="${X(li)}" cy="${Y(sA[li])}" r="3.5" fill="${colore}" stroke="#fff" stroke-width="1.6"/>
              <text x="${X(li) + 7}" y="${Y(sA[li]) + 3.5}" class="g-lab" fill="${colore}">${fmt(sA[li], larga ? 2 : 3)}</text>` : ""}
        </svg>`;
    }

    /** Numeri indice: asse unico legittimo, tutte le serie sulla stessa base. */
    function graficoIndice(labels, serie) {
        const W = 760, H = 262, m = { t: 14, r: 132, b: 30, l: 44 };
        const iw = W - m.l - m.r, ih = H - m.t - m.b;
        const tutti = serie.flatMap(s2 => s2.v).filter(v => v != null).concat([100]);
        let min = Math.min(...tutti), max = Math.max(...tutti);
        const pad = (max - min) * 0.14 || 1; min -= pad; max += pad;

        const X = i => m.l + (labels.length === 1 ? iw / 2 : i * iw / (labels.length - 1));
        const Y = v => m.t + ih - (v - min) / (max - min) * ih;
        const path = arr => arr.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`)
            .filter(Boolean).map((pt, i) => (i ? "L" : "M") + pt).join(" ");

        const ticks = [min + pad, 100, max - pad].map(v =>
            `<line x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}"
                   stroke="${Math.abs(v - 100) < 0.01 ? "#9aa5b1" : "#e6eaef"}"
                   ${Math.abs(v - 100) < 0.01 ? 'stroke-dasharray="4 3"' : ""}/>
             <text x="${m.l - 6}" y="${Y(v) + 3.5}" text-anchor="end" class="g-ax">${fmt(v, 0)}</text>`).join("");

        const passo = Math.max(1, Math.ceil(labels.length / 6));
        const ultimo = labels.length - 1;
        const xl = labels.map((_, i) => i).filter(i => i === ultimo || (i % passo === 0 && ultimo - i > passo * 0.6))
            .map(i => `<text x="${X(i)}" y="${H - 9}" text-anchor="middle" class="g-ax">${formattaData(labels[i])}</text>`).join("");

        // Etichette dirette a fine serie, separate verticalmente quando si
        // sovrappongono: identita' mai affidata al solo colore.
        const fine = serie.map(s2 => {
            const i = s2.v.map((v, k) => v == null ? -1 : k).filter(k => k >= 0).pop();
            return i == null ? null : { s: s2, i, y: Y(s2.v[i]) };
        }).filter(Boolean).sort((a, b) => a.y - b.y);
        for (let k = 1; k < fine.length; k++) {
            if (fine[k].y - fine[k - 1].y < 13) fine[k].y = fine[k - 1].y + 13;
        }

        return `<div class="rep-chart"><svg viewBox="0 0 ${W} ${H}" class="g-svg" role="img"
              aria-label="Numeri indice dei carburanti, base 100 alla prima settimana">
            ${ticks}${xl}
            ${serie.map(s2 => `<path d="${path(s2.v)}" fill="none" stroke="${s2.col}" stroke-width="2" stroke-linejoin="round"/>`).join("")}
            ${fine.map(f => `<circle cx="${X(f.i)}" cy="${Y(f.s.v[f.i])}" r="3.5" fill="${f.s.col}" stroke="#fff" stroke-width="1.6"/>
              <text x="${X(f.i) + 8}" y="${f.y + 3.5}" class="g-lab2" fill="${f.s.col}">${esc(f.s.lab.replace(" self service", ""))} ${fmt(f.s.v[f.i], 1)}</text>`).join("")}
        </svg></div>`;
    }

    return { init };
})();

window.ReportisticaTab = ReportisticaTab;
