"""Enrich existing courses without changing source IDs, order or character/word codes."""
from __future__ import annotations
import csv
import hashlib
import json
import math
from pathlib import Path
from mapping_curriculum import initial_of

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[1]

def han(text):
    return len(text) == 1 and (0x3400 <= ord(text) <= 0x9fff or 0x20000 <= ord(text) <= 0x323af)

def refresh_curriculum_metadata(data):
    """Describe and count the active course, including after TC selection.

    This runs after ordering and never changes IDs, positions or code answers.
    """
    items = data['items']
    index = {item['id']: item for item in items}
    roots = {item['id']: item for item in items if item['type'] == 'root'}
    root_ids = {item['text']: item['id'] for item in roots.values()}
    uses = {identifier: set() for identifier in roots}
    for item in items:
        if item['type'] in {'char', 'word'}:
            for part in item['parts']:
                for root in part['division']:
                    uses[root_ids[root]].add(item['id'])
    traditional = data.get('course') == 'traditional'
    full_dag = data['curriculum'].get('algorithm') == 'shared-full-prerequisite-dag-v1'
    def weight(identifier):
        if full_dag:
            item=index[identifier]
            if not item.get('code'):return 0
            ranks=[int(rank.strip()) for rank in item.get('sourceFrequency','').split('/') if rank.strip()] or ([item['frequency']] if item.get('frequency') else [])
            return math.fsum(1/rank for rank in ranks)
        return 1 / max(1, index[identifier].get('frequency') or 163747) if traditional else 1 / math.log2(identifier + 2)
    for lesson in items:
        if lesson['type'] not in {'initial', 'stroke'}:
            continue
        affected = [root for root in roots.values() if (
            root['mapping']['initial'] == lesson['initial'] if lesson['type'] == 'initial'
            else root['mapping']['strokeKey'] == lesson['strokeKey'])]
        identifiers = set().union(*(uses[root['id']] for root in affected))
        lesson['coverageCount'] = len(identifiers)
        lesson['coverageScore'] = math.fsum(weight(identifier) for identifier in sorted(identifiers))
        lesson['rootCount'] = len(affected)
        first = min((index[identifier] for identifier in identifiers if index[identifier]['type'] == 'char'),
                    key=lambda item: item['order'], default=None)
        lesson['firstNeededSourceId'] = first['sourceId'] if first else None
    curriculum = data['curriculum']
    curriculum['tableColumns']['order'] = f"课程实际位置（连续 1..{len(items)}）"
    curriculum['tableColumns']['ID'] = '稳定学习标识，独立于课程位置；筛选和移除旧规则课后允许不连续。'
    curriculum['tableColumns']['sourceId'] = '原表学习序号；映射和字根为空'
    curriculum['extensionRationale'] = '当前课程字词未使用这些字根；保留为完整字根表扩展，在全部当前字词之后学习。'
    if not full_dag:
        curriculum['rootWeighting'] = ('Sum 1 / (frequency rank or 163747) over distinct active character/word uses.' if traditional
                                       else 'Sum 1 / log2(sourceId + 2) over distinct original character/word uses.')
    if traditional and not full_dag:
        curriculum['ranking'] = 'Within each character, required roots are inserted by descending active weighted coverage, then stable root ID. Shared mapping lessons follow each root dependency order and are inserted once before use.'

def enrich_lessons(data, divisions=None):
    removed = {item['id'] for item in data['items'] if item['type'] == 'rule'}
    items = data['items'] = [item for item in data['items'] if item['id'] not in removed]
    for order,item in enumerate(items,1):
        item['dependencies'] = [identifier for identifier in item['dependencies'] if identifier not in removed]
        item['order'] = order
    data['stats']['total'] = len(items)
    data['stats'].pop('rules',None)
    characters = [item for item in items if item['type'] == 'char' and han(item['text']) and item.get('code')]
    roots = [item for item in items if item['type'] == 'root']
    root_by_text = {item['text']: item for item in roots}
    by_shape = {}
    for item in characters:
        for root in set(item['parts'][0]['division']):
            if root != item['text']:
                by_shape.setdefault(root, []).append(item)
    strokes = {'一','丨','丿','丶','乙','乛','亅','㇐','㇑','㇒','㇔','㇜','㇕'}
    def sample(item):
        return {key:item[key] for key in ('text','pinyin','zhuyin') if item.get(key)}
    for root in roots:
        root['code'] = root['fullCode']
        root.pop('answerRole', None)
        examples = [sample(item) for item in by_shape.get(root['text'], [])[:3]]
        if divisions and len(examples) < 3:
            used = {entry['text'] for entry in examples} | {root['text']}
            for text, part in divisions.items():
                if han(text) and text not in used and root['text'] in part.get('d', ''):
                    examples.append({'text':text,'source':'official-division'});used.add(text)
                    if len(examples) == 3:
                        break
        root['examples'] = examples
    aliases = 0
    for item in characters:
        root = root_by_text.get(item['text'])
        if root and root['fullCode'] == item['code']:
            item['practiceAlias'] = root['id'];aliases += 1
        else:
            item.pop('practiceAlias', None)
    for lesson in items:
        if lesson['type'] == 'initial':
            lesson['text'] = '零声母' if lesson['initial'] == '0' else '/'.join(lesson['symbols'])
            examples = [item for item in roots if item['mapping']['initial'] == lesson['initial']]
        elif lesson['type'] == 'stroke':
            examples = [item for item in roots if item['text'] not in strokes and item['mapping']['strokeKey'] == lesson['strokeKey']]
        else:
            continue
        examples.sort(key=lambda item:(item.get('firstNeededSourceId') or float('inf'),item['text']))
        lesson['examples'] = [sample(item)|{'rootId':item['id']} for item in examples[:3]]
        assert lesson['examples'], (lesson['type'],lesson['text'])
    data['lessonVersion'] = 'root-foundations-v5'
    if data['curriculum'].get('algorithm') != 'shared-full-prerequisite-dag-v1':
        data['curriculumVersion'] = 'sound-stroke-fullASB-char-word-v5' + ('-curated' if data.get('course') == 'traditional' else '')
    curriculum = data['curriculum']
    curriculum['rootPractice'] = '完整 ASB；同形同码汉字通过 practiceAlias 共用字根练习和复习，不重复出题。'
    curriculum['sharedCharacterLessons'] = aliases
    curriculum['foundationLessons'] = 27
    curriculum['silentRootRule'] = '无读音字根的小码同补码；并入字根初识，不另设规则课。'
    curriculum['practiceUnits'] = sum(bool(item.get('code')) and not item.get('practiceAlias') for item in items)
    curriculum['tableColumns']['code'] = '比较与输入用的小写编码；字根使用完整三位 ASB'
    if data.get('course') != 'traditional' and data['curriculum'].get('algorithm') != 'shared-full-prerequisite-dag-v1':
        curriculum['sourceOrderPolicy'] = '原字词 ID 与相对顺序保留；字根按需插入；同形同码汉字保留查阅身份并与字根共用练习。'
    refresh_curriculum_metadata(data)
    return {'sharedCharacters':aliases,'rootExamples':sum(bool(item['examples']) for item in roots),'rootsWithoutExamples':[item['text'] for item in roots if not item['examples']]}

def run():
    divisions = json.loads((WORKSPACE / '潇明码表' / 'chaifen.json').read_text(encoding='utf-8-sig'))
    for directory in [PROJECT/'dist/data',PROJECT/'dist/data/traditional']:
        path = directory/'learning.json';data = json.loads(path.read_text(encoding='utf-8'))
        retired = data.pop('retiredItems',None)
        if retired:
            archive = directory/'archive'
            archive.mkdir(exist_ok=True)
            (archive/'retired-items.json').write_text(json.dumps(retired,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        report = enrich_lessons(data, divisions)
        path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
        table = directory/data['curriculum']['table']
        with table.open(encoding='utf-8-sig',newline='') as handle:
            reader = csv.DictReader(handle,delimiter='\t');fields = reader.fieldnames;rows = list(reader)
        index = {item['id']:item for item in data['items']}
        rows = [row for row in rows if int(row['ID']) in index]
        for row in rows:
            item = index[int(row['ID'])]
            row['order'] = item['order'];row['text'] = item['text']
            row['dependencies IDs'] = ' '.join(map(str,item['dependencies']))
            if item['type'] == 'root':
                row['code'] = item['code'];row['displayCode'] = item['code'][0].upper()+item['code'][1:]
        with table.open('w',encoding='utf-8-sig',newline='') as handle:
            writer = csv.DictWriter(handle,fieldnames=fields,delimiter='\t',lineterminator='\n');writer.writeheader();writer.writerows(rows)
        coverage = directory/'coverage.tsv'
        with coverage.open(encoding='utf-8-sig',newline='') as handle:
            reader = csv.DictReader(handle,delimiter='\t');fields = reader.fieldnames;rows = list(reader)
        rows = [row for row in rows if int(row['学习ID']) in index]
        for row in rows:
            item = index[int(row['学习ID'])]
            row['编码'] = item.get('code') or ''
            row['课程顺序'] = item['order'];row['字词'] = item['text']
        with coverage.open('w',encoding='utf-8-sig',newline='') as handle:
            writer = csv.DictWriter(handle,fieldnames=fields,delimiter='\t',lineterminator='\n');writer.writeheader();writer.writerows(rows)
        meta_path = directory/'metadata.json';metadata = json.loads(meta_path.read_text(encoding='utf-8'))
        metadata.update({'stats':data['stats'],'supported':data['stats']['total']-data['stats']['unsupported'],'curriculum':data['curriculum'],'curriculumVersion':data['curriculumVersion'],'lessonPresentation':report,'learningBytes':path.stat().st_size,'learningSha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        metadata['codeRules']['root'] = '掌握对应声母与首笔映射后，输入完整 ASB；同形同码汉字与字根共用练习，原 ID 和字词顺序保留。'
        metadata['ordering'] = '声母/首笔映射→完整字根 ASB→汉字→词语；无读音规则并入字根初识。'
        if data.get('course') == 'traditional':
            metadata['frequencyPolicy'] = 'frequency 保留原综合频序；稳定 ID 不随筛选与重排改变，当前课程按混合字词步数优化结果排序。'
        metadata['downloads']['curriculum']['sha256'] = hashlib.sha256(table.read_bytes()).hexdigest()
        metadata['downloads']['curriculum']['rows'] = len(data['items'])
        meta_path.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(directory.name,report,flush=True)

if __name__ == '__main__':
    run()
    from build_curricula import build_and_validate
    build_and_validate()
