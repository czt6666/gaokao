"""
Import rich school data from the comprehensive XLS file into schools table.
Updates: flagship_majors, employment_quality, postgrad_rate, tags, rank_2024

Usage:
  python import_school_enrichment.py
"""
import os
import sys
import sqlite3
import xlrd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE, "gaokao.db")
DATA_DIR = os.path.expanduser("~/Desktop/高考程序素材")

XLS_FILE = os.path.join(
    DATA_DIR,
    "00、志愿填报必备资料",
    "01、一表查询全国本、专科3167个大学（六合一版）.xls",
)


def safe_str(v) -> str:
    if v is None:
        return ""
    # Handle numeric values (xlrd reads empty cells as 0.0)
    if isinstance(v, float):
        if v == 0.0:
            return ""
        # Non-zero float might be a valid number like a rank
        return str(int(v)) if v == int(v) else str(v)
    s = str(v).strip()
    if s in ("None", "nan", "/", "-", "", "0", "0.0"):
        return ""
    # Skip URL values (not useful as plain text fields)
    if s.startswith("http://") or s.startswith("https://"):
        return ""
    return s


def safe_float(v) -> float:
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def parse_postgrad_rate(val) -> str:
    """Parse national postgrad rate from 国内升学 column."""
    s = safe_str(val)
    if not s:
        return ""
    # Keep as-is if it already has % or looks like a number
    return s


def main():
    conn = sqlite3.connect(DB_PATH)

    if not os.path.exists(XLS_FILE):
        print(f"ERROR: File not found: {XLS_FILE}")
        sys.exit(1)

    print(f"Reading {os.path.basename(XLS_FILE)} ...")
    wb = xlrd.open_workbook(XLS_FILE)
    ws = wb.sheet_by_index(0)

    # Build column index from row 0 (headers)
    headers = ws.row_values(0)
    col = {str(h).strip(): i for i, h in enumerate(headers) if h}

    print(f"Total rows: {ws.nrows}")
    print(f"Key columns found: {[k for k in ['王牌专业', '就业质量', '保研率', '软科排名', '院校标签', '国内升学'] if k in col]}")

    updated = 0
    not_found = 0
    skipped = 0

    for row_idx in range(2, ws.nrows):  # Row 0=headers, Row 1=col indices, Row 2=data
        row = ws.row_values(row_idx)
        if not row or all(v == "" or v is None for v in row[:5]):
            skipped += 1
            continue

        # School name
        school_name = safe_str(row[col.get("院校新名称", 3)]) or safe_str(row[col.get("院校原名称", 2)])
        if not school_name:
            skipped += 1
            continue

        # Extract key fields
        flagship    = safe_str(row[col["王牌专业"]] if "王牌专业" in col else "")
        employ_qual = safe_str(row[col["就业质量"]] if "就业质量" in col else "")
        postgrad    = safe_str(row[col["保研率"]] if "保研率" in col else "")
        tags_extra  = safe_str(row[col["院校标签"]] if "院校标签" in col else "")
        rank_ruanke = safe_str(row[col["软科排名"]] if "软科排名" in col else "")
        domestic_pg = safe_str(row[col["国内升学"]] if "国内升学" in col else "")

        # Parse rank_2024 from 软科排名
        rank_2024 = 0
        if rank_ruanke:
            try:
                rank_2024 = int(float(rank_ruanke))
            except (ValueError, TypeError):
                pass

        # Build UPDATE only for non-empty fields
        updates = []
        params = []

        if flagship:
            updates.append("flagship_majors = CASE WHEN flagship_majors IS NULL OR flagship_majors = '' THEN ? ELSE flagship_majors END")
            params.append(flagship[:500])

        if employ_qual:
            updates.append("employment_quality = CASE WHEN employment_quality IS NULL OR employment_quality = '' THEN ? ELSE employment_quality END")
            params.append(employ_qual[:500])

        if postgrad:
            updates.append("postgrad_rate = CASE WHEN postgrad_rate IS NULL OR postgrad_rate = '' THEN ? ELSE postgrad_rate END")
            params.append(postgrad)

        if tags_extra:
            updates.append("tags = CASE WHEN tags IS NULL OR tags = '' THEN ? WHEN instr(tags, ?) = 0 THEN tags || ',' || ? ELSE tags END")
            params.extend([tags_extra, tags_extra, tags_extra])

        if rank_2024 > 0:
            updates.append("rank_2024 = CASE WHEN rank_2024 IS NULL OR rank_2024 = 0 THEN ? ELSE rank_2024 END")
            params.append(rank_2024)

        if not updates:
            skipped += 1
            continue

        params.append(school_name)
        sql = f"UPDATE schools SET {', '.join(updates)} WHERE name = ?"
        cursor = conn.execute(sql, params)
        if cursor.rowcount > 0:
            updated += 1
        else:
            not_found += 1

        if (updated + not_found) % 500 == 0:
            conn.commit()
            print(f"  ... processed {updated + not_found} schools (updated {updated})")

    conn.commit()
    wb.release_resources()

    print(f"\n=== School Enrichment Summary ===")
    print(f"Updated: {updated} schools")
    print(f"Not found in DB: {not_found}")
    print(f"Skipped (no data): {skipped}")

    # Check results
    cursor = conn.execute("SELECT COUNT(*) FROM schools WHERE flagship_majors != '' AND flagship_majors IS NOT NULL")
    print(f"\nSchools with flagship_majors: {cursor.fetchone()[0]}")
    cursor = conn.execute("SELECT COUNT(*) FROM schools WHERE employment_quality != '' AND employment_quality IS NOT NULL")
    print(f"Schools with employment_quality: {cursor.fetchone()[0]}")
    cursor = conn.execute("SELECT COUNT(*) FROM schools WHERE postgrad_rate != '' AND postgrad_rate IS NOT NULL")
    print(f"Schools with postgrad_rate: {cursor.fetchone()[0]}")
    cursor = conn.execute("SELECT COUNT(*) FROM schools WHERE rank_2024 > 0")
    print(f"Schools with rank_2024: {cursor.fetchone()[0]}")

    conn.close()


if __name__ == "__main__":
    main()
