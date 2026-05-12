"""
Carica l'anagrafica statica delle 107 province italiane nel Google Sheet.

Va eseguito UNA SOLA VOLTA (o quando l'anagrafica va aggiornata).
I dati di popolazione e superficie sono ISTAT 2024 (valori arrotondati).

Esecuzione: python scripts/load_anagrafica_province.py
"""

import sys
from pathlib import Path

from loguru import logger

sys.path.insert(0, str(Path(__file__).parent))

from utils.gsheets_client import (
    get_gspread_client,
    open_master_sheet,
    get_or_create_worksheet,
)

HEADERS = [
    "sigla", "nome", "regione", "macro_area",
    "popolazione_2024", "superficie_kmq", "n_imprese_attive",
]

# Dati province italiane (sigla, nome, regione, popolazione, superficie)
# Fonte: ISTAT 2024 - https://www.istat.it
# Macro-area: ripartizione ISTAT (Nord / Centro / Sud e Isole)
# n_imprese_attive: lasciato a 0 per ora, da popolare in fase successiva con Movimprese Infocamere
PROVINCE = [
    # (sigla, nome, regione, macro_area, popolazione, superficie_kmq)
    # PIEMONTE
    ("TO", "Torino", "Piemonte", "Nord", 2230946, 6827),
    ("VC", "Vercelli", "Piemonte", "Nord", 165769, 2087),
    ("NO", "Novara", "Piemonte", "Nord", 358105, 1339),
    ("CN", "Cuneo", "Piemonte", "Nord", 585898, 6895),
    ("AT", "Asti", "Piemonte", "Nord", 209062, 1510),
    ("AL", "Alessandria", "Piemonte", "Nord", 411046, 3559),
    ("BI", "Biella", "Piemonte", "Nord", 169049, 913),
    ("VB", "Verbano-Cusio-Ossola", "Piemonte", "Nord", 154852, 2261),
    # VALLE D'AOSTA
    ("AO", "Aosta", "Valle d'Aosta", "Nord", 122955, 3261),
    # LOMBARDIA
    ("VA", "Varese", "Lombardia", "Nord", 873311, 1199),
    ("CO", "Como", "Lombardia", "Nord", 593477, 1279),
    ("SO", "Sondrio", "Lombardia", "Nord", 175444, 3196),
    ("MI", "Milano", "Lombardia", "Nord", 3214000, 1575),
    ("BG", "Bergamo", "Lombardia", "Nord", 1107000, 2746),
    ("BS", "Brescia", "Lombardia", "Nord", 1255000, 4786),
    ("PV", "Pavia", "Lombardia", "Nord", 535000, 2965),
    ("CR", "Cremona", "Lombardia", "Nord", 354000, 1770),
    ("MN", "Mantova", "Lombardia", "Nord", 405000, 2341),
    ("LC", "Lecco", "Lombardia", "Nord", 333000, 816),
    ("LO", "Lodi", "Lombardia", "Nord", 228000, 783),
    ("MB", "Monza e Brianza", "Lombardia", "Nord", 873000, 405),
    # TRENTINO-ALTO ADIGE
    ("BZ", "Bolzano", "Trentino-Alto Adige", "Nord", 535000, 7398),
    ("TN", "Trento", "Trentino-Alto Adige", "Nord", 545000, 6207),
    # VENETO
    ("VR", "Verona", "Veneto", "Nord", 928000, 3121),
    ("VI", "Vicenza", "Veneto", "Nord", 855000, 2722),
    ("BL", "Belluno", "Veneto", "Nord", 196000, 3678),
    ("TV", "Treviso", "Veneto", "Nord", 879000, 2477),
    ("VE", "Venezia", "Veneto", "Nord", 829000, 2473),
    ("PD", "Padova", "Veneto", "Nord", 933000, 2144),
    ("RO", "Rovigo", "Veneto", "Nord", 226000, 1818),
    # FRIULI-VENEZIA GIULIA
    ("UD", "Udine", "Friuli-Venezia Giulia", "Nord", 514000, 4905),
    ("GO", "Gorizia", "Friuli-Venezia Giulia", "Nord", 134000, 466),
    ("TS", "Trieste", "Friuli-Venezia Giulia", "Nord", 226000, 213),
    ("PN", "Pordenone", "Friuli-Venezia Giulia", "Nord", 309000, 2275),
    # LIGURIA
    ("IM", "Imperia", "Liguria", "Nord", 209000, 1156),
    ("SV", "Savona", "Liguria", "Nord", 270000, 1545),
    ("GE", "Genova", "Liguria", "Nord", 814000, 1834),
    ("SP", "La Spezia", "Liguria", "Nord", 213000, 881),
    # EMILIA-ROMAGNA
    ("PC", "Piacenza", "Emilia-Romagna", "Nord", 286000, 2586),
    ("PR", "Parma", "Emilia-Romagna", "Nord", 451000, 3449),
    ("RE", "Reggio Emilia", "Emilia-Romagna", "Nord", 533000, 2293),
    ("MO", "Modena", "Emilia-Romagna", "Nord", 710000, 2688),
    ("BO", "Bologna", "Emilia-Romagna", "Nord", 1018000, 3702),
    ("FE", "Ferrara", "Emilia-Romagna", "Nord", 339000, 2635),
    ("RA", "Ravenna", "Emilia-Romagna", "Nord", 387000, 1858),
    ("FC", "Forlì-Cesena", "Emilia-Romagna", "Nord", 392000, 2378),
    ("RN", "Rimini", "Emilia-Romagna", "Nord", 339000, 864),
    # TOSCANA
    ("MS", "Massa-Carrara", "Toscana", "Centro", 191000, 1156),
    ("LU", "Lucca", "Toscana", "Centro", 384000, 1773),
    ("PT", "Pistoia", "Toscana", "Centro", 290000, 965),
    ("FI", "Firenze", "Toscana", "Centro", 996000, 3514),
    ("LI", "Livorno", "Toscana", "Centro", 327000, 1218),
    ("PI", "Pisa", "Toscana", "Centro", 419000, 2444),
    ("AR", "Arezzo", "Toscana", "Centro", 339000, 3233),
    ("SI", "Siena", "Toscana", "Centro", 263000, 3821),
    ("GR", "Grosseto", "Toscana", "Centro", 217000, 4504),
    ("PO", "Prato", "Toscana", "Centro", 253000, 365),
    # UMBRIA
    ("PG", "Perugia", "Umbria", "Centro", 644000, 6334),
    ("TR", "Terni", "Umbria", "Centro", 219000, 2127),
    # MARCHE
    ("PU", "Pesaro e Urbino", "Marche", "Centro", 357000, 2567),
    ("AN", "Ancona", "Marche", "Centro", 466000, 1962),
    ("MC", "Macerata", "Marche", "Centro", 305000, 2774),
    ("AP", "Ascoli Piceno", "Marche", "Centro", 198000, 1228),
    ("FM", "Fermo", "Marche", "Centro", 170000, 863),
    # LAZIO
    ("VT", "Viterbo", "Lazio", "Centro", 304000, 3612),
    ("RI", "Rieti", "Lazio", "Centro", 152000, 2750),
    ("RM", "Roma", "Lazio", "Centro", 4216000, 5363),
    ("LT", "Latina", "Lazio", "Centro", 569000, 2255),
    ("FR", "Frosinone", "Lazio", "Centro", 469000, 3247),
    # ABRUZZO
    ("AQ", "L'Aquila", "Abruzzo", "Sud e Isole", 290000, 5034),
    ("TE", "Teramo", "Abruzzo", "Sud e Isole", 304000, 1948),
    ("PE", "Pescara", "Abruzzo", "Sud e Isole", 311000, 1230),
    ("CH", "Chieti", "Abruzzo", "Sud e Isole", 372000, 2588),
    # MOLISE
    ("CB", "Campobasso", "Molise", "Sud e Isole", 217000, 2925),
    ("IS", "Isernia", "Molise", "Sud e Isole", 81000, 1535),
    # CAMPANIA
    ("CE", "Caserta", "Campania", "Sud e Isole", 909000, 2640),
    ("BN", "Benevento", "Campania", "Sud e Isole", 270000, 2080),
    ("NA", "Napoli", "Campania", "Sud e Isole", 2960000, 1171),
    ("AV", "Avellino", "Campania", "Sud e Isole", 401000, 2806),
    ("SA", "Salerno", "Campania", "Sud e Isole", 1062000, 4954),
    # PUGLIA
    ("FG", "Foggia", "Puglia", "Sud e Isole", 590000, 7008),
    ("BA", "Bari", "Puglia", "Sud e Isole", 1216000, 3863),
    ("TA", "Taranto", "Puglia", "Sud e Isole", 540000, 2467),
    ("BR", "Brindisi", "Puglia", "Sud e Isole", 374000, 1839),
    ("LE", "Lecce", "Puglia", "Sud e Isole", 762000, 2799),
    ("BT", "Barletta-Andria-Trani", "Puglia", "Sud e Isole", 365000, 1543),
    # BASILICATA
    ("PZ", "Potenza", "Basilicata", "Sud e Isole", 350000, 6549),
    ("MT", "Matera", "Basilicata", "Sud e Isole", 191000, 3447),
    # CALABRIA
    ("CS", "Cosenza", "Calabria", "Sud e Isole", 660000, 6710),
    ("CZ", "Catanzaro", "Calabria", "Sud e Isole", 333000, 2391),
    ("RC", "Reggio Calabria", "Calabria", "Sud e Isole", 524000, 3210),
    ("KR", "Crotone", "Calabria", "Sud e Isole", 156000, 1736),
    ("VV", "Vibo Valentia", "Calabria", "Sud e Isole", 153000, 1139),
    # SICILIA
    ("TP", "Trapani", "Sicilia", "Sud e Isole", 419000, 2470),
    ("PA", "Palermo", "Sicilia", "Sud e Isole", 1209000, 5009),
    ("ME", "Messina", "Sicilia", "Sud e Isole", 600000, 3266),
    ("AG", "Agrigento", "Sicilia", "Sud e Isole", 410000, 3052),
    ("CL", "Caltanissetta", "Sicilia", "Sud e Isole", 251000, 2138),
    ("EN", "Enna", "Sicilia", "Sud e Isole", 154000, 2562),
    ("CT", "Catania", "Sicilia", "Sud e Isole", 1064000, 3573),
    ("RG", "Ragusa", "Sicilia", "Sud e Isole", 313000, 1623),
    ("SR", "Siracusa", "Sicilia", "Sud e Isole", 386000, 2109),
    # SARDEGNA
    ("SS", "Sassari", "Sardegna", "Sud e Isole", 471000, 7692),
    ("NU", "Nuoro", "Sardegna", "Sud e Isole", 199000, 5638),
    ("CA", "Cagliari", "Sardegna", "Sud e Isole", 421000, 1248),
    ("OR", "Oristano", "Sardegna", "Sud e Isole", 152000, 3034),
    ("SU", "Sud Sardegna", "Sardegna", "Sud e Isole", 333000, 6530),
]


def main():
    logger.info(f"Caricamento anagrafica province: {len(PROVINCE)} record")

    client = get_gspread_client()
    spreadsheet = open_master_sheet(client)

    worksheet = get_or_create_worksheet(
        spreadsheet,
        "anagrafica_province",
        headers=HEADERS,
        rows=200,
    )

    # Cancella tutto tranne l'header e riscrivi
    if worksheet.row_count > 1:
        worksheet.batch_clear(["A2:G200"])
        logger.info("Pulito contenuto precedente")

    rows = [
        [sigla, nome, regione, macro, pop, sup, 0]
        for sigla, nome, regione, macro, pop, sup in PROVINCE
    ]
    worksheet.append_rows(rows, value_input_option="USER_ENTERED")

    logger.info(f"Caricate {len(rows)} province nel tab 'anagrafica_province'")


if __name__ == "__main__":
    main()
