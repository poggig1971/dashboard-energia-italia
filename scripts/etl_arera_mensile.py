"""
ETL ARERA - Prezzi finali tutela elettricita (versione finale + fix numeri).

Sorgente:
  https://www.arera.it/dati-e-statistiche/dettaglio/aggiornamenti-delle-condizioni-di-tutela-elettricita
  File: https://www.arera.it/fileadmin/allegati/dati/ele/eep35new.xlsx

Struttura file (verificata 12/05/2026):
  - Foglio "tabella 2700": dati trimestrali dal 2004 a oggi
  - Foglio "tabella 2000": dati trimestrali dal 2023 a oggi
  - Colonna 0: periodo testo (es. "I 2026", "II 2026")
  - Colonna 1: spesa per la materia energia (c€/kWh)
  - Colonna 2: spesa per il trasporto e gestione contatore
  - Colonna 3: spesa per oneri di sistema
  - Colonna 4: imposte
  - Colonna 5: TOTALE c€/kWh
  - Dati partono da riga 5 (header alle righe 0-4)

FIX (v2): scrittura su Sheets con value_input_option=RAW e numeri formattati
con virgola decimale (formato italiano) per evitare interpretazione "data"
da parte di Google Sheets localizzato in italiano.
"""

import io
import re
import sys
from datetime import datetime
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


URL_TUTELA_ELETTRICITA = "https://www.arera.it/fileadmin/allegati/dati/ele/eep35new.xlsx"

HEADERS_ARERA = [
    "anno_mese",
    "tipo_dato",
    "periodo",
    "valore",
    "materia_energia",
    "trasporto",
    "oneri_sistema",
    "imposte",
    "unita",
    "fonte_url",
    "data_inserimento",
]

TRIM_TO_MESE_INIZIO = {
    "I": "01",
    "II": "04",
    "III": "07",
    "IV": "10",
}


def fmt_num_it(v):
    """
    Converte un numero in stringa con virgola decimale (formato italiano).
    Restituisce "" se valore mancante.
    Es: 25.21 -> "25,21"
        15.13 -> "15,13"
        None  -> ""
    """
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not pd.isna(v):
        # Arrotondato a 4 decimali, virgola come separatore decimale
        return f"{round(float(v), 4):.4f}".replace(".", ",").rstrip("0").rstrip(",")
    return ""


def download_xlsx(url: str, label: str) -> bytes:
    logger.info(f"Download {label}: {url}")
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    logger.info(f"  -> {len(response.content)} bytes scaricati")
    return response.content


def parse_periodo(periodo_str):
    """
    Estrae trimestre e anno da una stringa periodo ARERA.
    """
    if not isinstance(periodo_str, str):
        return None, None

    clean = re.sub(r"[\n\r]+", " ", periodo_str).strip()
    clean = re.sub(r"\s+", " ", clean)

    match = re.match(r"^(IV|III|II|I)\s+(\d{4})", clean)
    if match:
        return match.group(1), int(match.group(2))

    match2 = re.match(r"^(IV|III|II|I)(\s+\*+)?$", clean)
    if match2:
        return match2.group(1), None

    return None, None


def estrai_record_da_foglio(xlsx_bytes, sheet_name, tipo_dato):
    """Estrae i record di prezzo da un foglio ARERA."""
    logger.info(f"Parsing foglio '{sheet_name}' (tipo_dato={tipo_dato})")

    df_raw = pd.read_excel(
        io.BytesIO(xlsx_bytes),
        sheet_name=sheet_name,
        header=None,
        engine="openpyxl",
    )

    record = []
    ultimo_anno = None

    for idx in range(5, len(df_raw)):
        row = df_raw.iloc[idx]
        periodo_raw = row[0]
        materia = row[1]
        trasporto = row[2]
        oneri = row[3]
        imposte = row[4]
        totale = row[5]

        if pd.isna(totale) or not isinstance(totale, (int, float)):
            continue

        trim, anno = parse_periodo(periodo_raw)
        if trim is None:
            continue

        if anno is None:
            if ultimo_anno is None:
                logger.warning(f"  Skip riga {idx}: anno non determinabile per '{periodo_raw}'")
                continue
            anno = ultimo_anno
        else:
            ultimo_anno = anno

        mese_inizio = TRIM_TO_MESE_INIZIO[trim]
        anno_mese = f"{anno}-{mese_inizio}"

        def safe_num(v):
            if isinstance(v, (int, float)) and not pd.isna(v):
                return round(float(v), 4)
            return None

        record.append({
            "anno_mese": anno_mese,
            "tipo_dato": tipo_dato,
            "periodo": f"{trim} {anno}",
            "valore": round(float(totale), 4),
            "materia_energia": safe_num(materia),
            "trasporto": safe_num(trasporto),
            "oneri_sistema": safe_num(oneri),
            "imposte": safe_num(imposte),
        })

    logger.info(f"  Estratti {len(record)} record da '{sheet_name}'")
    return record


def main():
    logger.info("=" * 60)
    logger.info("ETL ARERA - Avvio")
    logger.info("=" * 60)

    spreadsheet = None
    record_caricati = 0
    esito = "ok"
    note = ""

    try:
        client = get_gspread_client()
        spreadsheet = open_master_sheet(client)

        xlsx_bytes = download_xlsx(URL_TUTELA_ELETTRICITA, "tutela elettricità")

        record_2700 = estrai_record_da_foglio(
            xlsx_bytes, "tabella 2700", "elettricita_tutela_2700"
        )
        record_2000 = estrai_record_da_foglio(
            xlsx_bytes, "tabella 2000", "elettricita_tutela_2000"
        )

        tutti_record = record_2700 + record_2000

        if not tutti_record:
            raise RuntimeError("Nessun record estratto dai fogli ARERA")

        # Ordina record per tipo_dato, anno_mese
        tutti_record.sort(key=lambda r: (r["tipo_dato"], r["anno_mese"]))

        timestamp = datetime.utcnow().isoformat(timespec="seconds")

        # FIX: tutti i numeri in stringhe con virgola decimale italiana,
        # così Google Sheets non li interpreta come date.
        righe = []
        for r in tutti_record:
            righe.append([
                r["anno_mese"],                  # testo "YYYY-MM"
                r["tipo_dato"],                  # testo
                r["periodo"],                    # testo
                fmt_num_it(r["valore"]),         # numero -> stringa "25,21"
                fmt_num_it(r["materia_energia"]),
                fmt_num_it(r["trasporto"]),
                fmt_num_it(r["oneri_sistema"]),
                fmt_num_it(r["imposte"]),
                "c€/kWh",
                URL_TUTELA_ELETTRICITA,
                timestamp,
            ])

        worksheet = get_or_create_worksheet(
            spreadsheet,
            "prezzi_finali_arera",
            headers=HEADERS_ARERA,
            rows=2000,
        )

        contenuto = [HEADERS_ARERA] + righe

        worksheet.clear()
        # FIX: USE RAW (non USER_ENTERED) per evitare che Sheets reinterpreti.
        # Le celle conterranno esattamente le stringhe che inviamo.
        worksheet.update(
            values=contenuto,
            range_name="A1",
            value_input_option="RAW",
        )

        record_caricati = len(righe)
        logger.info(f"Scritti {record_caricati} record nel tab prezzi_finali_arera")
        logger.info(f"  - tabella 2700: {len(record_2700)} record")
        logger.info(f"  - tabella 2000: {len(record_2000)} record")
        note = f"2700kWh: {len(record_2700)} record. 2000kWh: {len(record_2000)} record."

        logger.info(f"\nUltimi 5 record (verifica):")
        for r in tutti_record[-5:]:
            logger.info(
                f"  {r['periodo']} ({r['tipo_dato']}): "
                f"{fmt_num_it(r['valore'])} c€/kWh"
            )

    except Exception as e:
        logger.exception("Errore durante ETL ARERA")
        esito = "errore"
        note = str(e)[:500]
        raise

    finally:
        if spreadsheet:
            try:
                log_etl_run(
                    spreadsheet=spreadsheet,
                    fonte="ARERA-elettricita",
                    record_caricati=record_caricati,
                    esito=esito,
                    url_fonte=URL_TUTELA_ELETTRICITA,
                    note=note,
                )
            except Exception:
                logger.error("Impossibile loggare l'esito ETL")

    logger.info("=" * 60)
    logger.info(f"ETL ARERA - Fine. Esito: {esito}, record: {record_caricati}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
