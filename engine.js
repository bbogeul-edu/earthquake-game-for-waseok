/* =================================================================
   engine.js — 재난 안전 게임 엔진 (이야기는 story.js)
   읽는 순서: ① 게임 상태 → ② 카드·수칙 데이터 → ③ 배경 그림
             → ④ 대본(이야기) → ⑤ 엔진(대본을 한 줄씩 실행) → ⑥ 시작
   ================================================================= */

/* ① 게임 상태: 게임이 기억해야 하는 값들을 한 상자에 모아 둬요 */
const state = {
  name: '', call: '',   // 입력한 이름, 친구들이 부르는 이름
  grade: 2, cls: 6,     // 학년, 반
  hearts: 3,            // 남은 하트
  ch: 0, chTitle: '',   // 지금 장 번호와 제목
  hintUsed: false,      // 이번 장에서 힌트를 썼는지
  lastOk: true          // 바로 앞 선택이 정답이었는지
};

Object.assign(state, STORY.state || {});   // 이야기마다 필요한 기억값 더하기

/* 이야기 파일(story.js)에서 가져오기 */
const CARDS = STORY.cards, RULES = STORY.rules, PEOPLE = STORY.people, FACES = STORY.faces, ANIM = STORY.anim || {};
const BG_IMAGES = {};
STORY.backgrounds.forEach(k=>BG_IMAGES[k] = `img/${k}.jpg`);
// 미리 불러 두면 장면이 바뀔 때 깜빡이지 않아요
Object.values(BG_IMAGES).forEach(src=>{ const i = new Image(); i.src = src; });

const faceSrc = (id, mood)=> FACES[id] ? `img/face/${id}${mood && FACES[id].includes(mood) ? '_'+mood : ''}.jpg` : null;
Object.entries(FACES).forEach(([id, ms])=>[null, ...ms].forEach(m=>{ const i = new Image(); i.src = faceSrc(id, m); }));

/* ④ 대본 도구: story.js의 대본을 이 도구로 만들어요.
   N(내레이션), S(누가, 대사, 행동지문), BG(배경), FX(효과), SAVE(장 시작·저장),
   C(선택지), CARD(카드뉴스), IF(조건, 줄들) 로 이야기를 만들어요.
   {이름}은 아이가 입력한 이름으로 바뀌어요. ("{이름}아" → "하늘아"/"지우야") */
const N = (text)=>({t:'say', who:null, text});
const S = (who,text,dir)=>({t:'say', who, text, dir});
const BG = (k)=>({t:'bg', k});
const FX = (k)=>({t:'fx', k});
const SAVE = (ch,title)=>({t:'save', ch, title});
const C = (o)=>({t:'choice', ...o});
const CARD = (k)=>({t:'card', k});
const IF = (cond,steps)=>({t:'if', cond, steps});
const SFX = (k)=>({t:'sfx', k});   // 효과음 한 번
const AMB = (k)=>({t:'amb', k});   // 배경 소리 바꾸기
const MUS = (k)=>({t:'mus', k});   // 배경 음악 바꾸기 (tension / sad / hope / none)

const SCRIPT = STORY.script({ N, S, BG, FX, SAVE, C, CARD, IF, SFX, AMB, MUS });
const CHAPTERS = SCRIPT.filter(s=>s.t === 'save').length;


/* =================================================================
   효과음: 소리 파일 없이 코드로 직접 만들어요 (Web Audio)
   - Sound.play('crash')  → 짧은 효과음 한 번
   - Sound.amb('beach')   → 계속 깔리는 배경 소리 (파도, 바람, 사람들 웅성임…)
   나중에 진짜 녹음 파일을 쓰고 싶으면: SFX_FILES.crash = 'sfx/crash.mp3';
   ================================================================= */
const SFX_FILES = {};
const Sound = (()=>{
  let ctx=null, out=null, master=null, muffleF=null, white=null, brown=null;
  let enabled = true, ambKind = 'none', ambNow = [], quakeNow = null;
  try{ enabled = localStorage.getItem('tsunami-sound') !== '0'; }catch(e){}

  function init(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx){
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = enabled ? 1 : 0; master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor(); comp.connect(master);
      muffleF = filt('lowpass', 18000); muffleF.connect(comp);
      out = muffleF;
      // 잡음 재료 두 가지: 하얀 잡음(쉬익), 갈색 잡음(우르릉)
      const len = ctx.sampleRate * 3;
      white = ctx.createBuffer(1, len, ctx.sampleRate); brown = ctx.createBuffer(1, len, ctx.sampleRate);
      const w = white.getChannelData(0), b = brown.getChannelData(0); let last = 0;
      for (let i=0;i<len;i++){ const r = Math.random()*2-1; w[i] = r; last = (last + 0.02*r)/1.02; b[i] = last*3.5; }
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  const now = ()=>ctx.currentTime;
  function filt(type, f, q=0.7){ const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; }
  function gain(v=0){ const g = ctx.createGain(); g.gain.value = v; return g; }
  function chain(...n){ for (let i=0;i<n.length-1;i++) n[i].connect(n[i+1]); return n[n.length-1]; }
  function src(kind){ const s = ctx.createBufferSource(); s.buffer = kind==='brown' ? brown : white; s.loop = true; return s; }
  // 소리 모양: a(커지는 시간) → hold(유지) → r(작아지는 시간)
  function shape(g, t, a, hold, r, peak){
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t+a);
    g.gain.setValueAtTime(peak, t+a+hold); g.gain.exponentialRampToValueAtTime(0.0001, t+a+hold+r);
    return t+a+hold+r;
  }
  function tone(f, {t=now(), type='sine', a=.01, hold=0, r=.3, peak=.3, fEnd=null, vib=0}={}){
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    const g = gain(), end = shape(g, t, a, hold, r, peak);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, end);
    if (vib){ const l = ctx.createOscillator(), lg = gain(vib); l.frequency.value = 28; chain(l, lg, o.frequency); l.start(t); l.stop(end+.05); }
    chain(o, g, out); o.start(t); o.stop(end+.05);
  }
  function burst({t=now(), kind='white', type='lowpass', f=1000, fEnd=null, q=.7, a=.01, hold=0, r=.3, peak=.3}={}){
    const s = src(kind), fl = filt(type, f, q), g = gain(), end = shape(g, t, a, hold, r, peak);
    if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, end);
    chain(s, fl, g, out); s.start(t, Math.random()*2); s.stop(end+.05);
  }
  // 계속 깔리는 소리 한 겹 (rate: 출렁임 빠르기, depth: 출렁임 크기, am: 헬리콥터처럼 두두두)
  function layer({kind='white', type='lowpass', f=800, q=.7, peak=.2, rate=0, depth=0, onFreq=false, am=0}={}){
    const s = src(kind), fl = filt(type, f, q), g = gain(0), t = now(), extra = [];
    let last = chain(s, fl, g);
    if (am){ const ag = gain(.5), l = ctx.createOscillator(), lg = gain(.5); l.type = 'square'; l.frequency.value = am; chain(l, lg, ag.gain); l.start(); extra.push(l); last = chain(g, ag); }
    last.connect(out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t+1.5);
    if (rate){ const l = ctx.createOscillator(), lg = gain(depth); l.frequency.value = rate; chain(l, lg); lg.connect(onFreq ? fl.frequency : g.gain); l.start(); extra.push(l); }
    s.start(t, Math.random()*2);
    return { stop(fd=1.2){ const t2 = now(); g.gain.cancelScheduledValues(t2); g.gain.setValueAtTime(g.gain.value, t2); g.gain.linearRampToValueAtTime(0, t2+fd);
      s.stop(t2+fd+.1); extra.forEach(o=>o.stop(t2+fd+.1)); } };
  }
  function every(min, max, fn){ let id; const go = ()=>{ id = setTimeout(()=>{ if (enabled) fn(); go(); }, min + Math.random()*(max-min)); }; go(); return { stop(){ clearTimeout(id); } }; }
  const wind = (p)=>layer({type:'bandpass', f:500, q:.6, peak:p, rate:.15, depth:250, onFreq:true});

  /* 짧은 효과음 목록 */
  const FX = {
    gull(){ const t = now(); [0,.45,1.05].forEach((d,i)=>tone(2100-i*120, {t:t+d, a:.04, hold:.05, r:.22, peak:.05, fEnd:1300, vib:70})); },
    crash(){ burst({kind:'brown', f:2500, fEnd:250, a:.35, hold:.6, r:2.4, peak:.95}); burst({f:6000, fEnd:900, a:.3, hold:.4, r:1.8, peak:.22}); },
    roar(){ burst({kind:'brown', f:320, fEnd:520, a:2.2, hold:.4, r:1.6, peak:.6}); burst({type:'bandpass', f:1500, q:.5, a:2, hold:.3, r:1.2, peak:.07}); },
    rumble(){ burst({kind:'brown', f:120, a:.15, hold:.6, r:.9, peak:.9}); tone(42, {a:.1, hold:.6, r:.6, peak:.35}); },
    siren(){ const t = now(), o = ctx.createOscillator(), g = gain(), bp = filt('bandpass', 900, .8);
      o.type = 'triangle'; o.frequency.setValueAtTime(620, t);
      for (let i=0;i<4;i++){ o.frequency.linearRampToValueAtTime(940, t+i*2+1); o.frequency.linearRampToValueAtTime(620, t+i*2+2); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t+1.2); g.gain.setValueAtTime(.05, t+6.5); g.gain.linearRampToValueAtTime(0, t+8);
      chain(o, bp, g, out); o.start(t); o.stop(t+8.1); },
    spark(){ const t = now(); for (let i=0;i<14;i++) burst({t:t+Math.random()*.7, type:'highpass', f:3500, a:.002, r:.04, peak:.28});
      tone(110, {t, type:'square', a:.005, hold:.12, r:.05, peak:.06}); tone(60, {t:t+.3, type:'sawtooth', a:.005, hold:.1, r:.05, peak:.05}); },
    busy(){ const t = now(); for (let i=0;i<3;i++){ tone(480, {t:t+i, hold:.45, r:.02, peak:.07}); tone(620, {t:t+i, hold:.45, r:.02, peak:.07}); } },
    horn(){ const t = now(); [0,.5,1.4].forEach((d,i)=>{ const h = i===1 ? .6 : .25; tone(i===2?370:415, {t:t+d, type:'square', a:.02, hold:h, r:.05, peak:.04}); tone(i===2?466:523, {t:t+d, type:'square', a:.02, hold:h, r:.05, peak:.035}); }); },
    rocks(){ const t = now(); for (let i=0;i<9;i++){ const d = t+i*.11+Math.random()*.08; burst({t:d, kind:'brown', f:600, a:.003, r:.14, peak:.55}); burst({t:d, type:'bandpass', f:2200, q:2, a:.002, r:.05, peak:.12}); } },
    glass(){ const t = now(); burst({type:'highpass', f:2500, a:.005, r:.5, peak:.4}); burst({kind:'brown', f:500, a:.005, r:.3, peak:.5});
      for (let i=0;i<10;i++) tone(2500+Math.random()*4000, {t:t+.02+Math.random()*.5, a:.002, r:.25+Math.random()*.3, peak:.04}); },
    thud(){ tone(110, {a:.005, r:.3, peak:.6, fEnd:40}); burst({kind:'brown', f:300, a:.005, r:.2, peak:.5}); },
    slip(){ burst({type:'bandpass', f:1600, fEnd:300, q:1.2, a:.03, hold:.1, r:.35, peak:.35}); },
    steps(){ const t = now(); for (let i=0;i<8;i++) burst({t:t+i*.26, kind:'brown', f:280, a:.005, r:.09, peak:.5}); },
    crack(){ const t = now(); for (let i=0;i<18;i++) burst({t:t+Math.random()*.6, type:'bandpass', f:1200+Math.random()*1500, q:3, a:.002, r:.05, peak:.25});
      burst({t:t+.55, kind:'brown', f:200, a:.01, hold:.3, r:1.2, peak:.8}); },
    recede(){ burst({kind:'brown', f:900, fEnd:180, a:.4, hold:.5, r:3.5, peak:.45}); burst({type:'highpass', f:3000, a:.5, hold:.4, r:3, peak:.06}); },
    heli(){ const h = layer({kind:'brown', f:500, peak:.2, am:11}); setTimeout(()=>h.stop(2), 4500); },
    ding(){ const t = now(); [523.25,659.25,783.99].forEach((f,i)=>{ tone(f, {t:t+i*.42, r:1.1, peak:.18}); tone(f*2, {t:t+i*.42, r:.6, peak:.04}); }); },
    whoosh(){ burst({type:'bandpass', f:400, fEnd:2000, q:1, a:.3, r:.4, peak:.25}); },
    // 게임 안내음
    correct(){ const t = now(); [783.99,987.77,1318.5].forEach((f,i)=>tone(f, {t:t+i*.09, type:'triangle', a:.005, r:.35, peak:.18})); },
    wrong(){ tone(233, {type:'square', a:.01, hold:.12, r:.25, peak:.06, fEnd:150}); },
    heart(){ const t = now(); tone(660, {t, r:.25, peak:.15, fEnd:440}); tone(440, {t:t+.22, r:.5, peak:.15, fEnd:220}); },
    card(){ tone(880, {a:.005, r:.12, peak:.12, fEnd:1320}); tone(1320, {t:now()+.08, a:.005, r:.3, peak:.08}); },
    chapter(){ const t = now(); tone(196, {t, a:.05, hold:.3, r:1.6, peak:.15}); tone(293.66, {t:t+.05, a:.05, hold:.3, r:1.6, peak:.1}); tone(392, {t:t+.1, a:.05, hold:.2, r:1.4, peak:.06}); },
    tick(){ tone(1500, {type:'square', a:.002, r:.04, peak:.04}); },
    tap(){ tone(1000, {a:.002, r:.06, peak:.06, fEnd:700}); },
    over(){ const t = now(); [392,349.23,311.13,261.63].forEach((f,i)=>tone(f, {t:t+i*.28, type:'triangle', r:.5, peak:.14})); },
    fanfare(){ const t = now(); [523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f, {t:t+i*.16, type:'triangle', hold:i===3?.4:0, r:.6, peak:.16}));
      [261.63,329.63,392].forEach(f=>tone(f, {t:t+.48, a:.02, hold:.4, r:1.2, peak:.06})); }
  };

  /* 배경 소리 목록 (여러 겹을 합쳐요) */
  const AMBS = {
    none: ()=>[],
    beach: ()=>[layer({kind:'brown', f:700, peak:.35, rate:.13, depth:.2}), layer({type:'highpass', f:3500, peak:.035, rate:.13, depth:.025}), every(6000,11000, FX.gull)],
    lowtide: ()=>[layer({kind:'brown', f:400, peak:.12, rate:.1, depth:.06}), wind(.12)],
    crowd: ()=>[layer({type:'bandpass', f:700, q:.9, peak:.12, rate:3.3, depth:.04}), layer({type:'bandpass', f:1300, q:1.2, peak:.05, rate:4.7, depth:.03}),
                layer({kind:'brown', f:250, peak:.25, rate:.08, depth:.12}), every(8000,14000, FX.siren)],
    roar: ()=>[layer({kind:'brown', f:300, peak:.45, rate:.2, depth:.15}), layer({type:'bandpass', f:900, q:.8, peak:.06, rate:3.5, depth:.03})],
    wind: ()=>[wind(.16), layer({kind:'brown', f:350, peak:.18, rate:.09, depth:.1}), every(10000,18000, FX.siren)],
    heli: ()=>[wind(.1), layer({kind:'brown', f:500, peak:.16, am:11})],
    calm: ()=>[layer({kind:'brown', f:500, peak:.2, rate:.09, depth:.12}), layer({type:'highpass', f:4000, peak:.02, rate:.09, depth:.015}), every(8000,15000, FX.gull)]
  };


  /* ---------- 배경 음악 (코드로 연주해요) ----------
     tension: 위험한 장면 (D단조, 심장 박동 + 낮은 반복음 + 떨리는 현악)
     sad:     재현이가 사라진 장면 (D단조 피아노 엘레지)
     hope:    재회와 엔딩 (F장조 피아노) */
  let musicBus = null, reverb = null, track = null, musicName = 'none', schedId = null;
  const mf = (m)=>440*Math.pow(2,(m-69)/12);
  const NOTE = (s)=>{ const m = s.match(/^([A-G])(#|b)?(\d)$/); const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]] + (m[2]==='#'?1:m[2]==='b'?-1:0); return mf(12*(+m[3]+1)+base); };
  function musicInit(){
    if (musicBus) return;
    musicBus = gain(.55); musicBus.connect(out);
    reverb = ctx.createConvolver(); const len = ctx.sampleRate*2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c=0;c<2;c++){ const d = ir.getChannelData(c); for (let i=0;i<len;i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 2.6); }
    reverb.buffer = ir; const wet = gain(.32); chain(reverb, wet, musicBus);
  }
  function piano(f, t, vel, dur, dest){   // 피아노 비슷한 소리: 배음을 겹치고 점점 작아지게
    const g = gain(0), lp = filt('lowpass', 2600 + vel*2000); chain(g, lp, dest); lp.connect(reverb);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel*.22, t+.006); g.gain.setTargetAtTime(0, t+.02, dur/3.2);
    [[1,1],[2,.42],[3,.16],[4.02,.07]].forEach(([h,a])=>{ const o = ctx.createOscillator(); o.type = h===1 ? 'triangle' : 'sine'; o.frequency.value = f*h; const og = gain(a); chain(o, og, g); o.start(t); o.stop(t+dur+.2); });
  }
  function pad(fs, t, dur, vol, dest){    // 부드럽게 깔리는 화음
    const g = gain(0), lp = filt('lowpass', 800); chain(g, lp, dest); lp.connect(reverb);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+dur*.35); g.gain.linearRampToValueAtTime(0, t+dur);
    fs.forEach(f=>[-7,7].forEach(cent=>{ const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cent; const og = gain(.25); chain(o, og, g); o.start(t); o.stop(t+dur+.05); }));
  }
  function pluck(f, t, dur, vol, dest){   // 낮은 반복음
    const o = ctx.createOscillator(), g = gain(0), lp = filt('lowpass', 700, 4);
    o.type = 'sawtooth'; o.frequency.value = f; chain(o, lp, g, dest);
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(300, t+dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t+dur); o.start(t); o.stop(t+dur+.02);
  }
  function thump(t, vol, dest){ const o = ctx.createOscillator(), g = gain(0); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t+.25); chain(o, g, dest); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t+.35); o.start(t); o.stop(t+.4); }
  function tremolo(fs, t, dur, vol, dest){
    const g = gain(0), am = gain(.5), l = ctx.createOscillator(), lg = gain(.5), bp = filt('bandpass', 900, .7);
    l.frequency.value = 11; chain(l, lg, am.gain); chain(g, am, bp, dest); bp.connect(reverb);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t+dur*.7); g.gain.linearRampToValueAtTime(0, t+dur);
    fs.forEach(f=>{ const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; chain(o, g); o.start(t); o.stop(t+dur); });
    l.start(t); l.stop(t+dur);
  }
  // 왼손 펼친화음: 근음-5도-10도-5도를 8분음표로 두 번
  const arp = (root, third, fifth)=>[root, fifth, third+12, fifth, root, fifth, third+12, fifth];
  const SONGS = {
    sad: { beat: 60/60, bars: [
      {lh:arp(50,53,57), ch:[50,57,65], mel:[['A4',2],['F4',1],['E4',1]]},
      {lh:arp(46,50,53), ch:[46,53,62], mel:[['D4',2],['F4',1],['Bb4',1]]},
      {lh:arp(43,46,50), ch:[43,50,58], mel:[['A4',1.5],['G4',.5],['F4',1],['G4',1]]},
      {lh:arp(45,49,52), ch:[45,52,61], mel:[['E4',3],[null,1]]},
      {lh:arp(50,53,57), ch:[50,57,65], mel:[['A4',2],['C5',1],['Bb4',1]]},
      {lh:arp(46,50,53), ch:[46,53,62], mel:[['A4',1],['G4',1],['F4',1],['D4',1]]},
      {lh:arp(43,46,50), ch:[43,50,58], mel:[['G4',1.5],['F4',.5],['E4',1],['D4',1]]},
      {lh:arp(45,49,52), ch:[45,52,61], mel:[['C#4',2],['E4',2]]}
    ]},
    hope: { beat: 60/72, bars: [
      {lh:arp(41,45,48), ch:[53,57,60], mel:[['C5',2],['A4',1],['G4',1]]},
      {lh:arp(40,43,48), ch:[52,55,60], mel:[['G4',2],['E4',1],['F4',1]]},
      {lh:arp(38,41,45), ch:[50,53,57], mel:[['A4',2],['D5',1],['C5',1]]},
      {lh:arp(34,38,41), ch:[46,50,53], mel:[['Bb4',3],['A4',1]]},
      {lh:arp(41,45,48), ch:[53,57,60], mel:[['A4',1],['C5',1],['F5',2]]},
      {lh:arp(36,40,43), ch:[48,52,55], mel:[['E5',2],['D5',1],['C5',1]]},
      {lh:arp(34,38,41), ch:[46,50,53], mel:[['D5',1.5],['C5',.5],['Bb4',1],['A4',1]]},
      {lh:arp(36,40,43), ch:[48,52,55], mel:[['G4',3],[null,1]]}
    ]}
  };
  function scheduleBar(name, n, t, dest){
    if (name === 'tension'){           // 96bpm, 8분음표 = 0.3125초
      const e = 60/96/2, riff = [50,50,53,50,52,50,49,50];
      riff.forEach((m,i)=>pluck(mf(m), t+i*e, e*1.6, .16, dest));
      thump(t, .55, dest); thump(t+e*.9, .35, dest); thump(t+e*4, .55, dest); thump(t+e*4.9, .35, dest);
      if (n % 2 === 0) pad([mf(38), mf(45)], t, e*16, .09, dest);
      if (n % 4 === 2) tremolo([mf(69), mf(70)], t, e*16, .05, dest);
      return e*8;
    }
    const S = SONGS[name], b = S.bars[n % S.bars.length], q = S.beat;
    b.lh.forEach((m,i)=>piano(mf(m), t+i*q/2, .32 - (i%4 ? .08 : 0), q*2.2, dest));
    pad(b.ch.map(mf), t, q*4.2, .035, dest);
    let x = 0; b.mel.forEach(([nm, len])=>{ if (nm) piano(NOTE(nm), t+x*q, .62, q*len*1.6+.6, dest); x += len; });
    return q*4;
  }
  function music(name){
    if (!ctx || name === musicName) return;
    musicInit(); musicName = name;
    if (track){ const old = track; old.g.gain.cancelScheduledValues(now()); old.g.gain.setValueAtTime(old.g.gain.value, now()); old.g.gain.linearRampToValueAtTime(0, now()+1.8); old.alive = false; setTimeout(()=>old.g.disconnect(), 2600); }
    track = null;
    if (name === 'none') return;
    const g = gain(0); g.connect(musicBus); g.gain.linearRampToValueAtTime(1, now()+2);
    const tr = track = {g, name, n:0, next: now()+.15, alive:true};
    if (!schedId) schedId = setInterval(()=>{ const T = track; if (!T || !T.alive) return;
      while (T.next < now()+.6){ const len = scheduleBar(T.name, T.n, T.next, T.g); T.n++; T.next += len; } }, 120);
  }

  return {
    init, music,
    get on(){ return enabled; },
    setOn(v){ enabled = v; if (master) master.gain.setTargetAtTime(v ? 1 : 0, now(), .05); try{ localStorage.setItem('tsunami-sound', v ? '1' : '0'); }catch(e){} },
    play(k){
      if (!ctx || !enabled) return;
      if (SFX_FILES[k]){ try{ new Audio(SFX_FILES[k]).play().catch(()=>{}); }catch(e){} return; }
      if (FX[k]) FX[k]();
    },
    amb(k){ if (!ctx || k === ambKind) return; ambKind = k; ambNow.forEach(x=>x.stop()); ambNow = (AMBS[k] || AMBS.none)(); },
    quake(on){
      if (!ctx) return;
      if (on && !quakeNow){ quakeNow = [layer({kind:'brown', f:110, peak:.9, rate:1.7, depth:.3}), layer({kind:'brown', type:'bandpass', f:600, q:1, peak:.12, rate:5, depth:.08}),
        every(250,700, ()=>burst({type:'bandpass', f:1800+Math.random()*1500, q:4, a:.002, r:.06, peak:.08}))]; FX.rumble(); }
      if (!on && quakeNow){ quakeNow.forEach(x=>x.stop(1.5)); quakeNow = null; }
    },
    muffle(on){ if (ctx) muffleF.frequency.setTargetAtTime(on ? 600 : 18000, now(), .3); }
  };
})();

/* ⑤ 엔진: 위 대본을 한 줄씩 실행하는 부분 */
const $ = (id)=>document.getElementById(id);
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 이름 뒤 받침이 있는지 확인 (하늘 → 받침 있음, 지우 → 없음)
function hasBatchim(word){
  const c = word.charCodeAt(word.length-1) - 0xAC00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
}
// {이름}, {학년}, {반}을 실제 값으로 바꾸고 조사를 맞춰요
function fill(t){
  if (typeof t === 'function') t = t(state);
  const n = state.call, b = hasBatchim(n);
  return t.replace(/\{이름\}(아|을|은|의|이)?/g, (m, j) => {
    if (j === '아') return n + (b ? '아' : '야');
    if (j === '을') return n + (b ? '이를' : '를');
    if (j === '은') return n + (b ? '이는' : '는');
    if (j === '의') return n + (b ? '이의' : '의');
    if (j === '이') return n + (b ? '이가' : '가');
    return n + (b ? '이' : '');
  }).replace(/\{학교\}/g, STORY.school).replace(/\{학년\}/g, state.grade).replace(/\{반\}/g, state.cls);
}

/* 읽어주기: 기계 음성이 어색해서 지금은 꺼 두었어요.
   나중에 녹음 파일이 생기면 대본 줄에 voice:'파일이름.mp3'를 붙이고
   아래 playVoice가 그 파일을 재생하도록 하면 돼요. */
function speak(text){ /* 지금은 소리 없음 */ }
let voicePlayer = null;
function playVoice(file){
  if (!file) return;
  try{ if (voicePlayer) voicePlayer.pause(); voicePlayer = new Audio(file); voicePlayer.play().catch(()=>{}); }catch(e){}
}

/* 하트 그리기 */
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.3 8.2 2.4 4 6.3 4c2.2 0 3.6 1.2 4.4 2.5h2.6C14.1 5.2 15.5 4 17.7 4c3.9 0 6 4.2 4.3 7.7C19.5 16.4 12 21 12 21z" fill="#ff5a6e"/></svg>';
function drawHearts(popIndex){
  $('hearts').innerHTML = [0,1,2].map(i=>HEART.replace('<svg', `<svg class="${i>=state.hearts?'lost':''} ${i===popIndex?'pop':''}"`)).join('');
}

/* 배경 바꾸기: 두 장을 번갈아 쓰며 부드럽게 바꿔요 */
let bgFront = 'bgA', currentBg = '';
function setBg(k){
  if (k === currentBg) return; currentBg = k;
  const back = bgFront === 'bgA' ? 'bgB' : 'bgA', el = $(back);
  if (BG_IMAGES[k]) {
    const cfg = ANIM[k] || {};
    el.innerHTML = `<div class="pic"><div class="bobw ${cfg.bob?'bob':''}"><div class="kb ${cfg.fast?'fast':''}" style="transform-origin:${cfg.origin||'50% 50%'}"><img src="${BG_IMAGES[k]}" alt=""><canvas></canvas></div></div></div>`;
    el.dataset.fx = cfg.fx ?? .5;
    fitPic(el); el.querySelector('img').onload = ()=>fitPic(el); startAnim(el, cfg);
  } else { stopAnim(); el.innerHTML = ''; }
  el.classList.add('on'); $(bgFront).classList.remove('on'); bgFront = back;
}

const IMG_RATIO = 1264/848;
let animNow = null;      // 지금 움직이는 장면 {canvas, cfg, parts, last}
const rr = (a,b)=>a+Math.random()*(b-a);

function fitPic(layer){   // 그림이 화면을 꽉 채우도록 크기 맞추기
  const pic = layer.querySelector('.pic'); if (!pic) return;
  const W = layer.clientWidth, H = layer.clientHeight;
  const img = pic.querySelector('img'), ratio = img && img.naturalWidth ? img.naturalWidth/img.naturalHeight : IMG_RATIO;
  let w = W, h = W/ratio; if (h < H){ h = H; w = H*ratio; }
  pic.style.width = w+'px'; pic.style.height = h+'px';
  const fx = +(layer.dataset.fx || .5);   // 화면이 좁을 때 그림의 어느 쪽을 보여줄지 (0 왼쪽 ~ 1 오른쪽)
  pic.style.left = Math.min(0, Math.max(W - w, W/2 - fx*w)) + 'px';
  const c = pic.querySelector('canvas'), dpr = Math.min(1.5, window.devicePixelRatio||1);
  c.width = Math.round(w*dpr); c.height = Math.round(h*dpr);
}
addEventListener('resize', ()=>document.querySelectorAll('.bg').forEach(fitPic));

function startAnim(layer, cfg){
  const canvas = layer.querySelector('canvas');
  const parts = {};
  const box = (r)=>({x0:r[0], y0:r[1], x1:r[2], y1:r[3]});
  if (cfg.sparkle) parts.sparkle = Array.from({length:cfg.sparkle[4]}, ()=>({...pt(box(cfg.sparkle)), ph:rr(0,6.3), sp:rr(.8,2.2)}));
  if (cfg.foam)    parts.foam    = Array.from({length:cfg.foam[4]}, ()=>({...pt(box(cfg.foam)), ph:rr(0,6.3), sp:rr(1.5,3)}));
  if (cfg.rain)    parts.rain    = Array.from({length:cfg.rain}, ()=>({x:rr(0,1), y:rr(0,1), l:rr(.02,.045), v:rr(.9,1.4)}));
  if (cfg.wind)    parts.wind    = Array.from({length:cfg.wind}, ()=>({x:rr(-.5,1), y:rr(.05,.6), l:rr(.12,.25), v:rr(.35,.6), c:rr(-.03,.03)}));
  if (cfg.mist)    parts.mist    = Array.from({length:cfg.mist[4]}, ()=>({...pt(box(cfg.mist)), r:rr(.02,.05), v:rr(.01,.03), a:rr(.15,.35)}));
  parts.sparks = []; parts.nextSpark = 0; parts.gulls = []; parts.nextGull = rr(1,4);
  animNow = {canvas, cfg, parts, t:0, last:performance.now()};
  function pt(b){ return {x:rr(b.x0,b.x1), y:rr(b.y0,b.y1), b}; }
}
function stopAnim(){ animNow = null; }

function animLoop(now){
  requestAnimationFrame(animLoop);
  const A = animNow; if (!A || reduceMotion) return;
  const dt = Math.min(.05, (now - A.last)/1000); A.last = now; A.t += dt;
  const c = A.canvas, ctx = c.getContext('2d'), W = c.width, H = c.height, t = A.t, P = A.parts, cfg = A.cfg;
  ctx.clearRect(0,0,W,H);
  // 물 위 반짝임 (별 모양)
  for (const [list, size] of [[P.sparkle, 1], [P.foam, 1.6]]){
    if (!list) continue;
    const col = list === P.sparkle ? cfg.sparkle[5] : '#ffffff';
    for (const s of list){
      const a = Math.pow(Math.max(0, Math.sin(t*s.sp + s.ph)), 6);
      if (a < .005 && Math.random() < .03){ s.x = rr(s.b.x0,s.b.x1); s.y = rr(s.b.y0,s.b.y1); }
      if (a < .02) continue;
      const x = s.x*W, y = s.y*H, r = (2 + 5*a) * size * W/1400;
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, r*.35);
      ctx.beginPath(); ctx.arc(x, y, r*.45, 0, 7); ctx.fill();
      if (list === P.sparkle){ ctx.beginPath(); ctx.moveTo(x-r*1.8, y); ctx.lineTo(x+r*1.8, y); ctx.moveTo(x, y-r*1.8); ctx.lineTo(x, y+r*1.8); ctx.stroke(); }
      else { ctx.beginPath(); ctx.ellipse(x, y, r*1.6, r*.5, 0, 0, 7); ctx.fill(); }
    }
  }
  // 비
  if (P.rain){
    ctx.globalAlpha = .45; ctx.strokeStyle = '#dce9f2'; ctx.lineWidth = Math.max(1, W/900);
    ctx.beginPath();
    for (const d of P.rain){
      d.y += d.v*dt; d.x += d.v*dt*.28; if (d.y > 1){ d.y = -d.l; d.x = rr(-.2,1); }
      ctx.moveTo(d.x*W, d.y*H); ctx.lineTo((d.x + d.l*.28)*W, (d.y + d.l)*H);
    }
    ctx.stroke();
  }
  // 바람 줄기
  if (P.wind){
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, W/1100);
    for (const w of P.wind){
      w.x += w.v*dt; if (w.x > 1.2){ w.x = rr(-.6,-.2); w.y = rr(.05,.6); }
      ctx.globalAlpha = .28;
      ctx.beginPath(); ctx.moveTo(w.x*W, w.y*H); ctx.quadraticCurveTo((w.x + w.l/2)*W, (w.y + w.c)*H, (w.x + w.l)*W, (w.y + w.c*.3)*H); ctx.stroke();
    }
  }
  // 물보라 (위로 피어오르는 하얀 안개)
  if (P.mist){
    for (const m of P.mist){
      m.y -= m.v*dt; const life = (m.b.y1 - m.y)/(m.b.y1 - m.b.y0);
      if (m.y < m.b.y0 - .08){ m.y = m.b.y1; m.x = rr(m.b.x0,m.b.x1); }
      const g = ctx.createRadialGradient(m.x*W, m.y*H, 0, m.x*W, m.y*H, m.r*W*(1+life));
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = m.a * (1 - Math.min(1, Math.max(0, life-.3))); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x*W, m.y*H, m.r*W*(1+life), 0, 7); ctx.fill();
    }
  }
  // 전깃줄 불꽃
  if (cfg.sparks){
    const [sx, sy] = cfg.sparks;
    if (t > P.nextSpark){ P.nextSpark = t + rr(.6,1.6); for (let i=0;i<14;i++) P.sparks.push({x:sx, y:sy, vx:rr(-.12,.12), vy:rr(-.22,-.04), life:rr(.3,.6), age:0}); P.flash = .25; }
    P.flash = Math.max(0, (P.flash||0) - dt);
    if (P.flash > 0){ const g = ctx.createRadialGradient(sx*W, sy*H, 0, sx*W, sy*H, W*.05); g.addColorStop(0,'rgba(255,240,150,.9)'); g.addColorStop(1,'rgba(255,240,150,0)'); ctx.globalAlpha = P.flash*4 > 1 ? 1 : P.flash*4; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx*W, sy*H, W*.05, 0, 7); ctx.fill(); }
    ctx.lineWidth = Math.max(1.5, W/800); ctx.strokeStyle = '#ffe066';
    P.sparks = P.sparks.filter(p=>{ p.age += dt; p.vy += .5*dt; const ox = p.x, oy = p.y; p.x += p.vx*dt; p.y += p.vy*dt;
      ctx.globalAlpha = 1 - p.age/p.life; ctx.beginPath(); ctx.moveTo(ox*W, oy*H); ctx.lineTo(p.x*W + (p.x-ox)*W*2, p.y*H + (p.y-oy)*H*2); ctx.stroke(); return p.age < p.life; });
  }
  // 구급차 경광등
  if (cfg.siren){
    cfg.siren.forEach(([x,y,col], i)=>{
      const on = Math.sin(t*9 + i*Math.PI) > 0;
      const g = ctx.createRadialGradient(x*W, y*H, 0, x*W, y*H, W*.045);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = on ? .85 : .12; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x*W, y*H, W*.045, 0, 7); ctx.fill();
    });
  }
  // 갈매기 (가끔 날아가요)
  if (cfg.gull){
    if (t > P.nextGull){ P.nextGull = t + rr(7,14); P.gulls.push({x:-.05, y:rr(.08,.3), v:rr(.05,.09), s:rr(.012,.022), ph:rr(0,6)}); }
    ctx.strokeStyle = '#3a4250'; ctx.lineCap = 'round';
    P.gulls = P.gulls.filter(g=>{ g.x += g.v*dt; g.y += Math.sin(t*1.3+g.ph)*.004*dt; const f = Math.sin(t*7+g.ph)*.6;
      const x = g.x*W, y = g.y*H, s = g.s*W; ctx.globalAlpha = .9; ctx.lineWidth = Math.max(1.5, s*.18);
      ctx.beginPath(); ctx.moveTo(x - s, y - s*f*.6); ctx.quadraticCurveTo(x - s*.4, y - s*.5, x, y); ctx.quadraticCurveTo(x + s*.4, y - s*.5, x + s, y - s*f*.6); ctx.stroke();
      return g.x < 1.08; });
  }
  ctx.globalAlpha = 1;
}
requestAnimationFrame(animLoop);

/* 화면 효과 */
function fx(k){
  const st = $('stage');
  if (k === 'shake'){ st.classList.add('shake'); Sound.quake(true); }
  if (k === 'tremble'){ st.classList.remove('tremble'); void st.offsetWidth; st.classList.add('tremble'); setTimeout(()=>st.classList.remove('tremble'),1000); Sound.play('rumble'); }
  if (k === 'slow'){ st.classList.add('slow'); Sound.muffle(true); Sound.play('whoosh'); }
  if (k === 'stop'){ st.classList.remove('shake','slow'); Sound.quake(false); Sound.muffle(false); }
  if (k === 'wave'){ const w=$('wave'); w.classList.remove('go'); void w.offsetWidth; w.classList.add('go'); Sound.play('crash'); }
  if (k === 'white'){ const f=$('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); Sound.amb('none'); }
}

/* =================================================================
   흐름 제어: 뒤로가기 · 건너뛰기 · 재시작
   - 장이 시작될 때 상태를 저장(saveSnap)하고, 그 장에서 고른 선택(decisions)과
     지나간 대사 번호(line)를 기록해요.
   - 뒤로가기 = 장 처음부터 같은 선택으로 '빨리 감기'해서 바로 앞 대사에서 멈추기
   - 이미 고른 선택보다 앞으로는 돌아갈 수 없어요 (틀린 답을 지워서 하트를 되살리지 못하게)
   ================================================================= */
const ABORT = { abort: true };
let runId = 0;            // 지금 돌아가는 흐름 번호. 바뀌면 예전 흐름은 멈춰요
let pendings = [];        // 기다리는 중인 것들 (멈출 때 한꺼번에 풀어요)
let ff = null;            // 빨리 감기 중: {decisions, di, stopLine, hint}
let skipping = false;     // 건너뛰기 중 (다음 선택지까지)
let chap = newChap();     // 이번 장의 기록
function newChap(){ return { line: 0, pos: 0, decisions: [], decLine: 0, hint: false }; }
const fast = ()=> !!ff || skipping;
const sfx = (k)=>{ if (!ff) Sound.play(k); };

// 취소할 수 있는 기다림: 다른 흐름으로 바뀌면 ABORT로 멈춰요
function waitFor(setup){
  const id = runId;
  return new Promise((resolve, reject)=>{
    const p = { cancel: ()=>reject(ABORT) };
    pendings.push(p);
    setup(v=>{ pendings = pendings.filter(x=>x !== p); if (id !== runId) reject(ABORT); else resolve(v); });
  });
}
function check(id){ if (id !== runId) throw ABORT; }
function abortRun(){
  runId++; const ps = pendings; pendings = []; ps.forEach(p=>p.cancel());
  advance = null; skipping = false;
  ['choices','feedback','over','cardBox','chapter','menu'].forEach(id=>{ const el = $(id); if (el) el.hidden = true; });
  $('choices').innerHTML = '';
}

/* 말풍선: 글자가 한 글자씩 나오고, 누르면 다음으로 넘어가요 */
let advance = null;   // 지금 '누르면 실행할 일'
function showLine(who, text, dir){
  const [id, mood] = (who || '').split(':');
  const p = id ? PEOPLE[id] : null;
  const name = p ? (typeof p.name === 'function' ? p.name() : p.name) : '';
  $('dialog').hidden = false;
  $('dialog').classList.toggle('narr', !p);
  const ava = $('ava');
  ava.className = 'ava' + (p ? '' : ' none');
  if (p){
    ava.style.background = p.color; ava.style.borderColor = lighten(p.color);
    const src = faceSrc(id, mood);
    const key = id + ':' + (mood||'');
    if (ava.dataset.key !== key){ ava.classList.remove('pop'); void ava.offsetWidth; ava.classList.add('pop'); ava.dataset.key = key; }
    if (src) ava.innerHTML = `<img src="${src}" alt="${name}">`; else ava.textContent = p.mark || name.charAt(0);
  } else ava.dataset.key = '';
  $('who').textContent = name; $('who').style.color = p ? lighten(p.color) : '';
  $('who').hidden = !p;
  $('dir').textContent = dir ? `(${dir})` : ''; $('dir').hidden = !dir;
}
function lighten(hex){ // 이름 글자를 프로필 색보다 밝게
  const n = parseInt(hex.slice(1),16); const f = v=>Math.min(255, Math.round(v + (255-v)*.45));
  return `rgb(${f(n>>16)},${f((n>>8)&255)},${f(n&255)})`;
}
function say(who, rawText, dir){
  const lineNo = chap.line++;
  if (ff){ if (lineNo < ff.stopLine) return; endFF(); }
  const text = fill(rawText);
  showLine(who, text, dir);
  const txt = $('txt'), next = $('next');
  if (skipping){ txt.textContent = text; return; }
  chap.pos = lineNo; updateNav();
  speak(text);
  next.classList.remove('on');
  const id = runId;      // 뒤로가기 등으로 흐름이 바뀌면 이 대사의 타자 효과도 멈춰요
  return waitFor(done=>{
    let i = 0, finished = false;
    const finish = ()=>{ if (id !== runId) return; finished = true; txt.textContent = text; next.classList.add('on'); advance = ()=>{ advance = null; done(); }; };
    if (reduceMotion){ finish(); return; }
    txt.textContent = '';
    advance = finish;     // 글자가 나오는 중에 누르면 한 번에 다 보여줘요
    (function type(){ if (finished || id !== runId) return; i += 1; txt.textContent = text.slice(0,i); if (i >= text.length) finish(); else setTimeout(type, 28); })();
  });
}
function endFF(){ ff = null; updateNav(); }
function stopSkip(){ if (skipping){ skipping = false; updateNav(); } }
// 화면을 누르거나 스페이스/엔터를 누르면 다음으로
$('dialog').addEventListener('click', ()=>{ if (advance && $('choices').hidden) advance(); });
$('stage').addEventListener('click', ()=>{ if (advance && $('choices').hidden && !$('dialog').hidden) advance(); });
addEventListener('keydown', e=>{ if ((e.key===' '||e.key==='Enter') && advance && $('choices').hidden && document.activeElement.tagName!=='INPUT'){ e.preventDefault(); advance(); } });

/* 덮개 화면 보여주고 버튼 누를 때까지 기다리기 */
function waitButton(coverId, btnId){
  $(coverId).hidden = false;
  return waitFor(done=>{ $(btnId).onclick = ()=>{ $(coverId).hidden = true; done(); }; });
}

/* 장 제목 */
async function showChapter(n, title){
  $('chN').textContent = n + '장'; $('chT').textContent = title;
  $('chNum').textContent = `${n}장`; $('chName').textContent = title;
  if (ff) return;
  stopSkip();
  $('chapter').hidden = false; sfx('chapter'); speak(`${n}장. ${title}`);
  await waitFor(done=>{ const t = setTimeout(done, 2200); $('chapter').onclick = ()=>{ clearTimeout(t); done(); }; });
  $('chapter').hidden = true;
}

/* 카드뉴스 팝업 */
function showCard(k){
  if (ff) return;
  stopSkip();
  const c = CARDS[k];
  const box = $('cardBox');
  box.innerHTML = `<div class="card" role="dialog" aria-label="${c.title}">
    <div class="card-top"><span class="kind">${c.kind}</span><span class="chip">${c.no}</span></div>
    <div class="card-body">${c.img ? `<img src="${c.img}" alt="${c.title}">` : ''}<h3>${c.title}</h3>
      <ul>${c.lines.map((l,i)=>`<li class="${c.emph===i?'emph':''}">${l}</li>`).join('')}</ul></div>
    <div class="card-foot"><small>출처: 행정안전부</small><button class="big-btn" id="cardOk">알겠어요!</button></div></div>`;
  sfx('card'); speak(c.title + '. ' + c.lines.join(' '));
  return waitButton('cardBox','cardOk');
}

/* 틀렸을 때: 왜 위험한지 알려줘요 */
function showFeedback(text){
  if (ff) return;
  stopSkip();
  $('fbHeart').innerHTML = HEART.replace('<svg','<svg style="filter:grayscale(1)"');
  $('fbText').textContent = text;
  speak('앗, 위험했어요! ' + text);
  return waitButton('feedback','fbBtn');
}

/* 순서를 섞어요 (정답이 늘 같은 자리에 있으면 외워 버리니까요) */
function shuffle(a){ a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* 선택지 보여주고, 고른 것을 돌려줘요 */
function askChoice(c, opts){
  const byK = (k)=> k === -1 ? {timeout:true, k:-1, ...c.timeout} : opts.find(o=>o.k === k);
  // 빨리 감기 중이면 예전에 골랐던 것을 그대로 골라요
  if (ff){
    if (ff.di < ff.decisions.length){ const k = ff.decisions[ff.di++]; chap.decisions.push(k); chap.decLine = chap.line; return Promise.resolve(byK(k)); }
    endFF();
  }
  stopSkip();
  chap.pos = chap.line; updateNav();
  const box = $('choices');
  box.innerHTML = '';
  const q = document.createElement('div'); q.className = 'q'; q.textContent = fill(c.q); box.appendChild(q);
  let timerId = null, tickId = null;
  return waitFor(done=>{
    const pick = (o)=>{ clearTimeout(timerId); clearInterval(tickId); sfx('tap'); box.hidden = true; box.innerHTML = '';
      chap.decisions.push(o.k); chap.decLine = chap.line; updateNav(); done(o); };
    if (c.timer){
      const bar = document.createElement('div'); bar.className = 'timer'; bar.innerHTML = '<i></i>'; box.appendChild(bar);
      bar.firstChild.animate([{transform:'scaleX(1)'},{transform:'scaleX(0)'}], {duration:c.timer*1000, fill:'forwards'});
      timerId = setTimeout(()=>pick(byK(-1)), c.timer*1000);
      sfx('tick'); tickId = setInterval(()=>sfx('tick'), 1000);
      pendings.push({cancel:()=>{ clearTimeout(timerId); clearInterval(tickId); }});
    }
    opts.forEach((o, n)=>{
      const b = document.createElement('button');
      b.className = 'opt'; b.dataset.k = o.k;
      b.innerHTML = `<span class="num">${n+1}</span><span></span>`;
      b.lastChild.textContent = fill(o.text);
      b.onclick = ()=>pick(o);
      box.appendChild(b);
    });
    if (c.hint && !c.noHint && !state.hintUsed && state.ch >= 2){
      const h = document.createElement('button');
      h.className = 'hint'; h.textContent = STORY.hint.label;
      h.onclick = ()=>{ state.hintUsed = true; chap.hint = true; stats.hints += 1; h.remove(); showLine(STORY.hint.by); const t = fill(c.hint); $('txt').textContent = t; $('next').classList.remove('on'); speak(t); };
      box.appendChild(h);
    }
    box.hidden = false;
    speak(fill(c.q) + ' ' + opts.map((o,n)=>`${n+1}번, ${fill(o.text)}`).join('. '));
  });
}

/* 선택 한 개 처리: 연습 / 하트 없는 선택 / 보통 선택
   정답: res(결과 + 칭찬 대사) → 카드뉴스
   오답: res(결과 장면) → 하트 -1 → 왜 위험한지(fb) → after(인물들의 대화: 남 탓, 앞으로는 이렇게 하자) */
async function doChoice(c){
  const id = runId;
  let opts = c.opts.map((o,k)=>({...o, k}));
  if (!c.unscored) opts = shuffle(opts);
  while (true){
    const o = await askChoice(c, opts); check(id);
    if (c.practice){ Object.assign(state, o.set || {}); return runSteps(o.res || []); }
    if (c.unscored){
      await runSteps(o.res || []); check(id);
      if (o.ok) return;
      opts = opts.filter(x=>x.ok);        // 선생님이 다시 묻고, 첫 번째 선택지만 남아요
      continue;
    }
    const r = await runSteps(o.res || []); check(id);
    if (r === 'over') return r;
    state.lastOk = !!o.ok;
    if (o.ok){
      sfx('correct'); if (!fast()) await wait(450); check(id);
      if (c.card) await showCard(c.card);
      return;
    }
    if (!ff) stats.wrong += 1;   // 랭킹 점수용 (빨리 감기 중에는 다시 세지 않아요)
    state.hearts -= 1; drawHearts(state.hearts); sfx('wrong'); if (!ff) setTimeout(()=>Sound.play('heart'), 300);
    if (state.hearts <= 0){ lastLesson = o.fb; return 'over'; }
    await showFeedback(o.fb); check(id);
    return runSteps(o.after || []);
  }
}

/* 대본 한 줄 실행 */
let lastLesson = '';
async function runStep(s){
  switch (s.t){
    case 'say': if (!fast()) playVoice(s.voice); return say(s.who, s.text, s.dir);
    case 'bg': setBg(typeof s.k === 'function' ? s.k(state) : s.k); return;
    case 'fx':
      if (fast() && ['wave','white','tremble'].includes(s.k)){ if (s.k === 'white') Sound.amb('none'); return; }
      fx(s.k); if (s.k==='wave'||s.k==='white') await wait(700); return;
    case 'card': return showCard(s.k);
    case 'sfx': if (!fast()) Sound.play(typeof s.k === 'function' ? s.k(state) : s.k); return;
    case 'amb': Sound.amb(s.k); return;
    case 'mus': Sound.music(s.k); return;
    case 'choice': return doChoice(s);
    case 'if': if (s.cond(state)) return runSteps(s.steps); return;
    case 'save':
      state.ch = s.ch; state.chTitle = s.title; state.hintUsed = ff ? ff.hint : false;
      saveSnap = JSON.parse(JSON.stringify(state));   // 지금 상태를 저장(세이브)
      chap = newChap(); chap.hint = state.hintUsed;
      if (!ff) $('dialog').hidden = true;
      return showChapter(s.ch, s.title);
    case 'end': stopSkip(); return showEnding();
  }
}
async function runSteps(list){
  const id = runId;
  for (const s of list){ const r = await runStep(s); check(id); if (r === 'over') return 'over'; }
}

/* 게임 전체 흐름: 하트가 0이 되면 이번 장 처음으로 돌아가요 */
let saveSnap = null, saveIdx = 0, topIdx = 0;
const SAVE_AT = SCRIPT.map((s,i)=>s.t === 'save' ? i : -1).filter(i=>i >= 0);
async function play(start = 0){
  const id = runId;
  let i = start;
  try {
    while (i < SCRIPT.length){
      if (SCRIPT[i].t === 'save') saveIdx = i;
      topIdx = i; updateProgress();
      const r = await runStep(SCRIPT[i]); check(id);
      if (r === 'over'){
        fx('stop'); $('dialog').hidden = true; Sound.amb('none'); Sound.music('none'); Sound.play('over');
        $('overText').textContent = lastLesson;
        $('overBtn').textContent = `${state.ch}장 처음부터 다시 하기`;
        speak('앗, 위험했어요! 다시 해볼까요? ' + lastLesson);
        await waitButton('over','overBtn'); check(id);
        Object.assign(state, saveSnap, {hearts:3});   // 저장한 곳으로 돌아가고 하트 3개
        drawHearts(); currentBg = '';
        i = saveIdx; continue;
      }
      i++;
    }
  } catch (e){ if (e !== ABORT) throw e; }
}

/* 진행 막대: 8개 장 + 장 안에서 얼마나 왔는지 */
function updateProgress(){
  const k = SAVE_AT.indexOf(saveIdx);
  const end = SAVE_AT[k+1] ?? SCRIPT.length;
  const inCh = Math.max(0, Math.min(1, (topIdx - saveIdx) / Math.max(1, end - saveIdx)));
  const total = SAVE_AT.length;
  $('pfill').style.width = (((k < 0 ? 0 : k) + inCh) / total * 100).toFixed(1) + '%';
}

/* 아래 버튼들: 뒤로 / 건너뛰기 / 다시 */
function updateNav(){
  const target = chap.pos - 1;
  $('backBtn').disabled = !!ff || target < 0 || target < chap.decLine;
  $('skipBtn').disabled = !!ff || !$('choices').hidden;
  $('skipBtn').classList.toggle('on', skipping);
}
function rewindTo(stopLine, decisions, hint){
  abortRun();
  Object.assign(state, JSON.parse(JSON.stringify(saveSnap)));
  drawHearts(); fx('stop'); currentBg = '';
  ff = stopLine == null ? null : { decisions, di: 0, stopLine, hint };
  updateNav();
  play(saveIdx);
}
function goBack(){
  if ($('backBtn').disabled) return;
  rewindTo(chap.pos - 1, chap.decisions.slice(), chap.hint);
}
function goSkip(){
  if ($('skipBtn').disabled) return;
  skipping = true; updateNav();
  if (advance){ advance(); if (advance) advance(); }   // 지금 대사도 바로 넘겨요
}
function restartChapter(){ $('menu').hidden = true; rewindTo(null); }
function restartGame(){
  $('menu').hidden = true; abortRun(); ff = null;
  Object.assign(state, { hearts: 3, loc: 'sand', lastOk: true, hintUsed: false });
  stats.wrong = 0; stats.hints = 0; myEntry = null;
  drawHearts(); fx('stop'); currentBg = ''; Sound.music('none');
  play(0);
}

/* =================================================================
   랭킹 보드 (Supabase)
   - 아래 두 칸에 Supabase 프로젝트 주소와 공개 키(anon / publishable)를 넣으면 켜져요.
   - 비어 있으면 랭킹 버튼은 보이지만 "아직 연결 안 됨"이라고 나와요.
   ================================================================= */
const GAME_VERSION = STORY.version;
const RANK = STORY.rank || { url: '', key: '' };   // 주소와 공개 키는 story.js에 있어요
// 점수 계산에 쓰는 기록 (장을 다시 해도 틀린 횟수·힌트는 지워지지 않아요)
const stats = { wrong: 0, hints: 0 };
const SCORE = { base: 1000, heart: 200, wrong: 100, hint: 50 };
function calcScore(){
  return Math.max(0, SCORE.base + state.hearts*SCORE.heart - stats.wrong*SCORE.wrong - stats.hints*SCORE.hint);
}
const rankOn = ()=> !!(RANK.url && RANK.key);
async function rankApi(path, opts = {}){
  const res = await fetch(`${RANK.url.replace(/\/$/,'')}/rest/v1/${path}`, {
    ...opts, headers: { apikey: RANK.key, 'Content-Type': 'application/json', ...(opts.headers||{}) }
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();          // 올리기는 빈 응답이 와요
  return text ? JSON.parse(text) : null;
}
let myEntry = null;      // 방금 올린 내 기록 (목록에서 강조)
async function submitScore(nickname){
  const row = { nickname, grade: state.grade, cls: state.cls, hearts: state.hearts,
                wrongs: stats.wrong, hints: stats.hints, score: calcScore(), version: GAME_VERSION, game: STORY.id };
  try { await rankApi('scores', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) }); }
  catch (err){
    // 아직 표에 'game' 칸이 없으면 그 칸만 빼고 다시 올려요 (supabase/schema.sql 참고)
    if (!/game/.test(String(err.message))) throw err;
    delete row.game;
    await rankApi('scores', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  }
  myEntry = row;
}
let rankTab = 'class';
async function showRanking(tab = rankTab){
  rankTab = tab;
  $('tabClass').classList.toggle('on', tab === 'class'); $('tabAll').classList.toggle('on', tab === 'all');
  $('tabClass').textContent = `${state.grade}학년 ${state.cls}반`;
  const list = $('rankList'); $('rankBox').hidden = false;
  const msg = (t)=>{ list.innerHTML = ''; const li = document.createElement('li'); li.className = 'empty'; li.textContent = t; list.appendChild(li); };
  if (!rankOn()) return msg('아직 랭킹 서버가 연결되지 않았어요. 선생님께 말씀드려 주세요.');
  msg('불러오는 중…');
  try {
    const filter = tab === 'class' ? `&grade=eq.${state.grade}&cls=eq.${state.cls}` : '';
    const q = (g)=>`scores?select=nickname,grade,cls,score,hearts,wrongs,hints,created_at${g}${filter}&order=score.desc,created_at.asc&limit=20`;
    let rows;
    try { rows = await rankApi(q(`&game=eq.${STORY.id}`)); }        // 이 게임 기록만
    catch (err){ rows = await rankApi(q('')); }                       // 'game' 칸이 아직 없을 때
    if (!rows.length) return msg('아직 기록이 없어요. 첫 번째 주인공이 되어 볼까요?');
    list.innerHTML = '';
    let marked = false;
    rows.forEach((r, i)=>{
      const li = document.createElement('li');
      const mine = !marked && myEntry && r.nickname === myEntry.nickname && r.score === myEntry.score && r.grade === myEntry.grade && r.cls === myEntry.cls;
      if (mine){ li.className = 'me'; marked = true; }
      li.innerHTML = `<span class="r">${i+1}</span><span class="n"></span><span class="s">${r.score}점</span>`;
      const n = li.querySelector('.n'); n.textContent = r.nickname;   // 별명은 글자로만 넣어요 (안전)
      const small = document.createElement('small');
      small.textContent = (tab === 'all' ? `${r.grade}-${r.cls} · ` : '') + `♥${r.hearts} · 틀림 ${r.wrongs} · 힌트 ${r.hints}`;
      n.appendChild(small);
      list.appendChild(li);
    });
  } catch (e){ msg('랭킹을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); }
}

/* 엔딩: 남은 하트로 칭호, 안전수칙 카드 넘겨보기 */
function showEnding(){
  fx('stop'); $('dialog').hidden = true; Sound.amb('calm'); Sound.music('hope'); Sound.play('fanfare');
  const titles = STORY.badges;
  $('badge').textContent = titles[state.hearts] || titles[1];
  $('whoLine').textContent = `${STORY.school} ${state.grade}학년 ${state.cls}반 ${state.name}`;
  // 점수와 계산 내용
  $('scoreNum').textContent = calcScore();
  const part = (t, cls)=>{ const sp = document.createElement('span'); sp.className = cls || ''; sp.textContent = t; return sp; };
  const parts = $('scoreParts'); parts.innerHTML = '';
  parts.append(part(`기본 ${SCORE.base}`), part(`남은 하트 ${state.hearts}개 +${state.hearts*SCORE.heart}`,'plus'),
               part(`틀린 횟수 ${stats.wrong}번 −${stats.wrong*SCORE.wrong}`,'minus'), part(`힌트 ${stats.hints}번 −${stats.hints*SCORE.hint}`,'minus'));
  $('nickMsg').textContent = rankOn() ? '별명을 쓰고 랭킹에 올려 봐요! (진짜 이름은 쓰지 않아요)' : '랭킹 서버가 아직 연결되지 않았어요.';
  $('nickBtn').disabled = false; $('nick').disabled = false;
  $('nickForm').onsubmit = async (e)=>{
    e.preventDefault();
    const nick = $('nick').value.trim();
    if (!nick){ $('nickMsg').textContent = '별명을 먼저 써 주세요!'; return; }
    if (!rankOn()){ showRanking('class'); return; }
    $('nickBtn').disabled = true; $('nickMsg').textContent = '올리는 중…';
    try { await submitScore(nick); $('nick').disabled = true; $('nickMsg').textContent = '랭킹에 올렸어요!'; showRanking('class'); }
    catch (err){ $('nickBtn').disabled = false; $('nickMsg').textContent = '올리지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
  };
  const pages = [...RULES.map((r,i)=>({no:`안전수칙 ${i+1} / ${RULES.length}`, text:r})),
                 {no:'더 알아보기', text:CARDS[STORY.moreInfoCard].lines[0], small:'출처: 행정안전부'}];
  let at = 0;
  const draw = ()=>{
    const p = pages[at];
    $('rule').innerHTML = `<div class="no">${p.no}</div><p></p>${p.small?`<small>${p.small}</small>`:''}`;
    $('rule').querySelector('p').textContent = p.text;
    $('dots').innerHTML = pages.map((_,i)=>`<i class="${i===at?'on':''}"></i>`).join('');
    $('prevR').disabled = at === 0; $('nextR').disabled = at === pages.length-1;
    speak(p.text);
  };
  $('prevR').onclick = ()=>{ if (at>0){ at--; draw(); } };
  $('nextR').onclick = ()=>{ if (at<pages.length-1){ at++; draw(); } };
  $('ending').hidden = false;
  draw();
  speak(`${$('badge').textContent}! 오늘 배운 안전수칙을 넘겨 봐요.`);
  return new Promise(r=>{ $('againBtn').onclick = ()=>{ $('ending').hidden = true; r(); location.reload(); }; });
}

/* ⑥ 시작 화면 */
(function init(){
  // 이야기 파일의 제목·학교 이름을 화면에 넣어요
  document.title = STORY.title;
  $('gameTitle').innerHTML = STORY.titleHTML || STORY.title;
  $('kicker').textContent = STORY.kicker || '';
  $('schoolShort').value = STORY.schoolShort || STORY.school || '';
  $('chTotal').textContent = `/ ${CHAPTERS}장`;
  document.querySelectorAll('.ver').forEach(v=>v.textContent = STORY.version);
  for (let g=1; g<=6; g++) $('gr').add(new Option(g+'학년', g, g===STORY.defaultGrade, g===STORY.defaultGrade));
  for (let c=1; c<=10; c++) $('cl').add(new Option(c+'반', c, c===STORY.defaultClass, c===STORY.defaultClass));
  setBg('beach');
  const sndUi = ()=>{ $('sndBtn').setAttribute('aria-pressed', Sound.on); $('sndLbl').textContent = Sound.on ? '소리 켬' : '소리 끔'; };
  sndUi();
  $('sndBtn').onclick = (e)=>{ e.stopPropagation(); Sound.init(); Sound.setOn(!Sound.on); sndUi(); };
  // 뒤로 / 건너뛰기 / 다시 버튼
  $('backBtn').onclick = (e)=>{ e.stopPropagation(); goBack(); };
  $('skipBtn').onclick = (e)=>{ e.stopPropagation(); goSkip(); };
  $('restartBtn').onclick = (e)=>{ e.stopPropagation(); $('rsChapter').textContent = `${state.ch}장 처음부터`; $('menu').hidden = false; };
  $('rsChapter').onclick = restartChapter;
  $('rsGame').onclick = restartGame;
  $('rsCancel').onclick = ()=>{ $('menu').hidden = true; };
  // 랭킹 보드
  $('rankOpen1').onclick = ()=>{ state.grade = +$('gr').value; state.cls = +$('cl').value; showRanking('class'); };
  $('rankOpen2').onclick = ()=>showRanking('class');
  $('tabClass').onclick = ()=>showRanking('class');
  $('tabAll').onclick = ()=>showRanking('all');
  $('rankClose').onclick = ()=>{ $('rankBox').hidden = true; };
  $('startForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = $('nm').value.replace(/\s/g,'');
    if (!name){ $('err').textContent = '이름을 먼저 써 주세요!'; $('nm').focus(); return; }
    state.name = name;
    // 세 글자 한글 이름이면 성을 빼고 불러요 (김하늘 → 하늘)
    state.call = /^[가-힣]{3}$/.test(name) ? name.slice(1) : name;
    state.grade = +$('gr').value; state.cls = +$('cl').value;
    Sound.init();   // 효과음은 버튼을 누른 뒤에만 켤 수 있어요
    $('start').hidden = true; $('hud').hidden = false; drawHearts();
    if (STORY.startCard) await showCard(STORY.startCard);
    play(0);
  });
})();
