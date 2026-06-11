"""
Client Google Sheets per scrittura via service account.

Utilizzato da tutti gli script ETL per scrivere i dati aggregati
sul foglio master `Dashboard_Energia_Italia_DATI`.

Autenticazione:
- Production (GitHub Actions): legge le credenziali dal secret GOOGLE_SERVICE_ACCOUNT_JSON
- Locale (test): legge dal file service_account.json nella radice del progetto
"""

import json
import os
from typing import List, Optional

import gspread
from google.oauth2.service_account import Credentials
from loguru import logger

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def get_gspread_client() -> gspread.Client:
    """
    Inizializza il client gspread autenticandosi via service account.

    Cerca le credenziali nell'ordine:
    1. Variabile d'ambiente GOOGLE_SERVICE_ACCOUNT_JSON (uso in GitHub Actions)
    2. File service_account.json nella radice del progetto (uso locale)
    """
    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")

    if creds_json:
        logger.info("Credenziali Google caricate da variabile d'ambiente")
        creds_dict = json.loads(creds_json)
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    else:
        local_path = "service_account.json"
        if not os.path.exists(local_path):
            raise FileNotFoundError(
                "Credenziali non trovate: né variabile GOOGLE_SERVICE_ACCOUNT_JSON "
                "né file service_account.json disponibili."
            )
        logger.info(f"Credenziali Google caricate da file locale: {local_path}")
        creds = Credentials.from_service_account_file(local_path, scopes=SCOPES)

    return gspread.authorize(creds)


def open_master_sheet(client: gspread.Client) -> gspread.Spreadsheet:
    """
    Apre il foglio master tramite l'ID nella variabile d'ambiente GSHEET_ID.
    """
    sheet_id = os.environ.get("GSHEET_ID")
    if not sheet_id:
        raise ValueError("Variabile d'ambiente GSHEET_ID non impostata.")

    logger.info(f"Apertura foglio master: {sheet_id}")
    return client.open_by_key(sheet_id)


def get_or_create_worksheet(
    spreadsheet: gspread.Spreadsheet,
    name: str,
    headers: Optional[List[str]] = None,
    rows: int = 1000,
    cols: int = 20,
) -> gspread.Worksheet:
    """
    Restituisce il worksheet se esiste, altrimenti lo crea con le intestazioni.
    """
    try:
        worksheet = spreadsheet.worksheet(name)
        logger.info(f"Worksheet '{name}' trovato")
        return worksheet
    except gspread.WorksheetNotFound:
        logger.info(f"Worksheet '{name}' non esiste: lo creo")
        worksheet = spreadsheet.add_worksheet(title=name, rows=rows, cols=cols)
        if headers:
            worksheet.append_row(headers)
            logger.info(f"Intestazioni aggiunte a '{name}': {headers}")
        return worksheet


def log_etl_run(
    spreadsheet: gspread.Spreadsheet,
    fonte: str,
    record_caricati: int,
    esito: str,
    url_fonte: str,
    note: str = "",
) -> None:
    """
    Aggiunge una riga di log nel tab `metadati_aggiornamento`.
    """
    from datetime import datetime, timezone

    headers = [
        "fonte",
        "data_ultimo_refresh",
        "record_caricati",
        "esito",
        "url_fonte",
        "note",
    ]
    ws = get_or_create_worksheet(
        spreadsheet, "metadati_aggiornamento", headers=headers
    )
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    ws.append_row([fonte, timestamp, record_caricati, esito, url_fonte, note])
    logger.info(f"Log ETL scritto: {fonte} | {esito} | {record_caricati} record")