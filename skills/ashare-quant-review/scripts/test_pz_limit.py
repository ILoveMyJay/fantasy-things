#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import urllib.request
import json

# 测试不同pz参数的返回量
for pz in [100, 500, 1000, 2000, 5000]:
    url = f'http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz={pz}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            total = data.get('data', {}).get('total', 0)
            returned = len(data.get('data', {}).get('diff', []))
            print(f"pz={pz:4d} -> 市场总量:{total:4d}, 实际返回:{returned:4d}")
    except Exception as e:
        print(f"pz={pz:4d} -> 失败: {e}")
