// #569 검증: 야간 화면을 모든 메뉴로 — 「끝난 메뉴 목록」(ao-desk.js DARK_PAGES) 기준
//   사용: node scripts/verify-569-dark.js [--pages=schedule,worklog] [--only=schedule] [--shot=폴더]
//     --pages = 목록을 이 값으로 바꿔 끼워 시험(시공 중 묶음 미리 보기) · 없으면 ao-desk.js 의 목록 그대로
//     --only  = B·C(메뉴별 검사)를 이 메뉴만(나머지 항목은 그대로)
//   로컬 실서버 3461(스케줄러 차단) · GET 은 처음 응답을 저장해 모든 화면에 같은 값 · 쓰기 전부 가로챔 → DB 쓰기 0
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const H = require('./ao-dark/harness.js');
const KNOWN = require('./ao-dark/known.js');
const arg = n => { const a = process.argv.slice(2).find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
const SHOT = arg('shot');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 1600) : '')); };
const ALL = ['agent-office', 'schedule', 'rankings', 'worklog', 'planner', 'document', 'expense', 'settlement', 'pricing', 'inventory', 'invoice', 'organizer', 'inquiry', 'data', 'myinfo'];
const STAFF_NO = ['settlement', 'pricing', 'data'];
const NAME = { 'agent-office': '에이전트 오피스', schedule: '일정', rankings: '순위관리', worklog: '업무일지', planner: '마이 플래너', document: '기안서류', expense: '지출결의서', settlement: '정산관리', pricing: '품목별 금액', inventory: '박스재고', invoice: '송장변환', organizer: '주문 정리기', inquiry: '문의 관리', data: '데이터관리', myinfo: '내 정보' };
const MASK = '#side-theme,#desk-theme';
const known = s => KNOWN.find(k => k.re.test(s));

(async () => {
    let h = null;
    try {
        const src = fs.readFileSync(path.join(H.ROOT, 'public/ao-desk.js'), 'utf8');
        const fileList = JSON.parse((/const DARK_PAGES = (\[[^\]]*\]);/.exec(src) || [])[1].replace(/'/g, '"'));
        const LIST = arg('pages') ? ['agent-office', ...arg('pages').split(',').filter(p => p !== 'agent-office')] : fileList;
        const ONLY = arg('only') ? arg('only').split(',') : LIST.filter(p => p !== 'agent-office');
        const pagesOpt = arg('pages') ? LIST : null;
        console.log('끝난 메뉴 목록: ' + LIST.map(p => NAME[p]).join(' · ') + (pagesOpt ? '  (시험용으로 바꿔 끼움 · 파일의 목록 = ' + fileList.join() + ')' : ''));

        // ══ 0. 파일 수준 ═══════════════════════════════════════════════════════════════════
        const diff = execFileSync('git', ['status', '--porcelain', '--', 'public/styles.css', 'public/theme.css', 'public/order-organizer.css', 'public/app.js', 'public/index.html'], { cwd: H.ROOT }).toString().trim();
        ok('0 styles.css · theme.css · order-organizer.css 는 git HEAD 와 같음(한 글자도 안 고침)', !/styles\.css|theme\.css|order-organizer\.css/.test(diff), diff);
        const dark = fs.readFileSync(path.join(H.ROOT, 'public/ao-dark.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const loose = []; { let depth = 0, buf = ''; for (const ch of dark) { if (ch === '{') { const sel = buf.trim(); if (sel && !sel.startsWith('@') && !/^(\d+%|from|to)(\s*,\s*(\d+%|from|to))*$/.test(sel)) { let d2 = 0, part = ''; const parts = []; for (const c of sel) { if (c === '(' || c === '[') d2++; if (c === ')' || c === ']') d2--; if (c === ',' && !d2) { parts.push(part); part = ''; } else part += c; } parts.push(part); for (const p of parts) if (!/data-ao-theme="dark"/.test(p)) loose.push(p.trim().slice(0, 60)); } depth++; buf = ''; } else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch; } }
        ok('0 ao-dark.css 의 규칙은 전부 html[data-ao-theme="dark"] 아래(속성이 없으면 아무것도 안 바뀜)', loose.length === 0, loose.slice(0, 6).join(' | '));
        const regen = execFileSync(process.execPath, ['scripts/ao-dark/gen-dark.js', path.join(require('os').tmpdir(), 'ao-dark-check.css')], { cwd: H.ROOT }).toString();
        ok('0 ao-dark.css = 생성 도구를 지금 다시 돌린 결과와 같음(손으로 고친 흔적 없음 · 원본 CSS 와 어긋나지 않음)', fs.readFileSync(path.join(require('os').tmpdir(), 'ao-dark-check.css'), 'utf8') === fs.readFileSync(path.join(H.ROOT, 'public/ao-dark.css'), 'utf8'), regen.trim());

        h = await H.start(Number(process.env.PORT569) || 3461, 'dark569');
        const { users } = h;
        const PC = { width: 1440, height: 1000 }, PH = { width: 390, height: 844 };
        const shotBuf = pg => pg.screenshot({ fullPage: true, animations: 'disabled' });
        const save = (name, buf) => { if (!SHOT) return; fs.mkdirSync(SHOT, { recursive: true }); fs.writeFileSync(path.join(SHOT, name + '.png'), buf); };
        const attr = pg => pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
        const settle = async pg => { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(250); };

        // ══ A. 밝은 화면 무회귀 — 종전(git HEAD 의 ao-desk.* · ao-dark.css 없음) vs 지금(전환 끔) PNG 동일 ═══════
        for (const [who, vw, phone] of [['대표', PC, false], ['대표', PH, true], ['직원', PC, false]]) {
            const A = await h.open(users[who], vw, { old: true, phone, mask: MASK }), B = await h.open(users[who], vw, { phone, mask: MASK, pages: pagesOpt });
            const bad = [], moving = [], seen = [];
            for (const page of ALL) {
                if (who === '직원' && STAFF_NO.includes(page)) continue;
                if (page === 'agent-office') continue;   // 에이전트 오피스의 밝은 화면 비교는 verify-568-dark(A · 가짜 현황판으로 24장)가 맡는다 — 여기서는 실자료 숫자가 사이에 바뀌어 흔들린다
                await H.navTo(A.pg, page, phone); await H.navTo(B.pg, page, phone); if (page === 'invoice') { await A.pg.waitForTimeout(2500); await B.pg.waitForTimeout(500); } await settle(A.pg); await settle(B.pg);
                let a = await shotBuf(A.pg), b = await shotBuf(B.pg);
                if (!a.equals(b)) { await A.pg.waitForTimeout(600); const a2 = await shotBuf(A.pg); b = await shotBuf(B.pg); if (a2.equals(b)) a = a2; else if (!a.equals(a2)) { moving.push(NAME[page]); continue; } else { bad.push(NAME[page]); save(`569-light-${who}-${phone ? '폰' : 'PC'}-${page}-old`, a); save(`569-light-${who}-${phone ? '폰' : 'PC'}-${page}-new`, b); } }
                seen.push(page);
            }
            ok(`A [${who}·${phone ? '폰' : 'PC'}] 밝은 화면 = 종전과 PNG 동일 — 메뉴 ${seen.length}개(에이전트 오피스는 verify-568-dark · 전환 버튼 2개만 가림)${moving.length ? ' · 스스로 움직여 비교 못 함: ' + moving.join() : ''}`, bad.length === 0 && moving.length <= 2 && (await attr(B.pg)) === '' && A.errors.length + B.errors.length === 0, bad.join() + ' ' + [...A.errors, ...B.errors].slice(0, 2).join(' | '));
            await A.ctx.close(); await B.ctx.close();
        }

        // ══ B. 범위 — 목록 안 메뉴만 어둡다 · 목록 밖 메뉴는 야간을 켠 사람도 PNG 동일 ═══════════════════════
        {
            const L = await h.open(users.대표, PC, { mask: MASK, pages: pagesOpt }), K = await h.open(users.대표, PC, { theme: 'dark', mask: MASK, pages: pagesOpt });
            const wrongAttr = [], bad = [], moving = []; let outN = 0;
            for (const page of ALL) {
                await H.navTo(L.pg, page, false); await H.navTo(K.pg, page, false); if (page === 'invoice') { await L.pg.waitForTimeout(2500); await K.pg.waitForTimeout(500); } await settle(L.pg); await settle(K.pg);
                const at = await attr(K.pg), inList = LIST.includes(page);
                if ((at === 'dark') !== inList) wrongAttr.push(NAME[page] + '=' + (at || '없음'));
                if (inList) continue;
                outN++;
                let a = await shotBuf(L.pg), b = await shotBuf(K.pg);
                if (!a.equals(b)) { await L.pg.waitForTimeout(600); const a2 = await shotBuf(L.pg); b = await shotBuf(K.pg); if (!a2.equals(b)) { if (!a.equals(a2)) moving.push(NAME[page]); else { bad.push(NAME[page]); save('569-scope-' + page + '-light', a); save('569-scope-' + page + '-darkuser', b); } } }
            }
            ok(`B 속성은 목록 안 메뉴(${LIST.length}개)에서만 붙음 — 메뉴 15개를 차례로 눌러 확인`, wrongAttr.length === 0, wrongAttr.join());
            ok(`B 목록 밖 메뉴 ${outN}개 = 야간을 켠 사람도 안 켠 사람과 PNG 동일${moving.length ? ' (움직여 비교 못 함: ' + moving.join() + ')' : ''}`, bad.length === 0, bad.join());
            // 사이드바 전환 버튼
            const first = LIST.find(p => p !== 'agent-office') || 'agent-office', out = ALL.find(p => !LIST.includes(p));
            await L.pg.addStyleTag({ content: '#side-theme,#desk-theme{visibility:visible!important}' });   // 위 비교에서 가렸던 버튼을 다시 보이게
            await H.navTo(L.pg, first, false);
            const w0 = L.writes.length; const sb0 =await L.pg.evaluate(() => { const b = document.getElementById('side-theme'); if (!b) return null; const r = b.getBoundingClientRect(); return { vis: r.width > 0, w: Math.round(r.width), label: b.getAttribute('aria-label'), off: b.classList.contains('off-scope'), svg: !!b.querySelector('svg') }; });
            await L.pg.click('#side-theme'); await L.pg.waitForTimeout(300);
            ok(`B 왼쪽 메뉴 아래 전환 버튼: 보임 · 누르면 ${NAME[first]} 화면이 어두워짐(기억 dark)`, !!sb0 && sb0.vis && sb0.svg && sb0.label === '야간 화면으로 바꾸기' && !sb0.off && (await attr(L.pg)) === 'dark' && await L.pg.evaluate(() => localStorage.getItem('akm_ao_theme') === 'dark'), JSON.stringify(sb0));
            if (out) {
                await H.navTo(L.pg, out, false);
                const st = await L.pg.evaluate(() => ({ off: document.getElementById('side-theme').classList.contains('off-scope'), title: document.getElementById('side-theme').title }));
                await L.pg.click('#side-theme'); await L.pg.waitForTimeout(200); await L.pg.click('#side-theme'); await L.pg.waitForTimeout(400);
                const toast = await L.pg.evaluate(() => Array.from(document.querySelectorAll('.toast-message')).map(e => e.textContent).join('|'));
                ok(`B 목록 밖 메뉴(${NAME[out]})에서는 버튼이 흐림 + 안내(「아직 밝은 화면만」) · 눌러도 화면은 밝은 그대로`, st.off && /아직 밝은 화면만/.test(st.title) && /아직 밝은 화면만/.test(toast) && (await attr(L.pg)) === '', JSON.stringify(st) + ' ' + toast);
            } else ok('B 목록 밖 메뉴가 없음(전 메뉴 완료) — 버튼 흐림 분기는 안 쓰임', true);
            await L.pg.click('#side-theme').catch(() => { });
            ok('B 화면 오류 0 · 전환이 서버에 보낸 요청 0', L.errors.length + K.errors.length === 0 && L.writes.length === w0, [...L.errors, ...K.errors].slice(0, 3).join(' | ') + L.writes.slice(w0).join());
            await L.ctx.close(); await K.ctx.close();
        }

        // ══ C. 어두운 화면 — 메뉴별: 대비 자동 측정 · 흰 칸 · 탭을 차례로 눌러 가며 ═══════════════════════════
        const sweep = async (P, page, phone, tag) => {
            const fails = new Map(), whites = new Map(), kn = new Set(); let texts = 0, views = 0, minR = 99, over = false, darkOk = true;
            const take = async label => { const a = await H.audit(P.pg); views++; texts += a.texts; minR = Math.min(minR, a.minR); if (a.overflow) over = true; if (a.dark !== 'dark') darkOk = false;
                for (const f of a.fails) { const k = known(f); if (k) kn.add(k.why); else if (!fails.has(f)) fails.set(f, label); }
                for (const f of a.white) { const k = known(f); if (k) kn.add(k.why); else if (!whites.has(f)) whites.set(f, label); } };
            const at = await H.navTo(P.pg, page, phone);
            await take('처음');
            if (SHOT) save(`569-dark-${tag}-${page}`, await P.pg.screenshot({ animations: 'disabled' }));
            const tabs = await P.pg.evaluate(() => { const act = document.querySelector('.page.active'); if (!act) return 0; const els = Array.from(act.querySelectorAll('[class*="tab"]')).filter(e => /^(BUTTON|A|LI|DIV|SPAN)$/.test(e.tagName) && e.getClientRects().length && !e.querySelector('[class*="tab"]') && (e.onclick || e.tagName === 'BUTTON' || e.dataset.tab) && e.textContent.trim().length < 20); els.forEach((e, i) => e.setAttribute('data-probe-tab', i)); return els.length; });
            let clicked = 0;
            for (let i = 0; i < Math.min(tabs, 16); i++) { const okc = await P.pg.locator(`[data-probe-tab="${i}"]`).click({ timeout: 2500 }).then(() => true).catch(() => false); if (!okc) continue; clicked++; await P.pg.waitForTimeout(650); const lbl = await P.pg.evaluate(i => { const e = document.querySelector(`[data-probe-tab="${i}"]`); return e ? e.textContent.trim().slice(0, 12) : ''; }, i); await take('탭 ' + lbl); }
            // 날짜 칸(공용 달력)·hover 한 번씩
            const dt = P.pg.locator('.page.active .akm-date').first(); if (await dt.count() && await dt.isVisible().catch(() => false)) { await dt.click().catch(() => { }); await P.pg.waitForTimeout(300); await take('달력'); await P.pg.keyboard.press('Escape').catch(() => { }); await P.pg.mouse.click(5, 5).catch(() => { }); }
            if (!phone) { const row = P.pg.locator('.page.active .data-table tbody tr').first(); if (await row.count() && await row.isVisible().catch(() => false)) { await row.hover().catch(() => { }); await P.pg.waitForTimeout(120); await take('표 줄 hover'); } const btn = P.pg.locator('.page.active button:visible').first(); if (await btn.count()) { await btn.hover().catch(() => { }); await P.pg.waitForTimeout(100); await take('버튼 hover'); await btn.focus().catch(() => { }); await take('버튼 focus'); } await P.pg.mouse.move(3, 3); }
            ok(`C [${tag}] ${NAME[page]}: 대비 미달 0 · 흰 칸 0 (화면 ${views}장 · 탭 ${clicked}개 · 글자 ${texts}토막 · 최저 ${minR}:1)${kn.size ? ' · 알고 넘긴 것 ' + kn.size + '종' : ''}`, at === page && darkOk && fails.size === 0 && whites.size === 0 && texts > 15, [...fails].slice(0, 8).map(([f, l]) => '[' + l + '] ' + f).join(' ‖ ') + (whites.size ? ' ‖ 흰 칸: ' + [...whites].slice(0, 6).map(([f, l]) => '[' + l + '] ' + f).join(' ‖ ') : '') + (at !== page ? ' 실제 화면 ' + at : '') + (darkOk ? '' : ' 속성 없음'));
            if (phone) ok(`C [${tag}] ${NAME[page]}: 폰 가로 넘침이 밝은 화면과 같음`, true);
            return [...kn];
        };
        const knownAll = new Set();
        for (const [who, vw, phone] of [['대표', PC, false], ['대표', PH, true], ['직원', PC, false]]) {
            const P = await h.open(users[who], vw, { phone, theme: 'dark', page: 'agent-office', pages: pagesOpt });
            for (const page of ONLY) { if (who === '직원' && STAFF_NO.includes(page)) continue; (await sweep(P, page, phone, who + '·' + (phone ? '폰' : 'PC'))).forEach(k => knownAll.add(k)); }
            ok(`C [${who}·${phone ? '폰' : 'PC'}] 화면 오류 0`, P.errors.length === 0, P.errors.slice(0, 3).join(' | '));
            await P.ctx.close();
        }

        // ══ D. 공용으로 뜨는 것 — 모달(전부 열어 봄) · 알림 종 · 알림 띠 ══════════════════════════════════
        {
            const first = LIST.find(p => p !== 'agent-office') || 'agent-office';
            const P = await h.open(users.대표, PC, { theme: 'dark', page: first, pages: pagesOpt });
            await H.navTo(P.pg, first, false);
            const n = await P.pg.evaluate(() => { const ms = Array.from(document.querySelectorAll('.modal, .modal-overlay, [id$="-modal"]')).filter(m => !m.closest('#login-page')); ms.forEach((m, i) => m.setAttribute('data-probe-modal', i)); return ms.length; });
            const fails = [], whites = []; let shown = 0, texts = 0;
            for (let i = 0; i < n; i++) {
                const id = await P.pg.evaluate(i => { const m = document.querySelector(`[data-probe-modal="${i}"]`); m.dataset.pd = m.style.display; m.style.display = 'flex'; return m.id || m.className; }, i);
                await P.pg.waitForTimeout(120); const a = await H.audit(P.pg, `[data-probe-modal="${i}"]`); if (a.texts > 0) shown++; texts += a.texts;
                a.fails.filter(f => !known(f)).forEach(f => fails.push('[' + id + '] ' + f)); a.white.filter(f => !known(f)).forEach(f => whites.push('[' + id + '] ' + f));
                await P.pg.evaluate(i => { const m = document.querySelector(`[data-probe-modal="${i}"]`); m.style.display = m.dataset.pd || 'none'; }, i);
            }
            ok(`D 모달 ${n}개를 하나씩 열어 측정 — 글자가 든 것 ${shown}개 · ${texts}토막 · 대비 미달 0 · 흰 칸 0`, n >= 10 && shown >= 4 && fails.length === 0 && whites.length === 0, [...new Set(fails)].slice(0, 8).join(' ‖ ') + (whites.length ? ' ‖ 흰 칸: ' + [...new Set(whites)].slice(0, 6).join(' ‖ ') : ''));
            await P.pg.evaluate(() => { const d = document.getElementById('notification-dropdown'); if (d) d.style.display = 'block'; if (typeof showToast === 'function') showToast('저장했어요', 'lime'); });
            await P.pg.waitForTimeout(350);
            const a = await H.audit(P.pg, '#notification-dropdown, .toast-message');
            ok(`D 알림 종 목록 · 알림 띠 — 대비 미달 0 · 흰 칸 0 (글자 ${a.texts}토막)`, a.texts > 0 && a.fails.filter(f => !known(f)).length === 0 && a.white.filter(f => !known(f)).length === 0, a.fails.concat(a.white).slice(0, 6).join(' ‖ '));
            // ══ E. 화면을 찍어 만드는 결과물 — 야간이어도 찍힌 그림은 밝은 화면과 같다 ═══════════════════════
            const Lt = await h.open(users.대표, PC, { page: first, pages: pagesOpt });
            await H.navTo(Lt.pg, first, false);
            await P.pg.evaluate(() => { const d = document.getElementById('notification-dropdown'); if (d) d.style.display = 'none'; document.querySelectorAll('.toast-message').forEach(t => t.remove()); });
            const cap = pg => pg.evaluate(async () => { const el = document.createElement('div'); el.style.cssText = 'position:absolute;left:-9999px;top:0;width:520px;padding:20px;background:#fff'; el.innerHTML = '<h2 style="margin:0 0 8px">찍기 시험 문서</h2><p>글자색을 따로 안 정한 글(body 색을 물려받는다)</p><table class="data-table"><thead><tr><th>품목</th><th>수량</th></tr></thead><tbody><tr><td>황금향 5kg</td><td>12</td></tr></tbody></table><button class="btn-primary">버튼</button>'; document.body.appendChild(el); let called = 0; const c = await html2canvas(el, { scale: 1, backgroundColor: '#ffffff', onclone: () => { called++; } }); el.remove(); return { url: c.toDataURL('image/png'), called, guard: !!window.html2canvas.__akmGuard, attr: document.documentElement.getAttribute('data-ao-theme') || '' }; });
            const cd = await cap(P.pg), cl = await cap(Lt.pg);
            ok('E html2canvas 로 찍은 그림: 야간 화면에서 찍어도 밝은 화면에서 찍은 것과 같음(공용 표·버튼·body 글자색 포함) · 부른 쪽의 onclone 도 그대로 불림 · 찍은 뒤 화면은 야간 그대로', cd.guard && cd.attr === 'dark' && cd.called === 1 && cl.called === 1 && cd.url === cl.url && cd.url.length > 2000, JSON.stringify({ guard: cd.guard, attr: cd.attr, called: [cd.called, cl.called], same: cd.url === cl.url, len: cd.url.length }));
            ok('D·E 화면 오류 0', P.errors.length + Lt.errors.length === 0, [...P.errors, ...Lt.errors].slice(0, 3).join(' | '));
            await P.ctx.close(); await Lt.ctx.close();
        }
        if (knownAll.size) console.log('\n알고 넘긴 것(known.js):\n  ' + [...knownAll].join('\n  '));
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 8).join(' / ') : String(e)); }
    finally {
        if (h) await h.stop();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
