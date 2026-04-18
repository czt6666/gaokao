#!/usr/bin/env python3
"""
Sync all improved province data to remote server.
Provinces (major-level Excel data):
  广东(2021-2023), 江苏(2021-2023), 山东(2021-2024), 浙江(2021-2024),
  河南(2022-2025), 上海(2022-2025), 天津(2022-2025), 海南(2021,2023),
  吉林(2022-2025), 陕西(2022-2025), 山西(2022-2025), 重庆(2022-2025),
  江西(2022-2025), 内蒙古(2022-2025), 安徽(2022-2025), 四川(2022-2025),
  云南(2022-2025), 广西(2022-2025), 河北(2022-2025)

Run AFTER deploying code with: bash deploy_full.sh

Usage: python3 sync_all_provinces.py
"""
import json, sqlite3, requests, sys, time

REMOTE = 'http://43.143.206.19'
ADMIN_TOKEN = 'yuanxi-admin-2026'
DB = '/Users/Admin/Desktop/claunde code gaokao/backend/gaokao.db'
BATCH_SIZE = 500

HEADERS = {'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json'}

# Province-year combos to sync (improved major-level data, replacing CDN school-level)
SYNC_TARGETS = [
    # 广东: 2021-2023 upgraded to major-level (历史类 added for 2023)
    ('广东', 2021), ('广东', 2022), ('广东', 2023),
    # 江苏: 2021-2023 upgraded to major-group level
    ('江苏', 2021), ('江苏', 2022), ('江苏', 2023),
    # 山东: 2021-2024 upgraded to major-level
    ('山东', 2021), ('山东', 2022), ('山东', 2023), ('山东', 2024),
    # 浙江: 2021-2024 upgraded to major-level (3+3 综合)
    ('浙江', 2021), ('浙江', 2022), ('浙江', 2023), ('浙江', 2024),
    # 河南: 2022-2025 upgraded to major-level
    ('河南', 2022), ('河南', 2023), ('河南', 2024), ('河南', 2025),
    # 上海: 2022-2025 major-level (3+3 综合)
    ('上海', 2022), ('上海', 2023), ('上海', 2024), ('上海', 2025),
    # 天津: 2022-2025 major-level (3+3 综合)
    ('天津', 2022), ('天津', 2023), ('天津', 2024), ('天津', 2025),
    # 海南: 2021, 2023 major-level (3+3 综合)
    ('海南', 2021), ('海南', 2023),
    # 吉林: 2022-2025 (proper 物理类/历史类, replaces 首选物理/历史)
    ('吉林', 2022), ('吉林', 2023), ('吉林', 2024), ('吉林', 2025),
    # 陕西: 2022-2025 (proper 理科→物理类, 文科→历史类)
    ('陕西', 2022), ('陕西', 2023), ('陕西', 2024), ('陕西', 2025),
    # 山西: 2022-2025 (proper 理科→物理类, 文科→历史类)
    ('山西', 2022), ('山西', 2023), ('山西', 2024), ('山西', 2025),
    # 重庆: 2022-2025 (proper 物理类/历史类, replaces 首选物理/历史)
    ('重庆', 2022), ('重庆', 2023), ('重庆', 2024), ('重庆', 2025),
    # 江西: 2022-2025 (proper 理科→物理类, 文科→历史类)
    ('江西', 2022), ('江西', 2023), ('江西', 2024), ('江西', 2025),
    # 内蒙古: 2022-2025 (proper subject categorization)
    ('内蒙古', 2022), ('内蒙古', 2023), ('内蒙古', 2024), ('内蒙古', 2025),
    # 安徽: 2022-2025 (proper subject categorization)
    ('安徽', 2022), ('安徽', 2023), ('安徽', 2024), ('安徽', 2025),
    # 四川: 2022-2025 (proper 理科→物理类, 文科→历史类)
    ('四川', 2022), ('四川', 2023), ('四川', 2024), ('四川', 2025),
    # 云南: 2022-2025 (proper subject categorization)
    ('云南', 2022), ('云南', 2023), ('云南', 2024), ('云南', 2025),
    # 广西: 2022-2025 (proper subject categorization)
    ('广西', 2022), ('广西', 2023), ('广西', 2024), ('广西', 2025),
    # 河北: 2022-2025 (proper 物理类/历史类)
    ('河北', 2022), ('河北', 2023), ('河北', 2024), ('河北', 2025),
    # 新疆: 2022-2024 (proper 理科→物理类, 文科→历史类; 2025 has no rank data)
    ('新疆', 2022), ('新疆', 2023), ('新疆', 2024),
    # 青海: 2022-2025 (proper subject categorization)
    ('青海', 2022), ('青海', 2023), ('青海', 2024), ('青海', 2025),
]


def check_server():
    try:
        r = requests.get(f'{REMOTE}/api/admin/stats/today', headers=HEADERS, timeout=10)
        if r.status_code != 200:
            print(f'Admin API check failed: {r.status_code} {r.text[:100]}')
            sys.exit(1)
        print('Remote server reachable ✓')
        # Check import endpoint exists
        r2 = requests.post(f'{REMOTE}/api/admin/import_admission_records',
                           json={'records': [], 'delete_existing': False},
                           headers=HEADERS, timeout=10)
        if r2.status_code == 404:
            print('ERROR: import_admission_records endpoint not found on server!')
            print('Please deploy the updated code first: bash deploy_to_server.sh')
            sys.exit(1)
        print('Import endpoint available ✓')
    except Exception as e:
        print(f'Cannot reach server: {e}')
        sys.exit(1)


def load_records(province, year):
    conn = sqlite3.connect(DB)
    cur = conn.execute("""
        SELECT school_code, school_name, major_name, province, year,
               batch, subject_req, min_score, min_rank, COALESCE(admit_count, 0),
               COALESCE(school_province, '')
        FROM admission_records
        WHERE province=? AND year=?
        AND min_rank > 0 AND min_score > 0
    """, (province, year))
    rows = cur.fetchall()
    conn.close()
    return [
        {
            'school_code': r[0] or '',
            'school_name': r[1],
            'major_name': r[2],
            'province': r[3],
            'year': r[4],
            'batch': r[5] or '',
            'subject_req': r[6] or '',
            'min_score': r[7],
            'min_rank': r[8],
            'admit_count': r[9],
            'school_province': r[10],
        }
        for r in rows
    ]


def send_batch(records, delete_existing=False):
    payload = {'records': records, 'delete_existing': delete_existing}
    r = requests.post(
        f'{REMOTE}/api/admin/import_admission_records',
        json=payload, headers=HEADERS, timeout=60
    )
    if r.status_code == 200:
        result = r.json()
        return result.get('inserted', 0), result.get('deleted', 0)
    else:
        print(f'  ERROR: {r.status_code} {r.text[:200]}')
        sys.exit(1)


def main():
    check_server()
    print()

    grand_total_inserted = 0
    grand_total_deleted = 0

    for province, year in SYNC_TARGETS:
        records = load_records(province, year)
        if not records:
            print(f'{province} {year}: no records, skipping')
            continue

        print(f'{province} {year}: {len(records)} records')
        total_inserted = 0
        total_deleted = 0
        first_batch = True

        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            inserted, deleted = send_batch(batch, delete_existing=first_batch)
            total_inserted += inserted
            total_deleted += deleted
            first_batch = False
            print(f'  batch {i//BATCH_SIZE + 1}: +{inserted} -{deleted}', end='\r')
            time.sleep(0.15)

        print(f'  ✓ {province} {year}: inserted={total_inserted}, deleted={total_deleted}')
        grand_total_inserted += total_inserted
        grand_total_deleted += total_deleted
        print()

    print(f'Done! Total: deleted={grand_total_deleted}, inserted={grand_total_inserted}')

    # Verify
    print('\nVerification:')
    for province, subject, ranks in [
        ('广东', '物理', [5000, 60000]),
        ('山东', '物理', [10000, 60000]),
        ('江苏', '物理', [10000, 60000]),
        ('浙江', '综合', [30000, 60000]),
        ('河南', '物理', [30000, 60000]),
        ('上海', '综合', [10000, 30000]),
        ('天津', '综合', [10000, 30000]),
        ('海南', '综合', [5000, 10000]),
        ('吉林', '物理', [10000, 30000]),
        ('陕西', '物理', [10000, 30000]),
        ('四川', '物理', [10000, 30000]),
        ('河北', '物理', [10000, 30000]),
    ]:
        for rank in ranks:
            try:
                r = requests.get(f'{REMOTE}/api/recommend',
                               params={'rank': rank, 'province': province, 'subject': subject},
                               timeout=15)
                if r.status_code == 200:
                    d = r.json()
                    total = len(d.get('surge', [])) + len(d.get('stable', [])) + len(d.get('safe', []))
                    print(f'  {province} {subject} rank={rank}: {total} results')
            except Exception as e:
                print(f'  {province} rank={rank}: {e}')


if __name__ == '__main__':
    main()
