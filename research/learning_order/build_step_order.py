"""Optimize the complete list: every character AND every word costs one step."""
from __future__ import annotations
import argparse
import collections
import hashlib
import heapq
import json
import math
from pathlib import Path
import time

from build_learning_order import Corpus, unique_han, is_han, write_tsv


def baseline(corpus):
    known, jobs = set(), []
    for wi, deps in enumerate(corpus.deps):
        for c in deps:
            if c not in known:
                known.add(c)
                jobs.append((0, c))
        jobs.append((1, wi))
    return jobs


def objective(corpus, jobs):
    return math.fsum(corpus.weights[i] * pos for pos, (kind, i) in enumerate(jobs, 1) if kind) / corpus.total_weight


def density_order(corpus, penalty=1.0, power=2):
    """Compare ready words with packets of missing characters + weighted words.

    For each exact missing-character set S, maximize sum(top-k word weights)
    / (penalty * len(S) + k). penalty tunes the heuristic only; the evaluation
    always counts every emitted item as exactly one step. Replan after each
    character, so newly available high-value words may be emitted immediately.
    """
    groups = collections.defaultdict(list)
    for wi, deps in enumerate(corpus.deps):
        groups[frozenset(deps)].append(wi)
    reverse = [set() for _ in corpus.chars]
    versions = collections.defaultdict(int)
    candidates = []
    ready = []
    missing_count = [len(d) for d in corpus.deps]
    known = set()
    jobs = []

    def push(key):
        versions[key] += 1
        total, best = 0.0, 0.0
        for k, wi in enumerate(groups[key], 1):
            w = corpus.weights[wi]
            if w <= best:
                break
            total += w
            best = total / (penalty * len(key) + k)
        heapq.heappush(candidates, (-best, groups[key][0], tuple(sorted(key)), versions[key]))

    for key in sorted(groups, key=lambda k: (min(groups[k]), tuple(sorted(k)))):
        for c in key:
            reverse[c].add(key)
        push(key)
    while candidates or ready:
        while candidates:
            neg, first, chars, version = candidates[0]
            key = frozenset(chars)
            if key not in groups or versions[key] != version:
                heapq.heappop(candidates)
            else:
                break
        best_density = -candidates[0][0] if candidates else -1
        if ready and corpus.weights[ready[0]] >= best_density - 1e-15:
            jobs.append((1, heapq.heappop(ready)))
            continue
        if not candidates:
            break
        key = frozenset(candidates[0][2])
        def potential(c):
            return math.fsum(corpus.weights[wi] / missing_count[wi] ** power for wi in corpus.adj[c])
        chosen = min(key, key=lambda c: (-potential(c), corpus.first_rank[c], ord(corpus.chars[c])))
        known.add(chosen)
        jobs.append((0, chosen))
        changed = set()
        old_keys = sorted(reverse[chosen], key=lambda k: (len(k), tuple(sorted(k))))
        for old in old_keys:
            word_ids = groups.pop(old)
            for c in old:
                reverse[c].remove(old)
            for wi in word_ids:
                missing_count[wi] -= 1
            new = old - {chosen}
            if not new:
                for wi in word_ids:
                    heapq.heappush(ready, wi)
                continue
            if new in groups:
                groups[new] = list(heapq.merge(groups[new], word_ids))
            else:
                groups[new] = word_ids
                for c in new:
                    reverse[c].add(new)
            changed.add(new)
        for new in sorted(changed, key=lambda k: (len(k), tuple(sorted(k)))):
            push(new)
    assert len(jobs) == len(corpus.chars) + len(corpus.entries)
    assert len(known) == len(corpus.chars)
    return jobs


def exact_job_block(corpus, block):
    """Exact minimum weighted completion-time ordering within a valid block."""
    if not any(kind == 0 for kind, _ in block):
        return sorted(block, key=lambda j: corpus.entries[j[1]]["rank"])
    local_chars = {i: 1 << k for k, (kind, i) in enumerate(block) if kind == 0}
    prereqs, weights = [], []
    for kind, i in block:
        prereqs.append(sum(local_chars.get(c, 0) for c in corpus.deps[i]) if kind else 0)
        weights.append(corpus.weights[i] if kind else 0.0)
    size = 1 << len(block)
    dp, parent = [math.inf] * size, [0] * size
    dp[0] = 0.0
    for mask in range(1, size):
        bits = mask
        step = mask.bit_count()
        while bits:
            bit = 1 << (bits.bit_length() - 1)
            j = bit.bit_length() - 1
            prev = mask ^ bit
            if prereqs[j] & prev == prereqs[j] and math.isfinite(dp[prev]):
                cost = dp[prev] + weights[j] * step
                if cost < dp[mask] - 1e-15:
                    dp[mask], parent[mask] = cost, bit
            bits ^= bit
    assert math.isfinite(dp[-1])
    result, mask = [], size - 1
    while mask:
        bit = parent[mask]
        result.append(block[bit.bit_length()-1])
        mask ^= bit
    return result[::-1]


def refine_jobs(corpus, jobs, width=8, passes=4):
    jobs = jobs.copy()
    for p in range(passes):
        before = objective(corpus, jobs)
        offset = width // 2 if p % 2 else 0
        starts = ([0] if offset else []) + list(range(offset, len(jobs), width))
        for start in starts:
            end = offset if start == 0 and offset else min(start + width, len(jobs))
            jobs[start:end] = exact_job_block(corpus, jobs[start:end])
        after = objective(corpus, jobs)
        assert after <= before + 1e-8
        print(f"  mixed DP {p+1}: {before:.6f} -> {after:.6f}", flush=True)
    return jobs


def evaluate(corpus, name, jobs):
    positions = [0] * len(corpus.entries)
    for step, (kind, wi) in enumerate(jobs, 1):
        if kind:
            positions[wi] = step
    stages = [50,100,200,300,500,1000,2000,3000,5000,10000,20000,40000,len(jobs)]
    stages = sorted(set(k for k in stages if k <= len(jobs)))
    progress = []
    for k in stages:
        learned = [i for i, pos in enumerate(positions) if pos <= k]
        row = {"学习总步数": k, "已学汉字数": sum(kind == 0 for kind, _ in jobs[:k]), "已学词条数":len(learned)}
        for n in [100,500,1000,3000,5000,10000]:
            row[f"前{n}词已学数"] = sum(corpus.entries[i]["rank"] <= n for i in learned)
        row["频序倒数权重覆盖率"] = math.fsum(corpus.weights[i] for i in learned) / corpus.total_weight
        progress.append(row)
    return {"方案":name, "加权平均词语出现步数":objective(corpus,jobs),"进度":progress,
            "完整覆盖前N词所需总步数":{str(n):max(pos for pos,r in zip(positions,corpus.entries) if r["rank"]<=n) for n in [100,500,1000,3000,5000,10000]}}


def audit(corpus, jobs):
    seen, words = set(), set()
    for kind, i in jobs:
        if not kind:
            assert i not in seen
            seen.add(i)
        else:
            assert i not in words and set(corpus.deps[i]) <= seen
            words.add(i)
    assert seen == set(range(len(corpus.chars)))
    assert words == set(range(len(corpus.entries)))


def export(corpus, jobs, source, output, comparisons, name, elapsed):
    output.mkdir(parents=True, exist_ok=True)
    audit(corpus,jobs)
    pinyin = collections.defaultdict(list)
    for row in corpus.entries:
        if len(row['word']) == 1 and is_han(row['word']) and row['pinyin'] not in pinyin[row['word']]:
            pinyin[row['word']].append(row['pinyin'])
    columns = ['学习序号','类型','字词','拼音','原词频序号','已学汉字数','组成汉字','前置汉字学习序号']
    rows, charrows, intro = [], [], {}
    word_steps = {wi:step for step,(kind,wi) in enumerate(jobs,1) if kind}
    for step,(kind,i) in enumerate(jobs,1):
        if not kind:
            c = corpus.chars[i]
            intro[c] = step
            rows.append(dict(zip(columns,[step,'汉字',c,' / '.join(pinyin[c]),'',len(intro),'',''])))
            upcoming = sorted(corpus.adj[i], key=lambda wi:word_steps[wi])[:5]
            charrows.append({'汉字序号':len(intro),'完整表学习序号':step,'汉字':c,'单字词原音':' / '.join(pinyin[c]),
                             '首次出现词频序号':corpus.first_rank[i], '后续词语示例':'、'.join(corpus.entries[wi]['word'] for wi in upcoming)})
        else:
            r = corpus.entries[i]
            deps = unique_han(r['word'])
            rows.append(dict(zip(columns,[step,'词语',r['word'],r['pinyin'],r['rank'],len(intro),
                                           ' '.join(deps),' '.join(str(intro[c]) for c in deps)])))
    write_tsv(output/'完整字词学习表.tsv',columns,rows)
    write_tsv(output/'汉字学习顺序.tsv',list(charrows[0]),charrows)
    final = evaluate(corpus,'最终方案',jobs)
    write_tsv(output/'分阶段覆盖.tsv',list(final['进度'][0]),final['进度'])
    comparison_rows = [{"方案":r['方案'],"加权平均词语出现步数":r['加权平均词语出现步数'],**p} for r in comparisons for p in r['进度']]
    write_tsv(output/'算法对比.tsv',list(comparison_rows[0]),comparison_rows)
    special=[{'原词频序号':r['rank'],'词语':r['word'],'拼音':r['pinyin'],'非汉字字符':' '.join(dict.fromkeys(c for c in r['word'] if not is_han(c)))} for r in corpus.entries if any(not is_han(c) for c in r['word'])]
    write_tsv(output/'含非汉字词条.tsv',list(special[0]),special)
    report={'优化口径':'每个汉字项和每个词语项均计一步；低频已解锁词语可以延后',
            '输入文件':str(source.resolve()),'输入SHA256':hashlib.sha256(source.read_bytes()).hexdigest(),
            '原词条数':len(corpus.entries),'不同汉字数':len(corpus.chars),'完整表行数':len(jobs),
            '同形词额外记录数':len(corpus.entries)-len(set(r['word'] for r in corpus.entries)),
            '含非汉字词条数':len(special),'权重指数':corpus.exponent,'选中算法':name,'运行秒数':elapsed,
            '校验':{'词条无遗漏无重复':True,'全部词语汉字前置':True,'汉字各引入一次':True},
            '最终方案':final,'算法对比':comparisons}
    (output/'校验与评估.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'workbook_data.json').write_text(json.dumps({'main':rows,'chars':charrows},ensure_ascii=False),encoding='utf-8')
    text=['汉语字词学习顺序（每个汉字、每个词语各计一步）','按序向下学习；词语后的 # 为原频序号。','']
    for r in rows:
        rank=f"  #{r['原词频序号']}" if r['类型']=='词语' else ''
        text.append(f"{r['学习序号']:>5}  {r['类型']}  {r['字词']}  {r['拼音']}{rank}")
    (output/'完整字词学习表.txt').write_text('\n'.join(text),encoding='utf-8-sig')
    return report


def main():
    root=Path(__file__).resolve().parent.parent
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=root/'现代汉语常用词表.tsv')
    parser.add_argument('--output',type=Path,default=root/'outputs/learning_order_20261021')
    parser.add_argument('--rank-exponent',type=float,default=1.0)
    parser.add_argument('--passes',type=int,default=4)
    args=parser.parse_args()
    if args.rank_exponent<=0 or args.passes<0:
        parser.error('rank-exponent 必须大于零，passes 必须非负')
    t=time.monotonic()
    corpus=Corpus.read(args.input,args.rank_exponent)
    candidates=[('按词频逐词补字基线',baseline(corpus))]
    for penalty,power in [(0.5,2),(0.75,2),(1,2),(1.25,2),(1.5,2),(2,2),(1,0)]:
        name=f'收益密度贪心 λ={penalty}, p={power}'
        jobs=density_order(corpus,penalty,power)
        audit(corpus,jobs)
        print(f'{name}: {objective(corpus,jobs):.6f}',flush=True)
        candidates.append((name,jobs))
    best=sorted(candidates,key=lambda v:objective(corpus,v[1]))[:3]
    for name,jobs in best:
        print(f'Refining {name}',flush=True)
        candidates.append((name+' + 字词窗口精确优化',refine_jobs(corpus,jobs,passes=args.passes)))
    name,jobs=min(candidates,key=lambda v:objective(corpus,v[1]))
    comparisons=[evaluate(corpus,n,j) for n,j in candidates]
    report=export(corpus,jobs,args.input,args.output,comparisons,name,round(time.monotonic()-t,3))
    print(json.dumps({'chosen':name,'baseline':comparisons[0]['加权平均词语出现步数'],'final':objective(corpus,jobs),
                      'first_50':[(('字' if not kind else '词'),corpus.chars[i] if not kind else corpus.entries[i]['word']) for kind,i in jobs[:50]],
                      'elapsed':report['运行秒数']},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    main()
