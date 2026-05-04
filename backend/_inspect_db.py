import sqlite3, json
conn = sqlite3.connect(r'D:\WebFrontEnd\Projects\Gaokao\backend\gaokao.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

def sample(table, limit=2):
    try:
        cur.execute(f'SELECT * FROM "{table}" LIMIT {limit}')
        rows = cur.fetchall()
        if not rows:
            return '（空表）'
        out = []
        for r in rows:
            out.append({k: r[k] for k in r.keys()})
        return json.dumps(out, ensure_ascii=False, indent=2, default=str)
    except Exception as e:
        return f'Error: {e}'

tables = [
    'schools','subject_evaluations','majors','admission_records',
    'rank_tables','major_employment','national_programs','province_control_lines',
    'users','orders','user_events','feedbacks',
    'school_employment','school_reviews','sms_codes','report_logs','report_scans'
]
for t in tables:
    print(f'--- {t} ---')
    print(sample(t))
    print()
conn.close()
