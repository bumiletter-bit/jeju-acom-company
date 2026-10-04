// #508 최종발주 화면 검증용 가짜 재료 — 이름·번호·주소 전부 지어낸 값(실주문·실파일 사용 0)
//   build({ byPartner, ship, later, realToday, noShip }) → 네이버 30행 · 자사몰 2행 · 쿠팡 2행 · 현금파일(13칸) · 메모 줄
//   품목 이름은 실행 시점의 단가표 카탈로그(/api/invoice/catalog)에서 고른다(이름이 바뀌어도 검증이 썩지 않게)
const CASH_HDR = ['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처', '박스타입(입력x)', '보내는이 변경주소'];
const DEFAULT_MEMO = '고객님의 소중한 물건으로 파손주의 부탁드리겠습니다.!';
const DEPOT = '제주특별자치도 제주시 연삼로 1066-31, 제주아꼼이네';
const P_HYODON = '효돈농협', P_DAESUNG = '대성(시온)';
const tel = n => '010-7000-' + String(1000 + n);                 // 가짜 구매자 번호(주문 n번)
const usd = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}`;
const pad = n => String(n).padStart(2, '0');
// 실제 오늘(포함) 이후 첫 금요일
function firstFriday(realToday) { for (let k = 0; k < 7; k++) { const d = new Date(Date.parse(realToday + 'T00:00:00Z') + k * 86400e3); if (d.getUTCDay() === 5) return d.toISOString().slice(0, 10); } return null; }

function build({ byPartner, ship, later, realToday, noShip }) {
    const H = [...(byPartner[P_HYODON] || [])].sort((a, b) => a.localeCompare(b, 'ko'));
    const D = [...(byPartner[P_DAESUNG] || [])].sort((a, b) => a.localeCompare(b, 'ko'));
    if (H.length < 2 || D.length < 2) throw new Error(`오늘 단가표에 ${P_HYODON}·${P_DAESUNG} 품목이 2종 이상 있어야 합니다(지금 ${H.length}·${D.length})`);
    const h = i => H[i % H.length], d = i => D[i % D.length];
    const laterMemo = `${+later.slice(5, 7)}월 ${+later.slice(8, 10)}일 발송 부탁드려요`;
    const addr = n => `서울특별시 가짜구 시험로 ${n}`;
    const row = (n, opt, o = {}) => ({
        '구매자명': '시험구매' + pad(n), '구매자연락처': o.tel || tel(n), '수취인명': '받는' + pad(n), '옵션정보': opt, '수량': o.qty || 1,
        '수취인연락처1': '010-7100-' + String(1000 + n), '수취인연락처2': '', '통합배송지': o.addr || addr(n), '배송메세지': o.memo || '', _pid: '2099010100' + String(1000 + n),
        _x: { productOrderId: '2099010100' + String(1000 + n), orderId: '20990101' + String(1000 + n), paymentDate: '2026-10-01T09:00:00.000+09:00', orderDate: '2026-10-01T08:59:00.000+09:00', ordererId: 'fake' + pad(n), productId: '1', productName: '시험 상품', expectedSettlementAmount: 10000 + n, shippingDueDate: '2026-10-09T23:59:59.000+09:00', inflowPath: '', deliveryMethod: 'DELIVERY', productOrderStatus: 'PAYED' },
    });
    const T = { A: tel(50), B: tel(60), C: tel(70), D: tel(80) };
    const naver = [
        row(1, h(0)), row(2, d(0)), row(3, h(1)), row(4, d(1)),                                    // 직원 보내는이 줄 대상(이름만 / +번호 / +주소 / 애매)
        row(5, h(0), { memo: '문앞에 놔주세요' }),                                                    // 손님 메모 원문 유지
        row(6, d(0)),                                                                              // E: 현금파일엔 있는데 처음엔 입력삭제 줄 없음 → [다시 판정]에서 줄 추가
        row(7, h(1)), row(8, d(1)), row(9, h(0)), row(10, d(2)), row(11, h(2)), row(12, d(3)),
        row(13, d(0), { memo: '부재 시 경비실에 맡겨주세요' }), row(14, h(1)), row(15, d(1)), row(16, h(0)),
        row(17, h(0), { memo: 's사이즈로 보내주세요' }),                                               // 사이즈 요청 → 옵션에 「S사이즈로!」 꼬리
        row(18, d(0), { memo: laterMemo }),                                                        // 손님 메모 뒤 날짜 → 자동 제외
        row(19, h(1), { memo: '다음주에 보내주세요' }),                                                // 날짜 애매 → 주문 확인 카드
        row(20, d(1), { memo: '보내는이 홍길동 변경' }),                                               // 손님 보내는이(확실)
        row(21, h(0), { memo: '보내는이: 홍길동 즐거운 명절 보내세요' }),                                // 손님 보내는이(애매)
        row(22, h(0), { addr: '제주특별자치도 제주시 가짜로 1' }),                                      // 제주(효돈)
        row(23, d(0), { addr: '제주특별자치도 서귀포시 가짜로 2' }),                                    // 제주(대성)
        row(24, h(1), { addr: '경기도 고양시 제주로 12 가짜아파트 101동' }),                             // 주소 중간에 「제주」 — 제주 아님
        row(25, d(1), { qty: 3, memo: '2박스는 다른 주소로 보내주세요 주소: 부산 가짜구 가짜로 5' }),     // 나눠 보내기 카드
        row(26, d(0), { tel: T.A }), row(27, h(0), { tel: T.A, qty: 2 }),                           // 같은 구매자 A 2건 → 기준일 입력o삭제x(합 3박스)
        row(28, h(1), { tel: T.B, qty: 2 }),                                                       // B → 「개별발송처리」(현금파일은 3박스 = 박스 수 다름)
        row(29, d(1), { tel: T.C }),                                                               // C → 뒤 날짜 줄
        row(30, h(0), { tel: T.D }),                                                               // D → 「번호 금요일 발송」
    ];
    const cafe24 = [1, 2].map(n => ({ '주문자명': '자사구매' + n, '주문상품명(세트상품 포함)': n === 1 ? h(0) : d(0), '배송메시지': '', '수령인': '자사받는' + n, '주문자 휴대전화': '010-7200-100' + n, '수량': 1, '수령인 휴대전화': '010-7200-200' + n, '수령인 주소(전체)': '부산광역시 가짜구 시험로 ' + n, _orderId: '20990101-000000' + n }));
    const coupang = [1, 2].map(n => ({ '구매자': '쿠팡구매' + n, '등록상품명': '시험 등록상품', '노출상품명(옵션명)': d(0), '배송메세지': '', '수취인이름': '쿠팡받는' + n, '구매자전화번호': '0505-700-100' + n, '구매수(수량)': 1, '수취인전화번호': '0505-700-200' + n, '수취인 주소': '대구광역시 가짜구 시험로 ' + n, _orderId: 'FAKECP' + n }));
    const canceledCoupang = ['FAKECP2'];                                                           // 다운로드 직전 취소 재확인에서 빠질 주문

    // 현금파일(13칸): 「!」 = 현금 행(A칸 끝 「!」) · 「!」 없는 행 = 입력삭제 구매자의 실제 받는 곳(K칸 = 구매자 번호)
    const cashRow = (nm, opt, qty, o = {}) => [o.bang === false ? `${o.sender || '시험구매'}(제주아꼼이네)` : `${o.sender || '현금손님'} 드림!`, o.stel || '010-7300-0000', DEPOT, nm, opt, qty, '010-7400-' + String(1000 + (o.n || 0)), '', o.addr || `인천광역시 가짜구 현금로 ${o.n || 0}`, o.memo || '', o.buyer || '', '', ''];
    const cashRows = [
        cashRow('현금받는1', h(0), 1, { n: 1 }), cashRow('현금받는2', d(0), 2, { n: 2, memo: '경비실 보관' }),
        cashRow('현금받는3', h(1), 1, { n: 3 }), cashRow('현금받는4', d(1), 1, { n: 4, addr: '제주특별자치도 제주시 현금로 4' }),          // 「!」 4행(두 거래처 · 제주 1)
        cashRow('삭제받는A1', d(0), 1, { n: 11, bang: false, buyer: T.A }), cashRow('삭제받는A2', h(0), 2, { n: 12, bang: false, buyer: T.A }),   // A: 주문 3박스 = 현금 3박스
        cashRow('삭제받는B1', h(1), 3, { n: 13, bang: false, buyer: T.B }),                                                                // B: 주문 2박스 ≠ 현금 3박스
        cashRow('삭제받는E1', d(0), 1, { n: 14, bang: false, buyer: tel(6) }),                                                             // E: 처음엔 입력삭제 줄 없음
        cashRow('재발송받는1', h(0), 1, { n: 15, bang: false, buyer: '010-7888-0000' }),                                                    // 주문에 없는 구매자(안내만)
    ];
    const cashAoa = [CASH_HDR, ...cashRows];

    const fri = firstFriday(realToday);
    const memoLines = [
        `${usd(ship)}\t${T.A}\t입력o삭제x 2건\t네이버`,          // 0 기준일 입력삭제(같은 구매자 2건)
        `${usd(ship)}\t${T.B}\t개별발송처리\t네이버`,            // 1 「개별발송처리」 = 입력삭제
        `${usd(later)}\t${T.C}\t\t네이버`,                      // 2 뒤 날짜 → 제외
        `${T.D} 금요일 발송`,                                   // 3 요일만
        `${tel(1)} 보내는이 김직원`,                             // 4 보내는이 — 이름만
        `${tel(2)} 보내는이 박직원 010-5555-0002`,               // 5 이름 + 번호
        `${tel(3)} 보내는이 (주)가짜상사 주소: 서울 가짜구 가짜로 99`,   // 6 이름 + 주소
        `${tel(4)} 보내는이 최직원 꼭 부탁드립니다 빠르게`,          // 7 애매(「주소」 낱말 없이 글이 더 있음) → 카드에서 [넣지 않음]
        `${usd(ship)}\t010-7999-0000\t\t네이버`,                // 8 주문 없는 줄(안내만)
        'ㅁㄴㅇㄹ 확인',                                         // 9 형식 오류
        `${tel(7)} 보내는이 이직원 부산 가짜구 가짜로 77`,        // 10 애매(주소 꼴인데 「주소」 낱말 없음) → 카드에서 칸을 채워 [이대로 넣기]
        `${usd(ship)}\t${tel(8)}\t보내는이 탭직원 주소 서울 가짜구 탭로 8\t네이버`,   // 11 탭 형식 비고에 보내는이(날짜 있음 → 보내는이만 떼고 줄은 넘김)
    ];
    const rejudgeLine = `${usd(ship)}\t${tel(6)}\t입력o삭제x\t네이버`;   // [다시 판정] 때 보탤 줄(E)
    return {
        naver, cafe24, coupang, canceledCoupang, cashAoa, memo: memoLines.join('\n'), rejudgeLine, fri,
        friKind: fri > ship ? 'future' : fri === ship ? 'today' : 'past', friNoShip: new Date(fri + 'T00:00:00Z').getUTCDay() === 6 || (noShip || []).includes(fri),
        H, D,
        expect: {
            individual: ['받는26', '받는27', '받는28'], individualAfterRejudge: ['받는06', '받는26', '받는27', '받는28'],
            excluded: ['받는18', '받는29'], canceled: ['쿠팡받는2'],
            jeju: { [P_HYODON]: ['받는22'], [P_DAESUNG]: ['받는23', '현금받는4'] }, midJeju: '받는24',
            staffSender: { '받는01': { A: '김직원 드림' }, '받는02': { A: '박직원 드림', B: '010-5555-0002' }, '받는03': { A: '(주)가짜상사 드림', M: '서울 가짜구 가짜로 99' }, '받는08': { A: '탭직원 드림', M: '서울 가짜구 탭로 8' } },
            senderLineUse: { find: '이직원', name: '이직원', addr: '부산 가짜구 가짜로 77', row: '받는07', A: '이직원 드림', M: '부산 가짜구 가짜로 77' }, senderLineSkip: { find: '최직원', row: '받는04' },
            keepMemo: { '받는05': '문앞에 놔주세요', '받는13': '부재 시 경비실에 맡겨주세요', '현금받는2': '경비실 보관' }, emptyMemo: ['받는07', '받는08', '현금받는1'],
            sizeRow: '받는17', cashNames: ['현금받는1', '현금받는2', '현금받는3', '현금받는4', '삭제받는A1', '삭제받는A2', '삭제받는B1', '삭제받는E1', '재발송받는1'],
        },
    };
}
module.exports = { build, CASH_HDR, DEFAULT_MEMO, P_HYODON, P_DAESUNG, tel, usd, firstFriday };
