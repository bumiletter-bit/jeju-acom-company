// #910 네이버 키워드 순위 자동 수집 — 어사이드(Aside AI 브라우저)를 스크립트가 직접 부려 읽는다(Claude 호출 0 · 토큰 0)
//
//   설계 = docs/910-keyword-rank-auto.md. 창구 대기 프로그램(launcher.js rankMaybe)이 KST 09:30 하루 한 번 `--apply` 로 띄운다.
//
//   어사이드 길 = aside.exe mcp(MCP stdio · JSON-RPC 2.0 · 줄 단위 JSON) 를 자식 프로세스로 띄우고 tools/call repl(title, code) 을 부른다.
//     - 10/28 실측: initialize 0.4초 · repl 한 번 0.3초(브라우저 작업 시간 별도) · 같은 프로세스 안에서는 REPL 변수·탭이 유지된다.
//     - 어사이드가 꺼져 있으면 CLI 가 저절로 켠다(「Aside isn't running. Opening Aside...」 · 5초 안팎).
//     - 다른 길(`aside repl "<code>"` 명령줄)도 되지만 호출마다 새 REPL 이라 탭을 다시 열어야 해서 MCP 길을 쓴다.
//
//   순위 셈(10/28 실측 DOM · 네이버가 class 뒤 해시를 바꿔도 앞 글자로 찾는다)
//     ① 쇼핑 = msearch.shopping.naver.com/search/all?query=… 목록(.listContainer_list_inner__*)의 자식 중
//          광고(adProduct_list_item__* · superSavingProduct_list_item__* · content_block)를 뺀 product_list_item__* 순서에서 우리 스토어(상호 글자) 첫 상품 = 쇼핑 순위.
//          한 쪽 40개(끝까지 스크롤해야 전부 그려짐). 2쪽은 🔴 주소에 pagingIndex=2 를 직접 치면 「접속이 일시적으로 제한」 차단 화면이 뜨므로(10/28 실측)
//          쪽 번호 단추(.paginator_* 안 「2」)를 눌러 넘긴다. max_rank(기본 40) 를 덮을 만큼만 본다(최대 3쪽).
//        광고 = 같은 목록의 광고 항목만 모은 순서에서 우리 스토어 첫 상품(쪽을 넘기며 이어 셈).
//     ② 파워링크 = 통합검색 「파워링크」 묶음 안 순서에서 우리 스토어(상호 또는 smartstore.naver.com/akkome 꼴 표시 주소) 첫 광고.
//          모바일(m.search.naver.com · section._pwl_video_container li.bx)은 5개만 보이고 나머지는 「더보기」 뒤 · PC(search.naver.com · .ad_section._pl_section li.lst)는 15개까지 보임.
//          어느 화면을 셀지 = 설정 powerlink_source 'mobile'(설계 기본) | 'pc' | 'both'(둘 다 읽고 mobile 을 저장 · pc 는 표에만).
//     ③ 상품 목록 API(/api/search/all)는 페이지 안 fetch 로도 418 → DOM 만 읽는다. 캡처는 안 찍는다(어사이드 메모리 함정).
//   없음·max_rank 밖 = null · 차단·캡차·탭 끊김·오류 = 그 키워드 세 칸 null + errors[].
//   요청(페이지 열기·쪽 넘김) 사이 1.5초.
//
//   저장(--apply) = keyword_rankings UPSERT(date, keyword · 화면 /api/rankings/bulk 와 같은 SQL · created_by NULL · source 'auto' 는 칸이 있을 때만 · 없으면 경고)
//     🔴 같은 날 직원이 손으로 넣은 줄(source 'manual' 또는 source 칸 없이 created_by 있는 줄)은 덮지 않는다(사람 값 우선 · ON CONFLICT … WHERE 한 문장).
//     🔴 읽기 실패 키워드는 DB 줄로 넣지 않는다(keyword_rank_last.errors 에만) — 전체 실패 날 auto 줄 0 → 서버 10:00 「미수집」 알림 · 같은 날 재실행이 좋은 값을 NULL 로 안 덮음.
//     + 설정 keyword_rank_last = { date, at, ok, rows:[{keyword,shopping,ad,powerlink}], errors:[{keyword,error}] } (jsonb 합치기 · notified 칸은 서버 몫이라 건드리지 않음)
//     + audit_logs(source desk · action keyword_rank_auto).
//
// 사용: node scripts/desk/keyword-rank.js                 (dry — DB 읽기만 · 표로 출력)
//       node scripts/desk/keyword-rank.js --apply         (저장)
//       node scripts/desk/keyword-rank.js --date 2026-10-28 --keywords 귤,제주귤 --pc   (--pc = 파워링크 PC 화면도 같이 읽어 표에 · --mobile-only 반대)
//       env ASIDE_EXE(aside.exe 경로) · KR_PAGE_WAIT_MS(요청 사이 · 기본 1500)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ASIDE_EXE = process.env.ASIDE_EXE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Aside', 'CLI', 'current', 'aside.exe');
const PAGE_WAIT_MS = Math.max(300, parseInt(process.env.KR_PAGE_WAIT_MS, 10) || 1500);
const REPL_TIMEOUT_MS = 125000;      // 어사이드 repl 자체 상한 120초
const MAX_PAGES = 3;                 // 한 키워드 쇼핑 3쪽 넘게 안 봄
const PAGE_SIZE = 40;                // 모바일 쇼핑 한 쪽 상품 수(실측)

const DEFAULT_CFG = {
    enabled: true,
    time: '09:30',
    keywords: ['귤', '제주귤', '감귤', '제주감귤', '타이벡귤', '황금향', '제주황금향', '레몬', '제주레몬'],
    store: { names: ['제주아꼼이네'], hosts: ['smartstore.naver.com/jejuakkome', 'brand.naver.com/jejuakkome', 'smartstore.naver.com/akkome'] },
    max_rank: 40,
    miss_alert: '10:00',
    powerlink_source: 'mobile',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDate = () => kstNow().toISOString().slice(0, 10);
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

// ───────── 인자
function parseArgs(argv) {
    const a = { apply: false, date: null, keywords: null, pc: null, mobileOnly: false, verbose: false };
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '--apply') a.apply = true;
        else if (v === '--dry') a.apply = false;
        else if (v === '--date') a.date = argv[++i];
        else if (v === '--keywords') a.keywords = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
        else if (v === '--pc') a.pc = true;
        else if (v === '--mobile-only') a.mobileOnly = true;
        else if (v === '--verbose' || v === '-v') a.verbose = true;
        else if (v === '-h' || v === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n')); process.exit(0); }
        else throw new Error('모르는 인자: ' + v);
    }
    if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new Error('--date 는 YYYY-MM-DD');
    return a;
}

// ───────── 어사이드 MCP 손잡이(JSON-RPC 2.0 · stdio · 줄 단위)
class Aside {
    constructor(exe, log) { this.exe = exe; this.log = log || (() => { }); this.id = 0; this.pending = new Map(); this.buf = ''; this.proc = null; this.exited = null; }
    async start() {
        if (!fs.existsSync(this.exe)) throw new Error('aside.exe 없음: ' + this.exe + ' (env ASIDE_EXE 로 경로 지정)');
        this.proc = spawn(this.exe, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.proc.stdout.setEncoding('utf8');
        this.proc.stdout.on('data', d => this._onData(d));
        this.proc.stderr.setEncoding('utf8');
        this.proc.stderr.on('data', d => { const s = String(d).trim(); if (s && !/"event":"startup"/.test(s)) this.log('[aside stderr] ' + s.slice(0, 300)); });
        this.proc.on('exit', (c, sig) => { this.exited = { code: c, sig }; for (const [, p] of this.pending) p.rej(new Error('어사이드 프로세스 종료(' + (c == null ? sig : c) + ')')); this.pending.clear(); });
        this.proc.on('error', e => { for (const [, p] of this.pending) p.rej(e); this.pending.clear(); });
        const init = await this._call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'keyword-rank', version: '910.1' } }, 60000);
        this._notify('notifications/initialized');
        const tools = await this._call('tools/list', {}, 30000);
        const names = ((tools.result || {}).tools || []).map(t => t.name);
        if (!names.includes('repl')) throw new Error('어사이드 MCP 에 repl 도구가 없음: ' + names.join(','));
        return { server: (init.result || {}).serverInfo, tools: names };
    }
    _onData(d) {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
            if (!line) continue;
            let m; try { m = JSON.parse(line); } catch (e) { this.log('[aside 비JSON] ' + line.slice(0, 200)); continue; }
            if (m.id != null && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.t); p.res(m); }
        }
    }
    _notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
    _call(method, params, timeoutMs) {
        const id = ++this.id;
        return new Promise((res, rej) => {
            const t = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('어사이드 응답 없음(' + method + ' · ' + Math.round(timeoutMs / 1000) + '초)')); } }, timeoutMs);
            this.pending.set(id, { res, rej, t });
            try { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch (e) { clearTimeout(t); this.pending.delete(id); rej(e); }
        });
    }
    // repl 실행 → console.log 로 찍힌 글(마지막 줄을 JSON 으로 돌려받는 약속)
    async repl(title, code) {
        const r = await this._call('tools/call', { name: 'repl', arguments: { title, code } }, REPL_TIMEOUT_MS);
        if (r.error) throw new Error('repl 오류: ' + JSON.stringify(r.error).slice(0, 300));
        const content = ((r.result || {}).content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
        if ((r.result || {}).isError) throw new Error('repl 실패: ' + content.slice(0, 400));
        return content;
    }
    async replJson(title, code) {
        const text = await this.repl(title, code);
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].startsWith('{') || lines[i].startsWith('[')) { try { return JSON.parse(lines[i]); } catch (e) { /* 다음 줄 */ } } }
        throw new Error('repl 결과에 JSON 줄이 없음: ' + text.slice(0, 300));
    }
    async stop() {
        if (!this.proc || this.exited) return;
        try { await this.repl('탭 정리', 'try { for (const t of [...tabs]) { try { await closeTab(t); } catch (e) {} } } catch (e) {} console.log("{}")'); } catch (e) { /* 무시 */ }
        try { this.proc.stdin.end(); } catch (e) { /* 무시 */ }
        await Promise.race([new Promise(r => this.proc.once('exit', r)), sleep(3000)]);
        if (!this.exited) { try { this.proc.kill(); } catch (e) { /* 무시 */ } }
    }
}

// ───────── 페이지 안에서 돌릴 코드(문자열) — 결과는 마지막 줄 JSON 하나로
// 공통: 차단 화면 판정
const JS_BLOCK_CHECK = `(() => { const t = (document.body && document.body.innerText || '').slice(0, 600); if (/접속이 일시적으로 제한|비정상적인 접근/.test(t)) return 'blocked'; if (/captcha|보안문자|자동입력 방지/i.test(t) || document.querySelector('#captcha, img[src*="captcha"]')) return 'captcha'; return ''; })()`;

// 쇼핑 목록 한 쪽 읽기(스크롤로 전부 그린 뒤) → { items:[{ad, mall}], page, blocked }
const JS_SHOP_READ = `(() => {
  const list = document.querySelector('[class*="listContainer_list_inner__"]');
  if (!list) return { items: null };
  const kids = [...list.children];
  const items = [];
  for (const c of kids) {
    const cls = String(c.className || '');
    let ad = null;
    if (/^product_list_item__/.test(cls)) ad = false;
    else if (/^adProduct_list_item__/.test(cls) || /^superSavingProduct_list_item__/.test(cls)) ad = true;
    else continue;   // content_block(배달 광고 묶음)·그 밖 = 상품 아님
    if (!ad && c.querySelector('[class*="link_ad__"]')) ad = true;   // 「광고」 배지가 붙은 일반 꼴은 광고로
    const mallEl = c.querySelector('[class*="_mall__"]');
    const mall = mallEl ? mallEl.textContent.replace(/네이버플러스멤버십|네이버톡톡|광고/g, '').trim() : '';
    const tit = c.querySelector('[class*="_info_tit__"],[class*="_title__"]');
    items.push({ ad, mall, title: tit ? tit.textContent.trim().slice(0, 40) : '', id: (c.id || '').replace('_sr_lst_', '') });
  }
  const pg = document.querySelector('[class*="paginator_"]');
  const active = pg ? [...pg.querySelectorAll('a')].find(a => /active/.test(a.className)) : null;
  return { items, page: active ? Number(active.textContent.trim()) : 1, hasNext: !!(pg && [...pg.querySelectorAll('a')].some(a => a.textContent.trim() === String((active ? Number(active.textContent.trim()) : 1) + 1))) };
})()`;

function jsShopPage(keyword, pageNo) {
    // pageNo 1 = 새로 열기 · 2~ = 쪽 번호 단추 누르기(주소 직접 치면 차단 화면)
    return `
var KR_q = ${JSON.stringify(keyword)};
if (typeof KR_shop === 'undefined' || !KR_shop) { globalThis.KR_shop = await openTab('about:blank'); }
var KR_out = {};
try {
  if (${pageNo} === 1) {
    await KR_shop.goto('https://msearch.shopping.naver.com/search/all?query=' + encodeURIComponent(KR_q), { waitUntil: 'domcontentloaded', timeout: 40000 });
  } else {
    var KR_clicked = await KR_shop.evaluate((n) => { const pg = document.querySelector('[class*="paginator_"]'); if (!pg) return 'nopg'; const a = [...pg.querySelectorAll('a')].find(x => x.textContent.trim() === String(n)); if (!a) return 'nolink'; a.click(); return 'ok'; }, ${pageNo});
    if (KR_clicked !== 'ok') { KR_out = { items: [], noPage: KR_clicked }; }
  }
  if (!KR_out.noPage) {
    var KR_t0 = Date.now(), KR_blk = '';
    while (Date.now() - KR_t0 < 25000) {
      KR_blk = await KR_shop.evaluate(() => ${JS_BLOCK_CHECK});
      if (KR_blk) break;
      var KR_ready = await KR_shop.evaluate((n) => { const l = document.querySelector('[class*="listContainer_list_inner__"]'); if (!l) return false; const pg = document.querySelector('[class*="paginator_"]'); const act = pg ? [...pg.querySelectorAll('a')].find(a => /active/.test(a.className)) : null; const cur = act ? Number(act.textContent.trim()) : 1; return l.children.length > 0 && cur === n; }, ${pageNo});
      if (KR_ready) break;
      await new Promise(r => setTimeout(r, 400));
    }
    if (KR_blk) { KR_out = { items: null, blocked: KR_blk, url: KR_shop.url() }; }
    else {
      // 끝까지 스크롤해 목록을 전부 그린다(가상 렌더 — 바닥에 닿아도 목록이 더 그려지면 높이가 늘어남 · 바닥에서 2.5초 동안 안 늘어나야 끝 · 상한 60초)
      //   10/28 1차: 1,600px 씩 350ms 로 돌리다 바닥 판정이 일찍 나 「감귤」이 10개만 읽혔음 → 걸음 900px · 바닥에서 5번 연속 같아야 멈춤.
      var KR_prev = -1, KR_same = 0, KR_t1 = Date.now();
      for (let i = 0; i < 150 && Date.now() - KR_t1 < 60000; i++) {
        await KR_shop.evaluate(() => window.scrollBy(0, 900));
        await new Promise(r => setTimeout(r, 300));
        var KR_st = await KR_shop.evaluate(() => { const l = document.querySelector('[class*="listContainer_list_inner__"]'); return { n: l ? l.querySelectorAll('[class*="_list_item__"]').length : 0, bottom: window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 50 }; });
        if (KR_st.n === KR_prev) KR_same++; else KR_same = 0;
        KR_prev = KR_st.n;
        if (KR_st.bottom) { await new Promise(r => setTimeout(r, 500)); if (KR_same >= 5) break; }
      }
      KR_out = await KR_shop.evaluate(() => ${JS_SHOP_READ});
      KR_out.url = KR_shop.url();
      KR_out.title = await KR_shop.title();
    }
  }
} catch (e) { KR_out = { items: null, error: String(e && e.message || e).slice(0, 200) }; }
console.log(JSON.stringify(KR_out));`;
}

// 통합검색 파워링크 — mobile: section._pwl_video_container li.bx(sublink 제외) · pc: .ad_section._pl_section li.lst
function jsPowerlink(keyword, which) {
    const url = which === 'pc'
        ? `'https://search.naver.com/search.naver?query=' + encodeURIComponent(KR_q)`
        : `'https://m.search.naver.com/search.naver?where=m&query=' + encodeURIComponent(KR_q)`;
    const tabVar = which === 'pc' ? 'KR_pc' : 'KR_mo';
    const read = which === 'pc'
        ? `(() => { const sec = document.querySelector('div.ad_section._pl_section, [class*="_pl_section"]'); if (!sec) return { ads: [], noSection: true }; const li = [...sec.querySelectorAll('li.lst, li[class*="lst"]')]; return { ads: li.map(l => l.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120)), total: li.length }; })()`
        : `(() => { const sec = document.querySelector('section._pwl_video_container, section[class*="_pwl"]'); if (!sec) return { ads: [], noSection: true }; const li = [...sec.querySelectorAll('li.bx')]; const more = sec.querySelector('a.group_more, [class*="group_more"]'); return { ads: li.map(l => l.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120)), total: li.length, more: more ? (more.href || '').slice(0, 200) : null }; })()`;
    return `
var KR_q = ${JSON.stringify(keyword)};
if (typeof ${tabVar} === 'undefined' || !${tabVar}) { globalThis.${tabVar} = await openTab('about:blank'); }
var KR_out = {};
try {
  await ${tabVar}.goto(${url}, { waitUntil: 'domcontentloaded', timeout: 40000 });
  var KR_t0 = Date.now(), KR_blk = '', KR_got = false;
  while (Date.now() - KR_t0 < 15000) {
    KR_blk = await ${tabVar}.evaluate(() => ${JS_BLOCK_CHECK});
    if (KR_blk) break;
    KR_got = await ${tabVar}.evaluate(() => !!document.querySelector('a[href*="ader.naver.com"]') || /검색결과|더보기/.test(document.body.innerText.slice(0, 20000)));
    if (KR_got) break;
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 800));
  if (KR_blk) KR_out = { ads: null, blocked: KR_blk };
  else { KR_out = await ${tabVar}.evaluate(() => ${read}); KR_out.url = ${tabVar}.url(); }
} catch (e) { KR_out = { ads: null, error: String(e && e.message || e).slice(0, 200) }; }
console.log(JSON.stringify(KR_out));`;
}

// ───────── 순위 셈
function matchStore(text, store) {
    const t = norm(text);
    if (!t) return false;
    for (const n of (store.names || [])) if (n && t.includes(norm(n))) return true;
    for (const h of (store.hosts || [])) if (h && t.includes(norm(h).replace(/^https?:\/\//, '').replace(/^m\./, ''))) return true;
    return false;
}
// 파워링크 글에 표시 주소가 「smartstore.naver.com/akkome 높은 만족도…」 꼴 → 주소 뒤 글자가 이어붙으므로 경로 뒤 경계도 본다
function matchStoreHost(text, store) {
    const t = norm(text);
    for (const n of (store.names || [])) if (n && t.includes(norm(n))) return true;
    for (const h of (store.hosts || [])) {
        const hh = norm(h).replace(/^https?:\/\//, '').replace(/^m\./, '');
        const i = t.indexOf(hh);
        if (i < 0) continue;
        const after = t.charAt(i + hh.length);
        if (!after || !/[a-z0-9_-]/.test(after)) return true;   // akkome 뒤에 영숫자가 더 붙으면(akkome2 등) 다른 스토어
    }
    return false;
}

async function rankShopping(aside, keyword, cfg, log) {
    const maxRank = Math.max(1, Number(cfg.max_rank) || 40);
    const pagesNeeded = Math.min(MAX_PAGES, Math.ceil(maxRank / PAGE_SIZE));
    let organic = [], ads = [], pages = 0, notes = [];
    let shopping = null, ad = null;
    for (let p = 1; p <= pagesNeeded; p++) {
        if (p > 1) await sleep(PAGE_WAIT_MS);
        const r = await aside.replJson(`쇼핑 「${keyword}」 ${p}쪽`, jsShopPage(keyword, p));
        if (r.blocked) throw new Error('네이버 쇼핑 차단 화면(' + r.blocked + ')');
        if (r.error) throw new Error('쇼핑 ' + p + '쪽 ' + r.error);
        if (r.noPage) { notes.push(p + '쪽 없음'); break; }
        if (!Array.isArray(r.items)) throw new Error('쇼핑 ' + p + '쪽 목록을 못 찾음(' + (r.title || '') + ')');
        if (r.page && r.page !== p) { notes.push('쪽 번호 어긋남 ' + r.page + '≠' + p); }
        pages = p;
        for (const it of r.items) { if (it.ad) ads.push(it); else organic.push(it); }
        if (shopping == null) { const i = organic.findIndex(it => matchStore(it.mall, cfg.store)); if (i >= 0 && i + 1 <= maxRank) shopping = i + 1; }
        if (ad == null) { const i = ads.findIndex(it => matchStore(it.mall, cfg.store)); if (i >= 0) ad = i + 1; }
        if (shopping != null && ad != null) break;
        if (organic.length >= maxRank && shopping == null && ad != null) break;
        if (!r.hasNext) break;
    }
    if (shopping != null && shopping > maxRank) shopping = null;
    return { shopping, ad, organicSeen: organic.length, adsSeen: ads.length, pages, notes, organic, ads };
}

async function rankPowerlink(aside, keyword, cfg, which) {
    const r = await aside.replJson(`통합검색(${which}) 「${keyword}」 파워링크`, jsPowerlink(keyword, which));
    if (r.blocked) throw new Error('통합검색(' + which + ') 차단 화면(' + r.blocked + ')');
    if (r.error) throw new Error('통합검색(' + which + ') ' + r.error);
    if (!Array.isArray(r.ads)) throw new Error('통합검색(' + which + ') 파워링크를 못 읽음');
    const i = r.ads.findIndex(t => matchStoreHost(t, cfg.store));
    return { rank: i >= 0 ? i + 1 : null, total: r.ads.length, noSection: !!r.noSection, more: r.more || null, ads: r.ads };
}

// ───────── DB
async function readConfig(pool) {
    const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'keyword_rank'`);
    const v = r.rows[0] && r.rows[0].value && typeof r.rows[0].value === 'object' ? r.rows[0].value : {};
    const cfg = Object.assign({}, DEFAULT_CFG, v);
    cfg.store = Object.assign({}, DEFAULT_CFG.store, v.store || {});
    if (!Array.isArray(cfg.keywords) || !cfg.keywords.length) cfg.keywords = DEFAULT_CFG.keywords.slice();
    cfg.keywords = cfg.keywords.map(s => String(s || '').trim()).filter(Boolean).slice(0, 30);
    if (!Array.isArray(cfg.store.names) || !cfg.store.names.length) cfg.store.names = DEFAULT_CFG.store.names.slice();
    if (!Array.isArray(cfg.store.hosts)) cfg.store.hosts = DEFAULT_CFG.store.hosts.slice();
    // 설계서 기본 hosts(jejuakkome)에 실측 표시 주소(smartstore.naver.com/akkome)가 없으면 보탠다 — 파워링크 글의 표시 주소가 이 꼴(10/28 실측)
    for (const h of DEFAULT_CFG.store.hosts) if (!cfg.store.hosts.includes(h)) cfg.store.hosts.push(h);
    cfg.max_rank = Math.min(120, Math.max(1, Number(cfg.max_rank) || 40));
    if (!['mobile', 'pc', 'both'].includes(cfg.powerlink_source)) cfg.powerlink_source = 'mobile';
    return { cfg, fromDb: !!r.rows[0] };
}

async function hasSourceColumn(pool) {
    const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'keyword_rankings' AND column_name = 'source'`);
    return r.rows.length > 0;
}

async function saveRows(pool, date, rows, log) {
    const withSource = await hasSourceColumn(pool);
    if (!withSource) log('⚠ keyword_rankings.source 칸이 아직 없음(서버 배포 전) → source 없이 저장(created_by NULL 로 자동 줄 구분)');
    let inserted = 0, updated = 0, kept = 0;
    // 사람이 넣은 오늘 줄(source 'manual' · source 칸 없이 created_by 있는 줄)은 덮지 않는다 — 한 문장(ON CONFLICT … WHERE · 안 덮으면 RETURNING 0행 = kept)
    const sql = withSource
        ? `INSERT INTO keyword_rankings (date, keyword, shopping_rank, ad_rank, powerlink_rank, created_by, source)
           VALUES ($1, $2, $3, $4, $5, NULL, 'auto')
           ON CONFLICT (date, keyword) DO UPDATE SET shopping_rank = EXCLUDED.shopping_rank, ad_rank = EXCLUDED.ad_rank, powerlink_rank = EXCLUDED.powerlink_rank, source = 'auto', updated_at = NOW()
             WHERE keyword_rankings.source IS DISTINCT FROM 'manual' AND NOT (keyword_rankings.source IS NULL AND keyword_rankings.created_by IS NOT NULL)
           RETURNING (xmax = 0) AS inserted`
        : `INSERT INTO keyword_rankings (date, keyword, shopping_rank, ad_rank, powerlink_rank, created_by)
           VALUES ($1, $2, $3, $4, $5, NULL)
           ON CONFLICT (date, keyword) DO UPDATE SET shopping_rank = EXCLUDED.shopping_rank, ad_rank = EXCLUDED.ad_rank, powerlink_rank = EXCLUDED.powerlink_rank, updated_at = NOW()
             WHERE keyword_rankings.created_by IS NULL
           RETURNING (xmax = 0) AS inserted`;
    for (const r of rows) {
        const u = await pool.query(sql, [date, r.keyword, r.shopping, r.ad, r.powerlink]);
        if (!u.rows[0]) kept++; else if (u.rows[0].inserted) inserted++; else updated++;
    }
    return { inserted, updated, kept, withSource };
}

async function saveLast(pool, last) {
    // jsonb 합치기 — 서버가 적는 notified 류 칸은 남긴다
    await pool.query(
        `INSERT INTO agent_office_config (key, value) VALUES ('keyword_rank_last', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = COALESCE(agent_office_config.value, '{}'::jsonb) || EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(last)]);
}

async function audit(pool, changes) {
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('keyword_rank_auto', 'keyword_rankings', NULL, $1::jsonb, 'desk', '키워드 순위 자동 수집')`, [JSON.stringify(changes)]).catch(e => console.error('audit 실패(무시):', e.message));
}

// ───────── 표
function fmt(v) { return v == null ? '-' : String(v); }
function table(rows, withPc) {
    const head = ['키워드', '쇼핑', '광고', '파워링크' + (withPc ? '(모바일)' : '')].concat(withPc ? ['파워링크(PC)'] : []).concat(['본 상품', '쪽', '비고']);
    const lines = rows.map(r => [r.keyword, fmt(r.shopping), fmt(r.ad), fmt(r.powerlink)].concat(withPc ? [fmt(r.powerlink_pc)] : []).concat([r.seen || '', r.pages || '', r.error || (r.notes || []).join(' · ')]));
    const w = head.map((h, i) => Math.max(h.length, ...lines.map(l => String(l[i]).length)));
    const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
    return [head.map((h, i) => pad(h, w[i])).join(' | ')].concat(lines.map(l => l.map((c, i) => pad(c, w[i])).join(' | '))).join('\n');
}

// ───────── 본체
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const t0 = Date.now();
    const log = m => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);
    const { pool } = require('./_db');
    const { cfg, fromDb } = await readConfig(pool);
    if (args.keywords) cfg.keywords = args.keywords;
    const date = args.date || kstDate();
    const readPc = args.mobileOnly ? false : (args.pc === true || cfg.powerlink_source === 'pc' || cfg.powerlink_source === 'both');
    const readMobile = args.mobileOnly ? true : (cfg.powerlink_source !== 'pc');
    const storePl = cfg.powerlink_source === 'pc' ? 'pc' : 'mobile';
    log(`#910 키워드 순위 ${args.apply ? '--apply' : '--dry'} · 날짜 ${date} · 키워드 ${cfg.keywords.length}개 · 설정 ${fromDb ? 'DB' : '기본값'} · 스토어 ${cfg.store.names.join('/')} · max_rank ${cfg.max_rank} · 파워링크 ${cfg.powerlink_source}${readPc && readMobile ? '(모바일·PC 둘 다 읽음)' : ''}`);

    const aside = new Aside(ASIDE_EXE, log);
    const rows = [], errors = [];
    try {
        const s = await aside.start();
        log(`어사이드 MCP 연결 ${(s.server || {}).name || ''} ${(s.server || {}).version || ''} · 도구 ${s.tools.join(',')} · ${Date.now() - t0}ms`);
        for (let k = 0; k < cfg.keywords.length; k++) {
            const keyword = cfg.keywords[k];
            const tk = Date.now();
            const row = { keyword, shopping: null, ad: null, powerlink: null, notes: [] };
            if (readPc && readMobile) row.powerlink_pc = null;
            if (k > 0) await sleep(PAGE_WAIT_MS);
            try {
                const sh = await rankShopping(aside, keyword, cfg, log);
                row.shopping = sh.shopping; row.ad = sh.ad; row.seen = `${sh.organicSeen}+광고${sh.adsSeen}`; row.pages = sh.pages; row.notes.push(...sh.notes);
                if (args.verbose) { log(`  일반 ${sh.organic.map((o, i) => (i + 1) + '.' + o.mall).join(' ')}`); log(`  광고 ${sh.ads.map((o, i) => (i + 1) + '.' + o.mall).join(' ')}`); }
            } catch (e) { row.error = '쇼핑: ' + e.message; errors.push({ keyword, error: row.error }); log(`  ✗ ${keyword} ${row.error}`); }
            const plOut = {};
            for (const which of [readMobile ? 'mobile' : null, readPc ? 'pc' : null].filter(Boolean)) {
                await sleep(PAGE_WAIT_MS);
                try {
                    const pl = await rankPowerlink(aside, keyword, cfg, which);
                    plOut[which] = pl;
                    if (pl.noSection) row.notes.push(`파워링크(${which}) 묶음 없음`);
                    else row.notes.push(`파워링크(${which}) ${pl.total}개${pl.more ? '+더보기' : ''}`);
                    if (args.verbose) log(`  파워링크(${which}) ${pl.ads.map((a, i) => (i + 1) + '.' + a.slice(0, 28)).join(' | ')}`);
                } catch (e) { const msg = `파워링크(${which}): ` + e.message; row.error = row.error ? row.error + ' / ' + msg : msg; errors.push({ keyword, error: msg }); log(`  ✗ ${keyword} ${msg}`); }
            }
            if (plOut[storePl]) row.powerlink = plOut[storePl].rank;
            if (readPc && readMobile && plOut.pc) row.powerlink_pc = plOut.pc.rank;
            if (readPc && !readMobile && plOut.pc) row.powerlink = plOut.pc.rank;
            if (row.error) { row.shopping = null; row.ad = null; row.powerlink = null; }   // 읽기 실패 키워드 = 세 칸 전부 NULL(설계)
            rows.push(row);
            log(`  ${keyword}: 쇼핑 ${fmt(row.shopping)} · 광고 ${fmt(row.ad)} · 파워링크 ${fmt(row.powerlink)}${row.powerlink_pc !== undefined ? ' · PC ' + fmt(row.powerlink_pc) : ''} · ${Math.round((Date.now() - tk) / 1000)}초`);
        }
    } catch (e) {
        log('✗ 어사이드 연결·실행 실패: ' + e.message);
        for (const keyword of cfg.keywords) if (!rows.find(r => r.keyword === keyword)) { rows.push({ keyword, shopping: null, ad: null, powerlink: null, error: e.message }); errors.push({ keyword, error: e.message }); }
    } finally {
        await aside.stop().catch(() => { });
    }

    console.log('\n' + table(rows, readPc && readMobile));
    const ok = errors.length === 0 && rows.length > 0;
    // 읽기 실패 키워드는 DB 줄로 안 넣는다(errors 에만) — 전체 실패 날은 auto 줄 0 → 서버 10:00 「미수집」 알림이 살고 · 같은 날 재실행이 앞 회차 좋은 값을 NULL 로 안 덮음
    const last = { date, at: new Date().toISOString(), ok, rows: rows.filter(r => !r.error).map(r => ({ keyword: r.keyword, shopping: r.shopping, ad: r.ad, powerlink: r.powerlink })), errors, powerlink_source: storePl, took_ms: Date.now() - t0 };

    if (args.apply) {
        const sv = await saveRows(pool, date, last.rows, log);
        await saveLast(pool, last);
        await audit(pool, { date, inserted: sv.inserted, updated: sv.updated, kept_manual: sv.kept, errors: errors.length, with_source: sv.withSource, took_ms: last.took_ms });
        log(`저장: 새 줄 ${sv.inserted} · 덮음 ${sv.updated} · 사람 줄 유지 ${sv.kept} · keyword_rank_last 갱신 · ${errors.length ? '오류 ' + errors.length : '오류 0'}`);
    } else {
        log(`dry — DB 쓰기 0 (저장될 keyword_rank_last: ${JSON.stringify(last).slice(0, 400)}${JSON.stringify(last).length > 400 ? '…' : ''})`);
    }
    log(`끝 · ${Math.round((Date.now() - t0) / 1000)}초`);
    await pool.end().catch(() => { });
    process.exit(ok ? 0 : 2);
}

if (require.main === module) {
    main().catch(e => { console.error('실패:', e && e.stack || e); process.exit(1); });
}
module.exports = { Aside, rankShopping, rankPowerlink, matchStore, matchStoreHost, readConfig, DEFAULT_CFG };
