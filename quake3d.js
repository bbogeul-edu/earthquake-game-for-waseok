/* =================================================================
   quake3d.js — 3D 대피 미니게임 (지진에서 살아남기 3장)
   아이가 고른 반의 교실에서 출발해, 학교 공식 대피 계단까지 1인칭으로 걸어가요.
   - 건물 모양: school.js (와석초 3D 배치도 자료)
   - 실수(창문 가까이, 떨어진 물건 밟기, 승강기, 머리 보호 안 함, 계단 뛰기)는
     하트 대신 점수만 50점씩 깎여요. 엔진이 모두 합쳐 최대 200점까지만 깎아요.
   - 읽는 순서: ① 설정 → ② 화면(HTML) → ③ 건물 만들기 → ④ 움직이기·부딪히기
               → ⑤ 사건(창문·물건·승강기·여진·계단) → ⑥ 끝내기
   ================================================================= */
const Quake3D = (()=>{
  /* ① 설정 (단위: 배치도 칸, 1칸 ≈ 0.2m) */
  const EYE = 6.2, CROUCH = 3.4, CEIL = 14;    // 눈높이(초등학생), 앉은 눈높이, 천장 높이
  const R = 1.6;                                // 몸 반지름 (벽에 부딪히는 거리)
  const SPEED = 10, TURN = 1.9;                 // 걷는 빠르기(칸/초), 도는 빠르기(라디안/초)
  const PEN = 50;                               // 실수 한 번 감점
  const WINDOW_NEAR = 2.8;                      // 창문에 이만큼 가까워지면 위험
  const COL = { hall:'#d7cfbf', room:'#c99f6c', ceil:'#f4f2ec', wall:'#ece6da', classWall:'#e3efe4',
                toilet:'#d6ebf3', glass:'#a9d4f2', frame:'#8c9aa6', go:'#14a06a', lift:'#9aa8b9', stair:'#e7b48d' };

  const $ = (id)=>document.getElementById(id);
  const clamp = (v,a,b)=>Math.max(a, Math.min(b, v));
  const rnd = (a,b)=>a + Math.random()*(b-a);

  /* ② 화면(HTML): 처음 한 번만 만들어 두고 다시 써요 */
  function buildUI(){
    if ($('mini')) return;
    const d = document.createElement('div');
    d.id = 'mini'; d.hidden = true;
    d.innerHTML = `
      <div id="m3d"></div>
      <div id="mShade"></div>
      <div id="mTop">
        <div id="mGoal"></div>
        <div id="mPen" hidden></div>
      </div>
      <canvas id="mMap" width="300" height="300" aria-label="작은 지도"></canvas>
      <div id="mPoint" hidden>➜</div>
      <div id="mBag" hidden>🎒</div>
      <div id="mSay" hidden><div class="ava" id="mAva"></div><div><b id="mWho"></b><p id="mTxt"></p></div></div>
      <div id="mJoy" aria-label="움직이기"><i id="mKnob"></i><span>움직이기</span></div>
      <button id="mProtect" hidden>머리 보호!</button>
      <div id="mFlash"></div>
      <div class="mPanel" id="mIntro" hidden></div>
      <div class="mPanel" id="mAsk" hidden></div>
      <div class="mPanel" id="mEnd" hidden></div>`;
    document.body.appendChild(d);
  }

  /* 글자 그림 (표지판·교실 이름) */
  function labelTex(text, {bg='#ffffff', fg='#1b2433', size=56, pad=22, border=null}={}){
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const font = `bold ${size}px "Jua","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    g.font = font; const w = Math.ceil(g.measureText(text).width) + pad*2, h = size + pad*1.4;
    c.width = w; c.height = h; g.font = font;
    g.fillStyle = bg; roundRect(g, 0, 0, w, h, 14); g.fill();
    if (border){ g.lineWidth = 6; g.strokeStyle = border; roundRect(g, 3, 3, w-6, h-6, 12); g.stroke(); }
    g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, w/2, h/2 + 2);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
    return { tex: t, aspect: w/h };
  }
  function roundRect(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x+r, y); g.arcTo(x+w, y, x+w, y+h, r); g.arcTo(x+w, y+h, x, y+h, r); g.arcTo(x, y+h, x, y, r); g.arcTo(x, y, x+w, y, r); g.closePath(); }
  function sprite(text, h, opts){
    const { tex, aspect } = labelTex(text, opts);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    s.scale.set(h*aspect, h, 1); return s;
  }
  // 바닥 타일 무늬
  function gridTex(base, line, n=4){
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0,0,64,64); g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(1,1,62,62);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  // 초록 바닥 화살표 (대피 유도 스티커)
  function arrowTex(){
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = 'rgba(20,160,106,.92)'; g.beginPath(); g.moveTo(64,8); g.lineTo(118,62); g.lineTo(88,62); g.lineTo(88,120); g.lineTo(40,120); g.lineTo(40,62); g.lineTo(10,62); g.closePath(); g.fill();
    g.strokeStyle = '#eafff4'; g.lineWidth = 6; g.stroke();
    return new THREE.CanvasTexture(c);
  }
  // 비상구 표지판 (달리는 사람 그림)
  function exitSign(text){
    const c = document.createElement('canvas'); c.width = 360; c.height = 120; const g = c.getContext('2d');
    g.fillStyle = COL.go; roundRect(g, 0, 0, 360, 120, 10); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.arc(62, 28, 11, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.moveTo(58,44); g.lineTo(50,72); g.lineTo(30,98); g.moveTo(50,72); g.lineTo(72,92); g.lineTo(80,108);
    g.moveTo(56,52); g.lineTo(36,62); g.moveTo(56,52); g.lineTo(78,58); g.stroke();
    g.font = 'bold 50px "Jua","Malgun Gothic",sans-serif'; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 108, 64);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t })); s.scale.set(6, 2, 1); return s;
  }

  /* 사람이 부르는 이름 (교실·특별실) */
  const NICE = { '화(남)':'남자 화장실', '화(여)':'여자 화장실', '교화(남)':'교직원 화장실', '교화(여)':'교직원 화장실', '장.화':'화장실', '승':'승강기' };
  const nice = (l)=>NICE[l] || l;

  /* ===== 게임 한 판 ===== */
  function run(ctx){
    buildUI();
    return new Promise(resolve=>new Game(ctx, resolve));
  }

  class Game {
    constructor(ctx, resolve){
      this.ctx = ctx; this.resolve = resolve;
      const st = ctx.state;
      this.plan = SCHOOL.planFor(st.grade, st.cls);
      this.mistakes = []; this.penalty = 0;
      this.flags = {};
      this.input = { f:0, t:0 }; this.keys = {};
      this.mode = 'intro';          // intro → walk → (shake) → ask → down → end
      this.auto = !!Quake3D.debug.auto;
      this.t = 0; this.lastProgress = 0; this.lastProgressT = 0;
      $('mini').hidden = false;          // 먼저 보이게 해야 화면 크기를 잴 수 있어요
      this.setup3D(); this.buildLevel(); this.bindInput();
      this.updateTop();
      this.showIntro();
      this.last = performance.now();
      this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
      Quake3D.debug.game = this;
    }

    /* ---------- ③ 건물 만들기 ---------- */
    setup3D(){
      const host = $('m3d');
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      host.innerHTML = ''; host.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#bfe0f5');           // 창밖 하늘
      this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 700);
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9ad98, 0.95));
      const sun = new THREE.DirectionalLight(0xfff3dc, 0.35); sun.position.set(-40, 80, 30); this.scene.add(sun);
      this.onResize = ()=>{ const w = host.clientWidth, h = host.clientHeight; this.renderer.setSize(w, h); this.camera.aspect = w/h; this.camera.updateProjectionMatrix(); };
      addEventListener('resize', this.onResize); this.onResize();
    }

    buildLevel(){
      const P = this.plan, own = new Set(P.room);
      this.own = own;
      // 걸을 수 있는 칸: 복도, 계단, 승강기, 우리 교실
      this.walk = [...P.floorCells.filter(c=>c.kind === 'walk' || c.kind === 'stair' || c.kind === 'lift'), ...P.room];
      this.rooms = P.floorCells.filter(c=>c.kind === 'room' && !own.has(c));
      const inside = (c, x, z, e=0)=> x >= c.x - e && x <= c.x + c.w + e && z >= c.z - e && z <= c.z + c.d + e;
      this.inside = inside;
      const walkAt = (x, z, e=.1)=>this.walk.find(c=>inside(c, x, z, e));
      const roomAt = (x, z)=>this.rooms.find(c=>inside(c, x, z, .1));
      this.walkAt = walkAt;
      // 우리 교실 문: 복도와 맞닿은 벽마다 앞문·뒷문 (너비 6칸)
      this.doors = [];
      for (const A of P.room) for (const B of this.walk){
        if (own.has(B)) continue;
        const m = SCHOOL.shared(A, B); if (!m) continue;
        const lo = m.axis === 'z' ? m.x - m.len/2 : m.z - m.len/2, hi = lo + m.len;
        const centers = m.len < 20 ? [(lo + hi)/2] : [lo + m.len*.2, hi - m.len*.2];
        for (const c of centers) this.doors.push({ axis: m.axis, line: m.axis === 'z' ? m.z : m.x, c, half: 3,
          x: m.axis === 'z' ? c : m.x, z: m.axis === 'z' ? m.z : c, room: A });
      }
      const inDoor = (x, z)=>this.doors.some(d=>d.axis === 'z' ? Math.abs(z - d.line) < 1.2 && Math.abs(x - d.c) < d.half
                                                          : Math.abs(x - d.line) < 1.2 && Math.abs(z - d.c) < d.half);

      const M = (color, extra={})=>new THREE.MeshLambertMaterial({ color, ...extra });
      const mats = {
        hall: M('#ffffff', { map: (()=>{ const t = gridTex(COL.hall, '#c3baa8'); return t; })() }),
        room: M(COL.room), lift: M(COL.lift), ceil: M(COL.ceil, { side: THREE.DoubleSide }),
        wall: M(COL.wall, { side: THREE.DoubleSide }), classWall: M(COL.classWall, { side: THREE.DoubleSide }),
        toilet: M(COL.toilet, { side: THREE.DoubleSide }), frame: M(COL.frame), door: M('#9a7552'), steel: M('#b8c2cc'),
        glass: new THREE.MeshLambertMaterial({ color: COL.glass, transparent: true, opacity: .32, side: THREE.DoubleSide, emissive: '#7fb4d8', emissiveIntensity: .25 }),
        stair: M(COL.stair), rail: M('#6b7480'), board: M('#2f5a46')
      };
      this.mats = mats;
      const add = (geo, mat, x, y, z, ry=0, rx=0)=>{ const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); this.scene.add(m); return m; };
      this.add = add;

      // 바닥과 천장
      for (const c of this.walk){
        const cx = c.x + c.w/2, cz = c.z + c.d/2;
        if (c.kind !== 'stair'){
          let mat = c.kind === 'lift' ? mats.lift : own.has(c) ? mats.room : mats.hall;
          if (mat === mats.hall){ mat = mat.clone(); mat.map = mats.hall.map.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(c.w/5, c.d/5); }
          add(new THREE.PlaneGeometry(c.w, c.d), mat, cx, 0, cz, 0, -Math.PI/2);
        }
        add(new THREE.PlaneGeometry(c.w, c.d), mats.ceil, cx, CEIL, cz, 0, Math.PI/2);
      }

      // 벽: 칸의 네 변을 1칸씩 살펴서, 바깥이 걸을 수 없는 곳이면 벽을 세워요
      this.segs = []; this.windows = []; const pieces = [];
      for (const A of this.walk){
        const edges = [
          { x1:A.x, z1:A.z, x2:A.x+A.w, z2:A.z, nx:0, nz:-1 },
          { x1:A.x, z1:A.z+A.d, x2:A.x+A.w, z2:A.z+A.d, nx:0, nz:1 },
          { x1:A.x, z1:A.z, x2:A.x, z2:A.z+A.d, nx:-1, nz:0 },
          { x1:A.x+A.w, z1:A.z, x2:A.x+A.w, z2:A.z+A.d, nx:1, nz:0 }];
        for (const e of edges){
          const len = Math.hypot(e.x2-e.x1, e.z2-e.z1), n = Math.max(1, Math.round(len)), step = len/n;
          let cur = null;
          const flush = ()=>{ if (cur){ pieces.push(cur); cur = null; } };
          for (let i=0;i<n;i++){
            const t0 = i/n, t1 = (i+1)/n, tm = (t0+t1)/2;
            const mx = e.x1 + (e.x2-e.x1)*tm, mz = e.z1 + (e.z2-e.z1)*tm;
            const ox = mx + e.nx*1.0, oz = mz + e.nz*1.0;
            const B = walkAt(ox, oz, .05);
            let type = null, ref = null;
            if (B && B !== A){
              if (own.has(A) && !own.has(B)){
                // 우리 교실 ↔ 복도: 벽에 앞문·뒷문 두 개
                type = inDoor(mx, mz) ? null : 'classWall';
              }
            } else if (!B){
              const r = roomAt(ox, oz);
              if (r){ type = r.c === '#41c7f1' ? 'toilet' : 'wall'; ref = r; }
              else type = 'out';
            }
            if (!type){ flush(); continue; }
            if (cur && cur.type === type && cur.ref === ref){ cur.x2 = e.x1 + (e.x2-e.x1)*t1; cur.z2 = e.z1 + (e.z2-e.z1)*t1; }
            else { flush(); cur = { type, ref, cell:A, nx:e.nx, nz:e.nz, x1: e.x1 + (e.x2-e.x1)*t0, z1: e.z1 + (e.z2-e.z1)*t0, x2: e.x1 + (e.x2-e.x1)*t1, z2: e.z1 + (e.z2-e.z1)*t1 }; }
          }
          flush();
        }
      }
      const labeled = new Set();
      for (const p of pieces){
        const len = Math.hypot(p.x2-p.x1, p.z2-p.z1); if (len < .2) continue;
        const cx = (p.x1+p.x2)/2, cz = (p.z1+p.z2)/2, ry = p.nz !== 0 ? 0 : Math.PI/2;
        const low = p.cell.kind === 'stair' ? -16 : 0, H = CEIL - low;
        this.segs.push(p);
        if (p.type === 'out'){
          this.windows.push(p);
          // 창문 벽: 아래 벽 + 유리 + 위 벽 + 창틀
          add(new THREE.PlaneGeometry(len, 4 - low), mats.wall, cx, low + (4-low)/2, cz, ry);
          add(new THREE.PlaneGeometry(len, 7), mats.glass, cx, 7.5, cz, ry);
          add(new THREE.PlaneGeometry(len, CEIL-11), mats.wall, cx, 11 + (CEIL-11)/2, cz, ry);
          const bars = Math.max(1, Math.round(len/6));
          for (let i=0;i<=bars;i++){
            const t = i/bars, bx = p.x1 + (p.x2-p.x1)*t, bz = p.z1 + (p.z2-p.z1)*t;
            add(new THREE.BoxGeometry(.35, 7, .35), mats.frame, bx, 7.5, bz);
          }
          add(new THREE.BoxGeometry(p.nz !== 0 ? len : .5, .35, p.nz !== 0 ? .5 : len), mats.frame, cx, 4, cz);
          continue;
        }
        const mat = p.type === 'classWall' ? mats.classWall : p.type === 'toilet' ? mats.toilet : mats.wall;
        add(new THREE.PlaneGeometry(len, H), mat, cx, low + H/2, cz, ry);
        // 문과 이름표 (복도 쪽에서 보이게, 칸마다 한 번)
        const key = p.type === 'classWall' ? 'own' : p.ref && p.ref.gi;
        if (p.cell.kind === 'walk' && p.ref && len >= 7 && !labeled.has(key) && p.ref.l){
          labeled.add(key);
          const inX = -p.nx*.25, inZ = -p.nz*.25;
          const dt = .25, dx = p.x1 + (p.x2-p.x1)*dt, dz = p.z1 + (p.z2-p.z1)*dt;
          add(new THREE.BoxGeometry(p.nz !== 0 ? 4 : .12, 8.6, p.nz !== 0 ? .12 : 4), mats.door, dx + inX*.5, 4.3, dz + inZ*.5);
          const s = sprite(nice(p.ref.l), 1.2, { bg:'#ffffff', fg:'#1b2433', size:52 });
          s.position.set(dx + inX*2, 11.2, dz + inZ*2); this.scene.add(s);
        }
      }
      // 계단: 아래로 내려가는 계단과 난간
      this.goal = P.goal;
      for (const s of P.floorCells.filter(c=>c.kind === 'stair')) this.buildStair(s, s === P.goal);
      // 승강기: 은색 문
      for (const L of P.lifts) this.buildLift(L);

      // 대피길: 교실 가운데 → 문 → 복도 → 우리 반 계단 (벽과 창문을 피해서 찾아요)
      const g = P.goal, target = P.ground ? SCHOOL.mid(g)
        : { x: g.stairStart.x + g.stairDir.x*(g.landing + 2.5), z: g.stairStart.z + g.stairDir.z*(g.landing + 2.5) };
      this.path = this.findPath(SCHOOL.mid(P.room[0]), target);
      this.door = this.doors.reduce((a, b)=>{ const da = Math.min(...this.path.map(p=>SCHOOL.dist(p, a))), db = Math.min(...this.path.map(p=>SCHOOL.dist(p, b))); return da <= db ? a : b; }, this.doors[0]) || this.path[1];

      // 우리 교실 이름표 (문 위)
      const rc = P.room[0];
      const board = sprite(`${P.grade}-${P.cls} 우리 반`, 2, { bg:'#fff4c9', fg:'#1b2433', size:56 });
      board.position.set(this.door.x, 11.5, this.door.z);
      this.scene.add(board);
      this.decorClassroom(rc);

      // 바닥 화살표: 대피길을 따라 6칸마다
      const aMat = new THREE.MeshBasicMaterial({ map: arrowTex(), transparent: true, depthWrite: false });
      const path = this.path;
      this.pathLen = [0];
      for (let i=1;i<path.length;i++) this.pathLen.push(this.pathLen[i-1] + SCHOOL.dist(path[i-1], path[i]));
      this.totalLen = this.pathLen[this.pathLen.length-1];
      this.doorAt = this.project(this.door.x, this.door.z).s;
      for (let s = 4; s < this.totalLen - 3; s += 6.5){
        const p = this.pointAt(s), q = this.pointAt(Math.min(this.totalLen, s + .5));
        // 바닥에 눕힌 뒤(X) 가는 방향으로 돌려요(Y)
        const m = add(new THREE.PlaneGeometry(2.6, 2.6), aMat, p.x, .04, p.z);
        m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI/2, Math.atan2(-(q.x - p.x), -(q.z - p.z)), 0);
      }
      // 꺾이는 곳마다 비상구 표지판
      for (let i=1;i<path.length-1;i++){
        if (this.pathLen[i] < this.doorAt + 4 || this.totalLen - this.pathLen[i] < 6) continue;
        const s = exitSign('대피로'); s.position.set(path[i].x, 12.2, path[i].z); this.scene.add(s);
      }
      const gs = exitSign(P.ground ? P.stair.exit : `${P.stair.name}`); gs.scale.set(8.4, 2.8, 1);
      const gv = P.ground ? SCHOOL.mid(P.goal) : P.goal.stairStart; gs.position.set(gv.x, 11.8, gv.z); this.scene.add(gs);

      this.placeHazards();
      // 출발: 교실 가운데에서 문 쪽을 보며
      this.pos = { x: path[0].x, z: path[0].z };
      const d0 = path[1]; this.yaw = Math.atan2(-(d0.x - this.pos.x), -(d0.z - this.pos.z));
      this.eye = EYE;
      this.mapBox = this.makeMapBox();
    }

    /* 길 찾기: 1칸 격자에서 A* → 곧게 펴기. 벽에서 조금 떨어지고 창문은 피해서 가요 */
    findPath(from, to){
      const ok = (x, z, r=R)=>this.clearAt(x, z, r);
      const winD = (x, z)=>{ let m = Infinity; for (const w of this.windows){ const ax = w.x1, az = w.z1, bx = w.x2, bz = w.z2, L2 = (bx-ax)**2 + (bz-az)**2 || 1;
        const k = clamp(((x-ax)*(bx-ax) + (z-az)*(bz-az))/L2, 0, 1); m = Math.min(m, Math.hypot(x - (ax + (bx-ax)*k), z - (az + (bz-az)*k))); } return m; };
      const blocked = (x, z)=>{ const c = this.walkAt(x, z, .3); return !c || c.kind === 'lift' || (c.kind === 'stair' && c !== this.goal); };
      const key = (i, j)=>i + ',' + j, sx = Math.round(from.x), sz = Math.round(from.z), tx = Math.round(to.x), tz = Math.round(to.z);
      const cost = new Map(), memo = new Map();
      const stepCost = (i, j)=>{ const k = key(i, j); if (memo.has(k)) return memo.get(k);
        let c = Infinity;
        if (!blocked(i, j) && ok(i, j)){ c = 1; if (!ok(i, j, R + 1.2)) c += 1.5; const wd = winD(i, j); if (wd < WINDOW_NEAR + 1.5) c += 6; }
        memo.set(k, c); return c; };
      const open = [[0, sx, sz]], prev = new Map(); cost.set(key(sx, sz), 0);
      const dirs = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]];
      let found = false, n = 0;
      while (open.length && n++ < 200000){
        let bi = 0; for (let q=1;q<open.length;q++) if (open[q][0] < open[bi][0]) bi = q;
        const [, i, j] = open.splice(bi, 1)[0];
        if (Math.abs(i - tx) <= 1 && Math.abs(j - tz) <= 1){ prev.set('end', key(i, j)); found = true; break; }
        const cij = cost.get(key(i, j));
        for (const [di, dj, w] of dirs){
          const ni = i + di, nj = j + dj, sc = stepCost(ni, nj); if (sc === Infinity) continue;
          if (di && dj && (stepCost(i + di, j) === Infinity || stepCost(i, j + dj) === Infinity)) continue;
          const nc = cij + w*sc, k = key(ni, nj);
          if (nc < (cost.has(k) ? cost.get(k) : Infinity)){ cost.set(k, nc); prev.set(k, key(i, j)); open.push([nc + Math.hypot(ni - tx, nj - tz), ni, nj]); }
        }
      }
      if (!found) return [from, to];
      const pts = []; let k = prev.get('end');
      while (k){ const [i, j] = k.split(',').map(Number); pts.unshift({ x: i, z: j }); k = prev.get(k); }
      pts[0] = { ...from }; pts.push({ ...to });
      // 곧게 펴기: 벽과 창문에 가까워지지 않는 한 멀리 있는 점으로 바로 가요
      const clearLine = (a, b)=>{ const L = SCHOOL.dist(a, b), n = Math.ceil(L/.5);
        for (let q=1;q<n;q++){ const x = a.x + (b.x-a.x)*q/n, z = a.z + (b.z-a.z)*q/n; if (stepCost(Math.round(x), Math.round(z)) > 1 && !(SCHOOL.dist({x,z}, a) < 2 || SCHOOL.dist({x,z}, b) < 2)) return false; if (!ok(x, z)) return false; }
        return true; };
      const out = [pts[0]]; let i = 0;
      while (i < pts.length - 1){ let j = pts.length - 1; while (j > i + 1 && !clearLine(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
      return out;
    }

    decorClassroom(rc){
      // 교실 책상 몇 줄 (부딪히지는 않아요)
      const desk = new THREE.BoxGeometry(3, 3.6, 2.2), mat = new THREE.MeshLambertMaterial({ color:'#d9b98c' });
      const legMat = new THREE.MeshLambertMaterial({ color:'#7d8a96' });
      const cols = Math.max(2, Math.floor((rc.w - 10)/7)), rows = Math.max(2, Math.floor((rc.d - 8)/6));
      for (let i=0;i<cols;i++) for (let j=0;j<rows;j++){
        const x = rc.x + 6 + i*(rc.w - 12)/Math.max(1, cols-1), z = rc.z + 5 + j*(rc.d - 10)/Math.max(1, rows-1);
        const near = this.path.some((p, k)=>{ if (!k) return false; const q = this.path[k-1], L2 = (p.x-q.x)**2 + (p.z-q.z)**2 || 1;
          const t = clamp(((x-q.x)*(p.x-q.x) + (z-q.z)*(p.z-q.z))/L2, 0, 1); return Math.hypot(x - (q.x + (p.x-q.x)*t), z - (q.z + (p.z-q.z)*t)) < 4; });
        if (near) continue;   // 대피길 위에는 책상을 두지 않아요
        const m = this.add(desk, mat, x + rnd(-.6,.6), 2.6, z + rnd(-.6,.6), rnd(-.3,.3));
        this.add(new THREE.BoxGeometry(2.6, .2, .2), legMat, m.position.x, .8, m.position.z, m.rotation.y);
      }
    }

    buildStair(c, isGoal){
      // 들어오는 방향: 계단 칸과 맞닿은 복도 쪽
      const nb = this.walk.find(w=>w !== c && w.kind !== 'stair' && SCHOOL.shared(c, w));
      const sh = nb ? SCHOOL.shared(c, nb) : { axis:'z', x:c.x + c.w/2, z:c.z };
      let dir;   // 계단을 내려가는 방향 (단위 벡터)
      if (sh.axis === 'z') dir = { x:0, z: sh.z <= c.z + .5 ? 1 : -1 }; else dir = { x: sh.x <= c.x + .5 ? 1 : -1, z:0 };
      const along = dir.x ? c.w : c.d, across = dir.x ? c.d : c.w;
      const start = { x: dir.x ? (dir.x > 0 ? c.x : c.x + c.w) : c.x + c.w/2, z: dir.z ? (dir.z > 0 ? c.z : c.z + c.d) : c.z + c.d/2 };
      const landing = Math.min(5, along*.3), steps = 9, depth = (along - landing)/steps, rise = 1.4;
      const mat = isGoal ? this.mats.stair : new THREE.MeshLambertMaterial({ color:'#d9c3ad' });
      const box = (a0, a1, y)=>{ const a = (a0+a1)/2, L = a1 - a0;
        this.add(new THREE.BoxGeometry(dir.x ? L : across, .8, dir.x ? across : L), mat, start.x + dir.x*a, y - .4, start.z + dir.z*a); };
      box(0, landing, 0);
      for (let i=0;i<steps;i++) box(landing + i*depth, landing + (i+1)*depth, -(i+1)*rise);
      this.add(new THREE.PlaneGeometry(c.w, c.d), mat, c.x + c.w/2, -16, c.z + c.d/2, 0, -Math.PI/2);
      // 난간
      const side = { x: dir.z, z: dir.x }, hw = across/2 - .6;
      for (const sgn of [-1, 1]){
        const p0 = { x: start.x + side.x*hw*sgn + dir.x*landing, z: start.z + side.z*hw*sgn + dir.z*landing };
        const L = along - landing, drop = steps*rise, len = Math.hypot(L, drop);
        const m = this.add(new THREE.CylinderGeometry(.18, .18, len, 6), this.mats.rail, p0.x + dir.x*L/2, 4 - drop/2, p0.z + dir.z*L/2);
        m.rotation.set(0, 0, 0);
        const axis = new THREE.Vector3(dir.x, -drop/L, dir.z).normalize();
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), axis);
      }
      if (!isGoal){
        const s = sprite(c.l.replace('계단2','중앙계단').replace('계단3','서편계단').replace('계단1','동편계단').replace('계단4','신관 계단').replace('계단5','별관 계단'), 1.6, { bg:'#ffe2c8' });
        s.position.set(start.x + dir.x*2, 11, start.z + dir.z*2); this.scene.add(s);
      }
      c.stairDir = dir; c.stairStart = start; c.landing = landing; c.depth = depth; c.rise = rise; c.steps = steps;
    }

    buildLift(L){
      const nb = this.walk.find(w=>w !== L && w.kind !== 'lift' && SCHOOL.shared(L, w));
      const sh = nb ? SCHOOL.shared(L, nb) : null;
      // 복도 반대쪽 벽에 은색 문
      let x = L.x + L.w/2, z = L.z + L.d/2, wide = L.w, ry = 0;
      if (sh && sh.axis === 'z'){ z = sh.z <= L.z + .5 ? L.z + L.d - .3 : L.z + .3; wide = L.w; }
      else if (sh){ x = sh.x <= L.x + .5 ? L.x + L.w - .3 : L.x + .3; wide = L.d; ry = Math.PI/2; }
      this.add(new THREE.BoxGeometry(Math.min(7, wide - 1), 9.5, .3), this.mats.steel, x, 4.75, z, ry);
      this.add(new THREE.BoxGeometry(.12, 9.5, .4), this.mats.frame, x, 4.75, z, ry);
      const s = sprite('승강기', 1.6, { bg:'#e6ecf3' }); s.position.set(x, 11, z); this.scene.add(s);
    }

    /* 대피길 위의 한 점, 길에서 가장 가까운 점 */
    pointAt(s){
      const P = this.path; s = clamp(s, 0, this.totalLen);
      for (let i=1;i<P.length;i++) if (s <= this.pathLen[i] || i === P.length-1){
        const k = (s - this.pathLen[i-1]) / Math.max(1e-6, this.pathLen[i] - this.pathLen[i-1]);
        return { x: P[i-1].x + (P[i].x - P[i-1].x)*k, z: P[i-1].z + (P[i].z - P[i-1].z)*k, i };
      }
    }
    project(x, z){
      const P = this.path; let best = { d: Infinity, s: 0 };
      for (let i=1;i<P.length;i++){
        const ax = P[i-1].x, az = P[i-1].z, bx = P[i].x, bz = P[i].z, L2 = (bx-ax)**2 + (bz-az)**2 || 1;
        const k = clamp(((x-ax)*(bx-ax) + (z-az)*(bz-az))/L2, 0, 1), px = ax + (bx-ax)*k, pz = az + (bz-az)*k, d = Math.hypot(x-px, z-pz);
        if (d < best.d) best = { d, s: this.pathLen[i-1] + Math.sqrt(L2)*k };
      }
      return best;
    }

    /* 떨어진 천장 판과 깨진 유리: 복도 길 위, 한쪽으로 비켜서 놓아요 */
    placeHazards(){
      this.hazards = [];
      const L0 = this.doorAt + 6, L1 = this.totalLen - 9, span = L1 - L0;
      const spots = span > 40 ? [[.28,'panel'], [.75,'glass']] : span > 12 ? [[.5,'panel']] : [];
      for (const [k, type] of spots){
        const s = L0 + span*k, p = this.pointAt(s), q = this.pointAt(s + 1);
        const dx = q.x - p.x, dz = q.z - p.z, dl = Math.hypot(dx, dz) || 1, nx = -dz/dl, nz = dx/dl;
        const reach = (sg)=>{ let r = 0; while (r < 12 && this.walkAt(p.x + nx*sg*(r+.5), p.z + nz*sg*(r+.5), 0)) r += .5; return r; };
        const a = reach(1), b = reach(-1), sg = a >= b ? 1 : -1, room = Math.max(a, b);
        const rad = clamp(room - (2*R + 1.2), 1.4, 3);
        const off = sg*Math.max(0, room - rad - .3);
        const cx = p.x + nx*off, cz = p.z + nz*off;
        if (type === 'panel'){
          const m = this.add(new THREE.BoxGeometry(rad*1.8, .4, rad*1.5), new THREE.MeshLambertMaterial({ color:'#f1efe8' }), cx, .5, cz, rnd(0,3), .25);
          m.rotation.z = .12;
          for (let i=0;i<5;i++) this.add(new THREE.BoxGeometry(rnd(.4,1.1), .25, rnd(.4,1.1)), new THREE.MeshLambertMaterial({ color:'#dcd8cc' }), cx + rnd(-rad,rad), .15, cz + rnd(-rad,rad), rnd(0,3));
          this.add(new THREE.PlaneGeometry(rad*1.6, rad*1.4), new THREE.MeshBasicMaterial({ color:'#3a3a3a' }), cx, CEIL - .05, cz, 0, Math.PI/2);
        } else {
          const gm = new THREE.MeshLambertMaterial({ color:'#cfeaff', transparent:true, opacity:.75, side:THREE.DoubleSide, emissive:'#9fd3ff', emissiveIntensity:.4 });
          for (let i=0;i<14;i++){
            const g = new THREE.Mesh(new THREE.CircleGeometry(rnd(.25,.7), 3), gm);
            g.position.set(cx + rnd(-rad,rad), .06, cz + rnd(-rad,rad)); g.rotation.set(-Math.PI/2, 0, rnd(0,6)); this.scene.add(g);
          }
          this.add(new THREE.BoxGeometry(rad*1.4, .6, .5), this.mats.frame, cx, .3, cz, rnd(0,3));
        }
        this.hazards.push({ type, x: cx, z: cz, rad, hit: false });
      }
      // 여진: 복도 길의 가운데쯤
      this.quakeAt = this.doorAt + Math.max(4, (this.totalLen - this.doorAt)*.5);
    }

    /* ---------- 작은 지도 ---------- */
    makeMapBox(){
      // 우리 반 대피길이 다 보이도록 (여유 25칸, 가로세로 같게)
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of this.path){ x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
      for (const c of this.plan.room){ x0 = Math.min(x0, c.x); z0 = Math.min(z0, c.z); x1 = Math.max(x1, c.x + c.w); z1 = Math.max(z1, c.z + c.d); }
      const cx = (x0 + x1)/2, cz = (z0 + z1)/2, h = Math.max(60, x1 - x0, z1 - z0)/2 + 25;
      return { x0: cx - h, z0: cz - h, x1: cx + h, z1: cz + h };
    }
    drawMap(){
      const cv = $('mMap'), g = cv.getContext('2d'), W = cv.width, H = cv.height, B = this.mapBox;
      const k = Math.min((W-20)/(B.x1-B.x0), (H-20)/(B.z1-B.z0)), ox = (W - (B.x1-B.x0)*k)/2, oz = (H - (B.z1-B.z0)*k)/2;
      const X = (x)=>ox + (x - B.x0)*k, Z = (z)=>oz + (z - B.z0)*k;
      g.clearRect(0,0,W,H); g.save(); g.beginPath(); g.rect(4,4,W-8,H-8); g.clip();
      for (const c of this.plan.floorCells){
        g.fillStyle = c.kind === 'walk' ? '#e9e3d6' : c.kind === 'stair' ? (c === this.goal ? '#14a06a' : '#f0c7a6') : c.kind === 'lift' ? '#8fa0b6' : this.own.has(c) ? '#ffd84a' : 'rgba(255,255,255,.28)';
        g.fillRect(X(c.x), Z(c.z), c.w*k, c.d*k);
      }
      g.strokeStyle = '#14a06a'; g.lineWidth = 3; g.setLineDash([6,5]); g.beginPath();
      this.path.forEach((p,i)=>i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))); g.stroke(); g.setLineDash([]);
      const px = X(this.pos.x), pz = Z(this.pos.z), fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      g.fillStyle = '#ff4d5e'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
      g.moveTo(px + fx*16, pz + fz*16); g.lineTo(px - fz*9 - fx*8, pz + fx*9 - fz*8); g.lineTo(px + fz*9 - fx*8, pz - fx*9 - fz*8); g.closePath(); g.fill(); g.stroke(); g.restore();
    }

    /* ---------- ④ 움직이기 ---------- */
    bindInput(){
      const joy = $('mJoy'), knob = $('mKnob');
      let id = null, cx = 0, cy = 0;
      const set = (dx, dy)=>{ const r = joy.clientWidth/2 - 10, l = Math.hypot(dx, dy), k = l > r ? r/l : 1;
        knob.style.transform = `translate(${dx*k}px, ${dy*k}px)`; this.input.t = clamp(dx/r, -1, 1); this.input.f = clamp(-dy/r, -1, 1); };
      this.onDown = (e)=>{ id = e.pointerId; joy.setPointerCapture(id); const b = joy.getBoundingClientRect(); cx = b.left + b.width/2; cy = b.top + b.height/2; set(e.clientX - cx, e.clientY - cy); Sound.init && Sound.init(); };
      this.onMove = (e)=>{ if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); };
      this.onUp = (e)=>{ if (e.pointerId !== id) return; id = null; knob.style.transform = ''; this.input.f = this.input.t = 0; };
      joy.addEventListener('pointerdown', this.onDown); joy.addEventListener('pointermove', this.onMove);
      joy.addEventListener('pointerup', this.onUp); joy.addEventListener('pointercancel', this.onUp);
      this.onKey = (e)=>{ const on = e.type === 'keydown'; const k = e.key;
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D'].includes(k)){ this.keys[k.toLowerCase()] = on; e.preventDefault(); }
        if (on && (k === ' ' || k === 'Enter') && !$('mProtect').hidden){ e.preventDefault(); this.protect(); } };
      addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
      $('mProtect').onclick = ()=>this.protect();
    }
    readInput(){
      const K = this.keys;
      let f = this.input.f, t = this.input.t;
      if (K.arrowup || K.w) f = 1; if (K.arrowdown || K.s) f = -1;
      if (K.arrowleft || K.a) t = -1; if (K.arrowright || K.d) t = 1;
      if (this.auto) ({ f, t } = this.mode === 'shake' ? { f:0, t:0 } : this.autoSteer());
      return { f: Math.abs(f) < .15 ? 0 : f, t: Math.abs(t) < .15 ? 0 : t };
    }
    autoSteer(){   // 시험용 자동 걷기: 대피길을 따라가요
      const s = this.project(this.pos.x, this.pos.z).s, p = this.pointAt(s + 4);
      const want = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
      let d = want - this.yaw; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI;
      return { f: Math.abs(d) < .6 ? 1 : .2, t: clamp(-d*2, -1, 1) };
    }
    canStand(x, z){ return this.clearAt(x, z, R); }
    clearAt(x, z, rad){
      if (!this.walk.some(c=>this.inside(c, x, z, .6))) return false;
      for (const s of this.segs){
        const ax = s.x1, az = s.z1, bx = s.x2, bz = s.z2, L2 = (bx-ax)**2 + (bz-az)**2 || 1;
        const k = clamp(((x-ax)*(bx-ax) + (z-az)*(bz-az))/L2, 0, 1);
        if (Math.hypot(x - (ax + (bx-ax)*k), z - (az + (bz-az)*k)) < rad) return false;
      }
      return true;
    }
    move(dt, inp){
      this.yaw -= inp.t * TURN * dt;
      if (!inp.f) return 0;
      const sp = SPEED * (Quake3D.debug.speed || 1) * (this.slowUntil > this.t ? .45 : 1) * inp.f;
      const dx = -Math.sin(this.yaw)*sp*dt, dz = -Math.cos(this.yaw)*sp*dt;
      const x = this.pos.x, z = this.pos.z;
      if (this.canStand(x + dx, z + dz)){ this.pos.x += dx; this.pos.z += dz; }
      else if (this.canStand(x + dx, z)) this.pos.x += dx;
      else if (this.canStand(x, z + dz)) this.pos.z += dz;
      return Math.hypot(this.pos.x - x, this.pos.z - z);
    }

    /* ---------- 화면 글자 ---------- */
    updateTop(){
      const P = this.plan;
      $('mGoal').innerHTML = `<small>${P.grade}학년 ${P.cls}반 대피길</small><b></b>`;
      $('mGoal').querySelector('b').textContent = P.ground ? `${P.stair.exit}로 가요` : `${P.stair.name}으로 가요 · ${P.floor+1}층`;
      $('mPen').hidden = !this.penalty; $('mPen').textContent = `감점 −${this.penalty}`;
    }
    say(who, text, ms=3800){
      const [id, mood] = who.split(':');
      const ppl = STORY.people[id] || {}, ms_ = STORY.faces[id];
      const face = ms_ ? `img/face/${id}${mood && ms_.includes(mood) ? '_' + mood : ''}.jpg` : null;
      const ava = $('mAva'); ava.style.background = ppl.color || '#456';
      ava.innerHTML = face ? `<img src="${face}" alt="">` : (ppl.mark || '');
      $('mWho').textContent = typeof ppl.name === 'function' ? ppl.name() : (ppl.name || ''); $('mWho').style.color = ppl.color || '';
      $('mTxt').textContent = this.ctx.fill ? this.ctx.fill(text) : text;
      const b = $('mSay'); b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      clearTimeout(this.sayT); this.sayT = setTimeout(()=>{ b.hidden = true; }, ms);
    }
    flash(color){ const f = $('mFlash'); f.style.background = color; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    sfx(k){ try{ Sound.play(k); }catch(e){} }
    mistake(text){
      this.mistakes.push(text); this.penalty += PEN; this.updateTop();
      this.sfx('wrong'); this.flash('rgba(255,70,90,.45)');
      const tag = document.createElement('div'); tag.className = 'mMinus'; tag.textContent = `−${PEN}`; $('mini').appendChild(tag); setTimeout(()=>tag.remove(), 1300);
    }

    /* ---------- 처음 안내 ---------- */
    showIntro(){
      const P = this.plan, box = $('mIntro');
      box.innerHTML = `<div class="panel mCard">
        <p class="mKick">3D 대피 훈련</p>
        <h2>우리 반 대피길을 찾아요!</h2>
        <p class="mLead"></p>
        <ul class="mRules">
          <li><b>움직이기</b> 왼쪽 아래 동그라미를 밀어요. 위로 밀면 앞으로, 옆으로 밀면 돌아요. (키보드: 방향키)</li>
          <li><b>길 찾기</b> 바닥의 초록 화살표와 오른쪽 위 작은 지도를 봐요.</li>
          <li><b>조심!</b> 창문 가까이 가지 않기 · 떨어진 물건 피하기 · 승강기 타지 않기</li>
          <li><b>흔들리면</b> 바로 <span class="mBtnTag">머리 보호!</span> 버튼을 눌러요.</li>
        </ul>
        <p class="mNote">실수하면 하트 대신 점수가 50점씩 깎여요.</p>
        <button class="big-btn" id="mGo">출발!</button></div>`;
      box.querySelector('.mLead').textContent = P.fallback
        ? `${this.ctx.state.grade}학년 ${this.ctx.state.cls}반 교실은 배치도에 없어서 ${P.grade}학년 ${P.cls}반 교실에서 출발해요. 초록 화살표를 따라 ${P.stair.name}까지 가요.`
        : `${P.grade}학년 ${P.cls}반 교실(${P.floor+1}층)에서 출발해요. 초록 화살표를 따라 ${P.ground ? P.stair.exit : P.stair.name}까지 가요.`;
      box.hidden = false;
      const go = ()=>{ box.hidden = true; this.mode = 'walk'; this.lastProgressT = this.t;
        this.say('teacher', '선생님 뒤에 한 줄로! 머리는 가방으로 덮고 가요.'); };
      $('mGo').onclick = go;
      if (this.auto) setTimeout(go, 50);
    }

    /* ---------- ⑤ 사건 ---------- */
    events(dt, moved){
      const P = this.plan, x = this.pos.x, z = this.pos.z;
      const here = this.walkAt(x, z, .3);
      // 창문 가까이
      if (moved && this.mode === 'walk'){
        for (const w of this.windows){
          const ax = w.x1, az = w.z1, bx = w.x2, bz = w.z2, L2 = (bx-ax)**2 + (bz-az)**2 || 1;
          const k = clamp(((x-ax)*(bx-ax) + (z-az)*(bz-az))/L2, 0, 1);
          if (Math.hypot(x - (ax + (bx-ax)*k), z - (az + (bz-az)*k)) < WINDOW_NEAR){
            if (!this.flags.window){ this.flags.window = true; this.sfx('glass'); this.mistake('창문 가까이 갔어요');
              this.say('sw:scared', '창문 가까이는 위험해! 유리가 깨질 수 있어. 반대쪽으로 걸어!'); this.flags.windowT = this.t; }
            else if (this.t - (this.flags.windowT || 0) > 6){ this.flags.windowT = this.t; this.say('sw', '창문에서 떨어져서 걷자!', 2500); }
            break;
          }
        }
      }
      // 떨어진 물건
      for (const h of this.hazards){
        if (h.hit || Math.hypot(x - h.x, z - h.z) > h.rad + R*.4) continue;
        h.hit = true; this.slowUntil = this.t + 1.2;
        if (h.type === 'panel'){ this.sfx('thud'); this.mistake('떨어진 천장 판을 밟았어요'); this.say('jhy:serious', '앗! 바닥에 떨어진 건 피해서 돌아가야 해!'); }
        else { this.sfx('glass'); this.mistake('깨진 유리를 밟았어요'); this.say('sw:scared', '유리 조각이야! 밟지 말고 비켜서 가!'); }
      }
      // 승강기
      for (const L of P.lifts){
        const dx = Math.max(L.x - x, 0, x - (L.x + L.w)), dz = Math.max(L.z - z, 0, z - (L.z + L.d)), d = Math.hypot(dx, dz);
        if (d < 14 && !this.flags.liftTalk){ this.flags.liftTalk = true; this.say('sh', '야, 엘리베이터 타자! 계단보다 훨씬 빠르잖아!'); }
        if (d === 0){
          if (!this.flags.lift){ this.flags.lift = true; this.mistake('승강기 쪽으로 갔어요'); }
          this.say('teacher', '승강기는 절대 안 돼요! 지진 때 멈추면 갇혀요. 계단으로!');
          this.pushBack();
        }
      }
      // 다른 계단
      if (here && here.kind === 'stair' && here !== this.goal){
        this.say('sw', `여긴 우리 반 계단이 아니야! 우리 반은 ${P.stair.name}이야.`); this.pushBack();
      }
      // 길 따라 얼마나 왔는지 (도움말과 여진에 써요)
      const pr = this.project(x, z);
      if (pr.s > this.lastProgress + 2){ this.lastProgress = pr.s; this.lastProgressT = this.t; $('mPoint').hidden = true; }
      if (this.mode === 'walk' && this.t - this.lastProgressT > 9){
        this.lastProgressT = this.t;
        this.say('sw', `${P.ground ? P.stair.exit : P.stair.name}은 저쪽이야! 초록 화살표를 따라가!`); this.pointUntil = this.t + 5;
      }
      if (this.pointUntil > this.t){
        const p = this.pointAt(this.lastProgress + 6), want = Math.atan2(-(p.x - x), -(p.z - z));
        $('mPoint').hidden = false; $('mPoint').style.transform = `translate(-50%,-50%) rotate(${(-(want - this.yaw))*180/Math.PI - 90}deg)`;
      } else $('mPoint').hidden = true;
      // 여진
      if (this.mode === 'walk' && !this.flags.quake && pr.s >= this.quakeAt && pr.d < 8) this.startQuake();
      // 도착
      if (this.mode === 'walk' && here === this.goal){
        const sd = here.stairDir, st = here.stairStart, into = (x - st.x)*sd.x + (z - st.z)*sd.z;
        // 길이 짧아서 아직 여진이 안 왔으면 계단 앞에서 먼저 와요
        if (!this.flags.quake) this.startQuake();
        else if (into > 1.5 || P.ground) P.ground ? this.finish() : this.askStair();
      }
    }
    pushBack(){
      const back = this.pointAt(Math.max(0, this.project(this.lastSafe.x, this.lastSafe.z).s));
      this.pos.x = this.lastSafe.x; this.pos.z = this.lastSafe.z;
      if (!this.canStand(this.pos.x, this.pos.z)){ this.pos.x = back.x; this.pos.z = back.z; }
      this.frozenUntil = this.t + .8;
    }

    // 여진: 머리 보호 버튼을 3.5초 안에, 움직이지 말고
    startQuake(){
      this.flags.quake = true; this.mode = 'shake'; this.shakeT = 0; this.protected = false; this.fell = false;
      try{ Sound.quake(true); }catch(e){}
      $('mProtect').hidden = false;
      this.say('teacher', '또 흔들려요! 그 자리에서 머리 보호!', 3500);
      if (this.auto) setTimeout(()=>this.protect(), 600);
    }
    protect(){
      if (this.mode !== 'shake' || this.protected || this.fell) return;
      this.protected = true; $('mProtect').hidden = true; $('mBag').hidden = false; this.sfx('tap');
      this.say('jhy', '좋아! 낮게 앉아서 가방으로 머리 꽉!', 2600);
    }
    fall(){
      this.fell = true; $('mProtect').hidden = true; this.sfx('thud');
      this.mistake('흔들릴 때 머리를 보호하지 않았어요');
      this.say('jhy:serious', '흔들릴 땐 멈춰서 머리부터 지켜야 해!', 3000); $('mBag').hidden = false;
    }
    shake(dt, inp){
      this.shakeT += dt;
      if (!this.protected && !this.fell && (inp.f || this.shakeT > 3.5)) this.fall();
      this.eye += ((this.protected || this.fell ? CROUCH : EYE) - this.eye)*Math.min(1, dt*6);
      if (this.shakeT > 6){
        this.mode = 'walk'; try{ Sound.quake(false); }catch(e){}
        $('mBag').hidden = true; $('mProtect').hidden = true; this.eye = EYE;
        this.say('sw', '흔들림이 멈췄어. 다시 가자!', 2500); this.lastProgressT = this.t;
      }
    }

    // 계단 앞: 어떻게 내려갈까?
    askStair(){
      this.mode = 'ask';
      const box = $('mAsk'), P = this.plan;
      const opts = [{ ok:true, text:'난간을 잡고 한 줄로 내려간다' }, { ok:false, text:'빨리 가려고 계단을 뛰어 내려간다' }].sort(()=>Math.random() - .5);
      box.innerHTML = `<div class="mAskIn"><div class="q">${P.stair.name}에 왔어요. 어떻게 내려갈까?</div></div>`;
      const inner = box.firstChild;
      opts.forEach((o, n)=>{ const b = document.createElement('button'); b.className = 'opt';
        b.innerHTML = `<span class="num">${n+1}</span><span></span>`; b.lastChild.textContent = o.text;
        b.onclick = ()=>{ box.hidden = true; this.descend(o.ok); }; inner.appendChild(b); });
      box.hidden = false;
      if (this.auto) setTimeout(()=>{ box.hidden = true; this.descend(true); }, 50);
    }
    descend(ok){
      if (ok){ this.sfx('correct'); this.say('jhy', '좋아, 한 줄로! 난간 꼭 잡고!', 2600); }
      else { this.sfx('slip'); this.mistake('계단을 뛰어 내려갔어요'); this.say('jhy:serious', '계단에서 뛰면 굴러떨어져! 난간 잡고 천천히!', 2800); }
      this.mode = 'down'; this.downT = 0; this.downFrom = { ...this.pos };
      const g = this.goal; this.yaw = Math.atan2(-g.stairDir.x, -g.stairDir.z);
      this.sfx('steps');
    }
    down(dt){
      const g = this.goal, T = 3.2; this.downT += dt;
      const k = Math.min(1, this.downT/T), along = g.landing + k*(g.depth*g.steps - 1);
      this.pos.x = g.stairStart.x + g.stairDir.x*along; this.pos.z = g.stairStart.z + g.stairDir.z*along;
      this.eyeDrop = -Math.max(0, along - g.landing)/g.depth*g.rise;
      const floors = this.plan.floor, now = Math.max(1, floors + 1 - Math.floor(k*floors + .001));
      $('mGoal').querySelector('b').textContent = `${now}층 · ${this.plan.stair.name}을 내려가요`;
      if (this.downT > T){ this.finish(); }
    }

    /* ---------- ⑥ 끝내기 ---------- */
    finish(){
      if (this.mode === 'end') return;
      this.mode = 'end'; try{ Sound.quake(false); }catch(e){}
      this.sfx('fanfare');
      const P = this.plan, box = $('mEnd');
      const route = `${P.grade}학년 ${P.cls}반 → ${P.ground ? '' : P.stair.name + ' → '}${P.stair.exit} → 운동장`;
      box.innerHTML = `<div class="panel mCard">
        <p class="mKick">대피 성공!</p><h2>우리 반 대피길</h2>
        <p class="mRoute"></p><ul class="mList"></ul>
        <p class="mTotal"></p>
        <button class="big-btn" id="mDone">이야기 계속하기</button></div>`;
      box.querySelector('.mRoute').textContent = route;
      const ul = box.querySelector('.mList');
      if (!this.mistakes.length){ const li = document.createElement('li'); li.className = 'good'; li.textContent = '실수 없이 완벽하게 대피했어요!'; ul.appendChild(li); }
      this.mistakes.forEach(m=>{ const li = document.createElement('li'); li.textContent = `${m}  −${PEN}`; ul.appendChild(li); });
      box.querySelector('.mTotal').textContent = this.penalty ? `3D 대피 감점 −${this.penalty}점` : '3D 대피 감점 없음';
      box.hidden = false;
      const done = ()=>{ box.hidden = true; this.cleanup(); this.resolve({ penalty: this.penalty, mistakes: this.mistakes.slice(), route }); };
      $('mDone').onclick = done;
      if (this.auto) setTimeout(done, 50);
    }
    cleanup(){
      cancelAnimationFrame(this.raf); this.dead = true;
      removeEventListener('resize', this.onResize); removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey);
      const joy = $('mJoy'); joy.removeEventListener('pointerdown', this.onDown); joy.removeEventListener('pointermove', this.onMove);
      joy.removeEventListener('pointerup', this.onUp); joy.removeEventListener('pointercancel', this.onUp);
      this.scene.traverse(o=>{ if (o.geometry) o.geometry.dispose(); if (o.material){ const m = o.material; if (m.map) m.map.dispose(); m.dispose(); } });
      this.renderer.dispose(); $('m3d').innerHTML = '';
      ['mSay','mProtect','mBag','mPoint','mPen'].forEach(id=>$(id).hidden = true);
      $('mini').hidden = true; clearTimeout(this.sayT);
    }

    /* ---------- 매 장면 ---------- */
    loop(now){
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.loop);
      const dt = Math.min(.05, (now - this.last)/1000); this.last = now; this.t += dt;
      const inp = this.readInput();
      let moved = 0;
      if (this.mode === 'walk' && !(this.frozenUntil > this.t)){
        const cell = this.walkAt(this.pos.x, this.pos.z, .3);
        if (this.canStand(this.pos.x, this.pos.z) && cell && cell.kind !== 'lift' && !(cell.kind === 'stair' && cell !== this.goal)) this.lastSafe = { ...this.pos };
        moved = this.move(dt, inp);
        this.eye += (EYE - this.eye)*Math.min(1, dt*6);
      } else if (this.mode === 'shake') this.shake(dt, inp);
      else if (this.mode === 'down') this.down(dt);
      if (this.mode === 'walk' || this.mode === 'shake') this.events(dt, moved);
      if (!this.lastSafe) this.lastSafe = { ...this.pos };
      // 카메라 (걸을 때 살짝 흔들, 여진 때 크게 흔들)
      this.bob = (this.bob || 0) + moved*0.9;
      const amp = this.mode === 'shake' ? .55 : 0;
      const y = this.eye + (this.eyeDrop || 0) + Math.sin(this.bob)*.12 + rnd(-amp, amp);
      this.camera.position.set(this.pos.x + rnd(-amp, amp)*.6, y, this.pos.z + rnd(-amp, amp)*.6);
      this.camera.rotation.set(rnd(-amp, amp)*.03, this.yaw, rnd(-amp, amp)*.04, 'YXZ');
      this.renderer.render(this.scene, this.camera);
      this.drawMap();
    }
  }

  return { run, debug: { auto: false, game: null, speed: 1 } };
})();
