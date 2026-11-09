// ReviewFlow og:video v4 — records office: typed sheets, two rubber stamps, an archive box. Canon: films/_v4/briefs/reviewflow.md
(() => {
const { el, add, rnd, onSeek, end, stage } = K;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const eOut = (p) => 1 - Math.pow(1 - p, 3);
const eIn = (p) => p * p * p;
const eIO = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const back = (p, c = 2.2) => 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
const step = (t, fps) => Math.floor(t * fps + 1e-6) / fps;
const R = (a, b) => a + (b - a) * rnd();
const vis = (n, on) => (n.style.visibility = on ? 'visible' : 'hidden');
const jolt = (t, t0, amp = 7, f = 42, d = 0.2) => (t < t0 || t > t0 + d ? 0 : amp * Math.cos((t - t0) * f) * (1 - (t - t0) / d));
function grain() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d'), im = x.createImageData(256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const v = 205 + rnd() * 50; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  x.putImageData(im, 0, 0); return el(`<div id="grainc" style="background:url(${c.toDataURL()})"></div>`);
}
stage.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute"><filter id="rough" x="-6%" y="-12%" width="112%" height="124%"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="5" result="lo"/><feDisplacementMap in="SourceGraphic" in2="lo" scale="6" result="d"/><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="2" seed="9" result="hi"/><feColorMatrix in="hi" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -3.4 2.75" result="m"/><feComposite in="d" in2="m" operator="in"/></filter></svg>`);

// ================= A: three sheets, six stamps
const SA = add(stage, el('<div class="scene"><div class="w"></div></div>')), WA = SA.querySelector('.w');
const sheetHTML = `<div class="hd">EVIDENCE TASK</div><div class="sd">Synthetic demo</div><div class="r1"></div><div class="ce">Cited evidence</div>
<div class="ln" style="top:146px"></div><div class="ln" style="top:174px"></div><div class="ln" style="top:202px;right:300px"></div>
<div class="bx" style="left:40px"><b>Model proposal</b></div><div class="bx" style="left:454px"><b>Human review</b></div>
<div class="ft">Model proposals are suggestions, not ground truth.</div>`;
const VC = [233, 338], RC = [647, 338];
// [violet text, size, red html, size, red rot, hit times V, R, leave]
const defs = [
  { v: 'Supported', vs: 84, r: 'Accept · Supported', rs: 56, rr: 5, tv: 0.2, tr: 0.62, out: 0.9, rot: -1.6 },
  { v: 'Supported', vs: 84, r: 'Correct to<br>Contradicted', rs: 62, rr: -7, tv: 1.16, tr: 1.5, out: 1.9, rot: 2.2, rx: -70, strike: 1 },
  { v: 'Contradicted', vs: 68, r: 'Escalate', rs: 104, rr: 6, tv: 2.08, tr: 2.4, out: 99, rot: -2.4 },
];
const sheets = defs.map((d) => ({ ...d }));
[2, 1, 0].forEach((i) => {
  const d = sheets[i], n = add(WA, el(`<div class="sheet">${sheetHTML}</div>`));
  d.n = n;
  d.mv = add(n, el(`<div class="mark v" style="font-size:${d.vs}px">${d.v}</div>`));
  d.sp = []; const mkS = (c, col) => { for (let k = 0; k < 9; k++) { const a = R(0, 6.28), r = R(150, 250), s = R(4, 15); d.sp.push({ n: add(n, el(`<div class="splat" style="width:${s}px;height:${s * R(0.7, 1.2)}px;background:${col};transform:translate(${(c[0] + (d.rx && col.includes('red') ? d.rx : 0) + Math.cos(a) * r).toFixed(0)}px,${(c[1] + Math.sin(a) * r * 0.5).toFixed(0)}px)"></div>`)), red: col.includes('red') }); } };
  mkS(VC, 'var(--vio)');
  if (d.strike) d.st = add(n, el('<div class="strike"></div>'));
  d.mr = add(n, el(`<div class="mark r" style="font-size:${d.rs}px">${d.r}</div>`));
  mkS(RC, 'var(--red)');
  d.sv = add(n, el('<div class="tsh"></div>')); d.tv_ = add(n, el('<div class="tool v"><div class="pl">Model proposal</div><div class="kn"></div></div>'));
  d.sr = add(n, el('<div class="tsh"></div>')); d.tr_ = add(n, el('<div class="tool r"><div class="pl">Human review</div><div class="kn"></div></div>'));
});
const centre = (n, c, rot, s = 1, dx = 0, dy = 0) => (n.style.transform = `translate(${(c[0] + dx).toFixed(1)}px,${(c[1] + dy).toFixed(1)}px) translate(-50%,-50%) rotate(${rot}deg) scale(${s.toFixed(4)})`);
// a stamp tool: falls onto the paper (h 1→0), sits a beat, then is lifted away
function tool(n, sh, c, t, hit, dir, rot) {
  const ts = step(t, 30);
  const fall = seg(t, hit - 0.4, hit), up = eOut(seg(ts, hit + 0.07, hit + 0.3));
  const h = t < hit ? 1 - eIn(fall) : up * 1.25;
  const on = t >= hit - 0.4 && ts < hit + 0.3;
  vis(n, on); vis(sh, on);
  const dx = t < hit ? dir * 26 * h : dir * 950 * up, dy = t < hit ? -18 * h : -560 * up;
  n.style.transform = `translate(${(c[0] + dx).toFixed(1)}px,${(c[1] + dy).toFixed(1)}px) rotate(${(rot + dir * 10 * (t < hit ? h * 0.5 : up)).toFixed(2)}deg) scale(${(1 + 1.25 * h).toFixed(4)})`;
  sh.style.transform = `translate(${(c[0] + dx + 70 * h).toFixed(1)}px,${(c[1] + dy + 90 * h).toFixed(1)}px) rotate(${rot}deg) scale(${(1 + 0.9 * h).toFixed(4)})`;
}

// ================= B: into the archive box
const SB = add(stage, el('<div class="scene"><div class="w"></div></div>')), WB = SB.querySelector('.w');
const typed = add(WB, el('<div class="typed"></div>')), TY = 'AI proposals,\nhuman review,\nimmutable releases.';
add(WB, el('<div class="syn">Synthetic demo</div>'));
const pad = add(WB, el('<div class="pad"><i></i></div>'));
let files = ''; for (let i = 0; i < 8; i++) files += `<div class="fl" style="top:${40 + i * 60}px"></div><div class="tb" style="top:${24 + i * 60}px;left:${[40, 150, 280, 90, 230, 300, 60, 190][i]}px"></div>`;
const box = add(WB, el(`<div class="box">${files}</div>`));
const mini = add(WB, el(`<div class="mini"><div class="ln" style="top:40px"></div><div class="ln" style="top:66px"></div><div class="ln" style="top:92px;right:150px"></div>
<div class="mark v" style="font-size:36px;border-width:4px;padding:7px 12px 2px;transform:translate(22px,150px) rotate(-4deg)">Contradicted</div>
<div class="mark r" style="font-size:54px;border-width:5px;padding:7px 14px 2px;transform:translate(204px,128px) rotate(6deg)">Escalate</div>
<div class="tag" style="left:8px">DECISION</div><div class="tag" style="left:138px">REASON</div><div class="tag" style="left:268px">SOURCE</div></div>`));
const tags = [...mini.querySelectorAll('.tag')];
const lid = add(WB, el('<div class="lid"><div class="lp"><b>Releases</b><span>decision · reason · source</span></div></div>'));

// ================= C: the box label
const SC = add(stage, el(`<div class="scene s3"><div class="w"><div class="plate"><div class="eb">Review workspace</div><div class="nm">ReviewFlow</div><div class="pr">Turn evidence into trusted decisions.</div><div class="r1"></div>
<div class="by">Experimental local review application.<br>Built by Sunny Patneedi</div>
<div class="strike" style="transform:translate(486px,326px) rotate(-1deg)"></div>
<div class="mark v" style="font-size:66px">Synthetic demo</div></div>
<div class="screw" style="left:24px;top:298px"></div><div class="screw" style="left:1100px;top:298px"></div></div></div>`));
const WC = SC.querySelector('.w'), eStrike = SC.querySelector('.strike'), eMark = SC.querySelector('.mark');
add(stage, grain());

onSeek.push((t) => {
  const ts = step(t, 30);
  vis(SA, t < 3); vis(SB, t >= 3 && t < 6); vis(SC, t >= 6);
  if (t < 3) {
    let j = 0; sheets.forEach((d) => { j += jolt(t, d.tv, 12) + jolt(t, d.tr, 14); });
    WA.style.transform = `translate(${(j * 0.35).toFixed(1)}px,${j.toFixed(1)}px)`;
    sheets.forEach((d, i) => {
      const o = eIn(seg(ts, d.out, d.out + 0.14));
      d.n.style.transform = `translate(${(600 + i * 9 + 1500 * o).toFixed(1)}px,${(322 + i * 7 - 90 * o).toFixed(1)}px) rotate(${(d.rot + 16 * o).toFixed(2)}deg)`;
      vis(d.n, o < 1);
      tool(d.tv_, d.sv, VC, t, d.tv, -1, -4); tool(d.tr_, d.sr, [RC[0] + (d.rx || 0), RC[1]], t, d.tr, 1, d.rr);
      vis(d.mv, t >= d.tv); vis(d.mr, t >= d.tr);
      centre(d.mv, VC, -4, 1, 0, 4); centre(d.mr, RC, d.rr, 1, d.rx || 0, 6);
      d.sp.forEach((s) => vis(s.n, t >= (s.red ? d.tr : d.tv)));
      if (d.st) { const p = seg(t, d.tr + 0.2, d.tr + 0.29); vis(d.st, p > 0); d.st.style.width = `${(380 * p).toFixed(0)}px`; d.st.style.transform = `translate(50px,${VC[1] + 26}px) rotate(-7deg)`; }
    });
  } else if (t < 6) {
    const fly = eIO(seg(ts, 4.0, 4.36)), jb = jolt(t, 4.36, 5) + jolt(t, 5.74, 10);
    WB.style.transform = `translate(0,${jb.toFixed(1)}px)`;
    box.style.transform = 'translate(930px,318px) rotate(1.5deg)';
    pad.style.transform = 'translate(560px,520px) rotate(-9deg)';
    const drop = 1 + 0.16 * Math.sin(fly * Math.PI);
    mini.style.transform = `translate(${lerp(340, 930, fly).toFixed(1)}px,${lerp(300, 330, fly).toFixed(1)}px) rotate(${lerp(-5, 93, fly).toFixed(2)}deg) scale(${(lerp(1.34, 0.9, fly) * drop).toFixed(4)})`;
    tags.forEach((g, i) => { const t0 = [3.18, 3.4, 3.54][i], p = back(seg(ts, t0, t0 + 0.14), 3); vis(g, ts >= t0); g.style.transform = `translate(0,${(-30 * (1 - p)).toFixed(1)}px) rotate(${[-3, 2, -1.5][i]}deg) scale(${lerp(1.5, 1, p).toFixed(3)})`; });
    const n = Math.floor(seg(t, 4.16, 5.0) * TY.length);
    typed.textContent = TY.slice(0, n);
    const lp = eOut(seg(ts, 5.52, 5.74));
    lid.style.transform = `translate(${lerp(1560, 930, lp).toFixed(1)}px,318px) rotate(${lerp(9, 1.5, lp).toFixed(2)}deg)`;
  } else {
    const j = jolt(t, 6.3, 9);
    WC.style.transform = `translate(${(j * 0.3).toFixed(1)}px,${j.toFixed(1)}px)`;
    const sp = seg(t, 6.2, 6.3);
    vis(eMark, t >= 6.2); eMark.style.opacity = t < 6.3 ? 0.4 : 1;
    centre(eMark, [806, 418], -6, lerp(1.8, 1, sp * sp));
    const p = seg(t, 6.52, 6.66); vis(eStrike, p > 0); eStrike.style.width = `${(196 * p).toFixed(0)}px`;
  }
});
end();
})();
