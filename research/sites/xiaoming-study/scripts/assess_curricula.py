"""Reproduce full-path metrics and prove base answers/identities are unchanged."""
from pathlib import Path
import csv,json,sys,math
from curriculum_order import Graph
ROOT=Path(__file__).resolve().parents[1];WORKSPACE=ROOT.parents[1]
def read(p):return json.loads(p.read_text(encoding='utf-8'))
result={}
for course,sub in [('simplified',''),('traditional','traditional')]:
    directory=ROOT/'dist/data'/sub;data=read(directory/'learning.json')
    graph=Graph(data['items']);baseline=graph.normalize(read(directory/'sources/order-v5.json'));current=graph.normalize([i['id'] for i in data['items']])
    assert math.isclose(graph.evaluate(current)['weightedLessons'],data['curriculum']['optimization']['selected']['weightedLessons'],abs_tol=1e-8)
    def curve(sequence):
        total=math.fsum(graph.weights.values());mass=0.;out={}
        for step,key in enumerate(sequence,1):
            mass+=graph.weights[key]
            if step in [50,100,300,500,1000,3000,5000,10000]:out[step]=mass/total
        return out
    anchors=[]
    old_ids=read(directory/'sources/order-v5.json')
    for text in ['學習','臺灣','一一','在在','好','我们','我們']:
        item=next((i for i in data['items'] if i['text']==text and i['type'] in ['char','word']),None)
        if item:anchors.append({'text':text,'frequency':item.get('frequency'),'previousPosition':old_ids.index(item['id'])+1,'currentPosition':item['order']})
    legacy=directory/'字根汉字词语学习表.tsv' if course=='simplified' else WORKSPACE/'outputs/traditional_learning_order_20261023/繁中聲母首筆字根字詞優序學習表.tsv'
    index={i['id']:i for i in data['items']};compared=0
    with legacy.open(encoding='utf-8-sig',newline='') as h:
        for row in csv.DictReader(h,delimiter='\t'):
            if row['type'] not in ['root','char','word']:continue
            item=index[int(row['ID'])]
            expected=(row.get('fullCode') or row['code']) if row['type']=='root' else row['code']
            assert item['text']==row['text'] and (item['code'] or '')==expected,(course,item['text'])
            compared+=1
    assert compared==data['stats']['characters']+data['stats']['words']+data['stats']['roots']
    report=data['curriculum']['optimization'];old=report['baseline'];new=report['selected']
    result[course]={'baseline':old,'selected':new,'lessonImprovementPercent':100*(1-new['weightedLessons']/old['weightedLessons']),
        'keystrokeImprovementPercent':100*(1-new['weightedKeystrokes']/old['weightedKeystrokes']),
        'baselineCoverage':curve(baseline),'currentCoverage':curve(current),'anchors':anchors,
        'baseAnswersAndIdentitiesCompared':compared,'baseAnswerChanges':0,
        'short':data['transferStats']['short'],'variants':data['transferStats']['variant'],
        'variantCodeChanges':sum(i['type']=='variant' and i['code']!=i['baseCode'] for i in data['transferItems']),
        'frequencyCorrections':data.get('frequencySource',{}).get('changes',[])}
path=ROOT/'artifacts/learning-v6-20261024/assessment.json';path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({key:{k:v for k,v in value.items() if k not in ['baselineCoverage','currentCoverage','anchors','frequencyCorrections']} for key,value in result.items()},ensure_ascii=False,indent=2))
