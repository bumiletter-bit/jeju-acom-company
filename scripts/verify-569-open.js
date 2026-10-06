// #569 검증(워커2): 메뉴마다 「열어 볼 것」을 실제로 눌러 열고 어두운 화면에서 잰다 — 탭 · 상세/미리보기 창 · 펼침 · 달력 · 빈 상태
//   verify-569-dark.js(워커1)의 C 항목이 탭까지 본다면, 이 검증은 그 안에서 「누르면 뜨는 것」(app.js 가 그때 그려 넣는 창·표)을 본다.
//   사용: node scripts/verify-569-open.js --group=all | 1~6 | 1,2  [--only=document] [--shot=폴더] [--max=14]
//     1 = 일정 · 2 = 업무일지·마이 플래너·순위관리·내 정보 · 3 = 문의 관리 · 4 = 정산관리·품목별 금액·박스재고 · 5 = 기안서류·지출결의서 · 6 = 데이터관리·주문 정리기·송장변환(겉틀)
//     전 묶음 한 번에: node scripts/verify-569-open.js --group=all   (끝에 걸린 시간을 적는다)
//   자료 = 실DB 읽기(GET 은 공통 틀이 처음 응답을 저장해 재사용) · 쓰기는 전부 가로챔(DB 쓰기 0) · 지우기·승인·저장·내려받기 버튼은 누르지 않는다
//   이 시험 안에서만 DARK_PAGES 를 해당 묶음으로 바꿔 끼워 야간 속성이 붙게 한다(워커1이 그 묶음에 도착하기 전에도 미리 돌릴 수 있게).
//   포트 3462(PORT569 로 바꿈) · 「빈 상태」는 목록 응답을 빈 배열로 바꿔 한 번 더 본다.
const fs = require('fs'), path = require('path');
const H = require('./ao-dark/harness.js');
const KNOWN = require('./ao-dark/known.js');
const arg = n => { const a = process.argv.slice(2).find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
const SHOT = arg('shot'), MAX = Number(arg('max')) || 14;
const GROUPS = { 1: ['schedule'], 2: ['worklog', 'planner', 'rankings', 'myinfo'], 3: ['inquiry'], 4: ['settlement', 'pricing', 'inventory'], 5: ['document', 'expense'], 6: ['data', 'organizer', 'invoice'] };
const NAME = { schedule: '일정', worklog: '업무일지', planner: '마이 플래너', rankings: '순위관리', myinfo: '내 정보', document: '기안서류', expense: '지출결의서', settlement: '정산관리', pricing: '품목별 금액', inventory: '박스재고', inquiry: '문의 관리', data: '데이터관리', organizer: '주문 정리기', invoice: '송장변환(겉틀 — 안쪽 iframe 은 verify-569-invoice-dark)' };
// --group=all = 전 묶음(①→⑥) · --group=1,2 처럼 여러 개도 됨
const G = arg('group') || '5'; const GLIST = G === 'all' ? ['1', '2', '3', '4', '5', '6'] : G.split(',');
const PAGES = (arg('only') ? arg('only').split(',') : GLIST.flatMap(g => GROUPS[g] || [])) || [];
const T0 = Date.now(); const mmss = () => { const s = Math.round((Date.now() - T0) / 1000); return `${Math.floor(s / 60)}분 ${s % 60}초`; };
const results = []; const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 2200) : '')); };
const known = s => KNOWN.find(k => k.re.test(s));
// 누르면 안 되는 것(쓰기·내려받기·나가기) — onclick 글자·버튼 글자 어느 쪽에든 있으면 건너뜀
const DANGER = /delete|remove|approve|reject|save|submit|download|export|reset|send|logout|upload|cancel(?!Edit)|restore|backup|toggle.*(Auto|Timer)|resend|post|publish|삭제|승인|반려|저장|등록|제출|변경|연결 테스트|전체 ON|전체 OFF|주소 검증|CJ양식|복사|올리기|정리하기|내려받기|다운로드|초기화|발송|보내기|로그아웃|업로드|복원|백업|게시/i;

(async () => {
    let h = null;
    try {
        if (!PAGES.length) throw new Error('묶음 번호가 틀렸습니다(--group=1~6 · all · 1,2)');
        // 누르기: 보통 클릭 → 안 되면(폰에서 화면 밖·다른 것에 가림) 그 자리로 스크롤해 직접 누름
        const press = async loc => { if (await loc.click({ timeout: 2500 }).then(() => true).catch(() => false)) return true; return loc.evaluate(el => { el.scrollIntoView({ block: 'center', inline: 'center' }); el.click(); return true; }).catch(() => false); };
        h = await H.start(Number(process.env.PORT569) || 3462, 'open569');
        const pagesOpt = ['agent-office', ...PAGES];
        const save = async (pg, name) => { if (!SHOT) return; fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, name.replace(/[\\/:*?"<>|\s]+/g, '_') + '.png'), animations: 'disabled' }).catch(() => { }); };
        const closeAll = pg => pg.evaluate(() => {
            let n = 0;
            for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position !== 'fixed' || cs.display === 'none') continue; const r = el.getBoundingClientRect(); if (r.width < innerWidth * .6 || r.height < innerHeight * .6) continue; if (el.closest('.sidebar') || el.id === 'app' || el.classList.contains('main-content')) continue; el.dataset.p569 = el.style.display; el.style.display = 'none'; n++; }
            document.querySelectorAll('.akm-cal').forEach(c => { c.style.display = 'none'; }); document.body.style.overflow = ''; document.body.classList.remove('modal-open');
            return n;
        });
        const tally = () => ({ fails: new Map(), whites: new Map(), kn: new Set(), texts: 0, views: 0, minR: 99, labels: [] });
        const take = async (pg, T, label, scope) => { const a = await H.audit(pg, scope || null); T.views++; T.texts += a.texts; if (a.texts) T.minR = Math.min(T.minR, a.minR); T.labels.push(label);
            for (const f of a.fails) { const k = known(f); if (k) T.kn.add(k.why); else if (!T.fails.has(f)) T.fails.set(f, label); }
            for (const f of a.white) { const k = known(f); if (k) T.kn.add(k.why); else if (!T.whites.has(f)) T.whites.set(f, label); } return a; };
        // 지금 보이는 화면에서 「누르면 뜨는 것」 후보를 찾는다: onclick 이 있는 것 + 표의 줄 + 펼침(details)
        const TAB_SEL = '.doc-main-tab, .doc-tab, .settlement-tab, .btn-toggle, [role="tab"], [class*="tab-btn"]';
        // 지금 보이는 화면에서 「누르면 뜨는 것」 후보: onclick 이 있는 것 + 손가락 모양(cursor:pointer)인 줄·칸·버튼 + 펼침(details). 탭·쓰기 버튼은 뺀다.
        const findOpeners = pg => pg.evaluate(([dangerSrc, tabSel]) => {
            const danger = new RegExp(dangerSrc, 'i'); const act = document.querySelector('.page.active'); if (!act) return [];
            const out = [], seen = new Set(); let i = 0;
            act.querySelectorAll('[data-p569-open]').forEach(e => e.removeAttribute('data-p569-open'));
            const vis = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
            const cand = new Set(act.querySelectorAll('[onclick], details > summary, button, a, tr, li, [class*="item"], [class*="card"], [class*="chip"], [class*="row"]'));
            for (const el of cand) {
                if (!vis(el) || el.disabled || el.matches(tabSel) || el.closest('.sidebar')) continue;
                if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) continue;   // 바깥 사이트로 나가는 링크는 누르지 않는다
                const oc = el.getAttribute('onclick') || ''; const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
                if (!oc && el.tagName !== 'SUMMARY' && getComputedStyle(el).cursor !== 'pointer') continue;
                if (danger.test(oc) || (/^(BUTTON|A)$/.test(el.tagName) && danger.test(text))) continue;
                if (el.getAttribute('type') === 'submit' || /^(INPUT|SELECT|TEXTAREA|LABEL|OPTION)$/.test(el.tagName)) continue;   // 주의: <button> 은 type 을 안 적어도 .type 이 'submit' 이다 → 속성으로 본다
                if (!oc && el.querySelector('[onclick], button, a') && !/^(TR|LI)$/.test(el.tagName)) continue;   // 안에 더 구체적인 누를 것이 있으면 그쪽을 본다
                const fn = (oc.match(/([A-Za-z0-9_$]+)\s*\(/) || [])[1] || (el.tagName === 'SUMMARY' ? 'summary' : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '') + (/^(BUTTON|A)$/.test(el.tagName) ? ':' + text.slice(0, 8) : ''));
                if (/^(event|this|stopPropagation)$/.test(fn) || seen.has(fn)) continue; seen.add(fn); el.setAttribute('data-p569-open', i); out.push({ i: i++, fn, text });
            }
            return out;
        }, [DANGER.source, TAB_SEL]);
        // 탭: 큰 탭 → 그 안의 작은 탭 순서로, 처음 보는 이름만(같은 이름은 한 번)
        const tabsOf = (pg, visited) => pg.evaluate(([tabSel, vs]) => { const act = document.querySelector('.page.active'); if (!act) return []; act.querySelectorAll('[data-p569-tab]').forEach(e => e.removeAttribute('data-p569-tab')); const out = []; let i = 0; for (const e of act.querySelectorAll(tabSel)) { if (!e.getClientRects().length) continue; const text = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16); const key = (typeof e.className === 'string' ? e.className.split(/\s+/)[0] : '') + ':' + text; if (vs.includes(key)) continue; e.setAttribute('data-p569-tab', i); out.push({ i: i++, text, key }); } return out; }, [TAB_SEL, visited || []]);

        for (const [who, vw, phone] of [['대표', { width: 1440, height: 1000 }, false], ['대표', { width: 390, height: 844 }, true]]) {
            const dev = phone ? '폰' : 'PC';
            const P = await h.open(h.users[who], vw, { phone, theme: 'dark', page: PAGES[0], pages: pagesOpt });
            for (const page of PAGES) {
                const T = tally(); const opened = [], skipped = [];
                const at = await H.navTo(P.pg, page, phone); const dark = await P.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
                await take(P.pg, T, '처음'); await save(P.pg, `569-open-${dev}-${page}-0-처음`);
                const visited = [], cands = []; const crawl = async tabText => {
                    const ops = await findOpeners(P.pg); cands.push(tabText + ": " + (ops.map(o => o.fn).join(", ") || "후보 없음"));
                    for (const op of ops.slice(0, MAX)) {
                        const loc = P.pg.locator(`.page.active [data-p569-open="${op.i}"]`).first(); if (!(await loc.count())) continue;
                        const okc = await press(loc); if (!okc) { skipped.push(op.fn); continue; }
                        await P.pg.waitForTimeout(700);
                        const here = await P.pg.evaluate(() => { const p = document.querySelector('.page.active'); return p ? p.id.replace(/^page-/, '') : ''; });
                        await take(P.pg, T, `[${tabText}] ${op.fn}`); opened.push(op.fn); await save(P.pg, `569-open-${dev}-${page}-${tabText}-${op.fn}`);
                        await P.pg.keyboard.press('Escape').catch(() => { }); await closeAll(P.pg); await P.pg.waitForTimeout(150);
                        if (here !== page) { await H.navTo(P.pg, page, phone); return; }
                    }
                    if (ops.length > MAX) skipped.push(`[${tabText}] 외 ${ops.length - MAX}개`);
                };
                await crawl('처음');
                for (let round = 0; round < 24; round++) {
                    const tabs = await tabsOf(P.pg, visited); if (!tabs.length) break; const tab = tabs[0]; visited.push(tab.key);
                    const okc = await press(P.pg.locator(`.page.active [data-p569-tab="${tab.i}"]`).first()); if (!okc) continue;
                    await P.pg.waitForTimeout(900); await take(P.pg, T, '탭 ' + tab.text); await save(P.pg, `569-open-${dev}-${page}-탭-${tab.text}`);
                    await crawl(tab.text);
                }
                // 날짜 칸(공용 달력)
                const dt = P.pg.locator('.page.active .akm-date').first(); if (await dt.count() && await dt.isVisible().catch(() => false)) { await dt.click().catch(() => { }); await P.pg.waitForTimeout(300); await take(P.pg, T, '달력'); await P.pg.keyboard.press('Escape').catch(() => { }); await closeAll(P.pg); }
                const fl = [...T.fails].map(([f, l]) => `(${l}) ${f}`), wl = [...T.whites].map(([f, l]) => `(${l}) ${f}`);
                ok(`[${dev}] ${NAME[page]}: 눌러 연 것 ${opened.length}개 · 화면 ${T.views}장 · 글자 ${T.texts}토막 · 최저 ${T.minR}:1 — 대비 미달 0 · 흰 칸 0${T.kn.size ? ' · 알고 넘긴 것 ' + T.kn.size + '종' : ''}`,
                    at === page && dark === 'dark' && T.fails.size === 0 && T.whites.size === 0 && T.texts > 15, `연 것: ${[...new Set(opened)].join(', ') || '없음'}${skipped.length ? ' · 못 누른 것: ' + [...new Set(skipped)].slice(0, 8).join(', ') : ''}` + (fl.length ? ' ‖ 미달 ' + fl.length + ': ' + fl.slice(0, 10).join(' ‖ ') : '') + (wl.length ? ' ‖ 흰 칸 ' + wl.length + ': ' + wl.slice(0, 10).join(' ‖ ') : ''));
                if (SHOT) fs.writeFileSync(path.join(SHOT, `569-open-${dev}-${page}.json`), JSON.stringify({ cands, opened: [...new Set(opened)], skipped: [...new Set(skipped)], fails: fl, whites: wl, known: [...T.kn] }, null, 1));
            }
            ok(`[${dev}] 화면 오류 0 · 가로챈 쓰기 ${P.writes.length}건(실제 쓰기 0)`, P.errors.length === 0, P.errors.slice(0, 4).join(' | '));
            await P.ctx.close();
        }
        // 빈 상태 — 목록 응답(배열)을 빈 배열로 바꿔 한 번 더(PC)
        {
            const P = await h.open(h.users.대표, { width: 1440, height: 1000 }, { theme: 'dark', page: PAGES[0], pages: pagesOpt, routes: async pg => { await pg.route('**/api/**', async route => { const rq = route.request(); if (rq.method() !== 'GET' || /\/api\/(auth|me|users|public|notifications|agent-office\/desk)/.test(new URL(rq.url()).pathname)) return route.fallback(); try { const r = await route.fetch(); const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (_) { return route.fulfill({ response: r }); } return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(j) ? [] : j) }); } catch (_) { return route.fallback(); } }); } });
            for (const page of PAGES) {
                const T = tally(); await H.navTo(P.pg, page, false); await take(P.pg, T, '빈 상태'); await save(P.pg, `569-open-PC-${page}-빈상태`);
                const vs = []; for (let round = 0; round < 24; round++) { const tabs = await tabsOf(P.pg, vs); if (!tabs.length) break; const tab = tabs[0]; vs.push(tab.key); const okc = await P.pg.locator(`.page.active [data-p569-tab="${tab.i}"]`).first().click({ timeout: 2500 }).then(() => true).catch(() => false); if (!okc) continue; await P.pg.waitForTimeout(700); await take(P.pg, T, '빈 탭 ' + tab.text); }
                const fl = [...T.fails].map(([f, l]) => `(${l}) ${f}`), wl = [...T.whites].map(([f, l]) => `(${l}) ${f}`);
                ok(`[PC·빈 상태] ${NAME[page]}: 화면 ${T.views}장 · 글자 ${T.texts}토막 — 대비 미달 0 · 흰 칸 0`, T.fails.size === 0 && T.whites.size === 0, (fl.length ? '미달: ' + fl.slice(0, 8).join(' ‖ ') : '') + (wl.length ? ' ‖ 흰 칸: ' + wl.slice(0, 8).join(' ‖ ') : ''));
            }
            ok('[PC·빈 상태] 화면 오류 0', P.errors.length === 0, P.errors.slice(0, 4).join(' | '));
            await P.ctx.close();
        }
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e)); }
    finally { if (h) await h.stop(); const pass = results.filter(r => r.pass).length; console.log(`\n결과: ${pass}/${results.length} · 메뉴 ${PAGES.length}개 · 걸린 시간 ${mmss()}`); setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300); }
})();
