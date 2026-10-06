/* Anime Boosters — effets spéciaux de l'ouverture : particules, flash, onde de choc, tremblement. */
(function (root) {
'use strict';
const REDUCED = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
let cv = null, ctx = null, W = 0, H = 0, DPR = 1, raf = 0;
const P = [];
const rand = (a, b) => a + Math.random() * (b - a);
const pickc = c => c[Math.floor(Math.random() * c.length)];
const scale = n => Math.max(1, Math.round(n * (REDUCED ? 0.3 : 1)));

function init(canvas) { cv = canvas; ctx = cv.getContext('2d'); resize(); root.addEventListener('resize', resize); }
function resize() {
    if (!cv) return;
    DPR = Math.min(2, root.devicePixelRatio || 1);
    W = root.innerWidth; H = root.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
function add(p) { if (P.length < 900) P.push(p); if (!raf) raf = requestAnimationFrame(tick); }
let last = 0;
function tick(t) {
    const dt = Math.min(2.5, last ? (t - last) / 16.67 : 1); last = t;
    ctx.clearRect(0, 0, W, H);
    for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.age += dt * 16.67;
        if (p.age >= p.life) { P.splice(i, 1); continue; }
        const k = p.age / p.life;
        if (p.to) { // aspirée vers un point
            const e = k * k;
            p.x = p.sx + (p.to.x - p.sx) * e; p.y = p.sy + (p.to.y - p.sy) * e;
        } else {
            p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * dt;
            p.x += p.vx * dt; p.y += p.vy * dt;
        }
        p.rot += p.vr * dt;
        const a = p.fade ? Math.min(1, (1 - k) * 1.6) : 1;
        ctx.globalAlpha = a;
        if (p.type === 'ring') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, p.w * (1 - k));
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2); ctx.stroke();
        } else if (p.type === 'confetti') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 1.7));
            ctx.fillStyle = p.c; ctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); ctx.restore();
        } else if (p.type === 'star') {
            ctx.globalCompositeOperation = 'lighter';
            const s = p.s * (p.tw ? 0.6 + 0.4 * Math.sin(p.age / 60) : 1);
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
            ctx.beginPath();
            for (let j = 0; j < 8; j++) { const r = j % 2 ? s * 0.28 : s; const an = j * Math.PI / 4; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); }
            ctx.closePath(); ctx.fill(); ctx.restore();
        } else { // point lumineux
            ctx.globalCompositeOperation = 'lighter';
            const s = p.s * (1 - k * 0.6);
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 2.2);
            g.addColorStop(0, '#fff'); g.addColorStop(0.25, p.c); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, s * 2.2, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (P.length) raf = requestAnimationFrame(tick); else { raf = 0; last = 0; ctx.clearRect(0, 0, W, H); }
}

// explosion de particules
function burst(x, y, o = {}) {
    const n = scale(o.count || 80), colors = o.colors || ['#fff'], sp = o.speed || 8;
    for (let i = 0; i < n; i++) {
        const an = Math.random() * Math.PI * 2, v = rand(0.3, 1) * sp;
        const type = o.types ? pickc(o.types) : Math.random() < 0.18 ? 'star' : Math.random() < 0.3 ? 'confetti' : 'dot';
        add({ type, x, y, vx: Math.cos(an) * v, vy: Math.sin(an) * v - (o.up || 0), g: o.gravity ?? 0.14, drag: 0.975, s: rand(2, o.size || 5), c: pickc(colors), life: rand(0.6, 1) * (o.life || 1300), age: 0, rot: rand(0, 6), vr: rand(-0.2, 0.2), fade: true });
    }
}
// particules aspirées vers un point (le pack se charge)
function implode(x, y, o = {}) {
    const n = scale(o.count || 70), R = o.radius || 300, colors = o.colors || ['#fff'];
    for (let i = 0; i < n; i++) {
        const an = Math.random() * Math.PI * 2, r = rand(R * 0.5, R);
        const sx = x + Math.cos(an) * r, sy = y + Math.sin(an) * r;
        add({ type: Math.random() < 0.3 ? 'star' : 'dot', x: sx, y: sy, sx, sy, to: { x, y }, s: rand(1.5, 4), c: pickc(colors), life: rand(0.55, 1) * (o.life || 700), age: 0, rot: 0, vr: 0.1, fade: false, g: 0, drag: 1, vx: 0, vy: 0 });
    }
}
// onde de choc
function ring(x, y, color = '#fff', size = 260, life = 700) {
    add({ type: 'ring', x, y, r0: 10, r1: size, w: 10, c: color, life, age: 0, rot: 0, vr: 0, fade: true, g: 0, drag: 1, vx: 0, vy: 0 });
    add({ type: 'ring', x, y, r0: 4, r1: size * 0.6, w: 5, c: '#fff', life: life * 0.8, age: 0, rot: 0, vr: 0, fade: true, g: 0, drag: 1, vx: 0, vy: 0 });
}
// pluie (God Pack, Chance x10…)
function rain(o = {}) {
    const colors = o.colors || ['#ffd700', '#fff6c2'], dur = o.duration || 2500, per = scale(o.rate || 6);
    const t0 = performance.now();
    const step = () => {
        for (let i = 0; i < per; i++) add({ type: Math.random() < 0.5 ? 'confetti' : 'star', x: rand(0, W), y: -20, vx: rand(-1, 1), vy: rand(2, 5), g: 0.05, drag: 0.995, s: rand(3, 6), c: pickc(colors), life: 3200, age: 0, rot: rand(0, 6), vr: rand(-0.15, 0.15), fade: true, tw: true });
        if (performance.now() - t0 < dur) setTimeout(step, 50);
    };
    step();
}
// petites étoiles autour d'une carte brillante
function sparkle(rect, o = {}) {
    const n = scale(o.count || 20), colors = o.colors || ['#fff', '#fff6c2', '#bfe9ff'];
    for (let i = 0; i < n; i++) {
        setTimeout(() => add({ type: 'star', x: rand(rect.left, rect.right), y: rand(rect.top, rect.bottom), vx: 0, vy: -0.3, g: 0, drag: 1, s: rand(3, 7), c: pickc(colors), life: rand(500, 900), age: 0, rot: rand(0, 3), vr: 0.05, fade: true, tw: true }), i * 40);
    }
}
// feux d'artifice sur tout l'écran
function fireworks(n, colors) {
    for (let i = 0; i < scale(n); i++) setTimeout(() => {
        const x = rand(W * 0.15, W * 0.85), y = rand(H * 0.15, H * 0.5);
        burst(x, y, { count: 70, colors: [pickc(colors), pickc(colors), '#fff'], speed: rand(5, 9), gravity: 0.08, life: 1500 });
        ring(x, y, pickc(colors), 120, 500);
    }, i * 280 + rand(0, 120));
}
// tremblement de l'écran
function shake(el, power = 8, ms = 350) {
    if (REDUCED || !el || !el.animate) return;
    const f = [];
    for (let i = 0; i < 8; i++) { const k = 1 - i / 8; f.push({ transform: `translate(${rand(-power, power) * k}px, ${rand(-power, power) * k}px)` }); }
    f.push({ transform: 'none' });
    el.animate(f, { duration: ms, easing: 'linear' });
}
// éclair de lumière plein écran
function flash(el, color = '#fff', ms = 350, peak = 0.9) {
    if (!el || !el.animate) return;
    el.style.background = color;
    el.animate([{ opacity: peak }, { opacity: 0 }], { duration: REDUCED ? ms / 2 : ms, easing: 'ease-out' });
}
function clear() { P.length = 0; }

root.FX = { init, resize, burst, implode, ring, rain, sparkle, fireworks, shake, flash, clear, REDUCED };
})(typeof self !== 'undefined' ? self : this);
