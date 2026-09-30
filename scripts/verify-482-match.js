// #482 검증: 알림톡·발송안내 품목 연결 — 네이버 실제 옵션 전체(최신 스냅샷)로 구(git HEAD)·신 결과 대조 + 하우스감귤 6종 기대값
//   node scripts/verify-482-match.js   (DB 읽기만)
require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..');
const oldSrc = execSync('git show HEAD:kakao-notify.js', { cwd: ROOT, encoding: 'utf8' });
const oldFile = path.join(os.tmpdir(), 'kn-old-482.js'); fs.writeFileSync(oldFile, oldSrc.replace(/require\('\.\//g, `require('${ROOT.replace(/\\/g, '/')}/`));
const OLD = require(oldFile), NEW = require(path.join(ROOT, 'kakao-notify.js'));
const results = [];
const ok = (n, p, note) => { results.push(p); console.log((p ? '✅' : '❌') + ' ' + n + (note ? ' — ' + note : '')); };
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const bp = (await pool.query(`SELECT id, name, status FROM bot_products WHERE deleted_at IS NULL`)).rows;
    const snap = (await pool.query(`SELECT id, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`)).rows[0];
    await pool.end();
    const cases = [];
    for (const it of snap.items || []) for (const o of it.opts || []) {
        const opt = o.n2 ? `아꼼이네 상품선택: ${o.n1} / 상품 및 과수: ${o.n2}` : `상품선택: ${o.n1}`;
        cases.push({ product: it.name, sell: it.statusType, text: `${it.name || ''} ${opt}`, label: (o.n2 || o.n1) });
    }
    let same = 0, changed = [], newly = [];
    for (const c of cases) {
        const a = OLD.matchNotifyProduct(c.text, bp), b = NEW.matchNotifyProduct(c.text, bp);
        if (a && (!b || a.id !== b.id)) changed.push(c.label + ' : ' + a.name + ' → ' + (b ? b.name : '없음'));
        else if (!a && b) newly.push({ label: c.label, sell: c.sell, to: b.name });
        else same++;
    }
    ok(`구 규칙으로 연결되던 옵션은 결과 그대로(${cases.length}개 옵션 중 변화 0)`, changed.length === 0, changed.slice(0, 5).join(' | '));
    console.log('\n새로 연결되는 옵션:'); newly.forEach(n => console.log('   ' + n.sell + ' · ' + n.label + '  →  ' + n.to));
    // 하우스감귤 기대값: 옵션의 무게·과 크기·용도가 판매현황 이름과 같아야 한다
    const key = s => { const m = String(s).match(/(가정용|선물용)\s*-\s*([\d.]+kg)\(([^)]+)\)/); return m ? m.slice(1).join('|') : null; };
    const house = newly.filter(n => /하우스/.test(n.label));
    const bad = house.filter(n => key(n.label) !== key(n.to));
    ok(`하우스감귤 옵션 연결 = 용도·무게·과 크기가 모두 같은 품목(${house.length}개)`, house.length >= 6 && bad.length === 0, bad.map(b => b.label + '→' + b.to).join(' | '));
    const other = newly.filter(n => !/하우스/.test(n.label));
    ok('하우스감귤 외에 새로 연결되는 옵션은 위 목록으로 사람이 확인', true, other.length + '개');
    // 실제 발송 기록 모양(상품명 + 옵션)
    const sample = '제주 노지 감귤 타이벡 하우스 아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: (특가)하우스감귤 가정용 - 4.5kg(소과)';
    const m = NEW.matchNotifyProduct(sample, bp);
    ok('특가 옵션 「(특가)하우스감귤 가정용 - 4.5kg(소과)」 → 가정용 4.5kg(소과)', m && /가정용 - 4\.5kg\(소과\)/.test(m.name), m && m.name);
    const neg = NEW.matchNotifyProduct('제주 노지 감귤 타이벡 하우스 아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 7kg(소과)', bp);
    ok('판매현황에 없는 무게(7kg)는 연결 안 함(오매칭보다 미매칭)', !neg, neg && neg.name);
    // 하우스귤·유라조생 동시 판매 대비(대표 9/30): 유라조생 옵션 여러 꼴이 하우스감귤 품목에 붙지 않아야 한다
    const PAGE = '제주 노지 감귤 타이벡 하우스 아꼼이네 상품선택: ';
    const yura = [
        PAGE + '2. (제철)유라조생 노지감귤 / 상품 및 과수: 유라조생 가정용 - 2.5kg(로얄과)',
        PAGE + '2. (제철)고당도 유라조생 / 상품 및 과수: 가정용 - 4.5kg(소과)',
        PAGE + '1. (제철)고당도 하우스감귤 / 상품 및 과수: 유라조생 가정용 - 2.5kg(소과)',
        '제주 유라조생 극조생 노지감귤 상품선택: 유라조생 가정용 - 5kg(중소과)',
        '제주 유라조생 노지감귤 상품 및 과수: 가정용 - 4.5kg(중소과)',
    ];
    const hit = yura.map(t => [t.split(': ').slice(-1)[0], NEW.matchNotifyProduct(t, bp)]).filter(([, m]) => m && /하우스감귤/.test(m.name));
    const hitNote = hit.map(([t, m]) => t + '→' + m.name).join(' | ');
    ok('유라조생 옵션 5가지 꼴 = 하우스감귤 품목에 안 붙음', hit.length === 0, hitNote || '0건');
    const mid = NEW.matchNotifyProduct(PAGE + '1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(중소과)', bp);
    ok('「4.5kg(중소과)」가 「4.5kg(소과)」 품목에 안 붙음(괄호째 비교)', !mid, mid && mid.name);
    // 자사몰·쿠팡 보조 함수 = 구 코드와 결과 동일
    const c24 = ['고당도 하우스감귤 · 가정용 - 2.5kg(로얄과)', '과즙팡팡 황금향 · 황금향 선물용 - 3kg(중대과 7~15과)', '고당도 하우스감귤 · 선물용 - 3kg(로얄과)', '(특가)하우스감귤 가정용 4.5kg 소과', '제주 레몬 3kg'];
    const diff = c24.filter(t => { const a = OLD.matchNotifyProductLoose(t, bp), b = NEW.matchNotifyProductLoose(t, bp); return (a && a.id) !== (b && b.id); });
    ok('자사몰·쿠팡 연결 = 구 코드와 결과 동일(5개 문자열)', diff.length === 0, diff.join(' | '));
    const lo = NEW.matchNotifyProductLoose('고당도 하우스감귤 · 가정용 - 2.5kg(로얄과)', bp);
    ok('자사몰·쿠팡 보조 연결 함수 동작 그대로', !!lo && /2\.5kg\(로얄과\)/.test(lo.name), lo && lo.name);
    console.log(`\n결과 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
