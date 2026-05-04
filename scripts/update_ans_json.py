#!/usr/bin/env python3
"""
Atualiza JSONs agregados da ANS para consumo pelo Apps Script e Looker.

Entrada:
  Arquivos ZIP públicos da ANS:
  https://dadosabertos.ans.gov.br/FTP/PDA/informacoes_consolidadas_de_beneficiarios-024/AAAAMM/

Saída:
  data/ans_RS_AAAAMM.json
  data/index.json

Estrutura do JSON:
{
  "month": "202602",
  "uf": "RS",
  "byCity": {
    "431490": {
      "total": 123,
      "mh": 100,
      "odonto": 23,
      "operadoras": {
        "OPERADORA X": {
          "modalidade": "COOPERATIVA MÉDICA",
          "beneficiarios": 123,
          "mh": 100,
          "odonto": 23
        }
      }
    }
  }
}
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import tempfile
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

import requests


BASE_DIR = "https://dadosabertos.ans.gov.br/FTP/PDA/informacoes_consolidadas_de_beneficiarios-024/"
OUT_DIR = Path("data")
TIMEOUT = 120


def norm(value: str) -> str:
    value = str(value or "").strip()
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value)
    return value.strip("_").lower()


def get(url: str) -> requests.Response:
    response = requests.get(url, timeout=TIMEOUT)
    response.raise_for_status()
    return response


def discover_months() -> List[str]:
    html = get(BASE_DIR).text
    months = sorted(set(re.findall(r'href=["\'](\d{6})/["\']', html)))
    if not months:
        months = sorted(set(re.findall(r">(\d{6})/<", html)))
    if not months:
        raise RuntimeError(f"Nenhuma competência encontrada em {BASE_DIR}")
    return months


def discover_zip_url(month: str, uf: str) -> str:
    month_dir = urljoin(BASE_DIR, f"{month}/")
    html = get(month_dir).text

    year = month[:4]
    mm = month[4:6]
    uf = uf.upper()

    patterns = [
        rf'pda-024-icb-{uf}-{year}_{mm}\.zip',
        rf'pda-024-icb-{uf}-{year}_{mm}[^"\'>\s]*\.zip',
        rf'[^"\'>\s]*{uf}[^"\'>\s]*{year}_{mm}[^"\'>\s]*\.zip',
    ]

    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE)
        if match:
            return urljoin(month_dir, match.group(0))

    raise RuntimeError(f"ZIP da UF {uf} e competência {month} não encontrado em {month_dir}")


def download_zip(url: str, target: Path) -> None:
    with requests.get(url, timeout=TIMEOUT, stream=True) as response:
        response.raise_for_status()
        with target.open("wb") as file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    file.write(chunk)


def find_csv_in_zip(zip_path: Path) -> str:
    with zipfile.ZipFile(zip_path) as zf:
        csv_files = [name for name in zf.namelist() if name.lower().endswith(".csv")]
        if not csv_files:
            raise RuntimeError(f"Nenhum CSV encontrado em {zip_path}")
        return csv_files[0]


def sniff_dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,|\t")
    except csv.Error:
        return csv.excel


def read_csv_rows_from_zip(zip_path: Path) -> Iterable[Dict[str, str]]:
    csv_name = find_csv_in_zip(zip_path)

    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(csv_name, "r") as raw:
            sample_bytes = raw.read(65536)
            raw.seek(0)

            for encoding in ("utf-8-sig", "latin-1", "cp1252"):
                try:
                    sample = sample_bytes.decode(encoding)
                    break
                except UnicodeDecodeError:
                    sample = ""
            else:
                encoding = "latin-1"
                sample = sample_bytes.decode(encoding, errors="replace")

            dialect = sniff_dialect(sample)

            text = (line.decode(encoding, errors="replace") for line in raw)
            reader = csv.DictReader(text, dialect=dialect)

            for row in reader:
                yield row


def build_header_map(headers: Iterable[str]) -> Dict[str, str]:
    return {norm(header): header for header in headers}


def pick(header_map: Dict[str, str], candidates: List[str]) -> Optional[str]:
    for candidate in candidates:
        key = norm(candidate)
        if key in header_map:
            return header_map[key]
    return None


def pick_required(header_map: Dict[str, str], candidates: List[str], label: str) -> str:
    value = pick(header_map, candidates)
    if not value:
        available = ", ".join(sorted(header_map.keys()))
        raise RuntimeError(f"Coluna obrigatória não encontrada para {label}. Colunas disponíveis: {available[:2000]}")
    return value


def to_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    text = str(value).strip()
    if not text:
        return default
    text = text.replace(".", "").replace(",", ".")
    try:
        return int(float(text))
    except ValueError:
        return default


def classify_coverage(row: Dict[str, str], coverage_col: Optional[str]) -> str:
    if not coverage_col:
        return "mh"

    text = norm(row.get(coverage_col, ""))

    if "exclusivamente" in text and "odonto" in text:
        return "odonto"

    if "odontologico" in text and "medic" not in text and "hospitalar" not in text:
        return "odonto"

    return "mh"


def process_month(month: str, uf: str, force: bool) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUT_DIR / f"ans_{uf.upper()}_{month}.json"

    if out_file.exists() and not force:
        print(f"Arquivo já existe, pulando: {out_file}")
        return out_file

    zip_url = discover_zip_url(month, uf)
    print(f"Baixando {zip_url}")

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / f"ans_{uf.upper()}_{month}.zip"
        download_zip(zip_url, zip_path)

        rows_iter = read_csv_rows_from_zip(zip_path)

        first_row = None
        for first_row in rows_iter:
            break

        if first_row is None:
            raise RuntimeError(f"CSV vazio para {uf} {month}")

        header_map = build_header_map(first_row.keys())

        city_code_col = pick_required(
            header_map,
            [
                "CD_MUNICIPIO",
                "COD_MUNICIPIO",
                "CODIGO_MUNICIPIO",
                "CD_MUNICIPIO_RESIDENCIA",
                "CODIGO_MUNICIPIO_RESIDENCIA",
                "CD_MUN",
                "COD_MUN",
            ],
            "código do município",
        )

        operator_col = pick_required(
            header_map,
            [
                "NM_RAZAO_SOCIAL",
                "RAZAO_SOCIAL",
                "OPERADORA",
                "NOME_OPERADORA",
                "NM_OPERADORA",
                "NO_OPERADORA",
            ],
            "operadora",
        )

        modality_col = pick(
            header_map,
            [
                "MODALIDADE",
                "MODALIDADE_OPERADORA",
                "DE_MODALIDADE_OPERADORA",
                "DS_MODALIDADE",
            ],
        )

        city_name_col = pick(
            header_map,
            [
                "NM_MUNICIPIO",
                "MUNICIPIO",
                "NOME_MUNICIPIO",
                "NM_MUNICIPIO_RESIDENCIA",
            ],
        )

        coverage_col = pick(
            header_map,
            [
                "COBERTURA_ASSISTENCIAL",
                "DE_COBERTURA_ASSISTENCIAL",
                "DS_COBERTURA_ASSISTENCIAL",
                "SEGMENTACAO_ASSISTENCIAL",
                "DE_SEGMENTACAO_ASSISTENCIAL",
            ],
        )

        qty_col = pick(
            header_map,
            [
                "QT_BENEFICIARIOS",
                "QTD_BENEFICIARIOS",
                "QTDE_BENEFICIARIOS",
                "BENEFICIARIOS",
                "QTD",
                "QTDE",
                "QUANTIDADE",
            ],
        )

        data = {
            "month": month,
            "uf": uf.upper(),
            "byCity": {},
        }

        def handle(row: Dict[str, str]) -> None:
            city_code = re.sub(r"\D", "", str(row.get(city_code_col, ""))).strip()
            if not city_code:
                return

            # A base agregada usa código municipal ANS de 6 dígitos.
            if len(city_code) > 6:
                city_code = city_code[:6]

            operator_name = str(row.get(operator_col, "")).strip()
            if not operator_name:
                return

            modality = str(row.get(modality_col, "")).strip() if modality_col else ""
            city_name = str(row.get(city_name_col, "")).strip() if city_name_col else ""

            quantity = to_int(row.get(qty_col), 1) if qty_col else 1
            if quantity <= 0:
                return

            coverage = classify_coverage(row, coverage_col)

            city = data["byCity"].setdefault(
                city_code,
                {
                    "total": 0,
                    "mh": 0,
                    "odonto": 0,
                    "cidade": city_name,
                    "operadoras": {},
                },
            )

            if city_name and not city.get("cidade"):
                city["cidade"] = city_name

            city["total"] += quantity
            city[coverage] += quantity

            operator = city["operadoras"].setdefault(
                operator_name,
                {
                    "modalidade": modality,
                    "beneficiarios": 0,
                    "mh": 0,
                    "odonto": 0,
                },
            )

            if modality and not operator.get("modalidade"):
                operator["modalidade"] = modality

            operator["beneficiarios"] += quantity
            operator[coverage] += quantity

        handle(first_row)

        processed = 1
        for row in rows_iter:
            handle(row)
            processed += 1
            if processed % 500000 == 0:
                print(f"{processed:,} linhas processadas")

    with out_file.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, separators=(",", ":"))

    print(f"Gerado: {out_file} com {len(data['byCity'])} cidades")
    return out_file


def update_index() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(OUT_DIR.glob("ans_*.json"))

    items = []
    for file in files:
        match = re.match(r"ans_([A-Z]{2})_(\d{6})\.json$", file.name)
        if not match:
            continue

        uf, month = match.groups()
        items.append(
            {
                "uf": uf,
                "month": month,
                "file": file.name,
                "path": f"data/{file.name}",
            }
        )

    index = {
        "updated_at": None,
        "files": items,
    }

    with (OUT_DIR / "index.json").open("w", encoding="utf-8") as file:
        json.dump(index, file, ensure_ascii=False, indent=2)

    print(f"Índice atualizado: {OUT_DIR / 'index.json'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uf", default="RS")
    parser.add_argument("--months", nargs="*", default=[])
    parser.add_argument("--latest", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uf = args.uf.upper()

    months = args.months

    if args.latest or not months:
        available = discover_months()
        months = [available[-1]]

    for month in months:
        if not re.fullmatch(r"\d{6}", month):
            raise ValueError(f"Competência inválida: {month}. Use AAAAMM.")
        process_month(month, uf, args.force)

    update_index()


if __name__ == "__main__":
    main()
