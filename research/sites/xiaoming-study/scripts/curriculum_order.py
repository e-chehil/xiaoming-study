"""Shared full prerequisite DAG optimizer; rank reciprocals are priorities, not timings."""
from collections import defaultdict
import heapq
import math

class Graph:
    def __init__(self, items):
        self.original = items
        self.index = {i['id']: i for i in items}
        self.canonical = {i['id']: i.get('practiceAlias') or i['id'] for i in items}
        self.items = {i['id']: i for i in items if i.get('code') and not i.get('practiceAlias')}
        self.deps = {k: {self.canonical[d] for d in i['dependencies']} - {k} for k,i in self.items.items()}
        assert all(d in self.items for ds in self.deps.values() for d in ds)
        self.weights = dict.fromkeys(self.items, 0.0)
        self.rank = dict.fromkeys(self.items, math.inf)
        for i in items:
            if i['type'] not in {'char','word','short','variant'} or not i.get('code'): continue
            k = self.canonical[i['id']]
            rs = [int(r.strip()) for r in i.get('sourceFrequency','').split('/') if r.strip()] or ([i['frequency']] if i.get('frequency') else [])
            self.weights[k] += math.fsum(1/r for r in rs)
            self.rank[k] = min(self.rank[k],min(rs,default=math.inf))
        self.closures = {}
        for k in self.items: self.closure(k)

    def closure(self, k, visiting=None):
        if k not in self.closures:
            visiting = (visiting or set()) | {k}
            assert not self.deps[k] & visiting, 'Cyclic curriculum'
            self.closures[k] = frozenset({k}.union(*(self.closure(d,visiting) for d in self.deps[k])))
        return self.closures[k]

    def normalize(self, sequence):
        out,known = [],set()
        def visit(k):
            k = self.canonical[k]
            if k in known or k not in self.items: return
            for d in sorted(self.deps[k],key=lambda x:(self.index[x].get('order',x),x)): visit(d)
            known.add(k);out.append(k)
        for k in sequence: visit(k)
        for k in self.items: visit(k)
        self.audit(out)
        return out

    def audit(self, sequence):
        assert len(sequence)==len(self.items) and set(sequence)==set(self.items)
        known=set()
        for k in sequence:
            assert self.deps[k]<=known,k
            known.add(k)

    def evaluate(self, sequence):
        total=math.fsum(self.weights.values())
        elapsed=0;steps=[];keys=[]
        for pos,k in enumerate(sequence,1):
            elapsed+=len(self.items[k]['code'])
            steps.append(self.weights[k]*pos);keys.append(self.weights[k]*elapsed)
        return {'weightedLessons':math.fsum(steps)/total,'weightedKeystrokes':math.fsum(keys)/total,'practiceUnits':len(sequence)}

    def density(self, power=1):
        targets=[k for k in self.items if self.weights[k]>0]
        inverse=defaultdict(list);remaining={};benefit={};downstream=dict.fromkeys(self.items,0.)
        for t in targets:
            closure=self.closure(t);remaining[t]=len(closure)
            benefit[t]=math.fsum(self.weights[k] for k in closure)
            for k in closure:
                inverse[k].append(t);downstream[k]+=self.weights[t]
        versions=dict.fromkeys(targets,0)
        heap=[(-benefit[k]/remaining[k]**power,self.rank[k],k,0) for k in targets]
        heapq.heapify(heap);out=[];known=set()
        while heap:
            _,_,target,version=heapq.heappop(heap)
            if target in known or version!=versions[target]:continue
            ready=[k for k in self.closure(target) if k not in known and self.deps[k]<=known]
            assert ready
            k=min(ready,key=lambda x:(-downstream[x],self.rank[x],x))
            out.append(k);known.add(k)
            for t in inverse[k]:
                if t in known:continue
                remaining[t]-=1;benefit[t]-=self.weights[k];versions[t]+=1
                heapq.heappush(heap,(-max(0,benefit[t])/remaining[t]**power,self.rank[t],t,versions[t]))
        return self.normalize(out)

    def exact_block(self, block):
        size=1<<len(block);bits={k:1<<j for j,k in enumerate(block)}
        required=[sum(bits.get(d,0) for d in self.deps[k]) for k in block]
        dp=[math.inf]*size;last=[0]*size;dp[0]=0.
        for mask in range(1,size):
            choices=mask;pos=mask.bit_count()
            while choices:
                bit=1<<(choices.bit_length()-1);choices^=bit;j=bit.bit_length()-1;prev=mask^bit
                if required[j]&prev!=required[j]:continue
                value=dp[prev]+self.weights[block[j]]*pos
                if value<dp[mask]-1e-14:dp[mask]=value;last[mask]=bit
        mask=size-1;out=[]
        while mask:
            bit=last[mask];assert bit
            out.append(block[bit.bit_length()-1]);mask^=bit
        return list(reversed(out))

    def refine(self, sequence, width=8, passes=4):
        sequence=sequence.copy()
        for p in range(passes):
            offset=width//2 if p%2 else 0
            for start in ([0] if offset else [])+list(range(offset,len(sequence),width)):
                end=offset if start==0 and offset else min(start+width,len(sequence))
                sequence[start:end]=self.exact_block(sequence[start:end])
            self.audit(sequence)
            print(' full DAG DP',p+1,self.evaluate(sequence)['weightedLessons'],flush=True)
        return sequence

    def expand(self, sequence):
        aliases=defaultdict(list)
        for i in self.original:
            if i.get('practiceAlias'):aliases[i['practiceAlias']].append(i)
        out=[]
        for k in sequence:
            out.append(self.index[k]);out.extend(sorted(aliases[k],key=lambda i:i['id']))
        out.extend(i for i in self.original if not i.get('code'))
        assert len(out)==len(self.original)
        for pos,i in enumerate(out,1):i['order']=pos
        positions={i['id']:i['order'] for i in out}
        assert all(positions[d]<i['order'] for i in out for d in i['dependencies'])
        return out

def optimize(items):
    g=Graph(items);old=g.normalize([i['id'] for i in items])
    candidates=[('previous-delivered-order',old),('rank-first-prerequisite-closure',g.normalize(sorted(g.items,key=lambda k:(g.rank[k],k))))]
    for p in [.75,1.,1.25,1.5]:
        seq=g.density(p);candidates.append((f'full-dag-density-p{p}',seq))
        print(candidates[-1][0],g.evaluate(seq),flush=True)
    for name,seq in sorted(candidates,key=lambda pair:(g.evaluate(pair[1])['weightedLessons'],pair[0]))[:2]:
        candidates.append((name+'+exact-dp8x4',g.refine(seq)))
    name,seq=min(candidates,key=lambda pair:(g.evaluate(pair[1])['weightedLessons'],pair[0]))
    report={'version':1,'algorithm':'shared-full-prerequisite-dag-v1','chosen':name,
        'objective':'Minimize sum(rank-reciprocal lexical weight * independently practised lesson completion position). Includes mapping/root cost; aliases cost once.',
        'parameters':{'densityPowers':[.75,1.,1.25,1.5],'exactWindow':8,'passes':4,'refinedCandidates':2},
        'baseline':g.evaluate(old),'selected':g.evaluate(seq),
        'comparison':[{'name':n,**g.evaluate(s)} for n,s in candidates],
        'limits':'Heuristic and local exact optimization, not global optimum or measured learner time.'}
    return g.expand(seq),report
