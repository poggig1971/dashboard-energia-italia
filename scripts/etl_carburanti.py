"""
ETL Carburanti - MIMIT Open Data.

Scarica i dati quotidiani dei prezzi praticati dagli impianti di carburante
italiani, li aggrega per provincia e li scrive su Google Sheets.

Sorgente dati: https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti
Licenza: IODL 2.0
Frequenza pubblicazione: quotidiana (alle 8:00 ora italiana)

Output:
- Tab `prezzi_carburanti_provinciale` del Google Sheet master
- Tab `metadati_aggiornamento` con log esecuzione
"""

import io
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import requests
from loguru import logger

# Aggiungi la cartella corrente al path per import locali
sys.path.insert(0, str(Path(__file__).parent))

from utils.gsheets_client import (
    get_gspread_client,
    open_master_sheet,
    get_or_create_worksheet,
    log_etl_run,
)

# ─── COSTANTI ──────────────────────────────────────────────────────────────────

URL_ANAGRAFICA = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
URL_PREZZI = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"

# Mapping sigla provincia → regione → macro-area ISTAT
SIGLE_PROVINCE_REGIONE = {
    # Piemonte
    "TO": "Piemonte", "VC": "Piemonte", "NO": "Piemonte", "CN": "Piemonte",
    "AT": "Piemonte", "AL": "Piemonte", "BI": "Piemonte", "VB": "Piemonte",
    # Valle d'Aosta
    "AO": "Valle d'Aosta",
    # Lombardia
    "VA": "Lombardia", "CO": "Lombardia", "SO": "Lombardia", "MI": "Lombardia",
    "BG": "Lombardia", "BS": "Lombardia", "PV": "Lombardia", "CR": "Lombardia",
    "MN": "Lombardia", "LC": "Lombardia", "LO": "Lombardia", "MB": "Lombardia",
    # Trentino-Alto Adige
    "BZ": "Trentino-Alto Adige", "TN": "Trentino-Alto Adige",
    # Veneto
    "VR": "Veneto", "VI": "Veneto", "BL": "Veneto", "TV": "Veneto",
    "VE": "Veneto", "PD": "Veneto", "RO": "Veneto",
    # Friuli-Venezia Giulia
    "UD": "Friuli-Venezia Giulia", "GO": "Friuli-Venezia Giulia",
    "TS": "Friuli-Venezia Giulia", "PN": "Friuli-Venezia Giulia",
    # Liguria
    "IM": "Liguria", "SV": "Liguria", "GE": "Liguria", "SP": "Liguria",
    # Emilia-Romagna
    "PC": "Emilia-Romagna", "PR": "Emilia-Romagna", "RE": "Emilia-Romagna",
    "MO": "Emilia-Romagna", "BO": "Emilia-Romagna", "FE": "Emilia-Romagna",
    "RA": "Emilia-Romagna", "FC": "Emilia-Romagna", "RN": "Emilia-Romagna",
    # Toscana
    "MS": "Toscana", "LU": "Toscana", "PT": "Toscana", "FI": "Toscana",
    "LI": "Toscana", "PI": "Toscana", "AR": "Toscana", "SI": "Toscana",
    "GR": "Toscana", "PO": "Toscana",
    # Umbria
    "PG": "Umbria", "TR": "Umbria",
    # Marche
    "PU": "Marche", "AN": "Marche", "MC": "Marche", "AP": "Marche", "FM": "Marche",
    # Lazio
    "VT": "Lazio", "RI": "Lazio", "RM": "Lazio", "LT": "Lazio", "FR": "Lazio",
    # Abruzzo
    "AQ": "Abruzzo", "TE": "Abruzzo", "PE": "Abruzzo", "CH": "Abruzzo",
    # Molise
    "CB": "Molise", "IS": "Molise",
    # Campania
    "CE": "Campania", "BN": "Campania", "NA": "Campania", "AV": "Campania", "SA": "Campania",
    # Puglia
    "FG": "Puglia", "BA": "Puglia", "TA": "Puglia", "BR": "Puglia",
    "LE": "Puglia", "BT": "Puglia",
    # Basilicata
    "PZ": "Basilicata", "MT": "Basilicata",
    # Calabria
    "CS": "Calabria", "CZ": "Calabria", "RC": "Calabria", "KR": "Calabria", "VV": "Calabria",
    # Sicilia
    "TP": "Sicilia", "PA": "Sicilia", "ME": "Sicilia", "AG": "Sicilia",
    "CL": "Sicilia", "EN": "Sicilia", "CT": "Sicilia", "RG": "Sicilia", "SR": "Sicilia",
    # Sardegna
    "SS": "Sardegna", "NU": "Sardegna", "CA": "Sardegna",
    "OR": "Sardegna", "SU": "Sardegna",
}

MACRO_AREE = {
    "Nord": ["Piemonte", "Valle d'Aosta", "Lombardia", "Trentino-Alto Adige",
             "Veneto", "Friuli-Venezia Giulia", "Liguria", "Emilia-Romagna"],
    "Centro": ["Toscana", "Umbria", "Marche", "Lazio"],
    "Sud e Isole": ["Abruzzo", "Molise", "Campania", "Puglia", "Basilicata",
                    "Calabria", "Sicilia", "Sardegna"],
}

# Mapping inverso regione → macro-area
REGIONE_TO_MACRO = {regione: macro for macro, regs in MACRO_AREE.items() for regione in regs}

# Mapping nome carburante MIMIT → colonna output
CARBURANTI_MAP = {
    "Benzina": "benzina_self_eur_l",
    "Gasolio": "gasolio_self_eur_l",
    "GPL": "gpl_eur_l",
    "Metano": "metano_eur_kg",
}


# ─── DOWNLOAD ──────────────────────────────────────────────────────────────────

def download_csv(url: str, label: str) -> pd.DataFrame:
    """
    Scarica un file CSV da URL e lo restituisce come DataFrame.

    I file MIMIT hanno due particolarità:
    1. La prima riga contiene la data di estrazione (es. "Estrazione del 2026-05-11")
       quindi va saltata. Il vero header è alla seconda riga.
    2. Il separatore è il pipe '|', non il punto e virgola.

    Per robustezza autoriliviamo il separatore controllando se la prima
    riga di intestazione contiene '|' oppure ';'.
    """
    logger.info(f"Download {label}: {url}")
    response = requests.get(url, timeout=60)
    response.raise_for_status()

    # Decodifica come UTF-8, fallback ISO-8859-1 se fallisce
    try:
        text = response.content.decode("utf-8")
    except UnicodeDecodeError:
        text = response.content.decode("iso-8859-1")

    # Auto-detect del separatore guardando la riga di header (la seconda)
    lines = text.splitlines()
    if len(lines) < 2:
        raise ValueError(f"File {label} troppo corto: solo {len(lines)} righe")

    header_line = lines[1]
    if "|" in header_line:
        sep = "|"
    elif ";" in header_line:
        sep = ";"
    else:
        sep = ","

    logger.info(f"  Separatore rilevato: '{sep}'")

    # Salta la prima riga (data estrazione), header sulla seconda
    df = pd.read_csv(
        io.StringIO(text),
        sep=sep,
        skiprows=1,
        low_memory=False,
        on_bad_lines="skip",  # se MIMIT ha righe corrotte le ignora invece di crashare
    )
    logger.info(f"  → {len(df)} righe scaricate, {len(df.columns)} colonne")
    return df


# ─── TRASFORMAZIONI ────────────────────────────────────────────────────────────

def get_settimana_iso(data: datetime = None) -> str:
    """
    Restituisce la data del lunedì della settimana ISO corrente
    in formato YYYY-MM-DD.
    """
    if data is None:
        data = datetime.utcnow()
    lunedi = data - timedelta(days=data.weekday())
    return lunedi.strftime("%Y-%m-%d")

def carica_nomi_province(spreadsheet) -> dict:
    """
    Carica il mapping sigla → nome esteso dal tab anagrafica_province.
    Se l'anagrafica non esiste ancora, ritorna un dict vuoto.
    """
    try:
        ws = spreadsheet.worksheet("anagrafica_province")
        records = ws.get_all_records()
        mapping = {r["sigla"]: r["nome"] for r in records if r.get("sigla")}
        logger.info(f"Caricati {len(mapping)} nomi province dall'anagrafica")
        return mapping
    except Exception as e:
        logger.warning(f"Anagrafica province non caricata: {e}")
        return {}
        
def aggrega_prezzi_provinciali(
    df_prezzi: pd.DataFrame,
    df_anagrafica: pd.DataFrame,
    nomi_province: dict = None,
) -> pd.DataFrame:
    """
    Esegue il join tra prezzi e anagrafica, filtra modalità self-service,
    e aggrega per (provincia × carburante) con la media dei prezzi.

    Restituisce un DataFrame "wide" con colonne:
    data_settimana | provincia_sigla | provincia_nome | regione | macro_area |
    benzina_self_eur_l | gasolio_self_eur_l | gpl_eur_l | metano_eur_kg | n_impianti
    """
    logger.info("Avvio aggregazione provinciale")

    # Normalizza nome carburante (capitalize, trim)
    df["carb_norm"] = df[col_carb].str.strip().str.title()

    # DIAGNOSTICA: stampa i valori unici di carburante per capire la nomenclatura MIMIT
    carb_uniq = df["carb_norm"].value_counts()
    logger.info(f"Carburanti trovati nel file MIMIT (top 15):\n{carb_uniq.head(15)}")

    # Mapping esteso per nomenclatura MIMIT (può includere varianti)
    # Es. il "Metano" è spesso registrato come "Metano Auto", "GNC", "GNL", ecc.
    CARBURANTI_VARIANTI = {
        "Benzina": ["Benzina"],
        "Gasolio": ["Gasolio"],
        "GPL": ["Gpl", "GPL"],
        "Metano": ["Metano", "Metano Auto", "Gnc", "GNC", "Gnl", "GNL", "L-Gnc"],
    }
    # Normalizza tutte le varianti verso il nome canonico
    inverso = {v: k for k, varianti in CARBURANTI_VARIANTI.items() for v in varianti}
    df["carb_norm"] = df["carb_norm"].map(lambda x: inverso.get(x, x))

    # Mantieni solo i carburanti che ci interessano
    df = df[df["carb_norm"].isin(CARBURANTI_MAP.keys())]
    logger.info(f"Dopo filtro carburanti: {len(df)} righe")

    logger.info(f"Colonne prezzi: {list(df_prezzi.columns)}")
    logger.info(f"Colonne anagrafica: {list(df_anagrafica.columns)}")

    # Identifica le colonne chiave (con fallback su varianti)
    col_id_prezzi = next(c for c in df_prezzi.columns if "idimpianto" in c.replace("_", ""))
    col_carb = next(c for c in df_prezzi.columns if "carburante" in c or "descrizionecarburante" in c.replace("_", ""))
    col_prezzo = next(c for c in df_prezzi.columns if c == "prezzo")
    col_self = next((c for c in df_prezzi.columns if "isself" in c.replace("_", "")), None)

    col_id_anag = next(c for c in df_anagrafica.columns if "idimpianto" in c.replace("_", ""))
    col_prov = next(c for c in df_anagrafica.columns if "provincia" in c)

    # Per i carburanti benzina/gasolio mantieni solo self-service
    if col_self:
        # MIMIT: isSelf = 1 (vero), 0 (servito). Conserva entrambi: filtreremo dopo.
        df_prezzi[col_self] = pd.to_numeric(df_prezzi[col_self], errors="coerce").fillna(0).astype(int)

    # Filtra prezzi validi
    df_prezzi[col_prezzo] = pd.to_numeric(df_prezzi[col_prezzo], errors="coerce")
    df_prezzi = df_prezzi[df_prezzi[col_prezzo] > 0]

    # Join con anagrafica per ottenere la provincia
    df = df_prezzi.merge(
        df_anagrafica[[col_id_anag, col_prov]],
        left_on=col_id_prezzi,
        right_on=col_id_anag,
        how="inner",
    )
    logger.info(f"Dopo merge con anagrafica: {len(df)} righe")

    # Per benzina e gasolio, mantieni solo self-service
    if col_self:
        carb_norm = df[col_carb].str.lower().fillna("")
        mask_carb_self = carb_norm.str.contains("benzina") | carb_norm.str.contains("gasolio")
        df = df[~mask_carb_self | (df[col_self] == 1)]
        logger.info(f"Dopo filtro self-service per benzina/gasolio: {len(df)} righe")

    # Normalizza nome carburante (capitalize, trim)
    df["carb_norm"] = df[col_carb].str.strip().str.title()

    # Mantieni solo i carburanti che ci interessano
    df = df[df["carb_norm"].isin(CARBURANTI_MAP.keys())]
    logger.info(f"Dopo filtro carburanti: {len(df)} righe")

    # Normalizza sigla provincia (uppercase)
    df["prov_sigla"] = df[col_prov].astype(str).str.strip().str.upper()

    # Tieni solo sigle valide
    df = df[df["prov_sigla"].isin(SIGLE_PROVINCE_REGIONE.keys())]
    logger.info(f"Dopo filtro sigle valide: {len(df)} righe")

    # Aggregazione: media prezzo per (provincia × carburante)
    agg = (
        df.groupby(["prov_sigla", "carb_norm"])[col_prezzo]
        .agg(["mean", "count"])
        .reset_index()
    )
    agg.columns = ["prov_sigla", "carburante", "prezzo_medio", "n_impianti"]

    # Pivot wide: una colonna per carburante
    pivot_prezzo = agg.pivot(index="prov_sigla", columns="carburante", values="prezzo_medio")
    pivot_count = agg.pivot(index="prov_sigla", columns="carburante", values="n_impianti")

    # Rinomina colonne usando il mapping
    pivot_prezzo.rename(columns=CARBURANTI_MAP, inplace=True)

    # Conteggio impianti totale (somma su tutti i carburanti, prendi il max - più robusto)
    n_impianti_per_prov = pivot_count.max(axis=1).fillna(0).astype(int)

    # Costruzione DataFrame finale
    out = pivot_prezzo.reset_index()
    out.rename(columns={"prov_sigla": "provincia_sigla"}, inplace=True)

    # Aggiungi colonne descrittive
    # Aggiungi colonne descrittive
    if nomi_province:
        out["provincia_nome"] = out["provincia_sigla"].map(nomi_province).fillna(out["provincia_sigla"])
    else:
        out["provincia_nome"] = out["provincia_sigla"]
    out["regione"] = out["provincia_sigla"].map(SIGLE_PROVINCE_REGIONE)
    out["macro_area"] = out["regione"].map(REGIONE_TO_MACRO)
    out["n_impianti"] = out["provincia_sigla"].map(n_impianti_per_prov)
    out["data_settimana"] = get_settimana_iso()

    # Ordina colonne secondo schema definito
    schema_cols = [
        "data_settimana", "provincia_sigla", "provincia_nome", "regione", "macro_area",
        "benzina_self_eur_l", "gasolio_self_eur_l", "gpl_eur_l", "metano_eur_kg",
        "n_impianti",
    ]
    for c in schema_cols:
        if c not in out.columns:
            out[c] = None
    out = out[schema_cols]

    # Arrotonda prezzi a 4 decimali per pulizia
    for c in ["benzina_self_eur_l", "gasolio_self_eur_l", "gpl_eur_l", "metano_eur_kg"]:
        out[c] = pd.to_numeric(out[c], errors="coerce").round(4)

    # Ordina per regione e provincia
    out = out.sort_values(["regione", "provincia_sigla"]).reset_index(drop=True)

    logger.info(f"Aggregazione completata: {len(out)} province")
    return out


# ─── SCRITTURA SU GOOGLE SHEETS ────────────────────────────────────────────────

HEADERS_CARBURANTI = [
    "data_settimana", "provincia_sigla", "provincia_nome", "regione", "macro_area",
    "benzina_self_eur_l", "gasolio_self_eur_l", "gpl_eur_l", "metano_eur_kg",
    "n_impianti",
]


def upsert_settimana_corrente(spreadsheet, df: pd.DataFrame) -> int:
    """
    Aggiorna o inserisce le righe della settimana corrente nel tab.

    Logica:
    - Se la settimana (chiave: data_settimana) esiste già, sovrascrive le righe
      delle province corrispondenti
    - Altrimenti aggiunge in coda
    """
    worksheet = get_or_create_worksheet(
        spreadsheet,
        "prezzi_carburanti_provinciale",
        headers=HEADERS_CARBURANTI,
        rows=10000,
    )

    # Leggi tutto il foglio attuale
    all_values = worksheet.get_all_values()
    if len(all_values) <= 1:
        # Foglio vuoto (solo header): scrivi tutto
        rows_to_write = df.fillna("").values.tolist()
        worksheet.append_rows(rows_to_write, value_input_option="USER_ENTERED")
        logger.info(f"Foglio vuoto: scritte {len(rows_to_write)} righe")
        return len(rows_to_write)

    # Trova le righe della settimana corrente già presenti
    settimana = df["data_settimana"].iloc[0]
    header_row = all_values[0]
    idx_settimana = header_row.index("data_settimana")

    righe_esistenti = [
        i for i, row in enumerate(all_values[1:], start=2)
        if len(row) > idx_settimana and row[idx_settimana] == settimana
    ]

    if righe_esistenti:
        # Cancella le righe esistenti per la settimana corrente
        logger.info(f"Trovate {len(righe_esistenti)} righe esistenti per settimana {settimana}: le sostituisco")
        # Cancella in ordine inverso per non far slittare gli indici
        for idx in sorted(righe_esistenti, reverse=True):
            worksheet.delete_rows(idx)

    # Aggiunge le righe nuove
    rows_to_write = df.fillna("").values.tolist()
    worksheet.append_rows(rows_to_write, value_input_option="USER_ENTERED")
    logger.info(f"Aggiunte {len(rows_to_write)} righe per settimana {settimana}")

    return len(rows_to_write)


# ─── ENTRY POINT ───────────────────────────────────────────────────────────────

def main() -> None:
    logger.info("=" * 60)
    logger.info("ETL CARBURANTI MIMIT - Avvio")
    logger.info("=" * 60)

    record_caricati = 0
    esito = "ok"
    note = ""

    try:
        # 1. Download
        df_prezzi = download_csv(URL_PREZZI, "prezzi MIMIT")
        df_anagrafica = download_csv(URL_ANAGRAFICA, "anagrafica MIMIT")

        # 2. Connetti a Google Sheets (prima per leggere anagrafica)
        client = get_gspread_client()
        spreadsheet = open_master_sheet(client)

        # 3. Carica i nomi estesi delle province dall'anagrafica
        nomi_province = carica_nomi_province(spreadsheet)

        # 4. Aggrega i prezzi
        df_agg = aggrega_prezzi_provinciali(df_prezzi, df_anagrafica, nomi_province)

        if df_agg.empty:
            raise RuntimeError("Aggregazione vuota: nessun dato da scrivere")

        # 5. Scrivi i dati
        record_caricati = upsert_settimana_corrente(spreadsheet, df_agg) 

    except Exception as e:
        logger.exception("Errore durante ETL Carburanti")
        esito = "errore"
        note = str(e)[:500]
        # Comunque registriamo il log dell'errore
        try:
            client = get_gspread_client()
            spreadsheet = open_master_sheet(client)
            log_etl_run(
                spreadsheet=spreadsheet,
                fonte="MIMIT-carburanti",
                record_caricati=0,
                esito=esito,
                url_fonte=URL_PREZZI,
                note=note,
            )
        except Exception:
            logger.error("Impossibile loggare anche l'errore su Sheet")
        raise

    # 5. Log esito
    log_etl_run(
        spreadsheet=spreadsheet,
        fonte="MIMIT-carburanti",
        record_caricati=record_caricati,
        esito=esito,
        url_fonte=URL_PREZZI,
        note=note,
    )

    logger.info("=" * 60)
    logger.info(f"ETL CARBURANTI - Fine. Esito: {esito}, record: {record_caricati}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
