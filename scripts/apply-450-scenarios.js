// #450(대표 GO 9/16 — 9/10~16 톡톡 응대 전수 점검 후 확정 항목): 시나리오 DB 교정 5건. 코드 무접촉·전건 audit.
//   ③ 쿠폰·할인 규칙 신설(#60·톡톡) — 등급별(SILVER 2,000/GOLD 3,000/VIP 5,000/VVIP 5,000×2 · 2만원 이상 · 1아이디 1회)·알림받기 1,000(상시)·추석 2,000(9/21 08시까지)
//   ④ 사이즈 지식 — 2S 골프공 전후·S 골프공보다 조금 큼·M 종이컵 위에 걸림 · 하우스감귤 선물용 지정 불가 · 황금향(만감류) 과수 지정 가능(옵션 13~25과면 「25과로」) — id 17·47·53
//   ⑤ 개별배송 송장 — 마이페이지엔 대표 송장 1개만 → 「개별 송장번호 전달 도와드릴까요?」 되묻기(쿨다운 후 직원 전달) — id 20 + 신설 #61(톡톡)
//   ⑥ 선물하기 주문 보내는이 = 주문자 정보 미노출·홍*동 자동 마스킹(직원 응대 문구) — id 16
//   ⑦ 교환 = 농산물 교환 시스템 없음 → 반품(무료수거·전액환불) 후 재주문 — id 3·14·52(+키워드 교환)
//   보류(대표): 되묻기 구조(2)·기주문 발송 문의(8)·긴 나열(9)·쿨다운 30분(11).  이벤트 종료 시: `node scripts/apply-450-scenarios.js off` = 추석 쿠폰 줄 제거.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #450 톡톡 응대 점검 교정)';
const audit = (action, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,'inquiry_scenarios',$2,$3,'claude-code',NULL,$4)`, [action, id, JSON.stringify(changes), ACTOR]);
const TAIL = '\n\n*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.';
const CHUSEOK_LINE = '· 추석맞이 쿠폰 2,000원 — 9월 21일(월) 오전 8시까지 사용 가능해요\n';

async function replaceOnce(id, from, to, note) {
    const row = (await pool.query(`SELECT id, scenario_no, name, response, keywords FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!row) throw new Error('id ' + id + ' 없음');
    const n = row.response.split(from).length - 1;
    if (n !== 1) throw new Error(`id ${id}(#${row.scenario_no} ${row.name}): 대상 문장 ${n}회 — 중단`);
    const next = row.response.replace(from, to);
    await pool.query(`UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3`, [next, ACTOR, id]);
    await audit('update', id, { instruction: '#450', note, removed: from, replaced_with: to, before: row.response, after: next });
    console.log(`✅ id ${id} #${row.scenario_no} ${row.name}: ${note}`);
}
async function addKeywords(id, kws) {
    const row = (await pool.query(`SELECT id, scenario_no, name, keywords FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    const cur = Array.isArray(row.keywords) ? row.keywords : [];
    const add = kws.filter(k => !cur.includes(k));
    if (!add.length) { console.log(`  id ${id} 키워드 추가 없음(이미 있음)`); return; }
    const next = cur.concat(add);
    await pool.query(`UPDATE inquiry_scenarios SET keywords=$1::jsonb, updated_at=now(), updated_by=$2 WHERE id=$3`, [JSON.stringify(next), ACTOR, id]);
    await audit('update', id, { instruction: '#450', field: 'keywords', added: add, before: cur, after: next });
    console.log(`✅ id ${id} #${row.scenario_no} 키워드 +${add.join(',')}`);
}
async function createScenario(no, name, kws, resp, channel, note) {
    const ex = await pool.query(`SELECT id FROM inquiry_scenarios WHERE scenario_no=$1 AND deleted_at IS NULL`, [no]);
    if (ex.rows.length) { console.log(`  #${no} 이미 있음 id ${ex.rows[0].id}`); return ex.rows[0].id; }
    const r = await pool.query(`INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, enabled, channel, updated_by) VALUES ($1,$2,$3::jsonb,$4,'자동응답',true,$5,$6) RETURNING id`, [no, name, JSON.stringify(kws), resp, channel, ACTOR]);
    await audit('create', r.rows[0].id, { instruction: '#450', after: { scenario_no: no, name, keywords: kws, response: resp, channel }, note });
    console.log(`✅ #${no} ${name} 생성 id ${r.rows[0].id} (${channel})`);
    return r.rows[0].id;
}

(async () => {
    const mode = process.argv[2] || 'apply';
    if (mode === 'off') {   // 추석 쿠폰 종료(9/21 08시 이후) — 그 줄만 제거
        const row = (await pool.query(`SELECT id, response FROM inquiry_scenarios WHERE scenario_no=60 AND deleted_at IS NULL`)).rows[0];
        if (row && row.response.includes(CHUSEOK_LINE)) { await replaceOnce(row.id, CHUSEOK_LINE, '', '추석 쿠폰 종료 — 줄 제거'); } else console.log('  추석 쿠폰 줄 없음(이미 제거)');
        await pool.end(); return;
    }

    // ③ 쿠폰·할인 안내 (#60 · 톡톡 = 네이버 스마트스토어 기준. 자사몰·카카오 채널은 쿠폰 체계가 달라 제외)
    const COUPON = [
        '안녕하세요 고객님 제주아꼼이네입니다 🍊',
        '쿠폰·할인 안내드릴게요 😊',
        '',
        '🎟 지금 받으실 수 있는 쿠폰 (스마트스토어)',
        '· 알림받기 쿠폰 1,000원 — 상품 「알림받기」 누르시면 발급 (상시)',
        CHUSEOK_LINE.trim(),
        '· 등급별 쿠폰 (2만원 이상 구매 시 · 상품중복할인)',
        '  - SILVER(2회 이상 구매) 2,000원 1장 / GOLD(3회 이상) 3,000원 1장 / VIP(5회 이상) 5,000원 1장 / VVIP(10회 이상) 5,000원 2장',
        '※ 등급 쿠폰은 해당 등급 고객님께만 발급되고, 쿠폰은 1아이디당 각 1회 사용 가능해요. 보유 쿠폰은 결제창에서 확인·적용하실 수 있어요!',
        '',
        '💡 "지난번보다 가격이 올랐나요?" — 상품가는 그대로예요. 지난 주문에 적용됐던 쿠폰(등급·알림받기·추석)이 이번엔 이미 사용돼 정상가로 보이는 경우가 대부분이에요.',
    ].join('\n') + TAIL;
    await createScenario(60, '쿠폰·할인 안내', ['쿠폰', '할인쿠폰', '할인 쿠폰', '등급', '등급쿠폰', 'VIP쿠폰', '알림받기 쿠폰', '가격이 오른', '가격이 올랐', '가격 올랐', '가격 변동', '금액이 변동', '금액 변동', '금액이 오른', '왜 비싸', '더 비싸', '쿠폰 적용', '쿠폰이 안', '할인이 안', '할인 적용'],
        COUPON, '톡톡', '#450 ③ — 9/10~16 실기록: 가격 변동 질문 2건이 쿠폰 차이였는데 봇이 가격표만 나열');

    // ④ 사이즈 지식 — id 17(#16 사이즈 지정·톡톡) 본문 교체(선물용 과수 15과 예시가 하우스감귤과 혼동되던 문구 교정)
    const SIZE = [
        '안녕하세요 제주아꼼이네입니다 🍊',
        '감귤·만감류 사이즈 지정 안내드려요! (미니밤호박 등 다른 품목은 기준이 달라요)',
        '',
        '🍊 하우스감귤 로얄과 사이즈 기준',
        '· 2S = 골프공 전후 / S = 골프공보다 조금 큰 크기 / M = 종이컵 위에 걸리는 크기',
        '· 별도 요청이 없으면 2S·S·M 중 한 사이즈로 균일하게 담아 보내드려요.',
        '✏️ 원하시는 사이즈가 있으면 주문하시면서 배송메세지에 "예시) S사이즈로"라고 남겨주시면 요청 사이즈로 보내드립니다.',
        '※ 하우스감귤 선물용은 사이즈 지정이 어려운 점 양해 부탁드려요.',
        '',
        '🍊 황금향 등 만감류는 과수(개수) 지정이 가능해요',
        '✏️ 옵션에 "13~25과"처럼 범위가 적혀 있으면 배송메세지에 "예시) 25과로"라고 남겨주시면 맞춰서 보내드립니다.',
        '',
        '*이미 결제하시고 톡톡으로 요청해주시는 거라면 이대로 접수해드릴까요? 답변 주시면 확인 후 발송 전에 반영해드리겠습니다.',
        '늘 고객님 입장에서 만족드리도록 제주에서 최선을 다하겠습니다. 감사합니다! 🙏',
    ].join('\n') + TAIL;
    {
        const row = (await pool.query(`SELECT id, response FROM inquiry_scenarios WHERE id=17 AND deleted_at IS NULL`)).rows[0];
        if (row.response !== SIZE) {
            await pool.query(`UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=17`, [SIZE, ACTOR]);
            await audit('update', 17, { instruction: '#450 ④', note: '사이즈 기준(2S/S/M)·선물용 지정 불가·만감류 과수 지정 — 본문 교체', before: row.response, after: SIZE });
            console.log('✅ id 17 #16 사이즈 지정: 본문 교체');
        } else console.log('  id 17 이미 반영');
    }
    await addKeywords(17, ['2S', '2s', '골프공', '종이컵', '25과', '과수 지정', '사이즈 지정']);
    // id 47(#46 귤 수량·과수) — 사이즈 설명 1줄 + 선물용 지정 불가
    await replaceOnce(47, '🍊 로얄과는 한 박스에 한 가지 사이즈로 균일하게 담겨요! 사이즈를 선택하지 않으시면 2S·S·M 중 한 사이즈로 발송되어 개수가 위 범위 안에서 달라질 수 있어요.',
        '🍊 로얄과는 한 박스에 한 가지 사이즈로 균일하게 담겨요! 사이즈를 선택하지 않으시면 2S·S·M 중 한 사이즈로 발송되어 개수가 위 범위 안에서 달라질 수 있어요.\n(2S = 골프공 전후 / S = 골프공보다 조금 큰 크기 / M = 종이컵 위에 걸리는 크기 · 하우스감귤 선물용은 사이즈 지정이 어려워요)', '④ 사이즈 기준 1줄 추가');
    // id 53(#52 로얄과·사이즈별 맛 차이) — 기준 1줄
    await replaceOnce(53, '원하시는 사이즈가 있으면 주문 시 배송메세지에 남겨주세요!',
        '로얄과 사이즈는 2S = 골프공 전후 / S = 골프공보다 조금 큰 크기 / M = 종이컵 위에 걸리는 크기예요.\n원하시는 사이즈가 있으면 주문 시 배송메세지에 남겨주세요! (하우스감귤 선물용은 사이즈 지정이 어려워요)', '④ 사이즈 기준 1줄 추가');

    // ⑤ 개별배송 송장 — id 20(#19 개별주소) 끝에 안내 + 되묻기
    await replaceOnce(20, '양이 많으신 경우에는 📧bumiletter@naver.com으로 보내주셔도 됩니다.! 감사합니다 🙏',
        '양이 많으신 경우에는 📧bumiletter@naver.com으로 보내주셔도 됩니다.! 감사합니다 🙏\n📦 개별배송 주문은 네이버 마이페이지에 대표 송장번호 1개만 표시돼요. 발송 후 개별 송장번호가 필요하시면 "개별 송장 부탁"이라고 남겨주세요 — 확인 후 톡톡으로 전달해드릴게요!', '⑤ 개별 송장 안내 추가');
    const TRACK = [
        '안녕하세요 고객님 제주아꼼이네입니다 🍊',
        '송장·배송조회 안내드릴게요 😊',
        '📦 네이버 마이페이지 → 주문내역 → 배송조회에서 송장번호와 배송 현황을 확인하실 수 있어요. (택배사는 CJ대한통운이에요)',
        '📦 여러 곳으로 나눠 보내는 개별배송 주문은 마이페이지에 대표 송장번호 1개만 표시돼요. 개별 송장번호 전달 도와드릴까요? "네"라고 답변 주시면 확인 후 톡톡으로 보내드리겠습니다!',
        '늘 고객님 입장에서 만족드리도록 제주에서 최선을 다하겠습니다. 감사합니다! 🙏',
    ].join('\n') + TAIL;
    await createScenario(61, '송장번호·배송조회 안내', ['송장', '송장번호', '운송장', '배송조회', '배송 조회', '택배조회', '택배 조회', '조회가 안', '송장이 하나', '송장 하나', '개별 송장', '개별송장'],
        TRACK, '톡톡', '#450 ⑤ — 개별배송 송장 문의는 되묻기 → 쿨다운 → 직원이 확인 후 전달(대표 확정 구조)');

    // ⑥ 선물하기 주문 — id 16(#15 보내는이 변경)
    await replaceOnce(16, '(구매자와 보내는 분이 같으면 구매자 성함으로 나가니 따로 적지 않으셔도 돼요)',
        '(구매자와 보내는 분이 같으면 구매자 성함으로 나가니 따로 적지 않으셔도 돼요)\n🎁 네이버 「선물하기」로 주문하신 경우에는 주문자 정보가 노출되지 않고, 보내는 분 성함이 홍길동님이면 "홍*동"처럼 자동으로 표기되어 발송돼요.', '⑥ 선물하기 마스킹 안내 추가');
    await addKeywords(16, ['선물하기', '누구로 가', '발송인이', '보낸사람']);

    // ⑦ 교환 = 반품 후 재주문 — id 3(#2 파손/불량·톡톡)·id 14(#13 맛/품질 불만·톡톡)·id 52(#51 맛 보증·반품)
    const EXCH = '\n※ 농산물 특성상 교환 시스템이 없어서, 새 상품을 원하시면 반품(무료수거·전액환불) 접수 후 재주문으로 진행해드리고 있어요. 번거로우시겠지만 양해 부탁드려요.';
    await replaceOnce(3, '📸 파손 및 이상 부분 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다 고객님 🙏',
        '📸 파손 및 이상 부분 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다 고객님 🙏' + EXCH, '⑦ 교환 = 반품 후 재주문');
    await replaceOnce(14, '📸 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다 고객님 🙏 다시한번 죄송합니다',
        '📸 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다 고객님 🙏 다시한번 죄송합니다' + EXCH, '⑦ 교환 = 반품 후 재주문');
    await replaceOnce(52, '일부만 아쉬운 경우에는 상품 회수 없이 네이버페이 포인트 부분환불로도 처리해드려요.',
        '일부만 아쉬운 경우에는 상품 회수 없이 네이버페이 포인트 부분환불로도 처리해드려요.' + EXCH, '⑦ 교환 = 반품 후 재주문');
    await addKeywords(52, ['교환', '교환되나', '교환 가능', '교환요청', '교환 요청', '새걸로', '새 상품으로']);

    // 잔존 검산
    const chk = await pool.query(`SELECT scenario_no, name FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND response ~ '15과로'`);
    console.log('검산: 「15과로」(하우스감귤 선물용 과수 예시) 잔존', chk.rows.length ? JSON.stringify(chk.rows) : '0');
    const chk2 = await pool.query(`SELECT scenario_no, name FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND response ~ '교환·환불|교환 도와|교환해드'`);
    console.log('검산: 「교환 도와드림」류 잔존', chk2.rows.length ? JSON.stringify(chk2.rows) : '0');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
