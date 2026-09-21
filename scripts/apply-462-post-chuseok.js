// #462(대표 GO 9/21): 추석 전 마지막 발송(9/21 08시) 종료 후 응대 정리 — DB만(코드·배포 0)
//   대표 확정: VIP 선물페이지 **링크 3곳(#36·#55·#56)은 유지**(명절 뒤에도 선물 수요 · 9/28에 내릴지 결정) · "명절 전 도착/미리 주문/조기 마감" 권유만 제거 ·
//   「명절 선물」→「선물」 중립화(명절 뒤에도 그대로 쓰게) · 시기 지식 #14에 "지금 주문은 9/27 발송을 먼저 알릴 것" 한 줄(09-26 자동 소멸). #54·#57·#59·키워드·채널 무접촉.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #462 추석 발송 마감 후 응대 정리)';
const audit = (type, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update',$1,$2,$3,'claude-code',NULL,$4)`, [type, id, JSON.stringify(changes), ACTOR]);
const LINK = 'https://brand.naver.com/jejuakkome/products/10801253976';
const EDITS = {
    36: { pairs: [
        ['📅 제철: 9월~11월 (추석 선물로 많이 찾으세요 🎁)', '📅 제철: 9월~11월 (선물용으로도 많이 찾으세요 🎁)'],
        ['💝 명절 선물용은 VIP 선물용 페이지에서 더 저렴하게 준비해드려요', '💝 선물용은 VIP 선물용 페이지에서 더 저렴하게 준비해드려요'],
        ['판매 여부·가격은 스토어에서 실시간 확인 가능하시고, 명절 시즌엔 조기 마감될 수 있으니 미리 주문 추천드려요!', '판매 여부·가격은 스토어에서 실시간 확인 가능하세요!'],
    ] },
    55: { name: '단체·기업 선물 문의', pairs: [
        ['💝 명절 선물은 아래 VIP 선물용 페이지에서 주문하시면', '💝 선물용은 아래 VIP 선물용 페이지에서 주문하시면'],
        ['"주문자 ○○○ 추석 선물"처럼', '"주문자 ○○○ 선물 명단"처럼'],
        ['📅 명절 전 도착을 원하시면 주문이 몰리니 연휴 전 마지막 발송일보다 여유 있게 미리 확정해주시면 안전합니다.', '📅 원하시는 도착일이 있으시면 미리 말씀해주세요. 발송 일정에 맞춰 안내해드릴게요!'],
    ] },
    56: { name: '선물 추천', pairs: [
        ['명절 선물 고민이시군요 😊', '선물 고민이시군요 😊'],
        ['🎁 명절 선물은 판매현황에 있는 선물용 상품 중에서', '🎁 선물은 판매현황에 있는 선물용 상품 중에서'],
        ['💝 명절 선물은 VIP 선물용 페이지에서 더 저렴하게 준비해드려요!', '💝 선물용은 VIP 선물용 페이지에서 더 저렴하게 준비해드려요!'],
    ] },
};
const KNOW_ADD = '\n★ 9월 21일 오전 8시 이후(추석 전 발송 마감 뒤): 선물 추천·단체 주문·품목 문의처럼 손님이 날짜를 묻지 않은 문의에도, 선물·명절·추석 이야기가 나오면 **첫머리에 「지금 주문하시면 9월 27일(일) 발송, 9월 28일(월)~29일(화) 도착(추석 이후)」을 먼저 알릴 것.** "추석 전 도착", "미리 주문", "조기 마감" 권유는 하지 말 것(추석 전 발송은 이미 끝났음).';
(async () => {
    for (const no of Object.keys(EDITS)) {
        const e = EDITS[no]; const row = (await pool.query(`SELECT id, name, response, keywords, channel FROM inquiry_scenarios WHERE scenario_no=$1 AND deleted_at IS NULL`, [Number(no)])).rows[0];
        if (!row) throw new Error('#' + no + ' 없음');
        let next = row.response; const done = [];
        for (const [a, b] of e.pairs) { const c = next.split(a).length - 1; if (c === 1) { next = next.replace(a, b); done.push(a.slice(0, 18)); } else if (c === 0 && next.includes(b)) { /* 이미 적용 */ } else throw new Error(`#${no} 대상 문장 ${c}회: ${a.slice(0, 30)}`); }
        // 검산: 링크 유지 · 줄 수 동일 · 바뀐 줄만 다름
        if (!next.includes(LINK)) throw new Error('#' + no + ' 링크 소실'); if (next.split('\n').length !== row.response.split('\n').length) throw new Error('#' + no + ' 줄 수 변함');
        const changedLines = next.split('\n').filter((l, i) => l !== row.response.split('\n')[i]).length;
        const newName = e.name && e.name !== row.name ? e.name : null;
        if (!done.length && !newName) { console.log('  #' + no + ' 변경 없음(이미 적용)'); continue; }
        await pool.query(`UPDATE inquiry_scenarios SET response=$1, name=COALESCE($2, name), updated_at=now(), updated_by=$3 WHERE id=$4`, [next, newName, ACTOR, row.id]);
        await audit('inquiry_scenarios', row.id, { note: '#462 추석 발송 마감 후 — 미리 주문·명절 전 도착 권유 제거·「명절 선물」 중립화(VIP 링크 유지)', before: { name: row.name, response: row.response }, after: { name: newName || row.name, response: next } });
        console.log(`✅ #${no}(id ${row.id}) 바뀐 줄 ${changedLines}줄${newName ? ' · 이름 「' + row.name + '」→「' + newName + '」' : ''} · 링크 유지 · 키워드/채널 무접촉`);
    }
    const k = (await pool.query(`SELECT id, knowledge, start_md, end_md FROM product_season_knowledge WHERE id=14 AND deleted_at IS NULL`)).rows[0];
    if (!k) throw new Error('시기 지식 #14 없음');
    if (k.knowledge.includes('9월 21일 오전 8시 이후(추석 전 발송 마감 뒤)')) console.log('  시기 지식 #14 이미 추가됨');
    else { const nk = k.knowledge + KNOW_ADD; await pool.query(`UPDATE product_season_knowledge SET knowledge=$1, updated_by=$2, updated_at=now() WHERE id=14`, [nk, ACTOR]); await audit('product_season_knowledge', 14, { note: '#462 마감 후 안내 한 줄 추가(09-26 자동 소멸)', added: KNOW_ADD.trim() }); console.log(`✅ 시기 지식 #14(${k.start_md}~${k.end_md}) 한 줄 추가 — 기존 본문 무변경`); }
    // 잔존 검사: 활성 시나리오에 남은 「미리 주문·조기 마감·명절 전 도착」 권유
    const all = (await pool.query(`SELECT scenario_no, name, response FROM inquiry_scenarios WHERE enabled=true AND deleted_at IS NULL ORDER BY scenario_no`)).rows;
    const left = all.filter(r => /명절\s*시즌엔\s*조기\s*마감|명절\s*전\s*도착을\s*원하시면\s*주문이\s*몰리니|추석 선물로 많이 찾으세요/.test(r.response)).map(r => '#' + r.scenario_no);
    console.log('정리 대상 문구 잔존:', left.length ? left.join(',') : '0건'); await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
