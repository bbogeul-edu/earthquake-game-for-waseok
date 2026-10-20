/* =================================================================
   school.js — 와석초 건물 배치와 반별 대피로 (3D 대피 미니게임이 써요)
   - 교실 위치 자료는 '와석초 3D 배치도'(waseok.github.io/waseok-3d-map)의 rooms.json과 같아요.
   - 반별 대피로는 2026학년도 교실배치도(안)의 빨간 화살표를 옮긴 거예요.
   - 이 파일은 tools/build_school.py 가 만들어요. 고칠 때는 school.src.js 를 고치고 다시 만드세요.
   ================================================================= */
(function(root){
  // [층(0=1층), 색, 이름, [[x, z, 가로, 세로], ...]]  (단위: 배치도 칸, 1칸 ≈ 0.2m)
  const ROOMS = /*ROOMS*/[];

  /* ---------- 학교 공식 대피로 ----------
     계단 이름 → 배치도 자료의 계단 번호, 나가는 곳 */
  const STAIRS = {
    중앙: { id:'계단2', name:'중앙계단', exit:'중앙현관' },
    서편: { id:'계단3', name:'서편계단', exit:'서편현관' },
    동편: { id:'계단1', name:'동편계단', exit:'동편현관' },
    신관: { id:'계단4', name:'신관 계단', exit:'신관 로비' },
    별관: { id:'계단5', name:'별관 계단', exit:'별관 출구' }
  };
  const EVAC = {};
  const put = (stair, list)=>list.split(' ').forEach(c=>EVAC[c] = stair);
  put('중앙', '6-1 6-2 6-3 6-8 6-9 5-7 5-1 5-2 5-3');
  put('서편', '5-8 5-9 5-10 5-4 5-5 5-6 4-7 4-8 4-9');
  put('동편', '6-4 6-5 6-6 6-7 2-7 1-1 1-2 1-3');
  put('신관', '2-1 2-2 2-3 2-4 2-5 2-6 4-1 4-2 4-3 4-4 4-5 4-6');
  put('별관', '1-4 1-5 3-1 3-2 3-3 3-4 3-5 3-6 3-7 3-8 4-10 1-6 1-7');

  /* ---------- 칸 종류 ---------- */
  const C = { hall:'#d8d8d8', stair:'#ffb589', lift:'#a0b4e6', lobby:'#f6cfdc', piloti:'#faf2da', blank:'#ffffff', toilet:'#41c7f1' };
  const cells = [];   // 모든 칸 하나하나: {f, c, l, x, z, w, d, kind}
  ROOMS.forEach(([f, c, l, boxes], gi)=>boxes.forEach(([x, z, w, d])=>{
    let kind = 'room';
    if (c === C.hall || c === C.lobby || c === C.piloti || (c === C.blank && !l)) kind = 'walk';
    if (c === C.stair) kind = 'stair';
    if (c === C.lift) kind = 'lift';
    // 5층 중앙계단 앞: 배치도에는 안전체험관 칸과 붙어 그려져 있어서, 계단 앞 부분을 복도로 나눠요
    if (f === 4 && l === '안전체험관' && Math.abs(x - 223.6) < 1 && Math.abs(z - 0.4) < 1){
      cells.push({ f, c:C.hall, l:'', x, z, w:49.4, d, kind:'walk', gi });
      cells.push({ f, c, l, x:x+49.4, z, w:w-49.4, d, kind, gi });
      return;
    }
    cells.push({ f, c, l, x, z, w, d, kind, gi });
  }));

  const EPS = 0.9;
  // 두 칸이 맞닿아 있으면 맞닿은 선의 가운데를 돌려줘요
  function shared(a, b){
    if (Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS){
      const lo = Math.max(a.z, b.z), hi = Math.min(a.z + a.d, b.z + b.d);
      if (hi - lo > 2) return { x: Math.abs(a.x + a.w - b.x) < EPS ? b.x : a.x, z: (lo + hi)/2, len: hi - lo, axis:'x' };
    }
    if (Math.abs(a.z + a.d - b.z) < EPS || Math.abs(b.z + b.d - a.z) < EPS){
      const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
      if (hi - lo > 2) return { z: Math.abs(a.z + a.d - b.z) < EPS ? b.z : a.z, x: (lo + hi)/2, len: hi - lo, axis:'z' };
    }
    return null;
  }
  const mid = (c)=>({ x: c.x + c.w/2, z: c.z + c.d/2 });
  const dist = (a, b)=>Math.hypot(a.x - b.x, a.z - b.z);
  const isWalk = (c)=>c.kind === 'walk' || c.kind === 'stair';

  /* 반 하나의 대피 계획: 출발 교실, 지나갈 길, 도착 계단 */
  function plan(grade, cls){
    const key = `${grade}-${cls}`;
    const stairKey = EVAC[key];
    const roomCells = cells.filter(c=>c.l === key && c.kind === 'room');
    if (!stairKey || !roomCells.length) return null;
    const S = STAIRS[stairKey], f = roomCells[0].f;
    const floorCells = cells.filter(c=>c.f === f);
    const walk = floorCells.filter(isWalk);
    const goal = walk.find(c=>c.kind === 'stair' && c.l === S.id);
    if (!goal) return null;
    // 다익스트라: 교실에서 문으로 나가 복도를 따라 계단까지 (승강기와 다른 교실은 지나가지 않아요)
    const nodes = [...roomCells, ...walk];
    const d = new Map(nodes.map(n=>[n, Infinity])), prev = new Map(), via = new Map(), done = new Set();
    roomCells.forEach(n=>d.set(n, 0));
    while (true){
      let u = null, best = Infinity;
      for (const n of nodes) if (!done.has(n) && d.get(n) < best){ best = d.get(n); u = n; }
      if (!u || u === goal) break;
      done.add(u);
      for (const v of walk){
        if (done.has(v)) continue;
        // 다른 계단 칸은 지나가지 않아요 (계단은 도착할 때만)
        if (v.kind === 'stair' && v !== goal) continue;
        const m = shared(u, v); if (!m) continue;
        const nd = d.get(u) + dist(mid(u), m) + dist(m, mid(v));
        if (nd < d.get(v)){ d.set(v, nd); prev.set(v, u); via.set(v, m); }
      }
    }
    if (d.get(goal) === Infinity) return null;
    const chain = []; let n = goal; while (n){ chain.unshift(n); n = prev.get(n); }
    const start = chain[0];
    const path = [mid(start)];
    for (let i=1;i<chain.length;i++){ const m = via.get(chain[i]); path.push({x:m.x, z:m.z}); path.push(mid(chain[i])); }
    const door = via.get(chain[1]);
    return {
      key, grade, cls, floor: f, ground: f === 0,
      stair: S, goal, start, door, path: simplify(path),
      room: roomCells, floorCells,
      lifts: floorCells.filter(c=>c.kind === 'lift'),
      otherStairs: walk.filter(c=>c.kind === 'stair' && c !== goal)
    };
  }
  // 거의 일직선인 점은 빼요
  function simplify(p){
    const out = [p[0]];
    for (let i=1;i<p.length-1;i++){
      const a = out[out.length-1], b = p[i], c = p[i+1];
      const cross = (b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x);
      if (Math.abs(cross) > 1 && dist(a,b) > .5) out.push(b);
    }
    out.push(p[p.length-1]);
    return out;
  }

  // 없는 반(예: 2학년 8반)을 고르면 같은 학년 첫 반, 그래도 없으면 2학년 6반에서 출발해요
  const cache = {};
  function planFor(grade, cls){
    const k = grade + '-' + cls;
    if (cache[k]) return cache[k];
    let p = plan(grade, cls), fallback = false;
    if (!p){
      fallback = true;
      for (let c=1; c<=10 && !p; c++) p = plan(grade, c);
      if (!p) p = plan(2, 6);
    }
    return cache[k] = Object.assign(p, { fallback });
  }

  root.SCHOOL = { ROOMS, cells, STAIRS, EVAC, C, shared, plan, planFor, mid, dist,
                  classes: Object.keys(EVAC) };
})(typeof window !== 'undefined' ? window : globalThis);
