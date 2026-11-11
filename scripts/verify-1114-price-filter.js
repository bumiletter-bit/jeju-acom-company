// #1114 검증 — 가격표 품목 고르기(회사 server.js qnaFilterStoreLines · 톡톡봇 ai-handler.js filterStoreLines) 옛(HEAD)/새 판 비교
//   실행: node scripts/verify-1114-price-filter.js [--real]   (기본 = DB·서버·AI 0 · --real = 실DB 30일 상품문의·고객문의·톡톡 손님 글 SELECT 만 해 옛/새 결과가 바뀐 것만 목록)
//   두 함수 구간을 소스에서 떼어 같은 판매현황 줄(11/11 실제 판매중 이름·값)로 돌린다
'use strict';
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), BOT = path.join(ROOT, '..', '★제주아꼼이네 톡톡봇');
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d != null && !c ? ' — ' + String(d).slice(0, 600) : '')); };
const norm = s => s.replace(/\r\n/g, '\n');
function grab(src, startMark, fnName, ret) {   // startMark ~ fnName 함수 끝까지 떼어 ret 을 돌려받음
    const s = norm(src); const a = s.indexOf(startMark); const f = s.indexOf('function ' + fnName + '(', a); const b = s.indexOf('\n}\n', f) + 2;
    if (a < 0 || f < 0) throw new Error('구간 없음: ' + fnName);
    return new Function(s.slice(a, b) + '\nreturn ' + ret + ';')();
}
const gitShow = (cwd, file) => execSync('git show ' + ((cwd === ROOT ? process.env.BASE_SV : process.env.BASE_BOT) || 'HEAD') + ':' + file, { cwd, maxBuffer: 64 << 20 }).toString('utf8');   // 옛 판 = HEAD(기본) · 커밋 뒤 대조는 BASE_SV·BASE_BOT 에 그 앞 커밋
const SV_OLD = grab(gitShow(ROOT, 'server.js'), 'const QNA_FILTER_STOPWORDS', 'qnaFilterStoreLines', 'qnaFilterStoreLines');
const SV_NEW = grab(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), 'const QNA_FILTER_STOPWORDS', 'qnaFilterStoreLines', 'qnaFilterStoreLines');
const BOT_OLD = grab(gitShow(BOT, 'ai-handler.js'), 'const FILTER_STOPWORDS', 'filterStoreLines', 'filterStoreLines');
const BOT_NEW = grab(fs.readFileSync(path.join(BOT, 'ai-handler.js'), 'utf8'), 'const FILTER_STOPWORDS', 'filterStoreLines', 'filterStoreLines');
const FALL = '판매 여부·가격은 스토어에서 실시간 확인 가능하세요!';

// 11/11 판매현황 판매중(가격 있는 것) — 그룹마다 빈 줄(qnaStoreData 꼴 「🍊 이름 — 값」)
const G = [
    ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', '22,800원'], ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', '31,800원'], ['고당도 타이벡감귤 / 상품 및 과수: 선물용 - 3kg(로얄과 2S~M)', '28,800원'], ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 3kg(소과 2S미만)', '19,800원'], ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(중대과 L이상)', '26,800원'], ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 10kg(로얄과 2S~M)', '54,800원'], null,
    ['과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 가정용 - 5kg(혼합과)', '30,100원'], ['과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 가정용 - 10kg(혼합과)', '57,800원'], ['과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 못난이 - 5kg(혼합과)', '27,800원'], ['과즙팡팡 황금향 / 상품 및 과수: 하우스 황금향 선물용 - 3kg(중대과 7~15과)', '35,800원'], null,
    ['새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', '16,800원'], ['새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', '21,800원'], ['새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 10kg(로얄과 2S~M)', '29,800원'], ['새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 10kg(소과 2S미만)', '27,800원'], ['새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 10kg(중대과 L이상)', '25,800원'], null,
    ['그린레몬 / 상품 및 과수: 중소과 - 5kg', '50,000원']];
const PRICE = G.map(x => x ? `🍊 ${x[0]} — ${x[1]}` : '').join('\n');
const SELL = G.filter(Boolean).map(x => `- ${x[0]}: 판매중 (${x[1]})`).join('\n');
const PN = ' 제주 노지 감귤 타이벡 하우스';   // 상품 페이지 이름(kg 숫자는 호출부가 뺌)

(async () => {
    for (const [nm, OLD, NEW] of [['회사 서버', SV_OLD, SV_NEW], ['톡톡봇', BOT_OLD, BOT_NEW]]) {
        console.log(`\n■ ${nm}`);
        const q1 = '작년 제주도 여행때 타이백 감귤을 먹고 맛있어서. 알아보다가 주문전 문의 남깁니다.\n저는 새콤달콤 보다는 달콤한게 좋아서 타이백 주문하려하는데요.\n10kg해도 될지.... 달면 좋은데 혹시라도 하는 맘에 여쭤봅니다~^^;;';
        { const o = OLD(PRICE, q1 + PN), n = NEW(PRICE, q1 + PN);
          ok(!/타이벡/.test(o) && /노지감귤.*10kg/.test(o), '① 옛 판 = 노지 10kg 만(대표 실례 재현)', o);
          ok(/고당도 타이벡감귤 \/ 상품 및 과수: 가정용 - 10kg\(로얄과 2S~M\) — 54,800원/.test(n) && n.split('\n').every(l => /10kg/.test(l)), '① 새 판 = 타이벡 10kg 54,800 줄이 남음(10kg 줄만)', n); }
        { const q = '새콤달콤 노지감귤 얼마예요?'; const o = OLD(PRICE, q), n = NEW(PRICE, q); ok(o === n && /노지감귤/.test(n) && !/타이벡/.test(n), '② 「새콤달콤 노지감귤 얼마」 = 노지 줄 그대로(옛과 같음)', n); }
        { const q = '황금향 못난이 5kg 얼마예요?'; const o = OLD(PRICE, q), n = NEW(PRICE, q); ok(o === n && /못난이 - 5kg/.test(n) && n.split('\n').length === 1, '③ 「황금향 못난이 5kg」(#495) = 그대로 1줄', n); }
        { const q = '타이백 5kg 얼마예요?'; const n = NEW(PRICE, q); ok(/타이벡감귤/.test(n) && n.split('\n').every(l => /타이벡/.test(l) && /5kg/.test(l)), '④ 「타이백」 표기 = 타이벡 줄', n); }
        { const qs = ['가격 알려주세요', '귤 얼마예요?', '선물용 있나요', '10kg 얼마에요', '배송비 얼마예요', '상품을 문의합니다', '고당도 귤 있어요?', '귤 3kg 선물용 얼마'];
          for (const q of qs) ok(OLD(PRICE, q) === NEW(PRICE, q) && OLD(SELL, q) === NEW(SELL, q), '⑤ 품목 낱말 없는 글 = 옛과 바이트 같음: ' + q); }
        { const q = '레드키위 아직 파나요?'; const o = OLD(PRICE, q), n = NEW(PRICE, q); ok(o.split('\n').length > 5 && n === '', 'f) 판매 안 하는 품목(레드키위) = 옛 전체 목록 → 새 빈 글(자리 비움)', n); }
        { const q = '하우스귤 얼마예요?'; const n = NEW(PRICE, q); ok(n !== FALL && n.split('\n').filter(Boolean).every(l => /타이벡감귤/.test(l)), 'e) 「하우스귤」 = 타이벡 줄', n); }
        { const q = '하우스감귤 5kg 가정용 얼마'; const n = NEW(PRICE, q); ok(/타이벡감귤 \/ 상품 및 과수: 가정용 - 5kg/.test(n) && n.split('\n').every(l => /타이벡/.test(l)), 'e) 「하우스감귤 5kg 가정용」 = 타이벡 5kg 가정용', n); }
        { const q = '하우스 황금향 선물용 얼마예요'; const o = OLD(PRICE, q), n = NEW(PRICE, q); ok(o === n && /하우스 황금향 선물용/.test(n), 'e) 「하우스 황금향」 = 안 건드림(옛과 같음)', n); }
        { const q = '고당도 타이벡 말고 새콤달콤한 노지 5kg'; const n = NEW(PRICE, q); ok(/노지감귤.*5kg/.test(n) && /타이벡감귤.*5kg/.test(n), '두 품목 말한 글 = 두 품목 5kg 줄(합집합 유지)', n); }
        { const q = '레몬 5kg 얼마'; ok(OLD(PRICE, q) === NEW(PRICE, q), '레몬 5kg = 그대로'); }
        // #1114-g(30일 실자료 대조에서 나온 회귀): 판매 중 품목인데 줄 낱말이 안 겹쳐 0줄 → 비우지 않고 종전대로
        for (const q of ['타이벡은 지금도 당도가 좋은가요?', '타이벡이면 5키로 주문하려고 했는대 선물용이랑 다른가보내요???ㅠ', '청레몬 맞나요?', '오 주문할께요~~~!! 레몬도 좋았는데!!'])
            ok(NEW(PRICE, q) !== '' && NEW(PRICE, q) === OLD(PRICE, q), 'g) 판매 중 품목(줄 낱말 안 겹침) = 종전대로(빈 글 아님): ' + q, NEW(PRICE, q).slice(0, 80));
        { const q = '레드키위 언제쯤 다시 판매하시나요??'; ok(NEW(PRICE, q) === '', 'g) 판매 줄에 없는 품목(레드키위) = 빈 글 그대로'); }
        { const n = NEW(SELL, q1 + PN); ok(/타이벡감귤.*10kg/.test(n), '{{판매현황}} 꼴(「- 이름: 판매중」)도 같은 고침', n); }
        { const n = NEW('🍊 새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M) — 21,800원\n🍊 그린레몬 / 상품 및 과수: 중소과 - 5kg — 50,000원', '타이벡 5kg 있나요'); ok(n === FALL, 'd) 글에 나온 품목(타이벡) 줄이 결과에 0 = 가격표 대신 재료 한 줄', n); }
    }
    console.log('\n■ 두 함수 결과가 같은지(같은 고침)');
    // 옛 판끼리 이미 다른 글(「노지」 → 노지감귤 #972 는 회사 쪽에만 있음)은 견주지 않음 = 이번 고침이 둘을 새로 갈라놓지 않았는지만
    for (const q of ['타이백 10kg 새콤달콤 보다는 달콤', '새콤달콤 노지감귤 얼마', '황금향 못난이 5kg', '귤 얼마', '타이벡 선물용 3kg', '고당도 타이벡 10kg']) {
        const same0 = SV_OLD(PRICE, q) === BOT_OLD(PRICE, q);
        ok(!same0 || SV_NEW(PRICE, q) === BOT_NEW(PRICE, q), '회사·톡톡봇 ' + (same0 ? '같음' : '(옛 판부터 다름 · 건너뜀)') + ': ' + q, SV_NEW(PRICE, q) + ' ≠ ' + BOT_NEW(PRICE, q));
    }
    { const q = '작년 타이백 감귤 새콤달콤 보다는 달콤한게 좋아서 10kg' + PN; ok(SV_NEW(PRICE, q) === BOT_NEW(PRICE, q) || (/타이벡.*10kg/.test(SV_NEW(PRICE, q)) && /타이벡.*10kg/.test(BOT_NEW(PRICE, q))), '이번 사례 = 두 쪽 다 타이벡 10kg 줄 남음'); }

    if (process.argv.includes('--real')) {
        console.log('\n■ 실DB 30일(SELECT 만)');
        require('dotenv').config({ path: path.join(ROOT, '.env') });
        const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
        const rows = [].concat(
            (await pool.query(`SELECT 'qna' ch, question_id::text id, concat_ws(' ', raw->>'question', regexp_replace(COALESCE(raw->>'product_name',''), '[0-9.]+\\s*kg', ' ', 'gi')) q FROM naver_qnas WHERE collected_at > now() - interval '30 days'`)).rows,
            (await pool.query(`SELECT 'inq' ch, inquiry_id::text id, concat_ws(' ', raw->>'title', raw->>'content', regexp_replace(COALESCE(raw->>'product_name',''), '[0-9.]+\\s*kg', ' ', 'gi')) q FROM naver_inquiries WHERE collected_at > now() - interval '30 days'`)).rows,
            (await pool.query(`SELECT 'talk' ch, id::text id, message q FROM message_logs WHERE received_at > now() - interval '30 days' AND message NOT LIKE '[%'`)).rows);
        await pool.end();
        const diff = [];
        for (const r of rows) {
            const f = r.ch === 'talk' ? [BOT_OLD, BOT_NEW] : [SV_OLD, SV_NEW];
            const o = f[0](PRICE, r.q || ''), n = f[1](PRICE, r.q || '');
            if (o !== n) diff.push(`${r.ch} ${r.id} | ${String(r.q).replace(/\s+/g, ' ').slice(0, 70)}\n      옛 ${o.split('\n').filter(Boolean).length}줄 ${o.split('\n')[0].slice(2, 34)} → 새 ${n === FALL ? '(대신 줄)' : n.split('\n').filter(Boolean).length + '줄 ' + n.split('\n')[0].slice(2, 34)}`);
        }
        console.log(`  글 ${rows.length} · 결과가 바뀐 글 ${diff.length}`);
        diff.forEach(s => console.log('   ' + s));
    }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
