"""
把多条 mp3 拼成若干组（每组 <= 默认 55 分钟），供批量 ASR 一次转写。
用法: python scripts/make_groups.py [manifest.json] [--limit 55]
输出: groups/g1.mp3 ... + groups.json（每条视频在组内的起止秒偏移表）

批量转写的原因：一条一条调 ASR 太慢（55 条就是 55 次）。拼接后一次转写，
再用 split_transcript.py 按时间偏移切回单条。
"""
import json, os, subprocess, sys, argparse

ap = argparse.ArgumentParser()
ap.add_argument('manifest', nargs='?', default='manifest.json')
ap.add_argument('--limit', type=int, default=55, help='每组最大分钟数，默认 55')
args = ap.parse_args()

M = json.load(open(args.manifest, encoding='utf-8'))
M = [m for m in M if m.get('dur', 0) > 2]  # 跳过 0 秒 / 异常条目
print('有效条数', len(M), '总时长', round(sum(m['dur'] for m in M) / 60, 1), '分钟')

LIMIT = args.limit * 60
groups, cur, cur_dur = [], [], 0
for m in M:
    if cur_dur + m['dur'] > LIMIT and cur:
        groups.append(cur)
        cur, cur_dur = [], 0
    cur.append(m)
    cur_dur += m['dur']
if cur:
    groups.append(cur)

os.makedirs('groups', exist_ok=True)
out = []
for gi, g in enumerate(groups, 1):
    lst = f'groups/g{gi}.txt'
    with open(lst, 'w', encoding='utf-8') as f:
        for m in g:
            mp3 = m['base'] + '.mp3'
            f.write(f"file '{os.path.abspath(mp3).replace(chr(92), '/')}'\n")
    target = f'groups/g{gi}.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
                    '-i', lst, '-c', 'copy', target], check=True)
    off = 0
    table = []
    for m in g:
        table.append({'n': m['n'], 'date': m['date'], 'start': off, 'end': off + m['dur'],
                      'dur': m['dur'], 'aweme_id': m['aweme_id']})
        off += m['dur']
    size = round(os.path.getsize(target) / 1024 / 1024, 1)
    print(f'g{gi}: {len(g)} 条, {round(off/60,1)} 分钟, {size} MB')
    out.append({'group': gi, 'file': target, 'total_sec': off, 'items': table})

json.dump(out, open('groups.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('written groups.json，共', len(out), '组')
