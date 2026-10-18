// #736 상세 미리보기 그림 — 창구 도구 공용(naver-detail.js plan --detail · draft · coupang-item.js --detail-from-naver)
//   renderOne(html, name, { width })            → JPEG 경로 하나(폭 width · 세로 통째)
//   renderCompare({ before, after, name, widths }) → [{ width, file }] — 폭마다 한 장에 「지금 | 새」 좌우(기본 PC 860 · 폰 390)
//   Playwright(창구 PC 에 있음) · 파일 = %LOCALAPPDATA%\akkome\detail-preview\ · JPEG 70(상세 통째 PNG 는 수십 MB) · 쓰기 = 이 파일뿐
//   그림 주소가 늦게 떠도 최대 60초 기다림(networkidle) · 실패하면 throw — 도구는 「미리보기 못 만듦」으로 카드만 보냄
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'detail-preview');
const BASE_CSS = 'body{margin:0;background:#fff;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#222}img{max-width:100%;height:auto;display:block;margin:0 auto}a{color:inherit}.db-html{padding:6px 12px}';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function shoot(doc, file, width) {
    const { chromium } = require('playwright');
    const b = await chromium.launch();
    try {
        const pg = await b.newPage({ viewport: { width, height: 1200 } });
        await pg.setContent(doc, { waitUntil: 'networkidle', timeout: 60000 });
        await pg.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70 });
    } finally { await b.close(); }
    return file;
}
async function renderOne(html, name, opt) {
    const width = (opt && opt.width) || 860;
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${name}-${width}.jpg`);
    return shoot(`<!doctype html><meta charset="utf-8"><style>${BASE_CSS}body{max-width:${width}px;margin:0 auto}</style><body>${html}`, file, width);
}
async function renderCompare(o) {
    const widths = (o && o.widths) || [860, 390], out = [];
    fs.mkdirSync(DIR, { recursive: true });
    for (const w of widths) {
        const col = (label, html) => `<section style="width:${w}px;flex:none;overflow:hidden;border:1px solid #ddd"><h2 style="margin:0;padding:8px 12px;font-size:16px;background:${label === '지금' ? '#F2F4F7' : '#EEF0FF'};color:${label === '지금' ? '#475467' : '#3730A3'}">${esc(label)} 상세${label === '새' ? ' (이렇게 바뀜)' : ''}</h2>${html || '<p style="padding:12px;color:#888">(비어 있음)</p>'}</section>`;
        const doc = `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style><body><div style="display:flex;gap:24px;align-items:flex-start;padding:12px;width:${w * 2 + 24}px">${o.before == null ? '' : col('지금', o.before)}${col('새', o.after)}</div>`;
        const file = path.join(DIR, `${o.name}-${w}.jpg`);
        await shoot(doc, file, (o.before == null ? w : w * 2 + 24) + 24);
        out.push({ width: w, file });
    }
    return out;
}
module.exports = { renderOne, renderCompare, DIR };
