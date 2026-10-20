// #769 미리보기용 네이버 스마트에디터(se-) 서식
//   정본 = 실제 상품 화면이 쓰는 편집기 CSS 를 그대로 건다(NAVER_CSS · 공개 CDN · 10/20 brand.naver.com 실화면에서 읽은 주소)
//        + 상점 화면 겹 규칙(STORE_CSS · 부품 간격 30 · 그림끼리 0 · PC 내용 폭 848 · 같은 날 실화면 CSS 에서 옮김)
//   예비 = SE_CSS(우리 상세에 실제로 쓰인 class 만 · 10/20 감귤·레몬·체험 집계) — CDN CSS 를 못 불러왔을 때만 남김(_preview.js shoot 이 지움)
//   🔵 네이버가 편집기 판 번호(1.73.1)를 바꿔도 옛 주소는 남아 있음 · 화면이 달라 보이면 실화면에서 주소를 다시 읽어 바꿀 것
//   쿠팡 미리보기(detail-blocks toPreviewHtml)는 se-viewer 가 없어 감싸지 않음 · 글꼴(se-ff-)은 맞추지 않음
const SE_CSS = `
.se-viewer{font-size:15px;line-height:1.6;color:#000;word-break:break-all;overflow-wrap:break-word}
.se-viewer *{box-sizing:border-box}
.se-main-container{width:100%}
.se-component{position:relative;margin:0}
.se-component + .se-component{margin-top:var(--se-gap,0px)}
.se-section{position:relative;margin:0 auto}
.se-section-align-center{text-align:center}
.se-section-align-left{text-align:left}
.se-section-align-right{text-align:right}
.se-section-align-justify{text-align:justify}
.se-module{position:relative}
.se-text-paragraph{margin:0;min-height:1.6em;white-space:pre-wrap}
.se-text-paragraph-align-center{text-align:center}
.se-text-paragraph-align-left{text-align:left}
.se-text-paragraph-align-right{text-align:right}
.se-text-paragraph-align-justify{text-align:justify}
.se-module-text{padding:var(--se-text-pad,0px) 0}
.se-section-text,.se-section-sectionTitle,.se-section-quotation,.se-section-material{padding:0 var(--se-side,0px)}
.se-section-image .se-module-image,.se-section-imageStrip .se-module-image{display:block;font-size:0;line-height:0}
.se-viewer img{max-width:100%;height:auto;display:inline-block;margin:0;vertical-align:top}
.se-image-resource{width:auto;max-width:100%}
.se-component-content-extend .se-image-resource{width:100%}
.se-imageStrip-container{display:flex;flex-wrap:nowrap;align-items:flex-start;gap:var(--se-strip-gap,0px)}
.se-imageStrip-container .se-module-image{flex:0 1 auto;min-width:0}
.se-imageStrip-container .se-image-resource{width:100%}
.se-caption{margin:0;padding:var(--se-cap-pad,8px) var(--se-side,0px) 0;font-size:13px;line-height:1.6;color:#666}
.se-caption .se-text-paragraph{min-height:0}
.se-section-horizontalLine{padding:var(--se-hr-pad,20px) 0}
.se-hr{margin:0 auto;border:0;height:0;border-top:1px solid #bbb;width:100%}
.se-l-line1 .se-hr{width:100px;border-top:2px solid #000}
.se-l-line2 .se-hr{width:100%;border-top:1px solid #000}
.se-l-line3 .se-hr{width:100%;border-top:1px dashed #999}
.se-l-line4 .se-hr{width:100%;border-top:3px double #999}
.se-l-line5 .se-hr{width:100%;border-top:1px dotted #999}
.se-quotation-container{margin:0 auto;padding:12px 16px}
.se-l-quotation_line .se-quotation-container{border-left:3px solid #000;text-align:left}
.se-quote{font-size:17px;line-height:1.6}
.se-module-oglink{display:flex;align-items:stretch;max-width:100%;margin:0 auto;border:1px solid rgba(0,0,0,.15);text-align:left;background:#fff}
.se-section-align-center .se-module-oglink{display:inline-flex}
.se-oglink-thumbnail{flex:none;width:120px;height:120px;overflow:hidden}
.se-oglink-thumbnail-resource{width:120px;height:120px;object-fit:cover}
.se-oglink-info{flex:1;min-width:0;padding:16px 18px;text-decoration:none;color:#000}
.se-oglink-title{display:block;font-size:16px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.se-oglink-summary{margin:6px 0 0;font-size:13px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.se-oglink-url{margin:6px 0 0;font-size:12px;color:#03c75a}
.se-module-material{display:inline-flex;border:1px solid rgba(0,0,0,.15);text-align:left;max-width:100%}
.se-material-poster{flex:none;width:120px}
.se-material-poster-resource{width:120px;height:auto}
.se-material-text,.se-material-shopping{padding:12px 16px}
.se-material-title{font-weight:700}
.se-sectionTitle{font-size:22px;font-weight:700}
`;
// 글자 크기 se-fs-fsN → N px(8~72 · -unset·빈 값은 기본 15px)
const FS_CSS = Array.from({ length: 65 }, (_, i) => `.se-fs-fs${i + 8}{font-size:${i + 8}px}`).join('');
// 폭별 숫자(실측) — PC 860 · 폰 390
const SE_VARS = {
    pc: '--se-gap:0px;--se-text-pad:0px;--se-side:0px;--se-strip-gap:0px;--se-cap-pad:8px;--se-hr-pad:20px',
    mobile: '--se-gap:0px;--se-text-pad:0px;--se-side:0px;--se-strip-gap:0px;--se-cap-pad:8px;--se-hr-pad:20px',
};
const seVars = width => `.se-viewer{${width <= 600 ? SE_VARS.mobile : SE_VARS.pc}}`;
const NAVER_CSS = {
    pc: ['https://editor-static.pstatic.net/v/basic/1.73.1/css/se.viewer.desktop.css', 'https://ssl.pstatic.net/storefarm.editor/static/viewer/common/se_viewer_storefarm_pc.css'],
    mobile: ['https://editor-static.pstatic.net/v/basic/1.73.1/css/se.viewer.css', 'https://ssl.pstatic.net/storefarm.editor/static/viewer/common/se_viewer_storefarm_mobile.css'],
};
// 상점 화면 틀(10/20 brand.naver.com 판매 중 상품 실측 · 감귤·레몬·VIP·황금향 같음)
//   PC  = 상세가 상점 틀(se_smartstore_wrap) 밖 · 내용 폭 848 · 글 12px · 부품 간격은 편집기 CSS 기본값 그대로(그림 뒤 글 20 · 그림끼리 5 · 구분선 30 …)
//   폰  = 상점 틀 안 · 좌우 16px 틀 + 편집기 -15px = 내용 388(가운데 1px) · 글 17px · 그림끼리 0 · 맨 위 25
//   🔵 품절 상품 등 옛 틀(PC 도 se_smartstore_wrap · 부품 간격 30)로 그려지는 화면이 가끔 있음(10/20 체험 7673020911 첫 실측) — 미리보기는 판매 중 틀 기준
const W = 'body:not(.center) .pv-store .se_smartstore_wrap .se-viewer';   // 실화면 규칙과 같은 무게로 써야 편집기 CSS 를 이긴다
const STORE_CSS = {
    pc: `.pv-store{max-width:848px;margin:0 auto;font-size:12px}.pv-store .se-viewer .se-image-tag-area::before{display:none}`,
    mobile: `.pv-frame{padding:0 16px;font-size:17px}.se_smartstore_wrap{font-size:14px}${W}{margin:25px -15px 0}${W} .se-image+.se-image,${W} .se-image+.se-imageStrip,${W} .se-imageStrip+.se-image,${W} .se-imageStrip+.se-imageStrip{margin-top:0}${W} .se-image-tag-area::before{display:none}`,
};
const kindOf = width => (width <= 600 ? 'mobile' : 'pc');
// 네이버 상세 HTML(se-viewer 가 든 것)만 감싼다 — 그 밖(쿠팡 blocks 미리보기 등)은 그대로
const isSe = html => /class="(?:[^"]*\s)?se-viewer(?:\s[^"]*)?"/.test(String(html || ''));
const wrap = (html, width) => (!isSe(html) ? html : kindOf(width || 860) === 'pc'
    ? `<div class="pv-store">${html}</div>`
    : `<div class="pv-store"><div class="se_smartstore_wrap"><div class="pv-frame">${html}</div></div></div>`);
// <head> 에 넣을 것 — CDN 링크(불러오면 data-ok) + 상점 겹 + 예비 CSS(id se-fallback)
const head = width => { const k = kindOf(width); return NAVER_CSS[k].map(u => `<link rel="stylesheet" data-se href="${u}" onload="this.dataset.ok=1">`).join('') + `<style id="se-fallback">${SE_CSS + FS_CSS + seVars(width)}</style><style>${STORE_CSS[k]}</style>`; };
module.exports = { SE_CSS: SE_CSS + FS_CSS, SE_VARS, seVars, NAVER_CSS, STORE_CSS, head, wrap, isSe, kindOf };
