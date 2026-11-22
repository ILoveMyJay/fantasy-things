"""
入库后清理本地音视频/图片，只保留文章、逐字稿、元数据、脚本。
用法:
  python scripts/cleanup.py [工作目录]            # 默认 dry-run，只报告不删除
  python scripts/cleanup.py [工作目录] --apply     # 确认后真正删除
  python scripts/cleanup.py [工作目录] --apply --yes  # 跳过交互确认
"""
import os, sys, argparse

ap = argparse.ArgumentParser()
ap.add_argument('root', nargs='?', default='.')
ap.add_argument('--apply', action='store_true', help='真正删除；不加则只 dry-run')
ap.add_argument('--yes', action='store_true', help='跳过交互确认')
args = ap.parse_args()

TARGET = {'.mp4', '.mp3', '.jpg', '.jpeg', '.png', '.wav', '.m4a'}

found = []
freed = 0
for dp, dn, fn in os.walk(args.root):
    if 'node_modules' in dp.replace('\\', '/') or '.udd' in dp.replace('\\', '/'):
        continue
    for f in fn:
        ext = os.path.splitext(f)[1].lower()
        if ext not in TARGET:
            continue
        p = os.path.join(dp, f)
        try:
            found.append((p, os.path.getsize(p)))
        except OSError:
            pass

print(f'发现 {len(found)} 个媒体文件，共 {round(sum(s for _, s in found)/1024**3, 2)} GB')
for p, s in found[:20]:
    print('  ', p, round(s/1024/1024, 1), 'MB')
if len(found) > 20:
    print(f'   ... 还有 {len(found)-20} 个')

if not args.apply:
    print('\n[dry-run] 未删除任何文件。确认无误后加 --apply 真正删除。')
    sys.exit(0)

if not args.yes:
    ans = input(f'\n确认删除这 {len(found)} 个文件？此操作不可恢复。输入 yes 继续: ')
    if ans.strip().lower() != 'yes':
        print('已取消')
        sys.exit(0)

removed = failed = 0
for p, s in found:
    try:
        os.remove(p)
        removed += 1
        freed += s
    except Exception as e:
        failed += 1
        print('  删除失败', p, e)
print(f'\n已删除 {removed} 个文件，释放 {round(freed/1024**3, 2)} GB，失败 {failed} 个')
