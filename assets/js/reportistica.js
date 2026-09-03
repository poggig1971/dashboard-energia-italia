/**
 * Scheda Reportistica — Dashboard Energia Italia
 *
 * Rapporto personalizzabile e stampabile in PDF tramite la stampa del browser
 * (foglio @media print, nessuna dipendenza aggiuntiva).
 *
 * Due livelli: PROVINCIA o REGIONE. Nel rapporto regionale compare in piu' il
 * dettaglio delle province, che e' il vero motivo per farne uno: una media
 * regionale nasconde la dispersione interna, il dettaglio la mostra.
 *
 * Principio sulla granularita' del dato, applicato in tutto il modulo:
 *   provinciale -> regionale -> nazionale
 * Quando un valore non e' disponibile alla granularita' richiesta si scende di
 * livello e lo si ETICHETTA. I prezzi finali ARERA esistono solo a livello
 * nazionale: in quella sezione non c'e' ripiego possibile e va detto.
 */

const ReportisticaTab = (function () {

    const CARB = [
        { k: "benzina_self_eur_l", lab: "Benzina self service", u: "€/l" },
        { k: "gasolio_self_eur_l", lab: "Gasolio self service", u: "€/l" },
        { k: "gpl_eur_l",          lab: "GPL",                  u: "€/l" },
        { k: "metano_eur_kg",      lab: "Metano",               u: "€/kg" },
    ];

    // Palette categorica validata con lo strumento della guida dataviz:
    // peggior coppia DeltaE 15,4 in deuteranopia e 18,1 in visione normale,
    // tutte e quattro sopra il contrasto 3:1. Blu e rosso sono gli stessi poli
    // della scala divergente usata altrove, cosi' le due palette convivono.
    // Soglie fisse della scala divergente, in centesimi di euro al litro.
    const SOGLIA_LINEA = 0.5;   // sotto mezzo centesimo la differenza non si percepisce
    const SOGLIA_FORTE = 2.0;   // circa l'1% del prezzo di un litro

    const CARB_COL = {
        benzina_self_eur_l: "#1a5c96",
        gasolio_self_eur_l: "#b03a2e",
        gpl_eur_l:          "#c9820b",
        metano_eur_kg:      "#6a3d9a",
    };

    const SEZIONI = [
        ["sintesi",     "Sintesi"],
        ["confronto",   "Confronto territoriale"],
        ["province",    "Dettaglio delle province (solo regione)"],
        ["storico",     "Andamento settimanale"],
        ["variazioni",  "Variazioni nel tempo"],
        ["elettricita", "Contesto elettricità"],
        ["fonti",       "Fonti e accesso ai dati"],
        ["note",        "Note di lettura"],
    ];

    const D = { rows: [], arera: [], anag: [], settimane: [], province: [], regioni: [], buchi: [] };
    const S = {
        // Apertura sul rapporto regionale del Piemonte: e' il territorio di
        // competenza di ANCE Piemonte e Valle d'Aosta, quindi la vista utile
        // nove volte su dieci. Il livello provinciale resta a un clic.
        livello: "regione",
        sigla: null,
        regione: null,
        settimana: null,
        carb: "benzina_self_eur_l",
        focus: false,
        sezioni: Object.fromEntries(SEZIONI.map(([k]) => [k, true])),
    };

    /* ================= utilita' ================= */

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

    function spostaSettimane(iso, n) {
        const d = new Date(iso + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 7 * n);
        return d.toISOString().slice(0, 10);
    }
    function settimaneTra(a, b) {
        const ms = new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z");
        return Math.round(ms / (7 * 86400000));
    }
    /** Lunedi ISO assenti fra la prima e l'ultima settimana caricata. */
    function calcolaBuchi() {
        const s = new Set(D.settimane), out = [];
        if (D.settimane.length < 2) return out;
        const ultima = D.settimane[D.settimane.length - 1];
        let cur = D.settimane[0];
        while (cur < ultima) {
            cur = spostaSettimane(cur, 1);
            if (cur < ultima && !s.has(cur)) out.push(cur);
        }
        return out;
    }

    /** Valore provinciale con ripiego dichiarato: provincia -> regione -> Italia. */
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

    /** Soggetto del rapporto: astrae provincia e regione dietro la stessa interfaccia. */
    function sogg() {
        if (S.livello === "regione") {
            const prov = D.province.filter(p => p.regione === S.regione);
            return {
                tipo: "regione", nome: S.regione, sigla: null,
                regione: S.regione, macro: (prov[0] || {}).macro, province: prov,
                val: (w, k) => ({ v: media(settimanaRows(w).filter(r => r.regione === S.regione), k), livello: "regionale" }),
            };
        }
        const p = D.province.find(x => x.sigla === S.sigla) || {};
        return {
            tipo: "provincia", nome: p.nome, sigla: p.sigla,
            regione: p.regione, macro: p.macro, province: [p],
            val: (w, k) => valoreConRipiego(p.sigla, w, k),
        };
    }

    function posizione(sg, w, k) {
        const rows = settimanaRows(w);
        if (sg.tipo === "regione") {
            const m = {};
            rows.forEach(r => { if (num(r[k]) != null) (m[r.regione] = m[r.regione] || []).push(num(r[k])); });
            const ord = Object.entries(m).map(([reg, a]) => [reg, a.reduce((x, y) => x + y, 0) / a.length])
                .sort((a, b) => b[1] - a[1]);
            const i = ord.findIndex(([reg]) => reg === sg.regione);
            return i < 0 ? null : { pos: i + 1, su: ord.length, che: "regione" };
        }
        const ord = rows.filter(r => num(r[k]) != null).sort((a, b) => num(b[k]) - num(a[k]));
        const i = ord.findIndex(r => r.provincia_sigla === sg.sigla);
        return i < 0 ? null : { pos: i + 1, su: ord.length, che: "provincia" };
    }

    const serieSogg = (sg, k) => D.settimane.map(w => sg.val(w, k).v);
    const serieNaz = k => D.settimane.map(w => media(settimanaRows(w), k));

    /* ================= bootstrap ================= */

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
            D.buchi = calcolaBuchi();
            S.settimana = D.settimane[D.settimane.length - 1];

            D.province = settimanaRows(S.settimana).map(r => ({
                sigla: r.provincia_sigla, nome: r.provincia_nome, regione: r.regione, macro: r.macro_area,
            })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "it"));
            D.regioni = [...new Set(D.province.map(p => p.regione))].sort((a, b) => a.localeCompare(b, "it"));

            S.sigla = (D.province.find(p => p.sigla === "TO") || D.province[0] || {}).sigla;
            S.regione = D.regioni.includes("Piemonte") ? "Piemonte" : D.regioni[0];

            renderShell(host);
            renderReport();
        } catch (err) {
            console.error("[Reportistica]", err);
            host.innerHTML = '<div class="error-message">Impossibile caricare i dati per la reportistica. ' +
                'Verificare la connessione e riprovare con il pulsante Aggiorna.</div>';
        }
    }

    /* ================= struttura della scheda ================= */

    function renderShell(host) {
        host.innerHTML = `
        <div class="rep-layout">
          <aside class="rep-side no-print">
            <div class="rep-side-title">RAPPORTO</div>

            <label class="rep-lab" for="rep-livello">LIVELLO</label>
            <select id="rep-livello" class="rep-sel">
              <option value="provincia"${S.livello === "provincia" ? " selected" : ""}>Provincia</option>
              <option value="regione"${S.livello === "regione" ? " selected" : ""}>Regione (con dettaglio province)</option>
            </select>

            <div id="rep-wrap-prov"${S.livello === "regione" ? ' style="display:none"' : ""}>
              <label class="rep-lab" for="rep-prov">PROVINCIA OGGETTO DEL RAPPORTO</label>
              <select id="rep-prov" class="rep-sel">
                ${D.province.map(p => `<option value="${esc(p.sigla)}"${p.sigla === S.sigla ? " selected" : ""}>${esc(p.nome)} (${esc(p.sigla)})</option>`).join("")}
              </select>
            </div>

            <div id="rep-wrap-reg"${S.livello === "provincia" ? ' style="display:none"' : ""}>
              <label class="rep-lab" for="rep-reg">REGIONE OGGETTO DEL RAPPORTO</label>
              <select id="rep-reg" class="rep-sel">
                ${D.regioni.map(r => `<option value="${esc(r)}"${r === S.regione ? " selected" : ""}>${esc(r)}</option>`).join("")}
              </select>
            </div>

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

        const $ = id => document.getElementById(id);
        $("rep-livello").onchange = e => {
            S.livello = e.target.value;
            $("rep-wrap-prov").style.display = (S.livello === "provincia") ? "" : "none";
            $("rep-wrap-reg").style.display = (S.livello === "regione") ? "" : "none";
            renderReport();
        };
        $("rep-prov").onchange = e => { S.sigla = e.target.value; renderReport(); };
        $("rep-reg").onchange = e => { S.regione = e.target.value; renderReport(); };
        $("rep-week").onchange = e => { S.settimana = e.target.value; renderReport(); };
        $("rep-carb").onchange = e => { S.carb = e.target.value; renderReport(); };
        $("rep-focus").onchange = e => {
            S.focus = e.target.checked;
            $("rep-carb").disabled = S.focus;
            renderReport();
        };
        $("rep-print").onclick = () => window.print();
        host.querySelectorAll("#rep-sez input").forEach(cb => {
            cb.onchange = () => { S.sezioni[cb.dataset.sez] = cb.checked; renderReport(); };
        });
    }

    /* ================= rapporto ================= */

    function renderReport() {
        const sheet = document.getElementById("rep-sheet");
        const sg = sogg();
        if (!sg.nome) { sheet.innerHTML = '<div class="error-message">Soggetto del rapporto non trovato.</div>'; return; }

        const oggi = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
        const titolo = sg.tipo === "regione"
            ? `Prezzi dell'energia in ${esc(sg.nome)}`
            : `Prezzi dell'energia in provincia di ${esc(sg.nome)}`;
        const sotto = sg.tipo === "regione"
            ? `${sg.province.length} province · area ${esc(sg.macro)}`
            : `${esc(sg.regione)} · area ${esc(sg.macro)}`;

        let h = `
          <h1 class="rep-h1">${titolo}</h1>
          <p class="rep-sub">Carburanti alla settimana del <b>${formattaData(S.settimana)}</b> ·
             ${sotto} · elaborazione ANCE Piemonte e Valle d'Aosta su dati MIMIT e ARERA, ${oggi}</p>
          <div class="rep-rule"></div>`
          + avvisoContinuita();

        if (S.sezioni.sintesi)     h += sezSintesi(sg);
        if (S.sezioni.confronto)   h += sezConfronto(sg);
        if (S.sezioni.province && sg.tipo === "regione") h += sezProvince(sg);
        if (S.sezioni.storico)     h += (S.focus ? sezStoricoFocus(sg) : sezStorico(sg));
        if (S.sezioni.variazioni)  h += sezVariazioni(sg);
        if (S.sezioni.elettricita) h += sezElettricita();
        if (S.sezioni.fonti)       h += sezFonti();
        if (S.sezioni.note)        h += sezNote(sg);

        sheet.innerHTML = h;
        attivaHover(sheet);
    }

    function box(titolo, badge, corpo) {
        return `<section class="rep-box"><h2 class="rep-h2">${titolo}` +
            (badge ? ` <span class="rep-badge">${badge}</span>` : "") +
            `</h2>${corpo}</section>`;
    }

    /** Avviso in testa: un buco nella serie va dichiarato, non lasciato dedurre. */
    function avvisoContinuita() {
        if (!D.buchi.length) return "";
        const el = D.buchi.map(formattaData).join(", ");
        return `<div class="rep-warn"><b>Serie non continua.</b> Fra la prima e l'ultima settimana caricata
            mancano ${D.buchi.length === 1 ? "una settimana" : D.buchi.length + " settimane"}: <b>${el}</b>.
            I confronti temporali di questo rapporto usano le settimane realmente disponibili e lo dichiarano
            nelle intestazioni.</div>`;
    }

    /* --- 1. sintesi --- */
    function sezSintesi(sg) {
        const rows = settimanaRows(S.settimana);
        const li = CARB.map(c => {
            const r = sg.val(S.settimana, c.k);
            if (r.v == null) return `<li>${c.lab}: dato non disponibile.</li>`;
            const naz = media(rows, c.k);
            const d = naz ? (r.v - naz) * 100 : null;
            const pos = posizione(sg, S.settimana, c.k);
            const tag = (sg.tipo === "provincia" && r.livello !== "provinciale")
                ? ` <span class="rep-tag">media ${r.livello}</span>` : "";
            return `<li><b>${c.lab}</b>: <b class="rep-key">${fmt(r.v)} ${c.u}</b>${tag}` +
                (d == null ? "" : `, ${d >= 0 ? "sopra" : "sotto"} la media nazionale di <b>${fmt(Math.abs(d), 2)} c€</b>`) +
                (pos ? `, <b>${pos.pos}ª</b> ${pos.che} su ${pos.su} per prezzo` : "") + ".</li>";
        }).join("");

        // Il carburante rincarato di piu': il livello non lo dice, la dinamica si.
        let dinamica = "";
        const idx = D.settimane.indexOf(S.settimana);
        if (idx > 0) {
            const var0 = CARB.map(c => {
                const a = sg.val(D.settimane[0], c.k).v, b = sg.val(S.settimana, c.k).v;
                return (a && b) ? { lab: c.lab, pc: (b / a - 1) * 100 } : null;
            }).filter(Boolean).sort((x, y) => y.pc - x.pc);
            if (var0.length) {
                const su = var0[0], giu = var0[var0.length - 1];
                dinamica = `<li>Dall'inizio della serie il rincaro maggiore è su <b>${su.lab}</b>
                    (<b class="${su.pc > 0 ? "up" : "dn"}">${sgn(su.pc)}%</b>)` +
                    (giu !== su ? `, il minore su <b>${giu.lab}</b> (<b class="${giu.pc > 0 ? "up" : "dn"}">${sgn(giu.pc)}%</b>)` : "") +
                    `. Il livello di prezzo e la sua dinamica sono cose diverse: una ${sg.tipo} può essere
                     sotto la media e insieme rincarare più delle altre.</li>`;
            }
        }

        let extra = "";
        if (sg.tipo === "provincia") {
            const anag = D.anag.find(a => a.sigla === sg.sigla);
            const pop = anag && num(anag.popolazione_2024);
            const imp = (rows.find(r => r.provincia_sigla === sg.sigla) || {}).n_impianti;
            if (pop) extra = `<li>Popolazione ${pop.toLocaleString("it-IT")} abitanti` +
                (num(imp) ? `, ${imp} impianti di distribuzione rilevati` : "") + ".</li>";
        } else {
            const sigle = sg.province.map(p => p.sigla);
            const pop = D.anag.filter(a => sigle.includes(a.sigla))
                .map(a => num(a.popolazione_2024)).filter(Boolean).reduce((a, b) => a + b, 0);
            const imp = rows.filter(r => r.regione === sg.regione)
                .map(r => num(r.n_impianti)).filter(Boolean).reduce((a, b) => a + b, 0);
            extra = `<li>${sg.province.length} province, ${pop ? pop.toLocaleString("it-IT") + " abitanti" : "popolazione n.d."}` +
                (imp ? `, ${imp.toLocaleString("it-IT")} impianti di distribuzione rilevati` : "") + ".</li>";
        }

        return box("In sintesi", null, `<ul class="rep-ul">${li}${dinamica}${extra}</ul>`);
    }

    /* --- 2. confronto territoriale --- */
    function sezConfronto(sg) {
        const rows = settimanaRows(S.settimana);
        const reg = rows.filter(r => r.regione === sg.regione);
        const mac = rows.filter(r => r.macro_area === sg.macro);
        const colReg = sg.tipo === "regione";

        const tr = CARB.map(c => {
            const r = sg.val(S.settimana, c.k);
            const vReg = media(reg, c.k), vMac = media(mac, c.k), vIta = media(rows, c.k);
            const pct = (r.v != null && vIta) ? (r.v / vIta - 1) * 100 : null;
            const pos = posizione(sg, S.settimana, c.k);
            const tag = (sg.tipo === "provincia" && r.v != null && r.livello !== "provinciale")
                ? ` <span class="rep-tag">${r.livello}</span>` : "";
            return `<tr>
              <td>${c.lab} <span class="rep-u">(${c.u})</span></td>
              <td class="num hl"><b>${fmt(r.v)}</b>${tag}</td>
              ${colReg ? "" : `<td class="num">${fmt(vReg)}</td>`}
              <td class="num">${fmt(vMac)}</td>
              <td class="num">${fmt(vIta)}</td>
              <td class="num ${pct == null ? "" : pct > 0 ? "up" : "dn"}">${pct == null ? "—" : sgn(pct) + "%"}</td>
              <td class="ctr">${pos ? pos.pos + "ª su " + pos.su : "—"}</td>
            </tr>`;
        }).join("");

        return box("Carburanti — confronto territoriale", formattaData(S.settimana),
            `<p class="rep-p">Medie aritmetiche semplici dei prezzi provinciali rilevati nella settimana,
             non ponderate per consumi né per numero di impianti. La posizione è calcolata in ordine
             decrescente di prezzo: 1ª significa ${colReg ? "la regione più cara d'Italia" : "la provincia più cara d'Italia"}.</p>
             <table class="ance-table"><thead><tr>
               <th>Parametro</th><th>${esc(sg.nome)}</th>
               ${colReg ? "" : `<th>${esc(sg.regione)}</th>`}
               <th>${esc(sg.macro)}</th><th>Italia</th><th>Scarto % su Italia</th><th>Posizione</th>
             </tr></thead><tbody>${tr}</tbody></table>`);
    }

    /* --- 3. dettaglio province (solo rapporto regionale) --- */
    function sezProvince(sg) {
        const rows = settimanaRows(S.settimana);
        const medieReg = Object.fromEntries(CARB.map(c => [c.k, media(rows.filter(r => r.regione === sg.regione), c.k)]));
        const cSel = CARB.find(c => c.k === S.carb) || CARB[0];

        const prov = sg.province.map(p => {
            const r = rows.find(x => x.provincia_sigla === p.sigla) || {};
            const pos = (() => {
                const ord = rows.filter(x => num(x[cSel.k]) != null).sort((a, b) => num(b[cSel.k]) - num(a[cSel.k]));
                const i = ord.findIndex(x => x.provincia_sigla === p.sigla);
                return i < 0 ? null : { pos: i + 1, su: ord.length };
            })();
            const base = medieReg[cSel.k];
            const scarto = (num(r[cSel.k]) != null && base) ? (num(r[cSel.k]) - base) * 100 : null;
            return { p, r, pos, scarto };
        }).sort((a, b) => (b.scarto == null ? -1e9 : b.scarto) - (a.scarto == null ? -1e9 : a.scarto));

        const tr = prov.map(({ p, r, pos, scarto }) => `<tr>
            <td class="nm">${esc(p.nome)} <span class="rep-u">(${esc(p.sigla)})</span></td>
            ${CARB.map(c => `<td class="num${c.k === cSel.k ? " hl" : ""}">${fmt(num(r[c.k]))}</td>`).join("")}
            <td class="num ${scarto == null ? "" : scarto > 0 ? "up" : "dn"}">${scarto == null ? "—" : sgn(scarto) + " c€"}</td>
            <td class="ctr">${pos ? pos.pos + "ª su " + pos.su : "—"}</td>
          </tr>`).join("");

        const tot = `<tr class="tot"><td>${esc(sg.regione)} — media</td>` +
            CARB.map(c => `<td class="num${c.k === cSel.k ? " hl" : ""}">${fmt(medieReg[c.k])}</td>`).join("") +
            `<td class="num">—</td><td class="ctr">—</td></tr>`;

        // Dispersione interna: scala divergente centrata sulla media regionale.
        const val = prov.map(x => x.scarto).filter(v => v != null);
        let barre = "";
        if (val.length > 1) {
            const max = Math.max(...val.map(Math.abs), 0.5);
            // Soglie FISSE in centesimi di euro al litro, non percentuali del
            // massimo: una soglia calcolata sul dato piu' estremo si sposta a
            // ogni settimana e fa cambiare colore a province ferme. Mezzo
            // centesimo e' sotto la soglia di percezione alla pompa; due
            // centesimi valgono circa l'1% del prezzo.
            const col = v => Math.abs(v) < SOGLIA_LINEA ? "var(--div-3)"
                : v > 0 ? (v > SOGLIA_FORTE ? "var(--div-5)" : "var(--div-4)")
                : (v < -SOGLIA_FORTE ? "var(--div-1)" : "var(--div-2)");
            barre = `<div class="dv-legend">
                <span><i style="background:var(--div-1)"></i>oltre ${fmt(SOGLIA_FORTE, 1)} c€ sotto</span>
                <span><i style="background:var(--div-2)"></i>sotto</span>
                <span><i style="background:var(--div-3)"></i>in linea (meno di ${fmt(SOGLIA_LINEA, 1)} c€)</span>
                <span><i style="background:var(--div-4)"></i>sopra</span>
                <span><i style="background:var(--div-5)"></i>oltre ${fmt(SOGLIA_FORTE, 1)} c€ sopra</span>
                <span style="margin-left:auto">${esc(cSel.lab)}, centesimi di euro</span>
              </div><div class="dv">` +
              prov.filter(x => x.scarto != null).map(({ p, scarto }) => {
                  const w = Math.abs(scarto) / max * 50;
                  const pos = scarto >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`;
                  return `<div class="lab" title="${esc(p.nome)}">${esc(p.nome)}</div>
                    <div class="track"><div class="axis"></div><div class="bar" style="${pos};background:${col(scarto)}"></div></div>
                    <div class="val">${sgn(scarto)} c€</div>`;
              }).join("") + `</div>`;
        }

        return box("Dettaglio delle province", esc(sg.regione),
            `<p class="rep-p">Il valore regionale è una media: da solo non dice quanto le province si
             assomiglino. Questa sezione mostra la dispersione interna. La colonna evidenziata e le barre
             seguono il carburante scelto nella barra laterale (<b>${esc(cSel.lab)}</b>); lo scarto è
             calcolato sulla media regionale, non su quella nazionale.</p>
             <table class="ance-table"><thead><tr>
               <th>Provincia</th>${CARB.map(c => `<th>${c.lab.replace(" self service", "")}<br><span class="rep-u">${c.u}</span></th>`).join("")}
               <th>Scarto su ${esc(sg.regione)}</th><th>Posizione naz.</th>
             </tr></thead><tbody>${tr}${tot}</tbody></table>
             <div class="rep-disp">${barre}</div>
             <p class="note-fonte">Le fasce di colore usano soglie fisse — meno di
             ${fmt(SOGLIA_LINEA, 1)} c€ «in linea», oltre ${fmt(SOGLIA_FORTE, 1)} c€ scostamento marcato —
             e non percentuali dello scarto massimo: una soglia calcolata sul dato più estremo
             cambierebbe ogni settimana e farebbe cambiare colore a province ferme.</p>`);
    }

    /* --- 4. andamento settimanale --- */
    function sezStorico(sg) {
        const c = CARB.find(x => x.k === S.carb);
        const a = serieSogg(sg, S.carb), b = serieNaz(S.carb);
        if (a.filter(v => v != null).length < 2) {
            return box("Andamento settimanale", c.lab,
                `<p class="rep-p">Serie troppo corta per essere rappresentata: servono almeno due settimane con dato disponibile.</p>`);
        }
        return box("Andamento settimanale", c.lab,
            `<p class="rep-p">Confronto fra ${sg.tipo === "regione" ? "la media regionale" : "il prezzo della provincia"}
             e la media nazionale sulle ${D.settimane.length} settimane disponibili. Asse unico, valori in ${c.u}.</p>` +
            graficoLinee(D.settimane, a, b, esc(sg.nome), c.u) +
            `<p class="note-fonte">Fonte: MIMIT, rilevazione dei prezzi praticati alle ore 8.
             Il valore settimanale è quello dell'ultima esecuzione ETL riuscita della settimana, non una media dei sette giorni.</p>`);
    }

    function sezStoricoFocus(sg) {
        const mini = CARB.map(c => {
            const a = serieSogg(sg, c.k), b = serieNaz(c.k);
            if (a.filter(v => v != null).length < 2) {
                return `<div class="mini"><div class="mini-t">${c.lab} <span class="rep-u">${c.u}</span></div>
                        <div class="mini-empty">dato non disponibile</div></div>`;
            }
            return `<div class="mini"><div class="mini-t">${c.lab} <span class="rep-u">${c.u}</span></div>
                    ${miniLinee(D.settimane, a, b, CARB_COL[c.k], false, esc(sg.nome), c.u)}</div>`;
        }).join("");

        return box("Andamento settimanale — focus completo", "TUTTI I CARBURANTI",
            `<p class="rep-p">Un pannello per carburante, ciascuno con la propria scala: benzina e GPL
             differiscono di oltre un euro al litro e il metano si misura in €/kg, quindi un asse unico
             renderebbe illeggibili le serie più basse. La linea in tinta è ${esc(sg.nome)},
             quella grigia la media nazionale.</p>
             <div class="dv-legend">
               <span><i style="background:#8b97a5"></i>Media Italia</span>
               <span>${esc(sg.nome)} — linea in tinta, un colore per carburante</span>
               <span style="margin-left:auto">${D.settimane.length} settimane</span>
             </div>
             <div class="rep-grid">${mini}</div>`) +
            sezIndicizzato(sg) + sezElettricitaGrafico();
    }

    function sezIndicizzato(sg) {
        const serie = CARB.map(c => {
            const v = serieSogg(sg, c.k);
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

    function sezElettricitaGrafico() {
        const serie = D.arera.filter(r => r.tipo_dato === "elettricita_tutela_2700")
            .sort((a, b) => String(a.anno_mese).localeCompare(String(b.anno_mese)));
        if (serie.length < 2) return "";
        // Due pannelli invece di uno: sulla serie lunga il picco del 2022 a
        // 66 c€/kWh schiaccia tutto il resto e la dinamica recente diventa una
        // linea piatta. Il contesto della crisi e il movimento attuale sono due
        // domande diverse e vogliono due scale diverse.
        const lungo = serie.slice(-16);
        const breve = serie.slice(-8);
        const lab = a => a.map(r => String(r.periodo || r.anno_mese));
        const val = a => a.map(r => num(r.valore));
        const picco = lungo.reduce((m, r) => (num(r.valore) || 0) > (num(m.valore) || 0) ? r : m, lungo[0]);

        return box("Elettricità — andamento", "DATO NAZIONALE — NON PROVINCIALE",
            `<p class="rep-p">Prezzo finale per il cliente domestico tipo in tutela, 2.700 kWh/anno.
             Serie <b>trimestrale</b> e <b>nazionale</b>: frequenza e unità diverse dai carburanti,
             perciò un pannello a sé. Valori in c€/kWh.</p>
             <div class="rep-grid">
               <div class="mini"><div class="mini-t">Dal ${esc(String(lungo[0].periodo || ""))} — contesto
                 <span class="rep-u">${lungo.length} trimestri</span></div>
                 ${miniLinee(lab(lungo), val(lungo), null, "var(--navy)", false, "Italia", "c€/kWh")}</div>
               <div class="mini"><div class="mini-t">Ultimi ${breve.length} trimestri — dinamica recente
                 <span class="rep-u">scala propria</span></div>
                 ${miniLinee(lab(breve), val(breve), null, "var(--div-5)", false, "Italia", "c€/kWh")}</div>
             </div>
             <p class="note-fonte">I due pannelli hanno scale diverse e non vanno confrontati a occhio.
             Sul primo il massimo della serie è ${fmt(num(picco.valore), 2)} c€/kWh
             (${esc(String(picco.periodo || ""))}): quel picco comprime tutto il resto, perciò accanto
             c'è la stessa serie sugli ultimi trimestri, dove il movimento in corso torna leggibile.
             Fonte: ARERA. Non esiste disaggregazione provinciale o regionale.</p>`);
    }

    /* --- 5. variazioni: riferimenti scelti per DATA, non per posizione --- */
    function riferimento(nSett) {
        const target = spostaSettimane(S.settimana, -nSett);
        if (D.settimane.includes(target)) return { w: target, esatto: true, delta: nSett, target };
        const prec = D.settimane.filter(w => w < S.settimana);
        if (!prec.length) return null;
        let best = prec[0];
        prec.forEach(w => {
            if (Math.abs(settimaneTra(w, target)) < Math.abs(settimaneTra(best, target))) best = w;
        });
        return { w: best, esatto: false, delta: settimaneTra(best, S.settimana), target };
    }

    /**
     * Sceglie i riferimenti temporali evitando che si accavallino.
     * Col ripiego per data puo' succedere che "una settimana prima" slitti a
     * tre e finisca addosso alla colonna "quattro settimane prima": due
     * istantanee a sette giorni l'una dall'altra non aggiungono nulla. Se due
     * riferimenti cadono a meno di due settimane, il secondo va piu' indietro.
     */
    function scegliRiferimenti() {
        const out = [];
        const troppoVicino = w => out.some(x => Math.abs(settimaneTra(x.w, w)) < 2);
        const prova = tentativi => {
            for (const n of tentativi) {
                const r = riferimento(n);
                if (!r || r.w === S.settimana || troppoVicino(r.w)) continue;
                out.push(r); return;
            }
        };
        prova([1, 2]);          // la piu' recente disponibile
        prova([4, 6, 8]);       // circa un mese
        prova([13, 17, 21]);    // circa un trimestre
        const w0 = D.settimane[0];
        if (D.settimane.length > 1 && w0 !== S.settimana && !out.some(x => x.w === w0)) {
            out.push({ w: w0, esatto: true, inizio: true, delta: settimaneTra(w0, S.settimana) });
        }
        return out;
    }

    function sezVariazioni(sg) {
        const rif = scegliRiferimenti();
        if (!rif.length) return box("Variazioni nel tempo", null,
            `<p class="rep-p">Nessuna settimana precedente disponibile per il confronto.</p>`);

        const intest = rif.map(r => {
            const plur = Math.abs(r.delta) === 1 ? "settimana" : "settimane";
            const tit = r.inizio ? "vs Inizio della serie" : `vs ${Math.abs(r.delta)} ${plur} prima`;
            const nota = r.esatto ? "" :
                `<br><span class="rep-warn-inline">${formattaData(r.target)} non disponibile</span>`;
            return `<th>${tit}<br><span class="rep-u">${formattaData(r.w)}</span>${nota}</th>`;
        }).join("");

        const tr = CARB.map(c => {
            const cur = sg.val(S.settimana, c.k).v;
            const celle = rif.map(r => {
                const old = sg.val(r.w, c.k).v;
                if (cur == null || old == null) return `<td class="num">—</td>`;
                const d = (cur - old) * 100, pc = (cur / old - 1) * 100;
                return `<td class="num ${d > 0 ? "up" : "dn"}">${sgn(d)} c€ <span class="rep-u">(${sgn(pc)}%)</span></td>`;
            }).join("");
            return `<tr><td>${c.lab}</td><td class="num hl">${fmt(cur)} <span class="rep-u">${c.u}</span></td>${celle}</tr>`;
        }).join("");

        const avviso = rif.some(r => !r.esatto)
            ? `<p class="note-fonte"><b>Le intestazioni indicano la distanza reale in settimane.</b>
               Dove la settimana teorica non è stata caricata si usa la più vicina disponibile e lo si segnala:
               un confronto etichettato "settimana precedente" ma calcolato su tre settimane sarebbe fuorviante.</p>`
            : "";

        return box("Variazioni nel tempo", null,
            `<table class="ance-table"><thead><tr>
               <th>Carburante</th><th>Valore corrente</th>${intest}
             </tr></thead><tbody>${tr}</tbody></table>
             <p class="note-fonte">Variazioni in centesimi di euro e in percentuale. Un valore positivo indica un rincaro.</p>${avviso}`);
    }

    /* --- 6. contesto elettricita' --- */
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
             e non va letta come un dato del territorio di riferimento.</div>
             <table class="ance-table"><thead><tr>
               <th>Trimestre</th><th>Prezzo finale</th><th>Materia energia</th>
               <th>Trasporto</th><th>Oneri di sistema</th><th>Imposte</th>
             </tr></thead><tbody>${tr}</tbody></table>
             <p class="rep-p">Cliente domestico tipo in regime di tutela, 2.700 kWh/anno, valori in c€/kWh.` +
            (d == null ? "" : ` Ultima variazione trimestrale: <b class="${d > 0 ? "up" : "dn"}">${sgn(d)}%</b>.`) +
            ` Dal 2024 la tutela riguarda i soli clienti vulnerabili: sul mercato libero i prezzi possono divergere.</p>
             <p class="note-fonte">Fonte: ARERA, tabella dei prezzi finali dell'energia elettrica per il cliente domestico tipo.</p>`);
    }

    /* --- 7. fonti --- */
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
             <table class="ance-table rep-fonti"><thead><tr>
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

    /* --- 8. note --- */
    function sezNote(sg) {
        const cont = D.buchi.length
            ? `<li><b>La serie non è continua.</b> Mancano ${D.buchi.length === 1 ? "la settimana" : "le settimane"}
               del ${D.buchi.map(formattaData).join(", ")}: in quei giorni l'aggiornamento automatico non è andato
               a buon fine. I confronti temporali usano le settimane realmente disponibili e le intestazioni
               indicano la distanza reale.</li>`
            : `<li>La serie è continua: nessuna settimana mancante fra la prima e l'ultima caricata.</li>`;

        return box("Note di lettura", null, `<ul class="rep-ul rep-ul-note">
          <li>I prezzi dei carburanti provengono dal dataset MIMIT «Prezzi praticati e anagrafica degli impianti»,
              rilevazione delle ore 8, licenza IODL 2.0. Benzina e gasolio sono considerati in modalità self service.</li>
          <li>Il valore settimanale non è la media dei sette giorni: l'ETL gira ogni giorno e sovrascrive la
              settimana ISO in corso, quindi resta il dato dell'ultima esecuzione riuscita di quella settimana.</li>
          <li>Le medie territoriali sono aritmetiche semplici sulle province, non ponderate per popolazione,
              consumi o numero di impianti. Una provincia piccola pesa quanto una grande.</li>
          ${cont}
          <li>Il metano non è distribuito in tutte le province. Dove manca il dato provinciale si riporta la media
              regionale, contrassegnata dall'etichetta <span class="rep-tag">regionale</span>; se manca anche quella
              si scende al dato nazionale.</li>
          <li>I prezzi finali dell'energia elettrica sono ARERA, nazionali e trimestrali: non esiste
              disaggregazione provinciale o regionale e nessuna stima viene qui prodotta.</li>
          <li>Soggetto del rapporto: ${sg.tipo === "regione" ? esc(sg.nome) + " (" + sg.province.length + " province)"
              : esc(sg.nome) + " (" + esc(sg.sigla) + "), " + esc(sg.regione)}.
              Settimane disponibili nella serie: ${D.settimane.length}, dalla settimana del
              ${formattaData(D.settimane[0])} a quella del ${formattaData(D.settimane[D.settimane.length - 1])}.</li>
        </ul>`);
    }

    /* ================= grafici ================= */

    function tipHtml(titolo, righe) {
        return `<div class="tt-title">${titolo}</div>` + righe.map(r =>
            `<div class="tt-row"><span class="tt-label"><i style="background:${r.col}"></i>${r.lab}</span>` +
            `<span class="tt-value">${r.val}</span></div>`).join("");
    }
    function hotspots(labels, X, m, ih, iw, tips) {
        const w = Math.max(6, iw / labels.length);
        return labels.map((_, i) =>
            `<rect class="g-hot" x="${X(i) - w / 2}" y="${m.t}" width="${w}" height="${ih}"
                   fill="transparent" data-x="${X(i)}" data-tip="${esc(tips[i])}"/>`).join("");
    }

    /** Grafico singolo: soggetto vs media nazionale. */
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

        const passo = Math.max(1, Math.ceil(labels.length / 6));
        const ultimo = labels.length - 1;
        const xlab = labels.map((_, i) => i)
            .filter(i => i === ultimo || (i % passo === 0 && ultimo - i > passo * 0.6))
            .map(i => `<text x="${X(i)}" y="${H - 9}" text-anchor="middle" class="g-ax">${formattaData(labels[i])}</text>`).join("");

        const iA = sA.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
        const iB = sB.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
        let dyA = 3.5, dyB = 3.5;
        if (iA != null && iB != null && Math.abs(Y(sA[iA]) - Y(sB[iB])) < 13) {
            const sopra = Y(sA[iA]) <= Y(sB[iB]);
            dyA = sopra ? -3 : 10; dyB = sopra ? 10 : -3;
        }

        const tips = labels.map((w, i) => tipHtml(formattaData(w), [
            { col: "var(--div-5)", lab: nomeA, val: sA[i] == null ? "—" : fmt(sA[i]) + " " + unita },
            { col: "var(--div-1)", lab: "Media Italia", val: sB[i] == null ? "—" : fmt(sB[i]) + " " + unita },
        ]));

        return `<div class="rep-chart ch">
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
            ${iA != null ? `<circle cx="${X(iA)}" cy="${Y(sA[iA])}" r="4" fill="var(--div-5)" stroke="#fff" stroke-width="2"/>
              <text x="${X(iA) + 9}" y="${Y(sA[iA]) + dyA}" class="g-lab" fill="var(--div-5)">${fmt(sA[iA], 3)}</text>` : ""}
            ${iB != null ? `<circle cx="${X(iB)}" cy="${Y(sB[iB])}" r="4" fill="var(--div-1)" stroke="#fff" stroke-width="2"/>
              <text x="${X(iB) + 9}" y="${Y(sB[iB]) + dyB}" class="g-lab" fill="var(--div-1)">${fmt(sB[iB], 3)}</text>` : ""}
            <line class="g-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#8b97a5" stroke-dasharray="3 3" opacity="0"/>
            ${hotspots(labels, X, m, ih, iw, tips)}
          </svg>
          <div class="g-tip" hidden></div>
        </div>`;
    }

    /** Piccolo multiplo: una serie in tinta piu' un riferimento grigio. */
    function miniLinee(labels, sA, sB, colore, larga, nomeA, unita) {
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

        const et = i => formattaData(labels[i]) || esc(labels[i]);
        const xl = `<text x="${X(0)}" y="${H - 5}" text-anchor="start" class="g-ax">${et(0)}</text>
                    <text x="${X(labels.length - 1)}" y="${H - 5}" text-anchor="end" class="g-ax">${et(labels.length - 1)}</text>`;

        const li = sA.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
        const tips = labels.map((w, i) => tipHtml(formattaData(w) || esc(w),
            [{ col: colore, lab: nomeA || "Valore", val: sA[i] == null ? "—" : fmt(sA[i], 4) + " " + (unita || "") }]
            .concat(sB ? [{ col: "#8b97a5", lab: "Media Italia", val: sB[i] == null ? "—" : fmt(sB[i], 4) + " " + (unita || "") }] : [])));

        return `<div class="ch mini-ch">
          <svg viewBox="0 0 ${W} ${H}" class="g-svg" role="img">
            ${ticks}${xl}
            ${sB ? `<path d="${path(sB)}" fill="none" stroke="#8b97a5" stroke-width="1.6"/>` : ""}
            <path d="${path(sA)}" fill="none" stroke="${colore}" stroke-width="2" stroke-linejoin="round"/>
            ${li != null ? `<circle cx="${X(li)}" cy="${Y(sA[li])}" r="3.5" fill="${colore}" stroke="#fff" stroke-width="1.6"/>
              <text x="${X(li) + 7}" y="${Y(sA[li]) + 3.5}" class="g-lab" fill="${colore}">${fmt(sA[li], larga ? 2 : 3)}</text>` : ""}
            <line class="g-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#8b97a5" stroke-dasharray="3 3" opacity="0"/>
            ${hotspots(labels, X, m, ih, iw, tips)}
          </svg>
          <div class="g-tip" hidden></div>
        </div>`;
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

        const fine = serie.map(s2 => {
            const i = s2.v.map((v, k) => v == null ? -1 : k).filter(k => k >= 0).pop();
            return i == null ? null : { s: s2, i, y: Y(s2.v[i]) };
        }).filter(Boolean).sort((a, b) => a.y - b.y);
        for (let k = 1; k < fine.length; k++) {
            if (fine[k].y - fine[k - 1].y < 13) fine[k].y = fine[k - 1].y + 13;
        }

        const tips = labels.map((w, i) => tipHtml(formattaData(w), serie.map(s2 => ({
            col: s2.col, lab: s2.lab.replace(" self service", ""),
            val: s2.v[i] == null ? "—" : fmt(s2.v[i], 1),
        }))));

        return `<div class="rep-chart ch"><svg viewBox="0 0 ${W} ${H}" class="g-svg" role="img"
              aria-label="Numeri indice dei carburanti, base 100 alla prima settimana">
            ${ticks}${xl}
            ${serie.map(s2 => `<path d="${path(s2.v)}" fill="none" stroke="${s2.col}" stroke-width="2" stroke-linejoin="round"/>`).join("")}
            ${fine.map(f => `<circle cx="${X(f.i)}" cy="${Y(f.s.v[f.i])}" r="3.5" fill="${f.s.col}" stroke="#fff" stroke-width="1.6"/>
              <text x="${X(f.i) + 8}" y="${f.y + 3.5}" class="g-lab2" fill="${f.s.col}">${esc(f.s.lab.replace(" self service", ""))} ${fmt(f.s.v[f.i], 1)}</text>`).join("")}
            <line class="g-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="#8b97a5" stroke-dasharray="3 3" opacity="0"/>
            ${hotspots(labels, X, m, ih, iw, tips)}
        </svg><div class="g-tip" hidden></div></div>`;
    }

    /**
     * Livello di lettura: crocino verticale e tooltip su OGNI grafico del foglio.
     * In stampa il livello sparisce e restano le etichette dirette di fine serie.
     */
    function attivaHover(root) {
        root.querySelectorAll(".ch").forEach(wrap => {
            const svg = wrap.querySelector("svg");
            const tip = wrap.querySelector(".g-tip");
            const cross = wrap.querySelector(".g-cross");
            if (!svg || !tip) return;
            const vbW = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || 760;

            wrap.querySelectorAll(".g-hot").forEach(r => {
                r.addEventListener("mouseenter", () => {
                    tip.innerHTML = r.dataset.tip;
                    tip.hidden = false;
                    if (cross) {
                        cross.setAttribute("x1", r.dataset.x);
                        cross.setAttribute("x2", r.dataset.x);
                        cross.setAttribute("opacity", "1");
                    }
                    const box = svg.getBoundingClientRect();
                    const x = parseFloat(r.dataset.x) / vbW * box.width;
                    const lw = tip.offsetWidth || 170;
                    tip.style.left = Math.max(0, Math.min(box.width - lw - 4, x - lw / 2)) + "px";
                });
            });
            svg.addEventListener("mouseleave", () => {
                tip.hidden = true;
                if (cross) cross.setAttribute("opacity", "0");
            });
        });
    }

    return { init };
})();

window.ReportisticaTab = ReportisticaTab;
