"""
ETL ARERA - Prezzi finali tutela elettricita (versione 2).

VERSIONE DIAGNOSTICA: questa esecuzione stampa la struttura completa del file
XLS ARERA per consentirci di affinare il parser. Una volta visto l'output,
identificheremo le colonne esatte e ottimizzeremo il codice.

Sorgente:
  https://www.arera.it/dati-e-statistiche/dettaglio/aggiornamenti-delle-condizioni-di-tutela-elettricita
  File: https://www.arera.it/fileadmin/allegati/dati/ele/eep35new.xlsx

Licenza: dati pubblici ARERA, citazione obbligatoria.
"""

import io
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
    "unita",
    "fonte_url",
    "data_inserimento",
]


def download_xlsx(url: str, label: str) -> bytes:
    logger.info(f"Download {label}: {url}")
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    logger.info(f"  -> {len(response.content)} bytes scaricati")
    return response.content


def analizza_foglio_completo(xlsx_bytes: bytes, sheet_name: str) -> pd.DataFrame:
    """
    Legge un foglio con pandas e ne stampa la struttura completa
    per consentire l'analisi della forma reale del dato.
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"ANALISI FOGLIO: {sheet_name}")
    logger.info(f"{'='*60}")

    # Prova diverse strategie di lettura
    # Strategia 1: leggi tutto senza header (preserve formato grezzo)
    df_raw = pd.read_excel(
        io.BytesIO(xlsx_bytes),
        sheet_name=sheet_name,
        header=None,
        engine="openpyxl",
    )
    logger.info(f"Dimensioni: {df_raw.shape[0]} righe x {df_raw.shape[1]} colonne")
    logger.info(f"\nContenuto completo del foglio (senza header):")
    logger.info(f"\n{df_raw.to_string(max_rows=120, max_cols=20)}")

    return df_raw


def main():
    logger.info("=" * 60)
    logger.info("ETL ARERA - Avvio (versione diagnostica completa)")
    logger.info("=" * 60)

    spreadsheet = None
    record_caricati = 0
    esito = "ok"
    note = ""

    try:
        # Connessione a Google Sheets (per log esito)
        client = get_gspread_client()
        spreadsheet = open_master_sheet(client)

        # Scarica file ARERA
        xlsx_bytes = download_xlsx(URL_TUTELA_ELETTRICITA, "tutela elettricità")

        # Analizza struttura completa di ENTRAMBI i fogli
        wb_sheets = pd.ExcelFile(io.BytesIO(xlsx_bytes), engine="openpyxl").sheet_names
        logger.info(f"\nFogli trovati nel file: {wb_sheets}")

        for sheet_name in wb_sheets:
            analizza_foglio_completo(xlsx_bytes, sheet_name)

        note = "Analisi diagnostica completata - vedi log per struttura dati"
        esito = "ok"

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
                    fonte="ARERA-diagnostica",
                    record_caricati=record_caricati,
                    esito=esito,
                    url_fonte=URL_TUTELA_ELETTRICITA,
                    note=note,
                )
            except Exception:
                logger.error("Impossibile loggare l'esito ETL")

    logger.info("=" * 60)
    logger.info(f"ETL ARERA - Fine. Esito: {esito}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
