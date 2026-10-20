-- 재난 안전 게임 랭킹 보드 (지진해일에서 살아남기 · 지진에서 살아남기 함께 써요)
-- Supabase 대시보드 → SQL Editor → New query 에 전부 붙여 넣고 Run 을 누르세요.

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  nickname    text not null check (char_length(btrim(nickname)) between 1 and 8),
  grade       int  not null check (grade between 1 and 6),
  cls         int  not null check (cls between 1 and 10),
  hearts      int  not null check (hearts between 0 and 3),
  wrongs      int  not null check (wrongs between 0 and 60),
  hints       int  not null check (hints between 0 and 7),
  score       int  not null check (score between 0 and 1600),
  version     text,
  game        text not null default 'tsunami',  -- 어느 게임의 기록인지 (story.js 의 id)
  mini        int  not null default 0 check (mini between 0 and 200)   -- 3D 미니게임 감점
);

-- 이미 표를 만들었다면 이 줄이 'game' 칸을 더해 줘요 (기존 기록은 지진해일 게임으로 채워져요)
alter table public.scores add column if not exists game text not null default 'tsunami';
-- '지진에서 살아남기'의 3D 대피 미니게임 감점 칸 (지진해일 게임은 늘 0이에요)
alter table public.scores add column if not exists mini int not null default 0 check (mini between 0 and 200);

drop index if exists scores_rank_idx;
create index if not exists scores_rank_idx on public.scores (game, grade, cls, score desc, created_at);

-- 보안 규칙: 누구나 읽기와 새 기록 올리기만 가능 (고치기·지우기는 선생님만 대시보드에서)
alter table public.scores enable row level security;

drop policy if exists "read scores" on public.scores;
create policy "read scores" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "add score" on public.scores;
create policy "add score" on public.scores
  for insert to anon, authenticated
  with check ( score = greatest(0, 1000 + hearts*200 - wrongs*100 - hints*50 - mini) );
