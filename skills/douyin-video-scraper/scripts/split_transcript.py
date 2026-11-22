"""
把一组批量 ASR 结果按时间偏移切回单条逐字稿。
用法: python scripts/split_transcript.py <转写结果文件> <组号> [groups.json] [manifest.json] [输出目录]

例: python scripts/split_transcript.py asr_g1.txt 1
输出: all_txt/01_2026-11-22.txt ...

兼容两种 ASR 结果格式：
  1) 纯文本，含 [分:秒.毫秒,分:秒.毫秒,序号] 时间戳行
  2) 双层 JSON：外层 {"content": "{\\"text\\": \\"...\\"}"}，需 json.loads 两次
"""
import json, re, os, sys, argparse

ap = argparse.ArgumentParser()
ap.add_argument('transcript', help='该组的 ASR 转写结果文件')
ap.add_argument('group', type=int, help='组号，对应 groups.json 里的 group 字段')
ap.add_argument('--groups', default='groups.json')
ap.add_argument('--manifest', default='manifest.json')
ap.add_argument('--out', default='all_txt')
args = ap.parse_args()


def load(path):
    raw = open(path, encoding='utf-8').read()
    try:
        d = json.loads(raw)
        # 双层 JSON：外层 content 里套着内层 JSON 字符串
        if isinstance(d, dict) and 'content' in d and isinstance(d['content'], str):
            try:
                d = json.loads(d['content'])
            except Exception:
                pass
        if isinstance(d, dict):
            return d.get('text', '') or raw
        return raw
    except Exception:
        return raw


def parse(text):
    """返回 [(start_sec, end_sec, content)]，时间戳形如 [0:11.250,0:16.425,0]"""
    out = []
    for m in re.finditer(r'\[(\d+):([\d.]+),(\d+):([\d.]+),\d+\]\s*(.*?)(?=\[\d+:|\Z)', text, re.S):
        s = int(m.group(1)) * 60 + float(m.group(2))
        e = int(m.group(3)) * 60 + float(m.group(4))
        c = m.group(5).strip()
        if c:
            out.append((s, e, c))
    return out


GROUPS = json.load(open(args.groups, encoding='utf-8'))
MANIFEST = {m['n']: m for m in json.load(open(args.manifest, encoding='utf-8'))}

g = next((x for x in GROUPS if x['group'] == args.group), None)
if not g:
    sys.exit(f'groups.json 中找不到组号 {args.group}')

segs = parse(load(args.transcript))
print(f'g{args.group}: 解析出 {len(segs)} 个片段, 覆盖 {round(segs[-1][1] if segs else 0)} 秒 / 组时长 {g["total_sec"]} 秒')
if not segs:
    print('警告：0 个片段。检查 ASR 结果是否带时间戳，或是否双层 JSON 没解开。')

os.makedirs(args.out, exist_ok=True)
for it in g['items']:
    n, s, e = it['n'], it['start'], it['end']
    body = [c for (ss, ee, c) in segs if ss >= s - 2 and ss < e - 1]
    m = MANIFEST.get(n, {})
    head = f"# {m.get('date','')} | {m.get('dur','')}s | 赞{m.get('stats',{}).get('digg_count')} 藏{m.get('stats',{}).get('collect_count')}\n"
    head += f"# 标题: {m.get('title')}\n# 原链接: https://www.douyin.com/video/{m.get('aweme_id')}\n\n"
    fn = os.path.join(args.out, f"{n:02d}_{m.get('date','')}.txt")
    open(fn, 'w', encoding='utf-8').write(head + '\n'.join(body))
    print(f'  [{n}] {m.get("date","")} {m.get("dur","")}s -> {len("".join(body))} 字 -> {fn}')
