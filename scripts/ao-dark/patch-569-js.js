// #569 ao-desk.js 전환 코드 넓히기(1회용 · 적용 뒤에는 기록용) — 범위 목록 · 사이드바 버튼 · 찍기 보호
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', '..', 'public', 'ao-desk.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('DARK_PAGES')) throw new Error('already patched');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const a = s.indexOf('    function applyTheme() {'), b = s.indexOf('    window.aoDeskEnter = async function () {');
if (a < 0 || b < a) throw new Error('range');
const code = String.raw`    // #569(대표 10/6 밤) 야간 화면을 모든 메뉴로 — 「끝난 메뉴 목록」에 든 메뉴를 보고 있을 때만 속성이 붙는다(목록 밖 메뉴는 켠 사람에게도 종전 밝은 화면)
    //   색은 ao-dark.css(생성물 · scripts/ao-dark) · 에이전트 오피스는 ao-desk.css #568 블록. 묶음이 검증을 통과할 때마다 여기에 이름만 넣는다.
    const DARK_PAGES = ['agent-office'];
    const curPage = () => { const p = document.querySelector('.main-content > .page.active, .page.active'); return p ? p.id.replace(/^page-/, '') : ''; };
    const loginShown = () => { const l = $('login-page'); return !!l && l.style.display !== 'none'; };
    const inScope = () => DARK_PAGES.includes(curPage());
    function applyTheme() {
        const root = document.documentElement;
        if (themeOn && inScope() && !loginShown()) root.setAttribute('data-ao-theme', 'dark'); else root.removeAttribute('data-ao-theme');
        const label = themeOn ? '밝은 화면으로 바꾸기' : '야간 화면으로 바꾸기';
        for (const b of [$('desk-theme'), $('side-theme')]) {
            if (!b) continue;
            b.setAttribute('aria-pressed', String(themeOn)); b.setAttribute('aria-label', label); b.title = label;
            if (b.dataset.on !== String(themeOn)) { b.dataset.on = String(themeOn); b.innerHTML = themeOn ? ICON_SUN : ICON_MOON; }
        }
        const sb = $('side-theme');
        if (sb) { const off = !inScope(); sb.classList.toggle('off-scope', off); if (off) sb.title = label + ' (이 화면은 아직 밝은 화면만 돼요)'; }
    }
    function setTheme(on) {
        themeOn = !!on;
        try { localStorage.setItem(THEME_KEY, themeOn ? 'dark' : 'light'); } catch (e) { /* 기억 못 해도 이번 화면에는 적용 */ }
        applyTheme();
        try { document.dispatchEvent(new CustomEvent('akm-ao-theme', { detail: { dark: themeOn } })); } catch (e) { /* 알림 없이도 속성으로 동작 */ }
    }
    window.AkmAoTheme = { isDark: () => themeOn, set: setTheme, toggle: () => setTheme(!themeOn), pages: () => DARK_PAGES.slice() };
    // 왼쪽 메뉴 아래(사용자 이름 줄 오른쪽 끝)의 전환 버튼 — 모든 메뉴·폰 메뉴에서 닿는다. index.html 무수정(여기서 만들어 붙인다)
    function mountSideTheme() {
        const row = document.querySelector('.sidebar-footer .user-info');
        if (!row || $('side-theme')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'side-theme'; b.className = 'side-theme';
        b.addEventListener('click', () => {
            setTheme(!themeOn);
            if (themeOn && !inScope()) { try { if (typeof showToast === 'function') showToast('야간 화면을 켰어요. 이 화면은 아직 밝은 화면만 돼요.'); } catch (e) { /* 안내 없이도 동작 */ } }
        });
        row.appendChild(b);
    }
    // 화면을 찍어 만드는 결과물(PDF · 이미지 저장)은 야간이어도 종전과 같아야 한다 → html2canvas 가 찍는 복제 문서에서만 속성을 뗀다(보이는 화면은 그대로)
    function guardCapture() {
        const orig = window.html2canvas;
        if (typeof orig !== 'function' || orig.__akmGuard) return;
        const wrapped = function (el, opt) {
            let o = opt;
            try {
                const prev = opt && opt.onclone;
                o = Object.assign({}, opt || {}, { onclone: function (doc) { try { doc.documentElement.removeAttribute('data-ao-theme'); } catch (e) { /* 그대로 찍는다 */ } return typeof prev === 'function' ? prev.apply(this, arguments) : undefined; } });
            } catch (e) { o = opt; }
            return orig.call(this, el, o);
        };
        wrapped.__akmGuard = true;
        try { window.html2canvas = wrapped; } catch (e) { /* 못 감싸면 원래 것 그대로 */ }
    }
    (() => {
        guardCapture(); mountSideTheme();
        if (window.MutationObserver) {
            const mo = new MutationObserver(applyTheme);
            document.querySelectorAll('.page').forEach(p => mo.observe(p, { attributes: true, attributeFilter: ['class'] }));
            const l = $('login-page'); if (l) mo.observe(l, { attributes: true, attributeFilter: ['style'] });
        }
        applyTheme();
    })();

`.split('\n').join(nl);
s = s.slice(0, a) + code + s.slice(b);
s = s.replace('    // #568(대표 10/6) 야간 화면 — 에이전트 오피스에 들어와 있을 때만 · 사람(기기)마다 기억 · 기기 다크모드 설정은 따르지 않는다', '    // #568(대표 10/6) 야간 화면 — 사람(기기)마다 기억 · 기기 다크모드 설정은 따르지 않는다 (범위는 아래 #569 DARK_PAGES)');
fs.writeFileSync(f, s);
console.log('patched');
