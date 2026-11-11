// #1110-5 화면 검증 — 응대 현황 미리보기 [초기화] · 「미리보기 이력」 창(누가·채널·물은 글·답 · 사람·채널 거름 · 더 보기 · 쓴 재료 링크) · window.AkmPreviewLog.open()
//   실행: node scripts/verify-1110-5-ui.js   (가짜 서버 scripts/_mock-1110.js · 포트 PORT1110 또는 3458 · DB·외부·AI 0 · 앱 전체 CSS 그대로)
const path = require('path'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = Number(process.env.PORT1110) || 3458, BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; if (!c) console.log('  ❌ ' + t + (d != null ? ' — ' + String(d).slice(0, 500) : '')); };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const getLog = () => fetch(BASE + '/__mock/log').then(r => r.json());
const USERS = { owner: { id: 1, username: 'owner', name: '전승범', role: 'admin', position: '대표' }, staff: { id: 7, username: 'staff', name: '김민주', role: 'user', position: '사원' } };
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const txt = (page, sel) => page.evaluate(s => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim(), sel);
const ask = async (page, text) => { await page.fill('#rv-text', text); await page.click('#rv-send'); await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait'), null, { timeout: 8000 }); await page.waitForTimeout(150); };
const nRows = page => page.evaluate(() => document.querySelectorAll('#pvl-list .pvl-item').length);
const dlgOpen = page => page.evaluate(() => document.getElementById('pvl').open);
const settle = async page => { await page.waitForFunction(() => !/읽는 중/.test(document.getElementById('pvl-list').textContent) && document.getElementById('pvl-more').textContent !== '읽는 중', null, { timeout: 8000 }); await page.waitForTimeout(120); };
const iso = minAgo => new Date(Date.now() - minAgo * 60000).toISOString();
// 이력 120줄: 정지현(6) 80 · 전승범(1) 40 · 채널 섞음 · 넘김·오류·가격 바로 답 한 줄씩
const SEED = () => { const a = []; for (let i = 1; i <= 120; i++) { const me = i % 3 === 0; a.push({ id: i, user_id: me ? 1 : 6, user_name: me ? '전승범' : '정지현', channel: ['talk', 'qna', 'inquiry', 'sms'][i % 4], question: '물음 ' + i + ' <i>글</i>', answer: '답 ' + i + ' 첫 줄 <b>굵게</b> 아님\n둘째 줄 ' + i, source: 'ai', scenario_nos: ['16', '99'], ms: 2100, created_at: iso(121 - i) }); }
    Object.assign(a[119], { source: 'skip', answer: '봇이 답하지 않고 넘겨요 → 실제로는 직원 몫', scenario_nos: [] }); Object.assign(a[118], { source: 'error', answer: '답을 만들지 못했어요(AI 오류)', scenario_nos: [] }); Object.assign(a[117], { source: 'price_direct', answer: '타이벡감귤 3kg — 19,800원' }); return a; };

async function open(br, w, h, who, ls) {
    await post('/__mock/reset'); await post('/__mock/user', USERS[who]);
    const ctx = await br.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([u, extra]) => { try { localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify(u)); for (const k in extra) localStorage.setItem(k, extra[k]); } catch (e) { } }, [USERS[who], ls || { akm_last_page: 'inquiry' }]);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|초기화 오류|renderSettlement|선결제 목록 오류|주간 정산 현황 오류|rankings load error/.test(m.text())) errs.push('console: ' + m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(1000);
    return { ctx, page, errs };
}

(async () => {
    let br, code = 1, srv;
    try {
        srv = spawn('node', [path.join(__dirname, '_mock-1110.js'), String(PORT)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 900));
        br = await chromium.launch();
        for (const [w, h, who] of [[390, 844, 'owner'], [390, 844, 'staff'], [900, 800, 'staff'], [1280, 860, 'owner'], [1280, 860, 'staff']]) {
            const tag = `[${w}·${who}] `;
            const o = await open(br, w, h, who); const { page } = o;
            ok(await vis(page, '#inquiry-tab-overview'), tag + '응대 현황 탭이 열림');
            // ── 머리 줄 단추
            const hd = await page.evaluate(() => { const R = s => document.querySelector(s).getBoundingClientRect(), a = R('#rv-hist-btn'), b = R('#rv-reset'), t = R('.rv-top .rv-h'), seg = R('#rv-pch'), top = R('.rv-top'); const cs = getComputedStyle(document.querySelector('#rv-reset'));
                return { names: document.querySelector('#rv-hist-btn').textContent + '|' + document.querySelector('#rv-reset').textContent, ah: a.height, bh: b.height, sameRow: Math.abs((a.top + a.height / 2) - (t.top + t.height / 2)) < 12, segBelow: seg.top >= a.bottom - 1, inTop: a.left >= top.left && b.right <= top.right + 0.5, bg: cs.backgroundColor, ink: cs.color, sx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth) }; });
            ok(hd.names === '미리보기 이력|초기화' && hd.sameRow && hd.segBelow && hd.inTop && hd.sx === 0, tag + '머리 줄 = 제목 옆 [미리보기 이력][초기화] · 채널 알약은 아래 줄 · 넘침 0', JSON.stringify(hd));
            ok(hd.bg === 'rgb(227, 236, 247)' && hd.ink === 'rgb(22, 32, 46)' && (w > 720 ? hd.ah >= 32 : hd.ah >= 44 && hd.bh >= 44), tag + '단추 = 톡톡 색 칸 색 · 닿는 높이', JSON.stringify(hd));
            // ── 초기화
            await page.click('#rv-reset'); await page.waitForTimeout(150);
            ok(/비울 대화가 없어요/.test(await page.evaluate(() => document.body.innerText)), tag + '빈 대화에서 [초기화] = 안내만');
            await page.click('#rv-chips .rv-chip'); await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait') && document.querySelectorAll('#rv-log .rv-msg').length >= 2, null, { timeout: 8000 });
            await post('/__mock/set', { rv: { next: 'skip' } }); await ask(page, '감사합니다'); await post('/__mock/set', { rv: { next: 'err' } }); await ask(page, '오류 나는 글');
            ok(await page.evaluate(() => document.querySelectorAll('#rv-log .rv-row').length) === 6, tag + '대화 6줄 쌓임');
            await page.fill('#rv-text', '치던 글'); await page.click('#rv-reset'); await page.waitForTimeout(200);
            ok(/손님이 물어볼 만한 질문을 넣어 보세요/.test(await txt(page, '#rv-log')) && await page.evaluate(() => document.querySelectorAll('#rv-log .rv-row').length) === 0 && await page.inputValue('#rv-text') === '치던 글' && /대화를 비웠어요/.test(await page.evaluate(() => document.body.innerText)), tag + '[초기화] = 대화 비움 · 치던 글은 그대로 · 안내 토스트');
            await page.fill('#rv-text', ''); await ask(page, '초기화 뒤 다시');
            ok(await page.evaluate(() => document.querySelectorAll('#rv-log .rv-row').length) === 2 && /오늘 남은|물어보기/.test(await txt(page, '#rv-send')), tag + '비운 뒤에도 다시 물어볼 수 있음');
            await post('/__mock/set', { rv: { delay: 1200 } }); await page.fill('#rv-text', '느린 답'); await page.click('#rv-send'); await page.waitForTimeout(150); await page.click('#rv-reset'); await page.waitForTimeout(100);
            ok(await page.evaluate(() => document.querySelectorAll('#rv-log .rv-row').length) === 4 && /답을 만드는 중이에요/.test(await page.evaluate(() => document.body.innerText)), tag + '답 만드는 중엔 [초기화] 안 먹고 안내');
            await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait'), null, { timeout: 8000 }); await post('/__mock/set', { rv: { delay: 0 } });
            // 다른 탭 갔다 오면 그대로 · 새로고침하면 빈 화면
            await page.evaluate(() => window.switchInquiryTab('scenario')); await page.waitForTimeout(250); await page.evaluate(() => window.switchInquiryTab('overview')); await page.waitForTimeout(250);
            ok(await page.evaluate(() => document.querySelectorAll('#rv-log .rv-row').length) === 4, tag + '다른 탭 갔다 오면 대화 그대로');
            await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1000);
            ok(await vis(page, '#inquiry-tab-overview') && await page.evaluate(() => document.querySelectorAll('#rv-log .rv-row').length) === 0 && await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).every(k => !/rv|preview|미리/i.test(k))), tag + '새로고침하면 대화가 빔(기기에 저장 안 함)');
            // ── 이력: 방금 물어본 것이 쌓였나(가짜 서버가 기록)
            await page.click('#rv-hist-btn'); await settle(page);
            ok(await dlgOpen(page) && await nRows(page) === 5 && /미리보기 이력/.test(await txt(page, '#pvl-title')) && /손님에게 나간 글이 아니에요/.test(await txt(page, '.pvl-sub')), tag + '[미리보기 이력] → 창이 열리고 방금 물어본 5건', String(await nRows(page)));
            let first = await page.evaluate(() => { const r = document.querySelector('#pvl-list .pvl-row'); return { who: r.querySelector('.pvl-who').textContent, ch: r.querySelector('.pvl-ch').textContent, q: r.querySelector('.pvl-q').textContent, a: r.querySelector('.pvl-a').textContent, when: r.querySelector('.pvl-when').textContent }; });
            ok(first.who === USERS[who].name && first.q === '느린 답' && /느린 답 에 대한 답/.test(first.a) && /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(first.when), tag + '줄 = 시각 · 누가 · 채널 · 물은 글 · 답 첫 줄(새 것부터)', JSON.stringify(first));
            ok(/봇이 넘김/.test(await txt(page, '#pvl-list')) && /오류/.test(await txt(page, '#pvl-list')), tag + '넘김·오류 줄은 알약으로 표시');
            await page.keyboard.press('Escape'); await page.waitForTimeout(150); ok(!(await dlgOpen(page)), tag + 'Esc 로 닫힘');
            // ── 이력 120줄: 더 보기 · 거름 · 펼침
            await post('/__mock/set', { plog: SEED() });
            await page.evaluate(() => window.AkmPreviewLog.open()); await settle(page);
            ok(await nRows(page) === 50 && await vis(page, '#pvl-more') && /물음 120/.test(await txt(page, '#pvl-list .pvl-item:first-child .pvl-q')), tag + 'window.AkmPreviewLog.open() · 첫 쪽 50줄 · [더 보기] 보임');
            ok(await page.evaluate(() => { const u = document.getElementById('pvl-user'), c = document.getElementById('pvl-ch'); return Array.from(u.options).map(x => x.textContent).join('|') === '전체|정지현|전승범' && Array.from(c.options).map(x => x.textContent).join('|') === '전체|톡톡|상품문의|고객문의|문자'; }), tag + '거름 칸 = 누가(전체·물어본 사람들) · 채널', await page.evaluate(() => Array.from(document.getElementById('pvl-user').options).map(x => x.textContent).join('|')));
            await page.click('#pvl-more'); await settle(page); ok(await nRows(page) === 100, tag + '[더 보기] → 100줄', String(await nRows(page)));
            await page.click('#pvl-more'); await settle(page); ok(await nRows(page) === 120 && !(await vis(page, '#pvl-more')), tag + '끝까지 = 120줄 · [더 보기] 사라짐');
            ok((await getLog()).gets.filter(x => /response-preview-log/.test(x)).length >= 3, tag + '쪽마다 조회 요청');
            await page.selectOption('#pvl-user', '6'); await settle(page);
            ok(await nRows(page) === 50 && await page.evaluate(() => Array.from(document.querySelectorAll('#pvl-list .pvl-who')).every(e => e.textContent === '정지현')) && await vis(page, '#pvl-more'), tag + '사람 거름(정지현) = 그 사람 글만(남이 물은 것도 보임)');
            await page.selectOption('#pvl-ch', 'sms'); await settle(page);
            const nSms = await nRows(page);
            ok(nSms === 20 && await page.evaluate(() => Array.from(document.querySelectorAll('#pvl-list .pvl-ch')).every(e => e.textContent === '문자')) && !(await vis(page, '#pvl-more')), tag + '사람 + 채널 거름(문자)', String(nSms));
            await page.selectOption('#pvl-user', '1'); await page.selectOption('#pvl-ch', 'inquiry'); await settle(page); const nInq = await nRows(page);
            await page.selectOption('#pvl-user', ''); await page.selectOption('#pvl-ch', ''); await settle(page);
            ok(nInq === 10 && await nRows(page) === 50, tag + '거름을 풀면 다시 전체', nInq + '/' + await nRows(page));
            // 펼침(넷째 줄 = id 117 보통 답)
            await page.click('#pvl-list .pvl-item:nth-child(4) .pvl-row'); await page.waitForTimeout(120);
            const full = await page.evaluate(() => { const it = document.querySelector('#pvl-list .pvl-item:nth-child(4)'), t = it.querySelectorAll('.pvl-text'), f = it.querySelector('.pvl-foot'); return { exp: it.querySelector('.pvl-row').getAttribute('aria-expanded'), q: t[0].textContent, a: t[1].textContent, pre: getComputedStyle(t[1]).whiteSpace, tags: it.querySelectorAll('.pvl-text b, .pvl-text i').length, links: Array.from(f.querySelectorAll('button.rv-link')).map(b => b.textContent).join(','), spans: Array.from(f.querySelectorAll('span')).map(b => b.textContent).join(','), foot: f.textContent, labs: Array.from(it.querySelectorAll('.pvl-lab')).map(e => e.textContent).join('|'), focus: document.activeElement === it.querySelector('.pvl-row'), noFirst: !it.querySelector('.pvl-a') }; });
            ok(full.exp === 'true' && full.q === '물음 117 <i>글</i>' && full.a === '답 117 첫 줄 <b>굵게</b> 아님\n둘째 줄 117' && full.pre.startsWith('pre') && full.tags === 0 && full.labs === '물은 글|봇 답' && full.focus && full.noFirst, tag + '줄을 누르면 전체 물음·답(줄바꿈 유지 · 태그 글자 그대로 · 초점 유지)', JSON.stringify(full));
            ok(full.links === '시나리오 16' && full.spans === '시나리오 99' && /2\.1초/.test(full.foot), tag + '쓴 재료 = 아는 번호만 링크 · 걸린 시간', JSON.stringify(full));
            await page.click('#pvl-list .pvl-item:nth-child(1) .pvl-row'); await page.click('#pvl-list .pvl-item:nth-child(2) .pvl-row'); await page.click('#pvl-list .pvl-item:nth-child(3) .pvl-row'); await page.waitForTimeout(120);
            const kinds = await page.evaluate(() => [1, 2, 3].map(i => { const it = document.querySelector(`#pvl-list .pvl-item:nth-child(${i})`); return Array.from(it.querySelectorAll('.pvl-lab')).map(e => e.textContent).join('|') + '/' + (it.querySelector('.pvl-foot') ? it.querySelector('.pvl-foot').textContent : ''); }));
            ok(/봇이 답하지 않았어요/.test(kinds[0]) && /답을 만들지 못했어요/.test(kinds[1]) && /가격 바로 답\(AI 없이\)/.test(kinds[2]) && !/쓴 재료/.test(kinds[0] + kinds[1]), tag + '넘김·오류·가격 바로 답 = 까닭 글과 맞는 머리말', JSON.stringify(kinds));
            await page.click('#pvl-list .pvl-item:nth-child(4) .pvl-row'); await page.waitForTimeout(100);
            ok(await page.evaluate(() => { const it = document.querySelector('#pvl-list .pvl-item:nth-child(4)'); return it.querySelector('.pvl-row').getAttribute('aria-expanded') === 'false' && !it.querySelector('.pvl-full') && !!it.querySelector('.pvl-a'); }), tag + '다시 누르면 접힘');
            // 크기 · 넘침 · 닿는 높이 · 야간
            const geo = await page.evaluate(() => { const d = document.getElementById('pvl'), r = d.getBoundingClientRect(), l = document.getElementById('pvl-list'), cs = getComputedStyle(d); return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top), iw: innerWidth, ih: innerHeight, listScroll: l.scrollHeight > l.clientHeight, inner: d.scrollWidth <= d.clientWidth + 1 && l.scrollWidth <= l.clientWidth + 1, rowH: Math.min(...Array.from(document.querySelectorAll('#pvl-list .pvl-row')).map(e => e.getBoundingClientRect().height)), selH: document.getElementById('pvl-user').getBoundingClientRect().height, closeH: document.getElementById('pvl-close').getBoundingClientRect().height, bg: cs.backgroundColor, ink: cs.color, sx: Math.max(0, document.documentElement.scrollWidth - innerWidth) }; });
            ok(geo.listScroll && geo.inner && geo.sx === 0 && geo.rowH >= 44 && (w <= 720 ? geo.w === geo.iw && geo.h === geo.ih && geo.selH >= 44 && geo.closeH >= 44 : geo.w <= 720 && geo.h <= geo.ih * 0.87 && geo.left > 0 && geo.top > 0), tag + (w <= 720 ? '폰 = 창이 화면 전체' : 'PC = 가운데 창(폭 720 안)') + ' · 목록만 스크롤 · 가로 넘침 0 · 줄 44px', JSON.stringify(geo));
            ok(geo.bg === 'rgb(255, 255, 255)' && geo.ink === 'rgb(16, 24, 40)', tag + '이력 창 = 회사프로그램 기본 색(흰 카드 · 짙은 글)', geo.bg + ' ' + geo.ink);
            await page.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark')); await page.waitForTimeout(100);
            const dk = await page.evaluate(() => { const lum = c => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }; const d = document.getElementById('pvl'), q = document.querySelector('#pvl-list .pvl-q'), a = document.querySelector('#pvl-list .pvl-a'), who = document.querySelector('#pvl-list .pvl-who'); return { bg: lum(getComputedStyle(d).backgroundColor), q: lum(getComputedStyle(q).color), a: lum(getComputedStyle(a).color), who: lum(getComputedStyle(who).color) }; });
            ok(dk.bg < 0.25 && dk.q > 0.7 && dk.who > 0.7 && dk.a > 0.45, tag + '야간 = 어두운 창 · 밝은 글', JSON.stringify(dk));
            await page.evaluate(() => document.documentElement.removeAttribute('data-ao-theme'));
            // 바깥 누르면 닫힘(PC) · 닫기 단추
            if (w > 720) { await page.mouse.click(8, 8); await page.waitForTimeout(150); ok(!(await dlgOpen(page)), tag + '바깥(어두운 바탕)을 누르면 닫힘'); await page.evaluate(() => window.AkmPreviewLog.open()); await settle(page); }
            await page.click('#pvl-close'); await page.waitForTimeout(150); ok(!(await dlgOpen(page)), tag + '[닫기] 로 닫힘');
            // ── 쓴 재료 링크 → 그 시나리오 고치기(다른 메뉴에 있다가도)
            await page.evaluate(() => switchPage('schedule')); await page.waitForTimeout(300);
            await page.evaluate(() => window.AkmPreviewLog.open()); await settle(page);
            ok(await dlgOpen(page) && await nRows(page) === 50, tag + '다른 메뉴(일정표)에서도 AkmPreviewLog.open() 으로 열림');
            await page.click('#pvl-list .pvl-item:nth-child(5) .pvl-row'); await page.waitForTimeout(120); await page.click('#pvl-list .pvl-item:nth-child(5) [data-pvl-scen]'); await page.waitForTimeout(900);
            ok(!(await dlgOpen(page)) && await page.evaluate(() => getComputedStyle(document.getElementById('page-inquiry')).display !== 'none' && getComputedStyle(document.getElementById('inquiry-tab-scenario')).display !== 'none' && getComputedStyle(document.getElementById('inquiry-edit-card')).display !== 'none' && /#16/.test(document.getElementById('inquiry-edit-title').textContent)), tag + '「시나리오 16」 링크 → 창 닫히고 문의 관리 › 그 글 고치기', await txt(page, '#inquiry-edit-title'));
            // ── 빈 이력 · 오류 · 다시 읽기
            await post('/__mock/set', { plog: [] }); await page.evaluate(() => window.AkmPreviewLog.open()); await settle(page);
            ok(await nRows(page) === 0 && /아직 미리 물어본 글이 없어요/.test(await txt(page, '#pvl-list')) && !(await vis(page, '#pvl-more')), tag + '빈 이력 안내');
            await post('/__mock/set', { plog: SEED().slice(0, 3) }); await page.selectOption('#pvl-ch', 'sms'); await settle(page); await page.selectOption('#pvl-user', '6'); await settle(page);
            ok(/고른 조건에 맞는 미리보기가 없어요/.test(await txt(page, '#pvl-list')), tag + '거름 결과 0 = 다른 안내', await txt(page, '#pvl-list'));
            await page.selectOption('#pvl-user', ''); await page.selectOption('#pvl-ch', ''); await settle(page);
            await post('/__mock/set', { rv: { plog: '500' } }); await page.evaluate(() => { window.AkmPreviewLog.close(); window.AkmPreviewLog.open(); }); await page.waitForTimeout(500);
            ok(/다시 읽기/.test(await txt(page, '#pvl-list')) && await nRows(page) === 0, tag + '조회 오류 = 안내 + [다시 읽기]', await txt(page, '#pvl-list'));
            await post('/__mock/set', { rv: { plog: 'ok' } }); await page.click('#pvl-list [data-pvl-retry]'); await settle(page);
            ok(await nRows(page) === 3, tag + '[다시 읽기] → 목록');
            await page.click('#pvl-close');
            ok(o.errs.length === 0, tag + '콘솔 오류 0', o.errs.slice(0, 3).join(' | ')); await o.ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error('검증 오류:', e); fail++; }
    finally { if (br) await br.close(); if (srv) srv.kill(); }
    console.log(`#1110-5 화면 검증: 통과 ${pass} · 실패 ${fail}`);
    process.exit(code);
})();
