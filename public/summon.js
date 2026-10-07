/* Anime Boosters — ouverture « Cercle d'invocation ».
   Le joueur pose le pack dans un cercle runique. Le cercle s'allume rune après rune et prend la couleur
   de la meilleure carte du pack, puis tout explose en lumière : les cartes retombent face cachée autour
   du cercle et leur aura trahit leur rareté. Les grosses raretés ont droit à leur propre mise en scène.
   Les cartes affichées sont celles du jeu (cardHtml) : ce module ne s'occupe que de la mise en scène. */
(function (root) {
'use strict';
const REDUCED = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NEUTRAL = '#9fd0ff';
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const STOP = Symbol('stop');
// intensité de la mise en scène selon le rang de rareté du jeu (0 commune … 8 au sommet)
const lvlOf = r => r >= 9.5 ? 8 : r >= 8 ? 7 : r >= 7 ? 6 : r >= 5 ? 5 : r >= 4 ? 4 : r >= 3 ? 3 : r >= 2 ? 2 : r >= 1 ? 1 : 0;
const el = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };
const centerOf = e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// raretés très claires (Oméga, Absolue…) : on dose la lumière pour ne pas tout blanchir
const lum = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- déroulé annulable : tout s'arrête net quand on ferme ou qu'on passe au pack suivant ---------- */
class Run {
    constructor() { this.dead = false; this.timers = new Set(); this.rejects = new Set(); this.offs = []; }
    wait(ms) {
        if (this.dead) return Promise.reject(STOP);
        return new Promise((res, rej) => {
            const t = setTimeout(() => { this.timers.delete(t); this.rejects.delete(rej); res(); }, ms);
            this.timers.add(t); this.rejects.add(rej);
        });
    }
    // promesse résolue par un geste du joueur, rejetée si on arrête tout
    until(fn) {
        if (this.dead) return Promise.reject(STOP);
        return new Promise((res, rej) => { this.rejects.add(rej); fn(v => { this.rejects.delete(rej); res(v); }); });
    }
    on(t, ev, h, o) { t.addEventListener(ev, h, o); this.offs.push(() => t.removeEventListener(ev, h, o)); }
    later(f) { this.offs.push(f); }
    // animation attendue : rejette STOP si on arrête tout pendant qu'elle tourne
    anim(e, kf, o) {
        if (this.dead) return Promise.reject(STOP);
        return e.animate(kf, o).finished.then(() => { if (this.dead) throw STOP; }, () => { if (this.dead) throw STOP; });
    }
    // animation « lancée et oubliée »
    fire(e, kf, o) { if (this.dead || !e.animate) return null; const a = e.animate(kf, o); a.finished.catch(() => {}); return a; }
    kill() {
        if (this.dead) return;
        this.dead = true;
        this.timers.forEach(clearTimeout); this.timers.clear();
        this.offs.forEach(f => { try { f(); } catch (_) {} }); this.offs = [];
        this.rejects.forEach(r => r(STOP)); this.rejects.clear();
    }
}

/* ---------- sons générés (avec réverbération), rien à télécharger ---------- */
function makeAudio(muted) {
    let ac = null, master = null, rev = null, amb = null;
    function init() {
        if (ac || muted()) return;
        try {
            ac = new (root.AudioContext || root.webkitAudioContext)();
            const comp = ac.createDynamicsCompressor();
            master = ac.createGain(); master.gain.value = 0.8; master.connect(comp).connect(ac.destination);
            rev = ac.createConvolver();
            const len = Math.floor(ac.sampleRate * 2.6), b = ac.createBuffer(2, len, ac.sampleRate);
            for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
            rev.buffer = b; const rg = ac.createGain(); rg.gain.value = 0.3; rev.connect(rg).connect(master);
        } catch (_) { ac = null; }
    }
    const ok = () => { if (muted()) return false; init(); if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); return !!ac; };
    function out(n, wet = 0.3) { n.connect(master); if (wet) { const s = ac.createGain(); s.gain.value = wet; n.connect(s).connect(rev); } }
    function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    function noise(dur) { const b = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * dur)), ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = ac.createBufferSource(); s.buffer = b; return s; }
    function tone(type, f0, f1, t, a, peak, d, wet) { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + d); env(g, t, a, peak, d); o.connect(g); out(g, wet); o.start(t); o.stop(t + a + d + 0.05); }
    function filt(type, f0, f1, t, dur, peak, a = 0.05, wet = 0.25, q = 1) { const s = noise(dur), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); env(g, t, a, peak, Math.max(0.01, dur - a)); s.connect(f).connect(g); out(g, wet); s.start(t); }
    function pad(root0, dur, vol, cutoff = 1500, mults = [1, 1.25, 1.5, 2, 2.5]) {
        const t = ac.currentTime, lp = ac.createBiquadFilter(), g = ac.createGain();
        lp.type = 'lowpass'; lp.frequency.value = cutoff;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        lp.connect(g); out(g, 0.7);
        mults.forEach(m => [-7, 7].forEach(c => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root0 * m; o.detune.value = c; o.connect(lp); o.start(t); o.stop(t + dur + 0.1); }));
    }
    const S = {
        init,
        whoosh(d = 0.6, v = 0.2) { if (ok()) filt('bandpass', 300, 3000, ac.currentTime, d, v, d * 0.6, 0.3, 1.3); },
        swish() { if (ok()) filt('bandpass', 2600, 900, ac.currentTime, 0.18, 0.12, 0.01, 0.12, 1.6); },
        riser(d = 1.4, v = 0.12) { if (!ok()) return; const t = ac.currentTime; filt('highpass', 300, 6000, t, d, v, d * 0.9, 0.4); tone('sawtooth', 90, 640, t, d * 0.92, 0.045, 0.15, 0.25); },
        tick(i = 0) { if (ok()) tone('sine', 520 * Math.pow(1.045, i), null, ac.currentTime, 0.004, 0.06, 0.18, 0.4); },
        thud(v = 0.4) { if (!ok()) return; const t = ac.currentTime; tone('sine', 130, 45, t, 0.005, v, 0.32, 0.05); filt('lowpass', 700, 120, t, 0.22, v * 0.5, 0.005, 0.05); },
        boom(p = 1) { if (!ok()) return; const t = ac.currentTime; tone('sine', 120, 30, t, 0.01, 0.6 * p, 0.9, 0.12); filt('lowpass', 2600, 140, t, 0.75, 0.42 * p, 0.005, 0.45); },
        crack() { if (ok()) filt('highpass', 6000, 1200, ac.currentTime, 0.35, 0.22, 0.004, 0.35, 0.7); },
        chime(f = 880, v = 0.12) { if (!ok()) return; const t = ac.currentTime; tone('sine', f, null, t, 0.005, v, 1.5, 0.55); tone('sine', f * 2.01, null, t, 0.005, v * 0.3, 1, 0.55); },
        chord(lvl) { if (!ok()) return; const base = [0, 784, 659, 523, 523, 440, 392, 349, 330][lvl] || 523; [1, 1.26, 1.5, 2].slice(0, 2 + Math.min(2, lvl)).forEach((m, i) => setTimeout(() => S.chime(base * m, 0.11), i * 85)); },
        shimmer(n = 8) { if (!ok()) return; for (let i = 0; i < n; i++) setTimeout(() => S.chime(1500 + Math.random() * 1800, 0.035), i * 55); },
        choir(r0 = 196, d = 3.2, v = 0.06) { if (ok()) pad(r0, d, v); },
        drone(r0 = 98, d = 3, v = 0.07) { if (ok()) pad(r0, d, v, 500, [1, 1.5, 2]); },
        heart(v = 0.55) { if (!ok()) return; const t = ac.currentTime; tone('sine', 70, 40, t, 0.006, v, 0.24, 0.08); tone('sine', 66, 38, t + 0.2, 0.006, v * 0.75, 0.24, 0.08); },
        hum(lvl) { if (!ok()) return; const f = [180, 220, 262, 294, 330, 392, 440, 494, 523][lvl] || 220; const t = ac.currentTime; tone('sine', f, null, t, 0.08, 0.035 + lvl * 0.006, 0.7, 0.5); if (lvl >= 3) tone('sine', f * 1.5, null, t, 0.08, 0.025, 0.7, 0.5); },
        // nappe sombre pendant que la salle est ouverte
        ambient(on) {
            if (!on) { if (amb) { try { const t = ac.currentTime; amb.g.gain.setTargetAtTime(0.0001, t, 0.2); amb.os.forEach(o => o.stop(t + 1)); } catch (_) {} amb = null; } return; }
            if (amb || !ok()) return;
            const t = ac.currentTime, lp = ac.createBiquadFilter(), g = ac.createGain();
            lp.type = 'lowpass'; lp.frequency.value = 340; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.022, t + 1.5);
            lp.connect(g); out(g, 0.5);
            const os = [55, 82.4, 110.2].map((f, i) => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = i * 5 - 5; o.connect(lp); o.start(t); return o; });
            amb = { g, os };
        }
    };
    return S;
}

/* ---------- lumière douce sur un canvas : éclats, anneaux, bulles qui montent, lueurs qui tournent vers le centre ---------- */
function makeGlow(cv) {
    const ctx = cv.getContext('2d'), P = [];
    let W = 0, H = 0, raf = 0, last = 0;
    function size() { const dpr = Math.min(2, root.devicePixelRatio || 1); W = cv.clientWidth || root.innerWidth; H = cv.clientHeight || root.innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function add(p) { if (P.length > 420) return; p.age = 0; P.push(p); if (!raf) raf = root.requestAnimationFrame(tick); }
    function tick(t) {
        const dt = Math.min(48, last ? t - last : 16); last = t;
        ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter';
        for (let i = P.length - 1; i >= 0; i--) {
            const p = P[i]; p.age += dt;
            if (p.age >= p.life) { P.splice(i, 1); continue; }
            const k = p.age / p.life;
            let x = p.x, y = p.y, r = p.r, a = p.a;
            if (p.kind === 'flare') { r = p.r * (0.3 + 0.7 * Math.sqrt(k)); a = p.a * (1 - k) * (1 - k); }
            else if (p.kind === 'ring') { r = p.r * (0.12 + 0.88 * (1 - Math.pow(1 - k, 3))); a = p.a * (1 - k); }
            else if (p.kind === 'spiral') {
                const e = k * k * (3 - 2 * k), rr = p.r0 * (1 - e), an = p.a0 + p.turns * Math.PI * 2 * e;
                x = p.cx + Math.cos(an) * rr; y = p.cy + Math.sin(an) * rr * p.ky; r = p.r * (0.5 + 0.8 * k); a = p.a * Math.sin(Math.PI * Math.min(1, k * 1.1));
            } else { p.x += p.vx * dt / 16; p.y += p.vy * dt / 16; x = p.x; y = p.y; a = p.a * Math.sin(Math.PI * k); }
            if (a <= 0.004) continue;
            ctx.globalAlpha = Math.min(1, a);
            const g = ctx.createRadialGradient(x, y, p.kind === 'ring' ? r * 0.7 : 0, x, y, Math.max(1, r));
            if (p.kind === 'ring') { g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.6, p.c); g.addColorStop(1, 'rgba(0,0,0,0)'); }
            else { g.addColorStop(0, p.core || p.c); g.addColorStop(0.35, p.c); g.addColorStop(1, 'rgba(0,0,0,0)'); }
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (P.length) raf = root.requestAnimationFrame(tick); else { raf = 0; last = 0; ctx.clearRect(0, 0, W, H); }
    }
    const n = v => REDUCED ? Math.ceil(v / 3) : v;
    return {
        size,
        flare(x, y, size, c, life = 900, a = 0.9) { add({ kind: 'flare', x, y, r: size, c, core: '#ffffff', a, life }); },
        ring(x, y, size, c, life = 800, a = 0.7) { add({ kind: 'ring', x, y, r: size, c, a, life }); },
        orbs(count, c, box, o = {}) {
            for (let i = 0; i < n(count); i++) add({ kind: 'orb', x: box.x + Math.random() * box.w, y: box.y + Math.random() * box.h, vx: rand(-0.15, 0.15), vy: -rand((o.rise || 0.5) * 0.3, o.rise || 0.5), r: rand(o.min || 5, o.max || 18), c, a: rand(0.35, o.alpha || 0.8), life: rand(1500, o.life || 3400) });
        },
        spiral(cx, cy, r0, ky, count, c, life = 1100) {
            for (let i = 0; i < n(count); i++) add({ kind: 'spiral', cx, cy, ky, r0: r0 * rand(0.85, 1.15), a0: rand(0, Math.PI * 2), turns: rand(0.35, 0.8), r: rand(5, 13), c, a: rand(0.5, 0.95), life: life * rand(0.75, 1.15) });
        },
        clear() { P.length = 0; }
    };
}

/* ---------- le cercle d'invocation, dessiné une fois ---------- */
function circleSvg() {
    const P = (r, a) => [(r * Math.cos(a * Math.PI / 180)).toFixed(2), (r * Math.sin(a * Math.PI / 180)).toFixed(2)];
    let ticks = '';
    for (let i = 0; i < 72; i++) { const a = i * 5, [x1, y1] = P(90, a), [x2, y2] = P(i % 6 ? 92.6 : 95, a); ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
    const outer = `<circle r="98" stroke-width="1.3"/><circle r="95.6" stroke-width=".45"/><g stroke-width=".5">${ticks}</g><circle r="89" stroke-width=".7"/>`;
    const tri = a0 => [0, 120, 240].map(a => P(74, a0 + a).join(',')).join(' ');
    let dots = '';
    for (let i = 0; i < 24; i++) { const [x, y] = P(53, i * 15); dots += `<circle class="fill" cx="${x}" cy="${y}" r="${i % 2 ? .9 : 1.6}"/>`; }
    const sq = a0 => [0, 90, 180, 270].map(a => P(30, a0 + a).join(',')).join(' ');
    const nodes = [0, 60, 120, 180, 240, 300].map(a => { const [x, y] = P(74, a - 90); return `<circle cx="${x}" cy="${y}" r="5.2" stroke-width=".8"/><circle class="fill" cx="${x}" cy="${y}" r="1.6"/>`; }).join('');
    const sigil = `<circle r="78" stroke-width=".9"/><circle r="74" stroke-width=".35"/><polygon points="${tri(-90)}" stroke-width=".9"/><polygon points="${tri(90)}" stroke-width=".9"/>${nodes}`
        + `<circle r="40" stroke-width=".8"/><circle r="36.6" stroke-width=".35"/><polygon points="${sq(0)}" stroke-width=".6"/><polygon points="${sq(45)}" stroke-width=".6"/><circle r="14" stroke-width=".7"/><circle class="fill" r="3"/>`;
    const inner = `<circle r="56.5" stroke-width=".55"/><circle r="49.5" stroke-width=".55"/>${dots}`;
    const svg = g => ['dim', 'lit'].map(c => `<svg class="${c}" viewBox="-100 -100 200 200" aria-hidden="true">${g}</svg>`).join('');
    return { outer: svg(outer), sigil: svg(sigil), inner: svg(inner) };
}

function create(o) {
    const stage = o.stage, ui = o.ui;
    const audio = makeAudio(o.muted || (() => false));
    const glow = makeGlow(o.canvas);
    const hint = t => { if (o.hint) o.hint.textContent = t || ''; };
    const SV = circleSvg();
    stage.innerHTML = `<div class="sm-bg"><i class="sm-tint"></i><i class="sm-fog"></i></div>
      <div class="sm-floor"><i class="f-pool"></i><i class="f-stone"></i>
        <div class="f-spin f-outer">${SV.outer}</div>
        <div class="f-spin f-runes"></div>
        <div class="f-spin f-inner">${SV.inner}</div>
        <div class="f-spin f-sigil">${SV.sigil}</div>
        <i class="f-core"></i></div>
      <div class="sm-pillars"></div><div class="sm-slots"></div><div class="sm-spot"></div><div class="sm-flash"></div>`;
    if (o.canvas) { o.canvas.style.zIndex = 20; stage.append(o.canvas); }
    const cvSpot = el('canvas', 'sm-glow sm-glow-spot'), glowS = makeGlow(cvSpot);
    const floor = stage.querySelector('.sm-floor'), slotsBox = stage.querySelector('.sm-slots'), pillarsBox = stage.querySelector('.sm-pillars');
    const spot = stage.querySelector('.sm-spot'), flashEl = stage.querySelector('.sm-flash');
    const runesBox = floor.querySelector('.f-runes'), sigil = floor.querySelector('.f-sigil');
    const runes = [];
    for (let i = 0; i < 24; i++) { const b = el('b', '', RUNES[i % RUNES.length]); b.style.setProperty('--a', (i * 15) + 'deg'); runesBox.append(b); runes.push(b); }
    [0, 60, 120, 180, 240, 300].forEach(a => { const nd = el('i', 'f-node'); nd.style.setProperty('--a', a + 'deg'); sigil.append(nd); });
    // les anneaux tournent en continu ; on peut les accélérer sans à-coup
    const spinners = [];
    const spin = (e, dur, dir) => { if (!e.animate) return; const a = e.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${dir * 360}deg)` }], { duration: dur, iterations: Infinity }); spinners.push({ a, dur, dir }); };
    spin(floor.querySelector('.f-outer'), 140000, 1);
    spin(runesBox, 90000, -1);
    spin(floor.querySelector('.f-inner'), 50000, 1);
    spin(sigil, 70000, 1);
    const sigilSpin = spinners[3];
    const speed = v => spinners.forEach(s => { try { s.a.updatePlaybackRate ? s.a.updatePlaybackRate(v) : (s.a.playbackRate = v); } catch (_) {} });

    let run = null, cur = null, L = null, ambT = 0;
    const setPower = v => stage.style.setProperty('--pw', clamp(v, 0, 1).toFixed(3));
    const setLit = c => stage.style.setProperty('--lit', c);

    /* ----- mise en page : tout est calculé d'après la taille de l'écran ----- */
    function layout() {
        const W = stage.clientWidth || root.innerWidth, H = stage.clientHeight || root.innerHeight;
        const uih = ui ? ui.getBoundingClientRect().height : 120;
        const topM = 54, botM = uih + 8, n = cur ? cur.n : 5, sBack = 0.8;
        const avail = H - topM - botM;
        // écran en hauteur (téléphone) : on regarde le cercle plus d'en haut pour utiliser la place
        const kMax = H / W > 1.3 ? 0.95 : n >= 8 ? 0.72 : 0.62;
        let rx = Math.min(W * 0.45, 440), ry = 0, w = 0, h = 0, k = 0.5;
        for (let i = 0; i < 60; i++) {
            const per = r => 2 * Math.PI * Math.sqrt((r * r + (r * k) ** 2) / 2) / n;
            w = Math.min(per(rx) * 0.8, W < 640 ? 132 : 164); h = w * 1.4;
            // plus l'écran est haut, plus on voit le cercle d'au-dessus
            k = clamp((avail - h * sBack * 1.12 - h * 0.16) / (2 * rx), 0.46, kMax);
            ry = rx * k;
            w = Math.min(per(rx) * 0.8, W < 640 ? 132 : 164); h = w * 1.4;
            const fitsH = ry * 2 + h * sBack * 1.12 + h * 0.16 <= avail, fitsW = rx + w * 0.5 + 10 <= W / 2;
            if ((fitsH && fitsW) || rx < 70) break;
            rx *= 0.96;
        }
        const minCy = topM + ry + h * sBack * 1.12, maxCy = H - botM - ry - h * 0.16;
        const cy = minCy <= maxCy ? (minCy + maxCy) / 2 : minCy, cx = W / 2;
        L = { W, H, cx, cy, rx, ry, k, w, h, n, botM, topM };
        Object.assign(floor.style, { left: (cx - rx) + 'px', top: (cy - rx) + 'px', width: (rx * 2) + 'px', height: (rx * 2) + 'px' });
        floor.style.setProperty('--k', k.toFixed(3)); floor.style.setProperty('--d', (rx * 2) + 'px');
        stage.style.setProperty('--cyp', (cy / H * 100).toFixed(1) + '%');
        o.root.style.setProperty('--uih', uih + 'px');
        if (cur && cur.slots) placeSlots();
        if (cur && cur.pack && cur.pack.state === 'rest') placePack(packRest());
    }
    function slotPos(i, n) {
        const th = -Math.PI / 2 + i * 2 * Math.PI / n + (n % 2 ? 0 : Math.PI / n);
        const d = (Math.sin(th) + 1) / 2, s = 0.8 + 0.2 * d;
        const fx = L.cx + L.rx * Math.cos(th), fy = L.cy + L.ry * Math.sin(th);
        return { th, d, s, fx, fy, x: fx, y: fy - L.h * s * 0.62 };
    }
    function placeSlots() {
        cur.slots.forEach((sl, i) => {
            const p = slotPos(i, cur.slots.length);
            Object.assign(sl, p);
            const e = sl.el;
            e.style.left = p.x + 'px'; e.style.top = p.y + 'px'; e.style.scale = p.s.toFixed(3);
            e.style.setProperty('--w', L.w + 'px'); e.style.zIndex = 10 + Math.round(p.d * 20);
        });
    }

    /* ----- le pack ----- */
    function packRest() {
        const pw = clamp(L.w * 0.95, 92, 150), ph = pw * 1.44;
        if (L.W - (L.cx + L.rx) > pw * 1.35) return { x: L.cx + L.rx + pw * 0.8, y: L.cy + L.ry * 0.15, pw };
        return { x: L.cx, y: Math.min(L.H - L.botM - ph * 0.52, L.cy + L.ry + ph * 0.18), pw };
    }
    const packCenter = () => ({ x: L.cx, y: L.cy - (cur.pack.pw * 1.44) * 0.32 });
    function placePack(p) {
        const pk = cur.pack;
        pk.x = p.x; pk.y = p.y; if (p.pw) pk.pw = p.pw;
        pk.el.style.left = pk.x + 'px'; pk.el.style.top = pk.y + 'px'; pk.el.style.setProperty('--pkw', pk.pw + 'px');
    }
    const inCircle = (x, y) => { const dx = (x - L.cx) / L.rx, dy = (y - L.cy) / L.ry; return dx * dx + dy * dy < 0.62; };

    /* ----- petits effets réutilisés ----- */
    function flash(c, x, y, peak = 0.85, ms = 520) {
        flashEl.style.setProperty('--c', c); flashEl.style.setProperty('--fx', x + 'px'); flashEl.style.setProperty('--fy', y + 'px');
        run.fire(flashEl, [{ opacity: 0 }, { opacity: peak, offset: 0.18 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
    }
    function shake(p = 8, ms = 420) {
        if (REDUCED || p <= 0) return;
        const f = []; for (let i = 0; i < 10; i++) { const k = 1 - i / 10; f.push({ transform: `translate(${(rand(-p, p) * k).toFixed(1)}px, ${(rand(-p, p) * k).toFixed(1)}px)` }); }
        f.push({ transform: 'none' }); run.fire(stage, f, { duration: ms });
    }
    function wave(c, scale = 3.4, ms = 950, thin) {
        const w = el('i', 'f-wave'); w.style.setProperty('--wc', c); if (thin) w.style.borderWidth = '1.5px';
        floor.append(w);
        const a = run.fire(w, [{ transform: 'scale(.15)', opacity: 1 }, { transform: `scale(${scale})`, opacity: 0 }], { duration: ms, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' });
        if (a) a.finished.then(() => w.remove(), () => w.remove()); else w.remove();
    }
    function pillars(fast) {
        pillarsBox.innerHTML = '';
        const t = sigilSpin && sigilSpin.a.currentTime != null ? sigilSpin.a.currentTime : 0;
        const rot = ((t % sigilSpin.dur) / sigilSpin.dur) * 360 * sigilSpin.dir;
        [0, 60, 120, 180, 240, 300].forEach((a, i) => {
            const an = (a - 90 + rot) * Math.PI / 180, x = L.cx + Math.cos(an) * L.rx * 0.74, y = L.cy + Math.sin(an) * L.ry * 0.74;
            const p = el('i', 'sm-pillar');
            p.style.left = x + 'px'; p.style.top = y + 'px';
            p.style.setProperty('--pwid', (L.rx * 0.2) + 'px'); p.style.setProperty('--phei', (L.H * 0.9) + 'px'); p.style.zIndex = Math.sin(an) > 0 ? 3 : 1;
            pillarsBox.append(p);
            run.fire(p, [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 0.85 }], { duration: fast ? 200 : 420, delay: i * (fast ? 20 : 60), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
        });
    }
    function clearPillars(ms = 500) {
        [...pillarsBox.children].forEach(p => { const a = run && !run.dead ? run.fire(p, [{ opacity: 0.85 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }) : null; if (a) a.finished.then(() => p.remove(), () => p.remove()); else p.remove(); });
    }
    function startAmbience() {
        clearInterval(ambT);
        if (REDUCED) return;
        // poussière de lumière qui flotte au-dessus du cercle
        ambT = setInterval(() => { if (L && cur) glow.orbs(1, 'rgba(170,190,255,.55)', { x: L.cx - L.rx, y: L.cy - L.ry * 0.6, w: L.rx * 2, h: L.ry * 1.4 }, { rise: 0.35, min: 3, max: 8, alpha: 0.45, life: 4200 }); }, 420);
    }

    /* ----- ouverture d'un nouveau pack ----- */
    function reset() {
        if (run) run.kill();
        run = new Run();
        glow.clear(); glowS.clear(); clearInterval(ambT); o.root.classList.remove('spotting');
        slotsBox.innerHTML = ''; pillarsBox.innerHTML = ''; spot.className = 'sm-spot'; spot.innerHTML = '';
        floor.querySelectorAll('.f-wave').forEach(w => w.remove());
        stage.querySelectorAll('.sm-pack').forEach(p => p.remove());
        runes.forEach(b => b.classList.remove('on'));
        stage.classList.remove('awake', 'lit', 'rainbow', 'quick');
        setPower(0); setLit(NEUTRAL); speed(1);
    }
    function open(p) {
        reset();
        cur = { n: p.n || 5, auto: !!p.auto, pack: null, slots: null, cards: null, spot: null, allRunning: false, done: false };
        if (cur.auto) stage.classList.add('quick');
        layout(); glow.size();
        const rest = packRest();
        const e = el('div', 'sm-pack idle', `<div class="pk-in"><div class="pk-body"><div class="pk-img"></div><i class="pk-crimp t"></i><i class="pk-crimp b"></i><div class="pk-emo">${esc(p.emo || '')}</div><div class="pk-name">${esc(p.name || '')}</div></div></div>`);
        if (p.art) e.querySelector('.pk-img').style.backgroundImage = `url("${String(p.art).replace(/"/g, '%22')}")`;
        e.setAttribute('role', 'button'); e.setAttribute('aria-label', 'Pack : glisse-le dans le cercle ou touche-le'); e.tabIndex = 0;
        stage.append(e);
        cur.pack = { el: e, x: 0, y: 0, pw: rest.pw, state: 'rest' };
        placePack(rest);
        run.fire(e, [{ transform: 'translateY(60vh) rotate(-25deg) scale(.6)', opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: 'none', opacity: 1 }], { duration: cur.auto ? 320 : 700, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
        audio.whoosh(0.5, 0.14); audio.ambient(true);
        startAmbience();
        hint(cur.auto ? '' : 'Glisse le pack dans le cercle (ou touche-le)');
    }
    // le joueur pose le pack dans le cercle (en mode auto, il y va tout seul)
    function drop() {
        const R = run, pk = cur.pack;
        return R.until(done => {
            let drag = null, flying = false;
            const target = () => packCenter();
            const fly = async () => {
                if (flying || R.dead) return;
                flying = true; pk.state = 'flying'; stage.classList.remove('awake'); hint('');
                const t = target(), dx = pk.x - t.x, dy = pk.y - t.y;
                placePack({ x: t.x, y: t.y });
                pk.el.classList.remove('idle', 'drag'); pk.el.querySelector('.pk-in').style.transform = '';
                const dur = cur.auto ? 380 : 620;
                try {
                    await R.anim(pk.el, [{ transform: `translate(${dx}px, ${dy}px) rotate(${clamp(dx * 0.03, -18, 18)}deg)` }, { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 60}px) rotate(${clamp(dx * 0.01, -8, 8)}deg) scale(1.08)`, offset: 0.55 }, { transform: 'none' }],
                        { duration: dur, easing: 'cubic-bezier(.35,.05,.25,1)' });
                } catch (_) { return; }
                pk.state = 'center'; pk.el.classList.add('hover');
                audio.thud(0.35); audio.chime(330, 0.07);
                wave(NEUTRAL, 1.6, 700, true); setPower(0.12);
                done(true);
            };
            cur.fly = fly;
            if (cur.auto) { fly(); return; }
            const e = pk.el;
            R.on(e, 'pointerdown', ev => {
                if (flying) return;
                ev.preventDefault(); audio.init();
                try { e.setPointerCapture(ev.pointerId); } catch (_) {}
                drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, px: pk.x, py: pk.y, moved: 0, lx: ev.clientX, lt: performance.now(), inside: false };
                e.classList.add('drag'); e.classList.remove('idle');
            });
            R.on(e, 'pointermove', ev => {
                if (!drag || ev.pointerId !== drag.id) return;
                const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0, now = performance.now();
                drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
                const vx = (ev.clientX - drag.lx) / Math.max(8, now - drag.lt) * 16; drag.lx = ev.clientX; drag.lt = now;
                placePack({ x: drag.px + dx, y: drag.py + dy });
                e.querySelector('.pk-in').style.transform = `rotate(${clamp(vx * 1.8, -16, 16).toFixed(1)}deg) scale(1.06)`;
                const inside = inCircle(pk.x, pk.y + pk.pw * 0.5);
                if (inside !== drag.inside) { drag.inside = inside; stage.classList.toggle('awake', inside); setPower(inside ? 0.25 : 0); if (inside) audio.hum(2); }
            });
            const up = ev => {
                if (!drag || ev.pointerId !== drag.id) return;
                const d = drag; drag = null; e.classList.remove('drag');
                e.querySelector('.pk-in').style.transform = '';
                if (d.moved < 8 || inCircle(pk.x, pk.y + pk.pw * 0.5)) { fly(); return; }
                // relâché à côté : il revient à sa place
                const rest = packRest(), dx = pk.x - rest.x, dy = pk.y - rest.y;
                placePack(rest); stage.classList.remove('awake'); setPower(0); e.classList.add('idle');
                R.fire(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,1.2,.4,1)' });
            };
            R.on(e, 'pointerup', up); R.on(e, 'pointercancel', up);
            R.on(e, 'keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fly(); } });
        });
    }
    // renvoie vrai si le pack attendait encore d'être posé
    function tapPack() { if (cur && cur.fly && cur.pack && cur.pack.state === 'rest') { cur.fly(); return true; } return false; }
    function setAuto(v) { if (!cur) return; cur.auto = !!v; stage.classList.toggle('quick', cur.auto); if (v && cur.fly && cur.pack && cur.pack.state === 'rest') cur.fly(); }

    /* ----- le cercle se charge dans la couleur de la meilleure carte, puis tout explose ----- */
    async function ignite(cards, god) {
        const R = run, fast = cur.auto, pk = cur.pack;
        cur.cards = cards; cur.god = !!god;
        const ranks = cards.map(c => o.rankOf(c)), best = Math.max(...ranks);
        const tl = god ? Math.max(5, lvlOf(best)) : lvlOf(best);
        const bestCard = cards[ranks.indexOf(best)];
        const tell = god ? '#ffd700' : tl >= 1 ? o.colorOf(bestCard) : NEUTRAL;
        cur.tell = { lvl: tl, color: tell };
        hint('');
        pk.el.classList.remove('hover'); pk.el.classList.add('charging');
        setLit(tell);
        audio.riser(fast ? 0.55 : 1.5, 0.1 + tl * 0.012);
        if (!fast) glow.spiral(L.cx, L.cy, L.rx * 1.05, L.k, 18 + tl * 6, tell, 1300);
        const N = runes.length, step = fast ? 11 : 46;
        for (let i = 0; i < N; i++) {
            runes[i].classList.add('on');
            setPower(0.15 + 0.85 * (i + 1) / N);
            if (!fast && i % 2 === 0) audio.tick(i / 2);
            if (i % 4 === 0) speed(1 + (i / N) * (fast ? 4 : 9));
            if (i === Math.floor(N * 0.55)) pillars(fast);
            await R.wait(step);
        }
        // une respiration… puis l'explosion
        if (!fast) { const pc = centerOf(pk.el); glow.flare(pc.x, pc.y, 120, tell, 380, 0.6); }
        await R.wait(fast ? 50 : 240);
        await burst(tl, tell, fast);
        await deal(fast);
    }
    async function burst(tl, tell, fast) {
        const R = run, pk = cur.pack, pc = centerOf(pk.el), big = Math.max(L.W, L.H);
        flash(tell, pc.x, pc.y, fast ? 0.5 : Math.min(0.95, 0.6 + tl * 0.05), fast ? 300 : 520);
        glow.flare(pc.x, pc.y, big * (0.3 + tl * 0.05), tell, fast ? 600 : 1200, 1);
        glow.ring(pc.x, pc.y, big * 0.3, tell, 800, 0.5);
        wave(tell, 3.6, fast ? 600 : 1000); if (!fast) setTimeout(() => !R.dead && wave('#ffffff', 2.6, 700, true), 90);
        if (tl >= 6 && !fast) setTimeout(() => !R.dead && wave(tell, 4.4, 1300), 260);
        shake(fast ? 3 : 4 + tl * 1.7, fast ? 260 : 480);
        audio.boom(0.75 + tl * 0.07); audio.crack(); if (!fast) audio.shimmer(6 + tl);
        if (tl >= 4 && !fast) audio.choir(tl >= 6 ? 147 : 196, 3.4, 0.05);
        if (tl === 4 || tl === 8) stage.classList.add('rainbow');
        clearPillars(fast ? 250 : 700);
        stage.classList.add('lit');
        pk.state = 'gone';
        R.fire(pk.el, [{ transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }, { transform: 'scale(1.5)', opacity: 0, filter: 'brightness(3) blur(6px)' }], { duration: fast ? 160 : 300, easing: 'ease-out', fill: 'forwards' });
        if (cur.god && o.onGod) o.onGod();
        await R.wait(fast ? 90 : 180);
        pk.el.remove();
        setPower(0.55); speed(1.6);
    }
    /* ----- les cartes jaillissent du centre et se posent autour du cercle ----- */
    async function deal(fast) {
        const R = run, cards = cur.cards, order = shuffle(cards.map((c, i) => i));
        cur.slots = order.map(ci => makeSlot(cards[ci], ci));
        placeSlots();
        const pc = packCenter(), dur = fast ? 380 : 720, gap = fast ? 32 : 85;
        cur.slots.forEach((sl, k) => {
            const dx = (pc.x - sl.x) / sl.s, dy = (pc.y - sl.y) / sl.s;
            R.fire(sl.el, [{ transform: `translate(${dx}px, ${dy}px) scale(.12) rotateY(540deg)`, opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'none', opacity: 1 }],
                { duration: dur, delay: k * gap, easing: 'cubic-bezier(.2,.85,.25,1.12)', fill: 'backwards' });
            const t = setTimeout(() => {
                if (R.dead) return;
                sl.el.classList.add('landed');
                if (!fast) { audio.thud(0.12 + sl.lvl * 0.03); audio.swish(); }
                if (sl.lvl >= 2) { const c = centerOf(sl.el); glow.ring(sl.fx, sl.fy, L.w * (0.8 + sl.lvl * 0.15), sl.color, 700, 0.35 + sl.lvl * 0.04); if (sl.lvl >= 3 && !fast) glow.flare(c.x, c.y, L.w * 1.6, sl.color, 700, 0.45); }
            }, k * gap + dur * 0.8);
            R.later(() => clearTimeout(t));
        });
        await R.wait(cur.slots.length * gap + dur);
        cur.dealt = true;
        if (!fast) hint('Touche les cartes pour les retourner');
    }
    function makeSlot(card, ci) {
        const r = o.rankOf(card), lv = lvlOf(r), col = o.colorOf(card);
        const e = el('div', `sm-slot l${lv}`);
        e.style.setProperty('--c', col); e.style.setProperty('--bd', (-Math.random() * 3.4).toFixed(2) + 's');
        e.tabIndex = 0; e.setAttribute('role', 'button'); e.setAttribute('aria-label', 'Carte face cachée : touche pour la retourner');
        e.innerHTML = `<i class="sm-pool"></i><div class="sm-float"><div class="sm-tilt">${auraHtml(lv)}<div class="sm-in"><div class="back t${Math.min(5, lv)}"><i class="emb"></i></div><div class="face">${o.cardHtml(card, { isNew: card.isNew, coins: card.coins })}</div></div></div></div>`;
        slotsBox.append(e);
        const sl = { el: e, card, ci, lvl: lv, rank: r, color: col, up: false, busy: false };
        run.on(e, 'click', () => onSlot(sl));
        run.on(e, 'keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSlot(sl); } });
        run.on(e, 'pointerenter', ev => { if (ev.pointerType === 'mouse' && !sl.up && !sl.busy && cur && cur.dealt) { e.classList.add('hot'); audio.hum(lv); } });
        run.on(e, 'pointerleave', () => e.classList.remove('hot'));
        return sl;
    }
    const auraHtml = lv => lv <= 0 ? '' : '<i class="sm-aura"></i>' + (lv >= 5 ? '<i class="sm-halo"></i>' : '') + (lv >= 3 ? '<i class="sm-flames"><i></i><i></i><i></i></i>' : '');
    function onSlot(sl) {
        if (!cur || !cur.dealt) return;
        hint('');
        if (sl.up) { if (!cur.spot && !sl.busy) o.inspect(sl.card); return; }
        if (sl.busy || cur.allRunning || cur.spot) return;
        flip(sl, cur.auto, false).catch(e => { if (e !== STOP) console.error(e); });
    }

    /* ----- retourner une carte : plus elle est rare, plus le suspense et la lumière montent ----- */
    async function flip(sl, fast, fromAll) {
        const R = run;
        if (sl.up || sl.busy) return;
        sl.busy = true; sl.el.classList.remove('hot');
        try {
            if (sl.lvl >= 3 && (!fast || sl.lvl >= 6)) await spotlight(sl, fast, fromAll);
            else {
                if (sl.lvl === 2 && !fast) {
                    sl.el.classList.add('tease'); audio.tick(8); audio.tick(11);
                    const c = centerOf(sl.el); glow.flare(c.x, c.y, L.w * 1.2, sl.color, 420, 0.4);
                    await R.wait(360);
                    sl.el.classList.remove('tease');
                }
                sl.el.style.setProperty('--flip', ((fast ? 0.32 : [0.42, 0.5, 0.62, 0.68, 0.72][Math.min(4, sl.lvl)]) + 's'));
                sl.el.classList.add('up'); sl.up = true;
                revealFx(sl, fast);
                if (!fast) await R.wait(sl.lvl >= 2 ? 360 : 200);
            }
        } finally { sl.busy = false; }
        sl.up = true; sl.el.setAttribute('aria-label', `${o.labelOf(sl.card)} : ${sl.card.name}`);
        if (sl.card.isNew && sl.lvl < 3 && !fast) { const t = el('div', 'sm-new', 'Nouveau !'); sl.el.querySelector('.sm-tilt').append(t); setTimeout(() => t.remove(), 1900); }
        checkDone();
    }
    function revealFx(sl, fast) {
        const c = centerOf(sl.el), lv = sl.lvl;
        if (lv === 0) { audio.swish(); if (!fast) glow.flare(c.x, c.y, L.w * 0.7, '#cfd8ff', 380, 0.25); }
        else if (lv === 1) { audio.swish(); audio.chime(988, 0.09); glow.flare(c.x, c.y, L.w * 1.3, sl.color, 600, 0.55); glow.ring(sl.fx, sl.fy, L.w * 0.9, sl.color, 600, 0.4); }
        else {
            audio.swish(); audio.chord(lv); if (lv >= 3) audio.boom(0.35);
            glow.flare(c.x, c.y, L.w * (1.6 + lv * 0.2), sl.color, 800, 0.75); glow.ring(sl.fx, sl.fy, L.w * 1.5, sl.color, 800, 0.55);
            if (!fast) { shake(2 + lv, 240); glow.orbs(6 + lv * 3, sl.color, { x: c.x - L.w * 0.6, y: c.y - L.w * 0.4, w: L.w * 1.2, h: L.w * 0.9 }, { rise: 0.6, max: 12, life: 2400 }); }
        }
        if (sl.card.finish || sl.card.shiny) { audio.shimmer(5); glow.orbs(8, '#fff3c4', { x: c.x - L.w * 0.5, y: c.y - L.w * 0.7, w: L.w, h: L.w * 1.4 }, { rise: 0.25, min: 3, max: 7, life: 1600 }); }
    }

    /* ----- la grande scène des raretés légendaires et au-delà ----- */
    async function spotlight(sl, fast, fromAll) {
        const R = run, lv = sl.lvl, card = sl.card, col = sl.color;
        cur.spot = sl;
        o.root.classList.add('spotting');
        const W = L.W, H = L.H, uih = L.botM, isSpecial = lv >= 5, label = o.labelOf(card);
        // place : bannière au-dessus, carte au centre, nom et chance en dessous
        const bannerH = isSpecial ? 112 : 88, subH = 96, room = H - uih - L.topM - bannerH - subH;
        const bw = Math.round(clamp(Math.min(W * 0.62, room / 1.4), 140, 300)), bh = bw * 1.4;
        const sy = L.topM + bannerH + bh / 2 + Math.max(0, room - bh) * 0.3;
        const smallTxt = card.season ? 'Carte de saison' : card.rarity === 'duo' ? 'Carte duo' : isSpecial ? 'Rareté spéciale' : '';
        const odds = o.oddsOf ? o.oddsOf(card) : '';
        const fin = o.finishOf ? o.finishOf(card) : '';
        const pale = lum(col) > 0.78;
        spot.className = `sm-spot on l${lv}${pale ? ' pale' : ''}`;
        spot.style.setProperty('--c', col); spot.style.setProperty('--sy', sy + 'px'); spot.style.setProperty('--syp', (sy / H * 100).toFixed(1) + '%'); spot.style.setProperty('--bw', bw + 'px');
        spot.style.setProperty('--bt', (sy - bh / 2 - bannerH + 4) + 'px'); spot.style.setProperty('--st', (sy + bh / 2 + 14) + 'px');
        spot.innerHTML = `<div class="sp-dim"></div><div class="sp-pillar"></div><div class="sp-rays"></div><div class="sp-glow"></div>
          <div class="sm-big l${lv}" style="--c:${col}">${auraHtml(lv)}<div class="sm-in"><div class="back t${Math.min(5, lv)}"><i class="emb"></i></div><div class="face">${o.cardHtml(card, { isNew: card.isNew, coins: card.coins })}</div></div></div>
          <div class="sm-banner ${lv <= 4 ? 'ribbon' : ''}">${smallTxt ? `<small>${esc(smallTxt)}</small>` : ''}<b>${esc(label)}</b></div>
          <div class="sm-sub"><div class="nm">${esc(card.name)}</div><div class="an">${esc(card.anime || '')}</div><div class="chips">${odds ? `<span class="odds">🎲 ${esc(odds)}</span>` : ''}${fin ? `<span>${esc(fin)}</span>` : ''}${card.shiny ? '<span>✨ Brillante</span>' : ''}${card.isNew ? '<span style="color:#39ff9a">Nouvelle !</span>' : ''}</div><div class="sm-skip">Touche pour continuer</div></div>`;
        spot.insertBefore(cvSpot, spot.querySelector('.sm-big')); glowS.size();
        const big = spot.querySelector('.sm-big'), dim = spot.querySelector('.sp-dim'), rays = spot.querySelector('.sp-rays'), pil = spot.querySelector('.sp-pillar'), gl = spot.querySelector('.sp-glow');
        const banner = spot.querySelector('.sm-banner'), sub = spot.querySelector('.sm-sub'), skip = spot.querySelector('.sm-skip');
        // la carte quitte sa place et vient devant, encore face cachée
        const r0 = sl.el.getBoundingClientRect(), r1 = big.getBoundingClientRect();
        const fromT = `translate(${(r0.left + r0.width / 2) - (r1.left + r1.width / 2)}px, ${(r0.top + r0.height / 2) - (r1.top + r1.height / 2)}px) scale(${(r0.width / r1.width).toFixed(3)})`;
        sl.el.style.visibility = 'hidden';
        const k = fast ? 0.45 : 1;
        R.fire(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 500 * k, fill: 'forwards' });
        if (lv >= 5 && !fast) { audio.drone(lv >= 7 ? 73 : 98, 3.6, 0.08); }
        audio.riser((fast ? 0.6 : 1.2) + lv * 0.08, 0.1);
        await R.anim(big, [{ transform: fromT }, { transform: 'translateY(-4%) scale(1.04) rotate(-2deg)', offset: 0.7 }, { transform: 'none' }], { duration: 650 * k + lv * 20, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'backwards' });
        // suspense : la carte tremble, la lumière monte, le cœur bat pour les très grosses
        big.classList.add('charge');
        R.fire(gl, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 700 * k, fill: 'forwards' });
        if (lv >= 5) R.fire(pil, [{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 0.9, transform: 'scaleY(1)' }], { duration: 600 * k, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        const beats = fast ? (lv >= 7 ? 1 : 0) : lv >= 8 ? 3 : lv >= 6 ? 2 : lv >= 5 ? 1 : 0;
        for (let i = 0; i < beats; i++) { audio.heart(0.45 + i * 0.1); flash(col, W / 2, sy, 0.25 + i * 0.08, 320); shake(3 + i * 2, 220); await R.wait(520); }
        const cc = { x: W / 2, y: sy };
        glowS.spiral(cc.x, cc.y, bw * 1.3, 1, fast ? 10 : 18 + lv * 4, col, 700 * k + 200);
        await R.wait((fast ? 200 : 520 + Math.min(4, lv - 3) * 90));
        // révélation
        big.classList.remove('charge');
        big.style.setProperty('--flip', fast ? '.45s' : '.75s');
        big.classList.add('up');
        flash(col, cc.x, cc.y, lv >= 7 ? 1 : 0.85, lv >= 7 ? 900 : 620);
        glowS.flare(cc.x, cc.y, Math.max(W, H) * (0.4 + lv * 0.03), col, 1300, pale ? 0.5 : 0.9);
        glowS.ring(cc.x, cc.y, bw * 2.2, col, 900, 0.6); glowS.ring(cc.x, cc.y, bw * 1.3, '#ffffff', 600, 0.5);
        shake(fast ? 5 : 8 + lv * 2, 520);
        audio.boom(0.95 + lv * 0.06); audio.chord(lv); audio.shimmer(8 + lv);
        if (lv >= 4) audio.choir(lv >= 7 ? 131 : lv >= 5 ? 165 : 196, 3.6, 0.065);
        if (lv >= 7 && !fast) { setTimeout(() => { if (R.dead) return; flash('#ffffff', cc.x, cc.y, 1, 700); glowS.ring(cc.x, cc.y, Math.max(W, H) * 0.7, '#ffffff', 1100, 0.6); shake(18, 600); audio.boom(1.2); }, 420); }
        R.fire(rays, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 900 * k, easing: 'ease-out', fill: 'forwards' });
        R.fire(banner, [{ opacity: 0, transform: 'scale(2.2)', filter: 'blur(10px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }], { duration: 520, delay: 160 * k, easing: 'cubic-bezier(.2,1.25,.4,1)', fill: 'both' });
        R.fire(sub, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 420 * k, fill: 'both' });
        const orbBox = { x: cc.x - bw * 1.2, y: cc.y - bh * 0.6, w: bw * 2.4, h: bh * 1.2 };
        glowS.orbs(fast ? 10 : 18 + lv * 3, col, orbBox, { rise: 0.75, max: pale ? 14 : 20, alpha: pale ? 0.55 : 0.8, life: 3800 });
        if (lv >= 4) glowS.orbs(fast ? 4 : 10, '#ffffff', orbBox, { rise: 0.5, min: 2, max: 7, alpha: 0.7, life: 3000 });
        // on attend que le joueur touche (ou un petit moment en « Tout révéler » et en auto)
        const minShow = fast ? 1100 : 900;
        await R.wait(minShow);
        R.fire(skip, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });
        const autoMs = fast ? 300 : fromAll ? 1700 : 0;
        await R.until(go => {
            let t = 0;
            const end = () => { clearTimeout(t); spot.removeEventListener('click', end); go(); };
            if (autoMs) t = setTimeout(end, autoMs);
            spot.addEventListener('click', end);
            R.later(() => { clearTimeout(t); spot.removeEventListener('click', end); });
            cur.skipSpot = end;
        });
        cur.skipSpot = null;
        // la carte retourne à sa place, face visible
        R.fire(banner, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
        R.fire(sub, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
        R.fire(skip, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        R.fire(rays, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' });
        R.fire(pil, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 380, fill: 'forwards' });
        R.fire(gl, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' });
        R.fire(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: 'forwards' });
        sl.el.classList.add('instant', 'up');
        const r2 = sl.el.getBoundingClientRect();
        const toT = `translate(${(r2.left + r2.width / 2) - (r1.left + r1.width / 2)}px, ${(r2.top + r2.height / 2) - (r1.top + r1.height / 2)}px) scale(${(r2.width / r1.width).toFixed(3)})`;
        audio.whoosh(0.4, 0.12);
        await R.anim(big, [{ transform: 'none' }, { transform: toT }], { duration: fast ? 260 : 420, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });
        sl.el.style.visibility = ''; sl.up = true;
        void sl.el.offsetWidth; sl.el.classList.remove('instant');
        spot.className = 'sm-spot'; spot.innerHTML = ''; glowS.clear();
        o.root.classList.remove('spotting');
        cur.spot = null;
        glow.ring(sl.fx, sl.fy, L.w * 1.6, col, 700, 0.5);
    }

    function checkDone() {
        if (!cur || !cur.slots || cur.done) return;
        if (cur.slots.every(s => s.up)) { cur.done = true; hint(''); if (o.onDone) o.onDone(); }
    }
    // « Tout révéler » : une carte après l'autre, de la moins rare à la plus rare
    async function revealAll(fast) {
        if (!cur || !cur.slots || cur.allRunning) return;
        cur.allRunning = true; hint('');
        const R = run;
        try {
            if (cur.skipSpot) cur.skipSpot();
            while (cur.spot) await R.wait(80);
            const hidden = cur.slots.filter(s => !s.up).sort((a, b) => a.rank - b.rank);
            for (const s of hidden) {
                if (s.up || s.busy) continue;
                await flip(s, fast || cur.auto, true);
                await R.wait(fast || cur.auto ? 70 : [120, 170, 240, 320, 360, 320, 320, 320, 320][s.lvl]);
            }
        } catch (e) { if (e !== STOP) throw e; }
        finally { if (cur && run === R) cur.allRunning = false; }
    }
    function close() {
        if (run) run.kill();
        run = null; cur = null;
        clearInterval(ambT); glow.clear(); glowS.clear(); audio.ambient(false); o.root.classList.remove('spotting');
        slotsBox.innerHTML = ''; pillarsBox.innerHTML = ''; spot.className = 'sm-spot'; spot.innerHTML = '';
        stage.querySelectorAll('.sm-pack').forEach(p => p.remove());
        runes.forEach(b => b.classList.remove('on'));
        stage.classList.remove('awake', 'lit', 'rainbow', 'quick'); setPower(0); setLit(NEUTRAL); speed(1);
    }
    root.addEventListener('resize', () => { if (cur) { layout(); glow.size(); if (cur.spot) glowS.size(); } });
    return {
        open, drop, ignite, revealAll, close, tapPack, setAuto,
        dealt: () => !!(cur && cur.dealt),
        hidden: () => !!(cur && cur.slots && cur.slots.some(s => !s.up)),
        busy: () => !!(cur && (cur.spot || cur.allRunning)),
        skip: () => { if (cur && cur.skipSpot) { cur.skipSpot(); return true; } return false; },
        STOP
    };
}

root.Summon = { create, lvlOf, STOP };
})(window);
