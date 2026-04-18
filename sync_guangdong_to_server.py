#!/usr/bin/env python3
"""
Sync Guangdong 物理类 admission data to remote server.
Run AFTER deploying code with: bash deploy_to_server.sh

Usage: python3 sync_guangdong_to_server.py
"""
import json, requests, sys, time

REMOTE = 'http://43.143.206.19'
ADMIN_TOKEN = 'yuanxi-admin-2026'
DATA_FILE = '/tmp/guangdong_wuli_records.json'
BATCH_SIZE = 500  # records per request

def main():
    print(f'Loading data from {DATA_FILE}...')
    with open(DATA_FILE, encoding='utf-8') as f:
        records = json.load(f)
    print(f'Loaded {len(records)} records')

    headers = {'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json'}

    # Verify server is reachable
    try:
        r = requests.get(f'{REMOTE}/api/admin/stats/today', headers=headers, timeout=10)
        if r.status_code != 200:
            print(f'Admin API check failed: {r.status_code} {r.text[:100]}')
            sys.exit(1)
        print('Remote server reachable ✓')
    except Exception as e:
        print(f'Cannot reach server: {e}')
        sys.exit(1)

    # Send in batches
    total_inserted = 0
    total_deleted = 0
    first_batch = True

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        payload = {
            'records': batch,
            'delete_existing': first_batch,  # only delete on first batch
        }
        first_batch = False

        try:
            r = requests.post(
                f'{REMOTE}/api/admin/import_admission_records',
                json=payload, headers=headers, timeout=60
            )
            if r.status_code == 200:
                result = r.json()
                total_inserted += result.get('inserted', 0)
                total_deleted += result.get('deleted', 0)
                print(f'  Batch {i//BATCH_SIZE + 1}: inserted={result.get("inserted")}, deleted={result.get("deleted")}')
            else:
                print(f'  Batch {i//BATCH_SIZE + 1} ERROR: {r.status_code} {r.text[:200]}')
                sys.exit(1)
        except Exception as e:
            print(f'  Batch {i//BATCH_SIZE + 1} exception: {e}')
            sys.exit(1)
        time.sleep(0.2)

    print(f'\nDone! Deleted={total_deleted}, Inserted={total_inserted}')

    # Verify
    print('\nVerifying remote results...')
    for rank, prov, subj in [(5000, '广东', '物理'), (60000, '广东', '物理')]:
        try:
            r = requests.get(f'{REMOTE}/api/recommend',
                           params={'rank': rank, 'province': prov, 'subject': subj},
                           timeout=10)
            if r.status_code == 200:
                d = r.json()
                items = d.get('surge', []) + d.get('stable', []) + d.get('safe', [])
                print(f'  {prov} {subj} rank={rank}: {len(items)} results')
        except Exception as e:
            print(f'  {prov} {subj} rank={rank}: {e}')

if __name__ == '__main__':
    main()
