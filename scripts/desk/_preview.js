// #736 상세 미리보기 그림 — 창구 도구 공용(naver-detail.js plan --detail · draft · coupang-item.js --detail-from-naver)
//   renderOne(html, name, { width })            → JPEG 경로 하나(폭 width · 세로 통째)
//   renderCompare({ before, after, name, widths }) → [{ width, file }] — 폭마다 한 장에 「지금 | 새」 좌우(기본 PC 860 · 폰 390)
//   Playwright(창구 PC 에 있음) · 파일 = %LOCALAPPDATA%\akkome\detail-preview\ · JPEG 70(상세 통째 PNG 는 수십 MB) · 쓰기 = 이 파일뿐
//   문서는 60초 안에 열려야 함(넘으면 throw) · 그 뒤 네트워크 조용해질 때까지 최대 20초 · 그림마다 최대 15초 · 네이버 CSS 8초 넘으면 예비 CSS(#769) — 도구는 「미리보기 못 만듦」으로 카드만 보냄
//   #769 네이버 상세(se-viewer)는 실화면이 쓰는 편집기 CSS 로 그림(_preview-se.js) · 열마다 iframe = 폰 390 열도 제 폭의 화면 규칙(미디어 쿼리)을 받음
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'detail-preview');
const BASE_CSS = 'body{margin:0;background:#fff;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#222}img:not(.se-viewer img){max-width:100%;height:auto;display:block;margin:0 auto}a{color:inherit}.db-html{padding:6px 12px}';
const SE = require('./_preview-se.js');   // #769 네이버 편집기 se- 서식 = 실화면이 쓰는 CDN CSS + 상점 겹 규칙(못 불러오면 예비 CSS)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => esc(s).replace(/"/g, '&quot;');
// 상세 한 장 문서(폭 width) — renderOne 과 renderCompare 의 열이 같은 꼴을 씀
const pageDoc = (html, width) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">${SE.isSe(html) ? SE.head(width) : ''}<style>${BASE_CSS}body{max-width:${width}px;margin:0 auto}</style><body>${SE.wrap(html, width)}`;
// 문서(와 그 안 iframe) 마다: 편집기 CSS 를 다 불러왔으면 예비 CSS 를 뺌(섞이면 간격 어긋남 · 못 불러왔으면 예비로 그림) · 그림 다 뜰 때까지(최대 15초)
async function settle(pg) {
    const docs = async () => [pg.mainFrame(), ...pg.frames().filter(f => f !== pg.mainFrame())];
    for (const f of await docs()) {
        await f.evaluate(() => {
            const ls = [...document.querySelectorAll('link[data-se]')];
            if (ls.length && ls.every(l => l.dataset.ok)) document.querySelectorAll('#se-fallback').forEach(e => e.remove());
            return Promise.all([...document.images].map(i => (i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 15000); }))));
        }).catch(() => { });
    }
    // iframe 높이 = 안 문서 높이(세로 통째 캡처)
    await pg.evaluate(() => document.querySelectorAll('iframe[data-pv]').forEach(fr => { const d = fr.contentDocument; if (d) fr.style.height = d.documentElement.scrollHeight + 'px'; }));
    await pg.waitForTimeout(300);
}
async function shoot(doc, file, width) {
    const { chromium } = require('playwright');
    const b = await chromium.launch();
    try {
        const pg = await b.newPage({ viewport: { width, height: 1200 } });
        // #769 네이버 편집기 CSS(pstatic · @import 포함)는 8초 상한 — 응답이 없으면 끊음 → link 에 data-ok 가 안 붙어 예비 CSS 로 그림
        await pg.route(/^https:\/\/(editor-static|ssl)\.pstatic\.net\/.*\.css(\?.*)?$/, async rt => {
            try { await rt.fulfill({ response: await rt.fetch({ timeout: 8000 }) }); } catch (e) { await rt.abort().catch(() => { }); }
        });
        await pg.setContent(doc, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pg.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });   // 그림이 늦어도 여기선 안 멈춤(settle 이 그림마다 15초)
        await settle(pg);
        await pg.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70 });
    } finally { await b.close(); }
    return file;
}
async function renderOne(html, name, opt) {
    const width = (opt && opt.width) || 860;
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${name}-${width}.jpg`);
    return shoot(pageDoc(html, width), file, width);
}
async function renderCompare(o) {
    const widths = (o && o.widths) || [860, 390], out = [];
    fs.mkdirSync(DIR, { recursive: true });
    for (const w of widths) {
        const col = (label, html) => `<section style="width:${w}px;flex:none;overflow:hidden;border:1px solid #ddd"><h2 style="margin:0;padding:8px 12px;font-size:16px;background:${label === '지금' ? '#F2F4F7' : '#EEF0FF'};color:${label === '지금' ? '#475467' : '#3730A3'}">${esc(label)} 상세${label === '새' ? ' (이렇게 바뀜)' : ''}</h2>${html ? `<iframe data-pv scrolling="no" style="display:block;width:${w}px;height:1200px;border:0" srcdoc="${attr(pageDoc(html, w))}"></iframe>` : '<p style="padding:12px;color:#888">(비어 있음)</p>'}</section>`;
        const doc = `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style><body><div style="display:flex;gap:24px;align-items:flex-start;padding:12px;width:${w * 2 + 24}px">${o.before == null ? '' : col('지금', o.before)}${col('새', o.after)}</div>`;
        const file = path.join(DIR, `${o.name}-${w}.jpg`);
        await shoot(doc, file, (o.before == null ? w : w * 2 + 24) + 24);
        out.push({ width: w, file });
    }
    return out;
}
module.exports = { renderOne, renderCompare, DIR, pageDoc, settle };
