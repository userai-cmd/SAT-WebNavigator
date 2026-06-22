#!/usr/bin/env python3
"""Convert SAT_Bot_Knowledge_Base_v4.xlsx → data/knowledge-base.json"""

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "SAT_Bot_Knowledge_Base_v4.xlsx"
OUT = ROOT / "data" / "knowledge-base.json"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def col_to_idx(col: str) -> int:
    n = 0
    for c in col:
        n = n * 26 + (ord(c) - 64)
    return n - 1


def cell_value(cell, shared_strings):
    t = cell.get("t")
    is_el = cell.find("m:is", NS)
    v_el = cell.find("m:v", NS)
    if is_el is not None:
        return "".join((x.text or "") for x in is_el.findall(".//m:t", NS))
    if v_el is None:
        return None
    if t == "s":
        return shared_strings[int(v_el.text)]
    return v_el.text


def parse_sheet(z, sheet_path, shared_strings):
    root = ET.fromstring(z.read(sheet_path))
    rows = {}
    for row in root.findall(".//m:sheetData/m:row", NS):
        r_idx = int(row.get("r"))
        rows[r_idx] = {}
        for c in row.findall("m:c", NS):
            ref = c.get("r")
            col = re.match(r"([A-Z]+)", ref).group(1)
            rows[r_idx][col_to_idx(col)] = cell_value(c, shared_strings)
    if not rows:
        return []
    max_col = max(max(r.keys()) for r in rows.values())
    return [
        [rows[ri].get(ci) for ci in range(max_col + 1)]
        for ri in sorted(rows.keys())
    ]


def find_header_row(rows):
    """Find row with ID or Питання or Параметр as first meaningful header."""
    for i, row in enumerate(rows):
        if not row:
            continue
        first = str(row[0] or "").strip()
        if first in ("ID", "Дата", "Параметр", "Лист"):
            return i
    return 0


def row_to_entry(sheet_name, headers, row):
    entry = {"sheet": sheet_name}
    for h, val in zip(headers, row):
        if h and val is not None and str(val).strip():
            key = str(h).strip()
            entry[key] = str(val).strip()
    return entry


def is_data_row(entry, headers):
    if len(entry) <= 1:
        return False
    id_val = entry.get("ID") or entry.get("Дата") or entry.get("Параметр") or entry.get("Лист")
    return bool(id_val)


def main():
    if not XLSX.exists():
        raise SystemExit(f"Excel file not found: {XLSX}")

    sheets_out = []

    with zipfile.ZipFile(XLSX) as z:
        shared = []
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheet_list = [
            (sh.get("name"), sh.get(REL + "id"))
            for sh in wb.findall(".//m:sheets/m:sheet", NS)
        ]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_path = {
            rel.get("Id"): rel.get("Target").lstrip("/") for rel in rels
        }

        for name, rid in sheet_list:
            rows = parse_sheet(z, rid_to_path[rid], shared)
            if not rows:
                continue

            header_idx = find_header_row(rows)
            headers = [str(h).strip() if h else "" for h in rows[header_idx]]
            data_rows = rows[header_idx + 1 :]

            entries = []
            for row in data_rows:
                entry = row_to_entry(name, headers, row)
                if is_data_row(entry, headers):
                    entries.append(entry)

            sheets_out.append(
                {
                    "id": name,
                    "title": name,
                    "entryCount": len(entries),
                    "entries": entries,
                }
            )

    payload = {
        "version": "v4",
        "source": XLSX.name,
        "sheetCount": len(sheets_out),
        "totalEntries": sum(s["entryCount"] for s in sheets_out),
        "sheets": sheets_out,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ {payload['totalEntries']} entries → {OUT}")


if __name__ == "__main__":
    main()
