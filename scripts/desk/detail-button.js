// #815 상세 바로가기 버튼 그림 — 창구 도구(#802 때 스크래치 btn802.js 를 리포로 옮김 · 틀 그대로)
//   대표 규칙(#802 · 2026-10-21): 상세에서 다른 곳으로 가는 링크(체험 예약·지도·블로그·다른 상품)는 글 링크가 아니라 「버튼 그림 링크」 — 손님이 눌러야 가는 걸 바로 알게
//     주 버튼(main) = 귤색 둥근 바탕 + 흰 굵은 글 + 3D 아꼼이 얼굴 · 보조 버튼(sub) = 흰 바탕 + 귤색 테두리·글(얼굴 없음 · 앞에 📍 같은 기호는 글에 넣음)
//   순서 = ① make(이 도구 · PNG 만 만듦) → ② `naver-detail.js upload <지시 id>` 로 네이버에 올려 주소 받기 → ③ 상세 HTML 에 `<a href="갈 곳"><img src="네이버 주소"></a>`(tag 로 뽑음) → plan/apply
//   node scripts/desk/detail-button.js make --text "<글>" [--sub "<작은 글>"] [--kind main|sub] [--name <파일 이름>] [--out <png 경로>]
//   node scripts/desk/detail-button.js make --spec <json>      json = [{ "name":"rsv", "text":"감귤체험 예약 바로가기", "sub":"…", "kind":"main", "out":"…png" }, …] 또는 { "out_dir":"…", "buttons":[…] }
//   node scripts/desk/detail-button.js tag --href <갈 곳 주소> --src <네이버에 올린 그림 주소>     상세에 넣을 그림 링크 컴포넌트(스마트에디터 se-image 꼴) 한 덩이를 출력
//   그림 = 860 폭 PNG(네이버 상세 본문 폭) · 기본 저장 = %LOCALAPPDATA%\akkome\detail-button\btn_<이름>.png · 글이 틀을 넘치면 🔴 표시(글을 줄여 다시)
//   쓰기 = PNG 파일뿐(실DB 0 · 네이버 0) · 그림은 Playwright(창구 PC 에 있음 · 저장소 node_modules --no-save)로 HTML 을 찍음 · 얼굴 재료 = ★에이전트오피스/브랜드/아꼼이_3D_얼굴_확대.png(저장소 안)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const FACE = path.join(ROOT, '★에이전트오피스', '브랜드', '아꼼이_3D_얼굴_확대.png');
const OUT_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'detail-button');
const W = 860;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => esc(s).replace(/"/g, '&quot;');

// 보조 버튼 = 흰 바탕 + 귤색 테두리·글(얼굴 없음) — #802 htmlSub 그대로
const htmlSub = (main) => `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="c" style="width:${W}px;padding:22px 40px 30px;box-sizing:border-box;background:#ffffff"><div style="height:120px;border-radius:70px;background:#fff;border:5px solid #ff7a00;box-shadow:0 8px 0 #f6c79a;display:flex;align-items:center;justify-content:center;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#ff7a00;box-sizing:border-box"><div style="font-size:${main.length > 15 ? 40 : 46}px;font-weight:900;letter-spacing:-1.5px;white-space:nowrap">${esc(main)} <span style="font-size:40px">›</span></div></div></div>`;
// 주 버튼 = 귤색 바탕 + 흰 글 + 3D 아꼼이 얼굴(+ 작은 글 한 줄) — #802 html 그대로
const htmlMain = (main, sub, face) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
<div id="c" style="width:${W}px;padding:22px 40px 30px;box-sizing:border-box;background:#ffffff">
 <div style="height:${sub ? 150 : 132}px;border-radius:80px;background:linear-gradient(180deg,#ff9a1f 0%,#ff7a00 100%);box-shadow:0 10px 0 #c95d00;display:flex;align-items:center;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#fff">
  <img src="${face}" style="width:${sub ? 118 : 104}px;height:${sub ? 118 : 104}px;border-radius:50%;object-fit:cover;margin-left:16px;background:#fff;border:4px solid rgba(255,255,255,.95);box-sizing:border-box;flex:none">
  <div style="flex:1;text-align:center;margin-right:24px">
   <div style="font-size:${main.length > 13 ? 44 : 50}px;font-weight:900;letter-spacing:-1.5px;line-height:1.1;white-space:nowrap">${esc(main)} <span style="font-size:44px">›</span></div>
   ${sub ? `<div style="font-size:26px;font-weight:700;opacity:.95;margin-top:8px">${esc(sub)}</div>` : ''}
  </div>
 </div>
</div>`;

// 상세에 넣을 그림 링크 컴포넌트(#802 b802.js imgComp 와 같은 꼴 · 네이버가 그대로 받음 · target 안 넣음 #726)
let _seq = 0;
const seId = () => `SE-815i${String(++_seq).padStart(4, '0')}-0000-4000-8000-000000000815`;
const imgLinkComponent = (src, href) => `<div class="se-component se-image se-l-default" id="${seId()}">
    <div class="se-component-content se-component-content-extend">
        <div class="se-section se-section-image se-l-default se-section-align-center">
            <div class="se-module se-module-image" style="">
                <a href="${attr(href)}" rel="noopener" class="se-module-image-link-use se-module-image-link __se_image_link __se_link">
                    <img src="${attr(src)}" alt="" class="se-image-resource" />
                </a>
            </div>
        </div>
    </div>
</div>
`;

function parseArgs(argv) {
    const o = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v == null || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; } }
        else o._.push(a);
    }
    return o;
}
const safeName = s => String(s || '').normalize('NFC').replace(/[^가-힣A-Za-z0-9()\-_.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'btn';   // 파일 이름 = 한글·영문·숫자만(이모지·공백 → _)

// 만들 버튼 목록 → [{ name, text, sub, kind, out }]
function buildList(o) {
    const list = [];
    if (o.spec) {
        const j = JSON.parse(fs.readFileSync(String(o.spec), 'utf8'));
        const arr = Array.isArray(j) ? j : (j.buttons || []);
        const dir = (!Array.isArray(j) && j.out_dir) ? String(j.out_dir) : null;
        arr.forEach((b, i) => list.push({ name: b.name || `btn${i + 1}`, text: b.text, sub: b.sub || null, kind: b.kind || 'main', out: b.out || (dir ? path.join(dir, `btn_${safeName(b.name || 'btn' + (i + 1))}.png`) : null) }));
    } else if (o.text) {
        list.push({ name: o.name || null, text: String(o.text), sub: o.sub ? String(o.sub) : null, kind: o.kind || 'main', out: o.out ? String(o.out) : null });
    }
    for (const b of list) {
        if (!b.text || !String(b.text).trim()) throw new Error('버튼 글(--text)이 비었어요');
        b.text = String(b.text).normalize('NFC').trim();
        if (!['main', 'sub'].includes(b.kind)) throw new Error(`kind 는 main 또는 sub (${b.name || b.text}: ${b.kind})`);
        if (b.kind === 'sub' && b.sub) throw new Error('보조 버튼(sub)에는 작은 글(--sub)이 없어요 — 주 버튼(main)으로');
        if (!b.name) b.name = (b.kind === 'sub' ? 'sub_' : '') + safeName(b.text);
        if (!b.out) b.out = path.join(OUT_DIR, `btn_${safeName(b.name)}.png`);
    }
    if (!list.length) throw new Error('무엇을 만들지 없어요 — --text "<글>" 또는 --spec <json>');
    return list;
}

async function make(list) {
    if (!fs.existsSync(FACE)) throw new Error('3D 아꼼이 얼굴 그림이 없어요: ' + FACE + ' (git pull 로 ★에이전트오피스/브랜드/ 받기)');
    let pw; try { pw = require(path.join(ROOT, 'node_modules', 'playwright')); } catch (_) { throw new Error('이 PC 에 Playwright 가 없어 버튼 그림을 못 만들어요(npm install --no-save playwright · 총괄에게)'); }
    const face = 'data:image/png;base64,' + fs.readFileSync(FACE).toString('base64');
    const br = await pw.chromium.launch();
    const made = [];
    try {
        for (const b of list) {
            fs.mkdirSync(path.dirname(b.out), { recursive: true });
            const pg = await br.newPage({ viewport: { width: W, height: 300 } });
            try {
                await pg.setContent(b.kind === 'sub' ? htmlSub(b.text) : htmlMain(b.text, b.sub, face), { waitUntil: 'load' });
                const over = await pg.evaluate(() => { const d = document.querySelector('#c > div'); return d.scrollWidth > d.clientWidth + 1; });
                await (await pg.$('#c')).screenshot({ path: b.out });
                const buf = fs.readFileSync(b.out);
                made.push({ name: b.name, kind: b.kind, text: b.text, sub: b.sub || undefined, file: b.out, kb: Math.round(buf.length / 1024), size: `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, overflow: over || undefined, warn: over ? '🔴 글이 버튼을 넘침 — 글을 줄여(또는 두 줄 = --sub) 다시' : undefined });
            } finally { await pg.close().catch(() => { }); }
        }
    } finally { await br.close().catch(() => { }); }
    return made;
}

async function main(argv) {
    const o = parseArgs(argv), cmd = o._[0];
    const out = (x) => { console.log(JSON.stringify(x, null, 1)); return x; };
    if (cmd === 'make') {
        const made = await make(buildList(o));
        return out({ ok: true, buttons: made, next: '① naver-detail.js upload <지시 id>(이 PNG 를 지시에 붙여) → 네이버 주소 ② detail-button.js tag --href <갈 곳> --src <그 주소> → 상세 HTML 의 글 링크 자리에 ③ plan → 되묻기 → apply. 버튼 그림은 가운데 정렬 · 글 링크 줄은 뺀다(#802)' });
    }
    if (cmd === 'tag') {
        if (!o.href || !o.src || !/^https?:\/\//.test(String(o.href)) || !/^https?:\/\//.test(String(o.src))) throw new Error('tag --href <갈 곳 https 주소> --src <네이버에 올린 그림 https 주소>');
        if (!/^https:\/\/shop-phinf\.pstatic\.net\//.test(String(o.src))) console.error('ℹ --src 가 네이버 그림 주소(shop-phinf.pstatic.net)가 아니에요 — 네이버 상세엔 upload 로 올린 주소만 들어가요');
        const html = imgLinkComponent(String(o.src), String(o.href));
        return out({ ok: true, href: o.href, src: o.src, html, note: '이 덩이를 상세 HTML 의 글 링크 단락 자리에(se-component 사이) 넣고 글 링크 줄은 뺀다 · target 은 안 넣음(#726)' });
    }
    throw new Error('사용: detail-button.js make --text "<글>" [--sub "<작은 글>"] [--kind main|sub] [--name <이름>] [--out <png>] | make --spec <json> | tag --href <주소> --src <그림 주소>');
}

module.exports = { main, make, buildList, htmlMain, htmlSub, imgLinkComponent, FACE, OUT_DIR };
if (require.main === module) {
    main(process.argv.slice(2)).catch(e => { console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)); process.exitCode = 1; });
}
