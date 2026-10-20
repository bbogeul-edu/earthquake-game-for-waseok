# 새 재난 안전 게임 만들기 (같은 틀, 다른 이야기)

이 저장소는 **엔진(engine.js)** 과 **이야기(story.js)** 가 나뉘어 있어요.
새 게임은 이 저장소를 복사한 뒤 `story.js` 와 `img/` 만 바꾸면 돼요.

## 파일 구성
| 파일 | 하는 일 | 새 게임에서 |
|---|---|---|
| `index.html` | 화면 모양(HTML·CSS) | 그대로 |
| `engine.js` | 대본 실행, 하트·세이브, 뒤로/건너뛰기/다시, 진행 막대, 효과음·음악, 배경 움직임, 랭킹 | 그대로 |
| `story.js` | 제목, 학교, 등장인물, 카드뉴스, 안전수칙, 배경 목록, 배경 움직임 좌표, 대본 | **새로 써요** |
| `img/*.jpg` | 배경 그림 (1264×848 정도, 3:2) | **새로 만들어요** |
| `img/face/*.jpg` | 인물 얼굴 192×192 (`sw.jpg`, `sw_cry.jpg` …) | 같은 인물이면 그대로 |
| `supabase/schema.sql` | 랭킹 표 | 같은 Supabase를 쓰면 그대로 |

## story.js 에서 바꿀 것
1. `STORY.id` — 영어 이름 (예: `earthquake`). 랭킹이 게임별로 나뉘어요.
2. `title`, `titleHTML`, `kicker`, `school`, `badges`, `hint`, `startCard`, `moreInfoCard`, `state`
3. 카드뉴스 `CARDS`, 안전수칙 `RULES`, 등장인물 `PEOPLE`, 표정 `FACES`
4. `backgrounds` 목록과 `STORY.anim` (반짝임·비·바람·물보라·불꽃·경광등·갈매기 좌표)
5. `STORY.script` 대본

## 대본 도구
- `N('내레이션')`, `S('sw:cry', '대사', '행동지문')` — 표정은 `scared / worried / cry / shock` 등
- `BG('beach')`, `FX('shake'|'stop'|'tremble'|'wave'|'white'|'slow')`
- `SAVE(장번호, '장 제목')` — 장 시작 = 자동 저장, 진행 막대 한 칸
- `SFX('crash')`, `AMB('beach')`, `MUS('tension'|'sad'|'hope'|'none')`
- `C({ id, q, hint, card, opts:[...] })` — 선택지
  - 정답 `{ ok:true, text, res:[결과 + 칭찬 대사] }`
  - 오답 `{ text, res:[결과 장면], fb:'왜 위험한지', after:[친구들 대화: 남 탓, 앞으로는 이렇게] }`
  - `practice:true` 연습(하트 없음), `unscored:true` 하트 없음, `timer:10` 시간제한 + `timeout:{res, fb}`
- `IF(s=>조건, [줄들])`, `CARD('t2')`
- 글 속 `{이름}아 / {이름}이 / {이름}을 / {이름}은 / {이름}의`, `{학교} {학년} {반}`

## 선택지 쓰는 원칙
- 정답·오답 모두 **같은 말투의 행동 문장**, 따옴표 없이, 길이 비슷하게 (±4자)
- 오답에도 그럴듯한 이유를 붙여요 ("엄마가 걱정하실 테니 …")
- 정답이면 주인공이 이유를 말하고 친구가 칭찬해요
- 성훈이는 끝까지 사과하지 않고 남 탓을 해요

## 점수
기본 1000 + 남은 하트×200 − 틀린 횟수×100 − 힌트×50

## 이 게임(지진에서 살아남기)에서 더한 대본 도구
- `MINI('evac')` — 미니게임 한 판. `STORY.mini.evac`(quake3d.js)를 실행하고, 끝나면 감점을 점수에 더해요 (최대 200점).
  뒤로가기로 미니게임 앞으로는 돌아갈 수 없어요.
- 선택지에 `when: s=>조건` — 그 조건일 때만 나오는 선택지 (예: 1장에서 고른 자리별 오답).
- 배경 소리 `AMB('room')`(조용한 교실), `AMB('yard')`(운동장).
