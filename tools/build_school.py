"""school.src.js 에 교실 위치 자료를 넣어 school.js 를 만들어요.
사용법: python tools/build_school.py <rooms.json 경로>
rooms.json 은 와석초 3D 배치도 저장소(waseok/waseok-3d-map)의 data/rooms.json 이에요."""
import json, sys, pathlib
here = pathlib.Path(__file__).resolve().parent.parent
rooms = json.load(open(sys.argv[1], encoding='utf-8'))
slim = [[x['f'], x['c'], x['l'], [[round(v, 1) for v in b] for b in x['b']]] for x in rooms]
src = (here / 'school.src.js').read_text(encoding='utf-8')
out = src.replace('/*ROOMS*/[]', json.dumps(slim, ensure_ascii=False, separators=(',', ':')))
(here / 'school.js').write_text(out, encoding='utf-8')
print('school.js', len(out), 'bytes,', len(slim), 'rooms')
