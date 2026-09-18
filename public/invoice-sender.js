// 송장변환 v2 — 배송메모의 「보내는이 변경」 요청 읽기(#453, 대표 9/18)
// 원칙: 확실한 것만 자동(보내는사람 = 「이름 드림」) · 애매하면 { ambiguous:true }로만 알리고 아무것도 바꾸지 않는다(오매칭 > 미매칭과 같은 원칙).
// 배송메모 글자는 어디서도 바꾸지 않는다 — 사람이 시트에서 확인하고 앞부분만 지운다.
// 규칙은 9/16~18 실메모 1,934건 + 수기 완성본 대조로 정했다(scripts/verify-453-sender.js가 같은 자료로 채점).
(function (root) {
    const PHONE = /(?:\(|\[)?\s*(01[016789])[\s\-.]?(\d{3,4})[\s\-.]?(\d{4})\s*(?:\)|\])?/;
    // 「보내는이 / 보내는 사람 / 보내는분 / 보낸이 / 발신자 …」 + (이름·성함) + 조사·구분 기호
    const KEY = /(보내는\s*(?:이|사람|분)|보낸\s*(?:이|사람|분)|발신자|발신인|발송인|발송자)\s*(?:이름|성함|명)?\s*(?:에|은|는|을|를)?\s*[:：\-ㅡ—.,·ㆍ~]*\s*/;
    // 이름 뒤에 와도 되는 「요청 꼬리」 — 이 앞까지가 이름
    const TAIL = /^\s*(?:(?:이|으)?로|이?라고)?\s*(?:꼭\s*)?(?:변경|표기|기재|기입|부탁|해\s*주|해주|넣어|바꿔|바꾸|수정|적어|써\s*주|요청|연락처|전화|번호|보내는\s*번호)/;
    // 「부탁·해주세요」처럼 아무 말에나 붙는 꼬리는 이름이 한 단어일 때만 인정(「홍길동 좋은걸로 부탁」 오인 방지)
    const GENERIC = /^\s*(?:(?:이|으)?로|이?라고)?\s*(?:꼭\s*)?(?:부탁|해\s*주|해주|넣어|적어|써\s*주|요청)/;
    // 그런 꼬리는 이름에 「으로·로·라고」가 붙어 있을 때만 인정(「보내는 사람 모르게 해주세요」 → 「모르게」를 이름으로 읽지 않게)
    const PARTICLE = /^\s*(?:(?:이|으)?로|이?라고)/;
    // 이름 자리에 이런 말·숫자가 있으면 이름이 아니다 → 애매
    const BAD = /받는|주소|문자|카톡|톡톡|메일|엑셀|파일|전송|예정|연락|주문|배송|발송|도착|출고|선물|감사|추석|명절|한가위|즐거운|행복|건강|부탁|주세요|입니다|니다|세요|에요|해요|모르|비밀|익명|없이|빼고|빼주|지워|삭제|말고|표시|좋은|맛있|달달|싱싱|\d/;
    const CLOSE = /\s*(드림|올림)\s*$/;
    const stripQ = s => s.replace(/[<>〈〉《》「」『』'"‘’“”`\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    function cleanName(s) {
        let n = stripQ(s).replace(/[\s.,!~^♡♥\-ㅡ:]+$/g, '').replace(/^[\s.,:\-ㅡ]+/, '');
        n = n.replace(CLOSE, '').trim();
        const t = n.split(' ');
        if (t.length > 1 && t.every(x => /^[가-힣]$/.test(x))) n = t.join('');   // 「류 현」 → 「류현」
        return n;
    }
    function validName(n) {
        if (!n || n.length < 2 || n.length > 25) return false;
        if (!/[가-힣A-Za-z]/.test(n)) return false;
        if (BAD.test(n)) return false;
        if (n.split(' ').some(t => /^(?:변경|표기|기재|기입|수정|이름|성함|표시)$/.test(t))) return false;   // 요청 단어 자체는 이름이 아님(「김수정」은 통과)
        return true;
    }
    // 반환: null(요청 없음) | { ambiguous:true, rule } | { name, phone|null, rule:'A'|'A2'|'B'|'C' }
    function parseSender(memoRaw, buyerName) {
        const memo = String(memoRaw || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!memo) return null;
        // 규칙 A: 보내는이 단어 + 이름 + (끝 | 번호 | 「으로 변경·표기…」)
        const km = memo.match(KEY);
        if (km) {
            const rest = memo.slice(km.index + km[0].length);
            const pm = rest.match(PHONE);
            const head = pm ? rest.slice(0, pm.index) : rest;
            let cut = -1;
            // 가장 앞의 요청 꼬리에서 자른다. 단 자른 앞부분이 한 글자 이하면 이름 속 글자(「김수정」의 「수정」)에 걸린 것 → 다음 꼬리로
            for (let i = 1; i <= head.length; i++) { if (TAIL.test(head.slice(i)) && cleanName(head.slice(0, i)).length >= 2) { cut = i; break; } }
            let name = (cut >= 0 ? head.slice(0, cut) : head).replace(/\(\s*[\d\-\s]{6,}\s*\)/g, ' ');   // 「(10-4003-2199)」 같은 잘못된 번호 괄호 제거
            const seg = name.split(/[.!?]/)[0];
            const trailing = name.slice(seg.length).replace(/[.!?\s~^]+/g, '');   // 이름 뒤에 요청 꼬리도 번호도 아닌 다른 말이 이어지면 애매
            const nm = cleanName(seg), tokN = nm.split(' ').length;
            const generic = cut >= 0 && GENERIC.test(head.slice(cut));
            if (validName(nm) && !trailing && tokN <= 3 && !(generic && (tokN > 1 || !PARTICLE.test(head.slice(cut))))) return { rule: 'A', name: nm, phone: pm ? pm[1] + '-' + pm[2] + '-' + pm[3] : null };
            const first = stripQ(rest).split(/[\s.,:(]/)[0];
            if (buyerName && first === buyerName) return { rule: 'A2', name: buyerName, phone: null };   // 뒤에 다른 말이 이어져도 첫 단어가 구매자 본인 이름이면 확실
            return { rule: 'A?', ambiguous: true };
        }
        // 규칙 B(메모 전체가 「○○○ 드림」) · C(인사말이 문장부호로 끝난 뒤 마지막 문장이 「○○○ 드림/올림」)
        const noPhone = memo.replace(PHONE, ' ').replace(/\(\s*\)/g, ' ').trim();
        const segs = noPhone.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
        if (segs.length) {
            const last = segs[segs.length - 1].replace(/[\s~^♡♥\-]+$/g, '');
            if (CLOSE.test(last)) {
                const nm = cleanName(last);
                if (validName(nm) && nm.split(' ').length <= 4) return { rule: segs.length === 1 ? 'B' : 'C', name: nm, phone: null };
                return { rule: 'BC?', ambiguous: true };
            }
        }
        if (/드림|올림/.test(memo)) return { rule: 'BC?', ambiguous: true };
        return null;
    }
    const senderLabel = p => p && !p.ambiguous ? p.name + ' 드림' : null;
    const api = { parseSender, senderLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.IvtSender = api;
})(typeof window !== 'undefined' ? window : null);
