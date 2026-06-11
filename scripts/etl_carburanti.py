"""
ETL Carburanti - MIMIT Open Data.

Scarica i dati quotidiani dei prezzi praticati dagli impianti di carburante
italiani, li aggrega per provincia e li scrive su Google Sheets.

Sorgente dati: https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti
Licenza: IODL 2.0
Frequenza pubblicazione: quotidiana

Output:
- Tab `prezzi_carburanti_provinciale` del Google Sheet master
- Tab `metadati_aggiornamento` con log esecuzione

FIX (v2): scrittura su Sheets con value_input_option=RAW e numeri formattati
con virgola decimale (formato italiano) per evitare interpretazione "data"
da parte di Google Sheets localizzato in italiano (es. 1.6512 -> "165.12.00").
"""

import io
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
from loguru import logger

sys.path.insert(0, str(Path(__file__).parent))

from utils.gsheets_client import (
    get_gspread_client,
    open_master_sheet,
    get_or_create_worksheet,
    log_etl_run,
)

# COSTANTI

URL_ANAGRAFICA = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
URL_PREZZI = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"

# Header HTTP "da browser": il server MIMIT a volte rifiuta o non risponde
# alle richieste con User-Agent di default di python-requests (visto il
# 10-11/06/2026: "Max retries exceeded" dai runner GitHub Actions).
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,application/csv,text/plain,*/*",
    "Accept-Language": "it-IT,it;q=0.9",
}

# Retry con backoff esponenziale: 4 tentativi, attese 20s / 40s / 80s
MAX_TENTATIVI = 4
ATTESA_BASE_SEC = 20

SIGLE_PROVINCE_REGIONE = {
    "TO": "Piemonte", "VC": "Piemonte", "NO": "Piemonte", "CN": "Piemonte",
    "AT": "Piemonte", "AL": "Piemonte", "BI": "Piemonte", "VB": "Piemonte",
    "AO": "Valle d'Aosta",
    "VA": "Lombardia", "CO": "Lombardia", "SO": "Lombardia", "MI": "Lombardia",
    "BG": "Lombardia", "BS": "Lombardia", "PV": "Lombardia", "CR": "Lombardia",
    "MN": "Lombardia", "LC": "Lombardia", "LO": "Lombardia", "MB": "Lombardia",
    "BZ": "Trentino-Alto Adige", "TN": "Trentino-Alto Adige",
    "VR": "Veneto", "VI": "Veneto", "BL": "Veneto", "TV": "Veneto",
    "VE": "Veneto", "PD": "Veneto", "RO": "Veneto",
    "UD": "Friuli-Venezia Giulia", "GO": "Friuli-Venezia Giulia",
    "TS": "Friuli-Venezia Giulia", "PN": "Friuli-Venezia Giulia",
    "IM": "Liguria", "SV": "Liguria", "GE": "Liguria", "SP": "Liguria",
    "PC": "Emilia-Romagna", "PR": "Emilia-Romagna", "RE": "Emilia-Romagna",
    "MO": "Emilia-Romagna", "BO": "Emilia-Romagna", "FE": "Emilia-Romagna",
    "RA": "Emilia-Romagna", "FC": "Emilia-Romagna", "RN": "Emilia-Romagna",
    "MS": "Toscana", "LU": "Toscana", "PT": "Toscana", "FI": "Toscana",
    "LI": "Toscana", "PI": "Toscana", "AR": "Toscana", "SI": "Toscana",
    "GR": "Toscana", "PO": "Toscana",
    "PG": "Umbria", "TR": "Umbria",
    "PU": "Marche", "AN": "Marche", "MC": "Marche", "AP": "Marche", "FM": "Marche",
    "VT": "Lazio", "RI": "Lazio", "RM": "Lazio", "LT": "Lazio", "FR": "Lazio",
    "AQ": "Abruzzo", "TE": "Abruzzo", "PE": "Abruzzo", "CH": "Abruzzo",
    "CB": "Molise", "IS": "Molise",
    "CE": "Campania", "BN": "Campania", "NA": "Campania", "AV": "Campania", "SA": "Campania",
    "FG": "Puglia", "BA": "Puglia", "TA": "Puglia", "BR": "Puglia",
    "LE": "Puglia", "BT": "Puglia",
    "PZ": "Basilicata", "MT": "Basilicata",
    "CS": "Calabria", "CZ": "Calabria", "RC": "Calabria", "KR": "Calabria", "VV": "Calabria",
    "TP": "Sicilia", "PA": "Sicilia", "ME": "Sicilia", "AG": "Sicilia",
    "CL": "Sicilia", "EN": "Sicilia", "CT": "Sicilia", "RG": "Sicilia", "SR": "Sicilia",
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

REGIONE_TO_MACRO = {regione: macro for macro, regs in MACRO_AREE.items() for regione in regs}

CARBURANTI_MAP = {
    "Benzina": "benzina_self_eur_l",
    "Gasolio": "gasolio_self_eur_l",
    "GPL": "gpl_eur_l",
    "Metano": "metano_eur_kg",
}

# Varianti di nomenclatura usate da MIMIT
CARBURANTI_VARIANTI = {
    "Benzina": ["Benzina"],
    "Gasolio": ["Gasolio"],
    "GPL": ["Gpl", "GPL"],
    "Metano": ["Metano", "Metano Auto", "Gnc", "GNC", "Gnl", "GNL", "L-Gnc"],
}

# Colonne che contengono valori numerici da formattare con virgola italiana
COLONNE_NUMERICHE = [
    "benzina_self_eur_l",
    "gasolio_self_eur_l",
    "gpl_eur_l",
    "metano_eur_kg",
]


# UTILITY FORMATO NUMERICO

def fmt_num_it(v):
    """
    Converte un numero in stringa con virgola decimale (formato italiano).
    Restituisce "" se valore mancante.
    Es: 1.8523 -> "1,8523"
        2.0  -> "2"
        None -> ""

    Necessario per evitare che Google Sheets in localizzazione italiana
    interpreti "1.8523" come una data e lo trasformi in "185.23.00".
    """
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(v, (int, float)):
        return f"{round(float(v), 4):.4f}".replace(".", ",").rstrip("0").rstrip(",")
    return str(v)


# DOWNLOAD

def download_csv(url: str, label: str) -> pd.DataFrame:
    """
    Scarica un file CSV/PSV da URL e lo restituisce come DataFrame.

    I file MIMIT hanno tre caratteristiche da gestire:
    1. La prima riga contiene la data di estrazione (da saltare)
    2. L'header e' sulla seconda riga
    3. Il separatore e' il pipe '|' (in passato era ';', auto-detect)
    """
    logger.info(f"Download {label}: {url}")
    response = None
    ultimo_errore = None
    for tentativo in range(1, MAX_TENTATIVI + 1):
        try:
            response = requests.get(url, timeout=60, headers=HTTP_HEADERS)
            response.raise_for_status()
            break
        except requests.RequestException as e:
            ultimo_errore = e
            logger.warning(
                f"  Tentativo {tentativo}/{MAX_TENTATIVI} fallito per {label}: {e}"
            )
            if tentativo < MAX_TENTATIVI:
                attesa = ATTESA_BASE_SEC * (2 ** (tentativo - 1))
                logger.info(f"  Riprovo tra {attesa}s...")
                time.sleep(attesa)
    if response is None:
        raise RuntimeError(
            f"Download {label} fallito dopo {MAX_TENTATIVI} tentativi: {ultimo_errore}"
        )

    try:
        text = response.content.decode("utf-8")
    except UnicodeDecodeError:
        text = response.content.decode("iso-8859-1")

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

    df = pd.read_csv(
        io.StringIO(text),
        sep=sep,
        skiprows=1,
        low_memory=False,
        on_bad_lines="skip",
    )
    logger.info(f"  -> {len(df)} righe scaricate, {len(df.columns)} colonne")
    return df


# UTILITY

def get_settimana_iso(data: datetime = None) -> str:
    """Restituisce la data del lunedi della settimana ISO in formato YYYY-MM-DD."""
    if data is None:
        data = datetime.now(timezone.utc)
    lunedi = data - timedelta(days=data.weekday())
    return lunedi.strftime("%Y-%m-%d")


def carica_nomi_province(spreadsheet) -> dict:
    """
    Carica il mapping sigla -> nome esteso dal tab anagrafica_province.
    Se non esiste, ritorna un dict vuoto.
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


# AGGREGAZIONE

def aggrega_prezzi_provinciali(
    df_prezzi: pd.DataFrame,
    df_anagrafica: pd.DataFrame,
    nomi_province: dict = None,
) -> pd.DataFrame:
    """
    Esegue il join tra prezzi e anagrafica, filtra modalita self-service,
    e aggrega per (provincia x carburante) con la media dei prezzi.
    """
    logger.info("Avvio aggregazione provinciale")

    # Normalizza nomi colonne (lowercase, trim)
    df_prezzi.columns = [c.strip().lower() for c in df_prezzi.columns]
    df_anagrafica.columns = [c.strip().lower() for c in df_anagrafica.columns]

    logger.info(f"Colonne prezzi: {list(df_prezzi.columns)}")
    logger.info(f"Colonne anagrafica: {list(df_anagrafica.columns)}")

    # Identifica le colonne chiave con fallback per varianti di naming MIMIT
    col_id_prezzi = next(c for c in df_prezzi.columns if "idimpianto" in c.replace("_", ""))
    col_carb = next(
        c for c in df_prezzi.columns
        if "carburante" in c or "desccarburante" in c.replace("_", "")
    )
    col_prezzo = next(c for c in df_prezzi.columns if c == "prezzo")
    col_self = next(
        (c for c in df_prezzi.columns if "isself" in c.replace("_", "")),
        None,
    )

    col_id_anag = next(c for c in df_anagrafica.columns if "idimpianto" in c.replace("_", ""))
    col_prov = next(c for c in df_anagrafica.columns if "provincia" in c)

    # Conversione tipi numerici
    if col_self:
        df_prezzi[col_self] = (
            pd.to_numeric(df_prezzi[col_self], errors="coerce").fillna(0).astype(int)
        )

    df_prezzi[col_prezzo] = pd.to_numeric(df_prezzi[col_prezzo], errors="coerce")
    df_prezzi = df_prezzi[df_prezzi[col_prezzo] > 0]

    # MERGE prezzi x anagrafica per ottenere la provincia
    df = df_prezzi.merge(
        df_anagrafica[[col_id_anag, col_prov]],
        left_on=col_id_prezzi,
        right_on=col_id_anag,
        how="inner",
    )
    logger.info(f"Dopo merge con anagrafica: {len(df)} righe")

    # Filtro self-service per benzina e gasolio
    if col_self:
        carb_lower = df[col_carb].str.lower().fillna("")
        mask_benz_gas = carb_lower.str.contains("benzina") | carb_lower.str.contains("gasolio")
        df = df[~mask_benz_gas | (df[col_self] == 1)]
        logger.info(f"Dopo filtro self-service benzina/gasolio: {len(df)} righe")

    # Normalizzazione nome carburante (capitalize, trim)
    df["carb_norm"] = df[col_carb].str.strip().str.title()

    # Diagnostica: stampa i valori unici di carburante
    carb_uniq = df["carb_norm"].value_counts()
    logger.info(f"Carburanti trovati in MIMIT (top 15):\n{carb_uniq.head(15)}")

    # Mappa varianti -> nome canonico
    inverso = {v: k for k, varianti in CARBURANTI_VARIANTI.items() for v in varianti}
    df["carb_norm"] = df["carb_norm"].map(lambda x: inverso.get(x, x))

    # Filtra solo carburanti di interesse
    df = df[df["carb_norm"].isin(CARBURANTI_MAP.keys())]
    logger.info(f"Dopo filtro carburanti: {len(df)} righe")

    # Sigla provincia (uppercase, trim)
    df["prov_sigla"] = df[col_prov].astype(str).str.strip().str.upper()
    df = df[df["prov_sigla"].isin(SIGLE_PROVINCE_REGIONE.keys())]
    logger.info(f"Dopo filtro sigle valide: {len(df)} righe")

    # Aggregazione: media prezzo per (provincia x carburante)
    agg = (
        df.groupby(["prov_sigla", "carb_norm"])[col_prezzo]
        .agg(["mean", "count"])
        .reset_index()
    )
    agg.columns = ["prov_sigla", "carburante", "prezzo_medio", "n_impianti"]

    # Pivot wide: una colonna per carburante
    pivot_prezzo = agg.pivot(index="prov_sigla", columns="carburante", values="prezzo_medio")
    pivot_count = agg.pivot(index="prov_sigla", columns="carburante", values="n_impianti")

    pivot_prezzo.rename(columns=CARBURANTI_MAP, inplace=True)
    n_impianti_per_prov = pivot_count.max(axis=1).fillna(0).astype(int)

    # Costruzione DataFrame finale
    out = pivot_prezzo.reset_index()
    out.rename(columns={"prov_sigla": "provincia_sigla"}, inplace=True)

    if nomi_province:
        out["provincia_nome"] = (
            out["provincia_sigla"].map(nomi_province).fillna(out["provincia_sigla"])
        )
    else:
        out["provincia_nome"] = out["provincia_sigla"]

    out["regione"] = out["provincia_sigla"].map(SIGLE_PROVINCE_REGIONE)
    out["macro_area"] = out["regione"].map(REGIONE_TO_MACRO)
    out["n_impianti"] = out["provincia_sigla"].map(n_impianti_per_prov)
    out["data_settimana"] = get_settimana_iso()

    schema_cols = [
        "data_settimana", "provincia_sigla", "provincia_nome", "regione", "macro_area",
        "benzina_self_eur_l", "gasolio_self_eur_l", "gpl_eur_l", "metano_eur_kg",
        "n_impianti",
    ]
    for c in schema_cols:
        if c not in out.columns:
            out[c] = None
    out = out[schema_cols]

    # Arrotonda prezzi a 4 decimali (manteniamo numerico nel DataFrame,
    # la conversione a stringa italiana avviene in upsert_settimana_corrente)
    for c in COLONNE_NUMERICHE:
        out[c] = pd.to_numeric(out[c], errors="coerce").round(4)

    out = out.sort_values(["regione", "provincia_sigla"]).reset_index(drop=True)

    logger.info(f"Aggregazione completata: {len(out)} province")
    return out


# SCRITTURA SHEETS

HEADERS_CARBURANTI = [
    "data_settimana", "provincia_sigla", "provincia_nome", "regione", "macro_area",
    "benzina_self_eur_l", "gasolio_self_eur_l", "gpl_eur_l", "metano_eur_kg",
    "n_impianti",
]


def dataframe_to_rows_italian(df: pd.DataFrame) -> list:
    """
    Converte un DataFrame in lista di liste pronta per Sheets,
    applicando fmt_num_it() alle colonne numeriche dei prezzi.
    n_impianti resta intero (non e' un prezzo, non genera bug data).
    Le colonne testuali restano stringhe.
    """
    righe = []
    for _, r in df.iterrows():
        riga = []
        for col in HEADERS_CARBURANTI:
            v = r[col]
            if col in COLONNE_NUMERICHE:
                riga.append(fmt_num_it(v))
            elif col == "n_impianti":
                # Intero, niente decimali
                try:
                    if pd.isna(v):
                        riga.append("")
                    else:
                        riga.append(str(int(v)))
                except (TypeError, ValueError):
                    riga.append(str(v) if v is not None else "")
            else:
                # Stringhe (data, provincia, regione, macro_area)
                if v is None:
                    riga.append("")
                else:
                    try:
                        if pd.isna(v):
                            riga.append("")
                        else:
                            riga.append(str(v))
                    except (TypeError, ValueError):
                        riga.append(str(v))
        righe.append(riga)
    return righe


def upsert_settimana_corrente(spreadsheet, df: pd.DataFrame) -> int:
    """
    Aggiorna o inserisce le righe della settimana corrente nel tab.

    Strategia ottimizzata: per evitare il limite di 60 scritture/minuto
    della Sheets API, NON cancelliamo riga per riga. Invece:
    1. Leggiamo l'intero contenuto attuale
    2. Filtriamo via le righe della settimana corrente (in memoria)
    3. Aggiungiamo le righe nuove
    4. Sovrascriviamo tutto il tab in UN'UNICA operazione bulk

    FIX (v2): numeri convertiti in stringhe italiane via fmt_num_it()
    e scritti con value_input_option="RAW" per evitare reinterpretazione.
    """
    worksheet = get_or_create_worksheet(
        spreadsheet,
        "prezzi_carburanti_provinciale",
        headers=HEADERS_CARBURANTI,
        rows=10000,
    )

    all_values = worksheet.get_all_values()
    settimana = df["data_settimana"].iloc[0]

    # Prepara le nuove righe con formato italiano
    nuove_righe = dataframe_to_rows_italian(df)

    # Caso foglio vuoto: scrivi header + tutti i dati
    if len(all_values) <= 1:
        rows_to_write = [HEADERS_CARBURANTI] + nuove_righe
        worksheet.clear()
        worksheet.update(
            values=rows_to_write,
            range_name="A1",
            value_input_option="RAW",
        )
        logger.info(f"Foglio vuoto: scritte {len(rows_to_write) - 1} righe")
        return len(df)

    # Caso foglio popolato: filtra in memoria
    header_row = all_values[0]
    idx_settimana = header_row.index("data_settimana")

    # Tieni solo le righe che NON sono della settimana corrente
    righe_da_mantenere = [
        row for row in all_values[1:]
        if not (len(row) > idx_settimana and row[idx_settimana] == settimana)
    ]
    n_rimosse = len(all_values) - 1 - len(righe_da_mantenere)
    if n_rimosse > 0:
        logger.info(f"Rimosse {n_rimosse} righe vecchie per settimana {settimana}")

    # Costruisci il contenuto totale: header + righe vecchie + righe nuove
    contenuto_completo = [HEADERS_CARBURANTI] + righe_da_mantenere + nuove_righe

    # UN'UNICA operazione bulk: clear + update
    # FIX: value_input_option="RAW" invece di "USER_ENTERED"
    worksheet.clear()
    worksheet.update(
        values=contenuto_completo,
        range_name="A1",
        value_input_option="RAW",
    )
    logger.info(
        f"Scritte {len(nuove_righe)} righe nuove per settimana {settimana} "
        f"(totale righe nel tab: {len(contenuto_completo) - 1})"
    )

    return len(nuove_righe)


# MAIN

def main() -> None:
    logger.info("=" * 60)
    logger.info("ETL CARBURANTI MIMIT - Avvio")
    logger.info("=" * 60)

    record_caricati = 0
    esito = "ok"
    note = ""
    spreadsheet = None

    try:
        # 1. Download dati MIMIT
        df_prezzi = download_csv(URL_PREZZI, "prezzi MIMIT")
        df_anagrafica = download_csv(URL_ANAGRAFICA, "anagrafica MIMIT")

        # 2. Connetti a Google Sheets
        client = get_gspread_client()
        spreadsheet = open_master_sheet(client)

        # 3. Carica nomi estesi province
        nomi_province = carica_nomi_province(spreadsheet)

        # 4. Aggrega
        df_agg = aggrega_prezzi_provinciali(df_prezzi, df_anagrafica, nomi_province)

        if df_agg.empty:
            raise RuntimeError("Aggregazione vuota: nessun dato da scrivere")

        # 5. Scrivi i dati
        record_caricati = upsert_settimana_corrente(spreadsheet, df_agg)
        note = f"Settimana ISO: {df_agg['data_settimana'].iloc[0]} - {len(df_agg)} province aggiornate"

        # Verifica visiva nei log: prime 3 righe formattate
        logger.info("Verifica formato (prime 3 province):")
        sample_rows = dataframe_to_rows_italian(df_agg.head(3))
        for i, row in enumerate(sample_rows):
            logger.info(f"  {i+1}. {row}")

    except Exception as e:
        logger.exception("Errore durante ETL Carburanti")
        esito = "errore"
        note = str(e)[:500]
        try:
            if spreadsheet is None:
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

