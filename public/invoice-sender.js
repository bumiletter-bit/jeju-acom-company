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
    // #455(대표 9/18 "애매한 건 변경 안 되게") — 이름이 아닌 말 거르기. 전부 「덜 바꾸는 쪽」(걸리면 애매 = 무변경·연노랑)
    //  · NOTNAME_SUB: 이름 자리에 들어 있으면 안 되는 말(「보내는 사람 번호 010…」「비공개로 변경」「구매자 이름으로」)
    //  · NOTNAME_TOKEN: 조사를 뗀 단어가 정확히 이 말이면 이름 아님(「보내는사람 동일/그대로/없음」「본인으로 해주세요」 · 「김동일」 같은 이름은 통과) + 상품·물건 말(「사과 드림」)
    //  · 단어 끝이 조사·동사 어미면 문장이지 이름이 아님(「경비실에 맡겨 드림」)
    const NOTNAME_SUB = /한라봉|황금향|천혜향|레드향|카라향|하우스|감귤|청귤|레몬|밤호박|세트|포장|번호|전화|핸드폰|휴대폰|비공개|회사명|상호명|법인명|단체명|업체명|아꼼|구매자|수취인|고객|기존|원래|기본|나중|추후|별도|따로|미정|확인|문의|상관|아무|실명|가명|무기명/;
    const NOTNAME_TOKEN = /^(?:하나만|하나로|하나씩|차례상|이상한|최고의|고양이|강아지|아니고|아니라|아님|말고|또는|혹은|or|OR|and|AND|및|외|이대로|이렇게|그렇게|저렇게|저는|제가|저희|내|나는|동일|동일인|동일하게|그대로|본인|없음|없슴|같음|같게|같이|상동|생략|미기재|미표기|무표기|공란|공백|빈칸|위와|저|제|나|우리|회사|상호|사과|귤|감귤|과일|물건|상품|택배|박스|경비실|문앞|문|현관|집|변경|표기|기재|기입|수정|이름|성함|표시)$/;
    const TOKEN_PARTICLE = /(?:으로|에게|에서|은|는|이|가|을|를|와|과|로|에|께|도|만)$/;
    const TOKEN_SENTENCE = /(?:에|에게|께|에서|을|를|으로|겨|놔|둬|줘|세요|니다|어요|아요|해요|하고|해서)$/;
    // #455-b 「이름처럼 생긴 것만 통과」(금지어만으로는 「미표기 드림」「음료 드림」 같은 새 말을 못 막는다 — 홀드아웃 44문장 중 9건 오변경 실측)
    //  통과 = ①구매자 본인 이름 ②회사·단체 표식이 있는 말 ③가족 호칭 ④성씨로 시작하는 3~4글자 사람 이름(직함이 붙어도 됨) ⑤영문 이름. 두 글자 이름은 구매자 이름의 일부일 때만(「이유」「정말」 같은 말과 구별 불가).
    const SURNAMES = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육맹제모탁국어은편용';
    const SURNAME2 = /^(?:남궁|황보|제갈|선우|독고|사공|서문)/;
    const ORG = /\(주\)|㈜|\(유\)|\(사\)|\(재\)|주식회사|유한회사|법인|회사|컴퍼니|스튜디오|병원|의원|약국|교회|성당|센터|학원|학교|대학|유치원|어린이집|은행|증권|투자|보험|금융|전자|산업|건설|건축|농협|조합|사무소|사무실|상사|물산|그룹|일동|본부|지점|캠퍼스|세차장|중개사|부동산|환경|전력|기계|테크|시스템|솔루션|디자인|엔지니어링|식당|카페|마트|상회|공업|공사|공단|협회|재단|연구소|연구원|사업팀|영업팀|지원팀|동호회|모임|산악회|동문회|향우회/;
    const FAMILY = /^(?:엄마|아빠|어머니|아버지|아들|딸|할머니|할아버지|며느리|사위|언니|오빠|누나|형|동생|이모|고모|삼촌|조카|손주|손녀|손자|막내|첫째|둘째|큰딸|작은딸|큰아들|작은아들|장남|장녀|차남|차녀)$/;
    const TITLE = /(?:대표이사|대표님|대표|이사장|이사|사장님|사장|회장|원장님|원장|본부장|팀장|과장|부장|차장|대리|실장|소장|국장|지점장|교수님|교수|박사|집사|권사|장로|목사|선생님|선생|님)$/;
    const LATIN_STOP = /^(?:yes|no|none|same|null|na|ok|okay|x|xx|xxx)$/i;
    // #455-c 이름 글자 검사: 성씨 뒤 글자가 한국 이름에 쓰이는 글자(또는 순우리말 이름)일 때만 사람 이름으로 본다 — 「심부름」「노란색」「정성껏」「서비스」처럼 성씨 글자로 시작하는 낱말 차단
    const GIVEN = '가강건경고관광구국권규균근금기길나남녀노다단달담대덕도돈동두라락란람래량려련렬령례로록룡류률리린림마만명모목무문미민박배백범병보복봉부비빈사산삼상서석선설섭성세소솔송수숙순슬승시식신실심아안애양언엄여연열염엽영예오옥온완왕용우욱운웅원월위유윤율은을음의이익인일임자잔장재전정제조종주준중지진찬창채천철초춘충치태택평표필하학한해향헌혁현형혜호홍화환황회효후훈휘희흥겸결곤교군랑루얀요울탁흠협';
    const PURE = /^(?:하얀|하늘|하람|하루|보람|보라|보미|슬기|아름|아람|아라|아리|나래|나라|나리|다솜|다운|다온|다인|한별|한솔|한결|한빛|한울|새봄|새롬|새별|가람|가온|가을|누리|마루|마리|이슬|초롱|빛나|샛별|은별|소라|소리|여름|겨울|봄|별|솔|샘|힘찬|푸름|바다|사랑|믿음|소망|기쁨|우리|두리|세리|유리|로운|라온|시우|시아|이든|이안)$/;
    function personLike(tok, buyerName) {
        const t = tok.replace(/\([^)]*\)/g, '').replace(TITLE, '');
        if (!/^[가-힣]+$/.test(t)) return false;
        const givenOk = g => PURE.test(g) || (g.length >= 1 && g.length <= 2 && g.split('').every(ch => GIVEN.includes(ch)));   // 성 뒤 이름은 두 글자까지(「김영수가 드림」의 「김영수가」·「신선한걸」 차단 — 세 글자 이름은 순우리말 목록만)
        if (SURNAME2.test(t) && givenOk(t.slice(2))) return true;   // 두 글자 성(남궁·황보…)
        if (!SURNAMES.includes(t[0])) return false;
        const given = t.slice(1);
        if (given.length === 1) return !!buyerName && buyerName.includes(t);   // 두 글자 이름은 구매자 이름의 일부일 때만(「이유」「정말」 같은 낱말과 구별 불가)
        return givenOk(given);
    }
    const parenPerson = (t, buyerName) => { const m = t.match(/\(([^)]+)\)/); return !!m && personLike(m[1], buyerName); };
    const CORP = /\(주\)|㈜|\(유\)|\(사\)|\(재\)|주식회사|유한회사/;
    function looksLikeName(n, buyerName) {
        if (buyerName && n === buyerName) return true;
        const toks = n.split(' ').filter(t => t !== '&' && t !== '·');
        if (!toks.length) return false;
        // 법인 표식((주)·주식회사…)이 있으면 회사 이름으로 본다(글자 모양만 확인 — 금지어는 validName이 거른다)
        if (CORP.test(n)) return toks.every(t => /^[가-힣A-Za-z()㈜&.\-]{2,}$/.test(t));
        const latin = t => /^[A-Za-z.&\-]{3,}$/.test(t) && !LATIN_STOP.test(t);
        const titleOnly = t => TITLE.test(t) && t.replace(TITLE, '') === '';
        // 회사·단체 말은 표식 앞에 고유 이름이 두 글자 이상 있어야 인정(「가나병원」 ○ · 「병원」「카페 사장」 ✕)
        const orgTok = t => { const bare = t.replace(/\([^)]*\)/g, ''); const m = bare.match(ORG); return !!m && bare.length >= m[0].length + 2; };
        const hasOrg = toks.some(orgTok), lastFam = FAMILY.test(toks[toks.length - 1]);
        const anchor = t => personLike(t, buyerName) || parenPerson(t, buyerName) || FAMILY.test(t) || orgTok(t) || latin(t);
        // 표식 없는 이름은 모든 단어가 이름 모양이어야 한다(「홍길동 아니고 김철수」 차단). 예외: 회사 뒤 부서(「영업부」)·끝의 「일동」·가족 호칭 앞 짧은 단어(「민서 엄마」)
        const tokOk = (t, i) => anchor(t) || titleOnly(t) || (hasOrg && /^[가-힣]{2,5}(?:부|팀|과|실|회|반|국|처)$/.test(t)) || (hasOrg && /^(?:임직원|직원|가족|식구)$/.test(t)) || (hasOrg && i === toks.length - 1 && t === '일동') || (lastFam && i < toks.length - 1 && /^[가-힣]{2,3}$/.test(t));
        return toks.every(tokOk) && toks.some(anchor);
    }
    function validName(n, buyerName) {
        if (!n || n.length < 2 || n.length > 25) return false;
        if (!looksLikeName(n, buyerName)) return false;
        if (!/[가-힣A-Za-z]/.test(n)) return false;
        if (BAD.test(n) || NOTNAME_SUB.test(n)) return false;
        const toks = n.split(' ');
        if (toks.some(t => NOTNAME_TOKEN.test(t) || (t.length >= 3 && NOTNAME_TOKEN.test(t.replace(TOKEN_PARTICLE, ''))))) return false;   // 요청 단어·대명사·물건 말은 이름이 아님(「김수정」·「김동일」·「나은」은 통과)
        if (toks.some(t => TOKEN_SENTENCE.test(t))) return false;   // 조사·어미로 끝나는 단어가 있으면 문장이지 이름이 아님
        return true;
    }
    // 반환: null(요청 없음) | { ambiguous:true, rule } | { name, phone|null, rule:'A'|'A2'|'B'|'C' }
    function parseSender(memoRaw, buyerName) {
        const memo = String(memoRaw || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!memo) return null;
        // 규칙 A: 보내는이 단어 + 이름 + (끝 | 번호 | 「으로 변경·표기…」)
        const km = memo.match(KEY);
        if (km) {
            // #455: 받는 분 이야기가 섞였거나(「받는분 ○○, 보내는분 ○○」) 보내는이가 두 번 나오면(상자마다 다른 보내는이) 사람이 봐야 한다
            if (/받는|수취인|수령인/.test(memo) || (memo.match(new RegExp(KEY.source, 'g')) || []).length >= 2) return { rule: 'A?', ambiguous: true };
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
            // #455: 「김미로 변경」처럼 띄어쓰기 없이 붙은 「로」를 떼고 남은 마지막 단어가 두 글자 이하면 이름 끝 글자인지 조사인지 알 수 없다 → 애매(「정중구로 변경」은 세 글자라 통과)
            const bareRo = cut >= 0 && /^로/.test(head.slice(cut)) && nm.split(' ').pop().length <= 2;
            // #455: 번호는 이름 바로 뒤(구분 기호·「연락처/번호」 말만 사이에 있을 때) 또는 「보내는 번호」라고 적혔을 때만 보내는이 번호로 본다 — 그 밖의 번호(받는 분·부재 시 연락처)는 버린다(이름만 적용)
            const gap = pm ? rest.slice(cut >= 0 ? cut : head.length, pm.index) : '';
            const phoneOk = !!pm && (/^[\s(\[:：\-.,/·]*(?:(?:연락처|전화번호|전화|번호|핸드폰|휴대폰|폰|HP|H\.P|TEL|tel|T)[\s:：.]*)?$/.test(gap) || /보내는\s*(?:이|사람|분)?\s*(?:번호|연락처|전화)|발신\s*번호/.test(gap));
            if (validName(nm, buyerName) && !trailing && !bareRo && tokN <= 3 && !(generic && (tokN > 1 || !PARTICLE.test(head.slice(cut))))) return { rule: 'A', name: nm, phone: phoneOk ? pm[1] + '-' + pm[2] + '-' + pm[3] : null };
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
                if (validName(nm, buyerName) && nm.split(' ').length <= 4) return { rule: segs.length === 1 ? 'B' : 'C', name: nm, phone: null };
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
