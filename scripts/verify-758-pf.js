// #758 검증 — 「전체 가격 확인하기」 카드의 판매처 글자(네이버·자사몰·쿠팡) 색 · 가짜 서버(scripts/_mock-612.js · DB·외부 호출 0)
//   사용: node scripts/verify-758-pf.js   (포트 PORT758 · 없으면 3466 · 다른 Playwright 검증과 동시에 돌리지 말 것)
//   밝음·야간 × 390·900 · 판매처 3색 실렌더(가짜 자료에 쿠팡 줄이 없어 쿠팡은 표의 한 줄을 쿠팡 꼴로 바꿔 봄) · 줄 바탕 위 글자 대비 4.5 이상 · 「일반/VIP」 알약과 다른 모양 · 넘침 0 · 콘솔 오류 0
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT758 || 3466), BASE = 'http://localhost:' + PORT;
const ADMIN = { id: 1, name: '시험대표', position: '대표', role: 'admin' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WANT = { light: { naver: '#067A3A', coupang: '#C4001F', mall: '#A64B06' }, dark: { naver: '#5EE08F', coupang: '#FF8A99', mall: '#FFB066' } };

(async () => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-612.js'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/__mock/log')).ok; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('가짜 서버가 안 떴어요(포트 ' + PORT + ')'); }
    const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
    const browser = await chromium.launch();
    try {
        for (const [label, w, phone, theme] of [['밝음 390', 390, true, null], ['밝음 900', 900, false, null], ['야간 390', 390, true, 'dark'], ['야간 900', 900, false, 'dark']]) {
            console.log('\n── ' + label);
            await fetch(BASE + '/__mock/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errors = [];
            pg.on('pageerror', e => errors.push(String(e))); const miss = []; pg.on('response', r => { if (r.status() === 404) miss.push(new URL(r.url()).pathname); }); pg.on('dialog', d => d.dismiss().catch(() => { }));
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([u, th]) => { localStorage.setItem('jwt_token', 'mock.token.612.admin'); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [ADMIN, theme]);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1500);
            if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); }
            await pg.click('#desk-price-now');
            await pg.waitForFunction(() => { const o = document.getElementById('pc-out'), p = document.getElementById('pc-prog'); return o && p && p.hidden && o.querySelector('.pc-group'); }, null, { timeout: 8000 });
            await pg.click('#pc-views button[data-view="all"]'); await pg.waitForTimeout(200);
            // 가짜 자료엔 쿠팡 줄이 없음 → 자사몰 줄 하나(가능하면 빨간 줄)의 판매처 칸을 쿠팡 꼴로 바꿔 같은 규칙으로 그려 봄
            await pg.evaluate(() => { const t = document.querySelector('#pc-out tr.pc-bad .pc-ch[data-pf="mall"]') || document.querySelector('#pc-out .pc-ch[data-pf="mall"]'); if (t) { const c = t.cloneNode(true); c.dataset.pf = 'coupang'; c.textContent = '쿠팡'; c.dataset.t758 = '1'; t.after(c); } });
            const R = await pg.evaluate(() => {
                const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
                const lum = c => { const a = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
                const over = (fg, bg) => fg.length > 3 && fg[3] < 1 ? fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) : fg.slice(0, 3);
                const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length && !(c.length > 3 && c[3] === 0)) { stack.push(c); if (!(c.length > 3 && c[3] < 1)) break; } } let b = [255, 255, 255]; for (const c of stack.reverse()) b = over(c, b); return b; };
                const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
                const tags = [...document.querySelectorAll('#desk-price .pc-ch')].filter(e => e.offsetParent !== null);
                return {
                    tags: tags.map(e => { const s = getComputedStyle(e), b = getComputedStyle(e, '::before'), fg = rgb(s.color), bg = bgOf(e); const L1 = lum(fg), L2 = lum(bg);
                        return { pf: e.dataset.pf || '', text: e.textContent, color: hex(fg), dot: hex(rgb(b.backgroundColor)), dotW: parseFloat(b.width), fw: s.fontWeight, bgCol: hex(bg), cr: (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05), row: (e.closest('tr') || {}).className || 'set', radius: s.borderRadius, pad: s.paddingLeft, fake: !!e.dataset.t758 }; }),
                    tier: (() => { const t = document.querySelector('#pc-out .pc-pmeta .desk-badge'); if (!t) return null; const s = getComputedStyle(t); return { bg: s.backgroundColor, radius: s.borderRadius, pad: s.paddingLeft }; })(),
                    sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                    cardOver: (() => { const c = document.getElementById('desk-price'); return c ? c.scrollWidth - c.clientWidth : -1; })(),
                    metaOver: [...document.querySelectorAll('#pc-out .pc-pmeta')].filter(e => e.scrollWidth > e.clientWidth + 1).length,
                };
            });
            const mode = theme ? 'dark' : 'light';
            const byPf = pf => R.tags.filter(t => t.pf === pf);
            for (const pf of ['naver', 'mall', 'coupang']) {
                const L = byPf(pf);
                ok(L.length > 0 && L.every(t => t.color === WANT[mode][pf] && t.dotW === 7 && Number(t.fw) >= 600), `[${label}] ${pf} ${L.length}곳 · 글자 ${[...new Set(L.map(t => t.color))].join(',')}(기대 ${WANT[mode][pf]}) · 점 ${[...new Set(L.map(t => t.dot))].join(',')} · 굵기 ${[...new Set(L.map(t => t.fw))].join(',')}`);
                const minCr = Math.min(...L.map(t => t.cr));
                ok(L.length && minCr >= 4.5, `[${label}] ${pf} 대비 최소 ${minCr.toFixed(2)}(줄 바탕 ${[...new Set(L.map(t => t.row.replace('pc-r', '').trim() || '보통'))].join('·')})`);
            }
            ok(R.tags.filter(t => !t.pf).length === 0, `[${label}] 판매처 칸 전부 색 있음(색 없는 칸 ${R.tags.filter(t => !t.pf).length})`);
            ok(byPf('mall').some(t => t.row === 'set') || true, `[${label}] (설정 목록 판매처 = 닫혀 있으면 안 보임 · 참고)`);
            ok(R.tier && R.tags.every(t => t.radius !== R.tier.radius || t.pad !== R.tier.pad), `[${label}] 「일반/VIP」 알약(바탕 ${R.tier && R.tier.bg} · 둥글기 ${R.tier && R.tier.radius})과 모양 다름(판매처 = 바탕 없음 · 점 + 색 글자)`);
            ok(R.sw <= w && R.cardOver <= 0 && R.metaOver === 0, `[${label}] 넘침 0(문서 ${R.sw} ≤ ${w} · 카드 ${R.cardOver} · 알약 줄 ${R.metaOver})`);
            ok(errors.length === 0, `[${label}] 화면 오류(pageerror) 0${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}${miss.length ? ' · 참고: 가짜 서버에 없는 주소 404 ' + [...new Set(miss)].join(',') : ''}`);
            // 설정 목록(관리자) 판매처도 같은 색
            const setOpen = await pg.evaluate(() => { const d = document.getElementById('pc-set'); if (!d || d.hidden) return null; d.open = true; return true; });
            if (setOpen) { await pg.waitForTimeout(400); const S = await pg.evaluate(() => [...document.querySelectorAll('#pc-set-list .pc-ch')].filter(e => e.offsetParent !== null).map(e => ({ pf: e.dataset.pf, c: getComputedStyle(e).color, it: getComputedStyle(e).fontStyle }))); ok(S.length > 0 && S.every(x => x.pf && x.it === 'normal'), `[${label}] 페이지 등급 설정 목록 판매처 ${S.length}곳 색·기울임 없음(${[...new Set(S.map(x => x.pf))].join(',')})`); }
            await ctx.close();
        }
    } finally { await browser.close(); srv.kill(); }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('크래시', e); process.exit(1); });
