// #508 최종발주 — 순수 로직(화면·DOM·전역 XLSX 의존 0 · node 에서도 require). 설계서 = docs/superpowers/specs/2026-10-04-final-order-design.md §5~§8
//   송장변환 v2(invoice-v2.js)가 하는 판정은 건드리지 않는다. 이 파일이 맡는 일 = v2 앞단(메모 줄 다듬기 · 직원 보내는이 지정)과 뒷단(현금파일 대조 · 거래처 나누기 · 정렬 · 13칸 · 수량 표).
//   원칙: 받는 분·주소·옵션·수량 글자는 주문·현금파일에서 그대로 옮긴다 · 애매하면 자동으로 넣지 않고 카드 재료(ambiguous·notes)로 돌려준다.
//   prepLines 는 v2 parseLines(invoice-v2.js 89~117)와 같은 줄 읽기 규칙을 전제로 한다 — 그쪽 규칙이 바뀌면 여기 readLine·parseDate 도 같이 본다.
(function (root) {
    const DEFAULT_MEMO = '고객님의 소중한 물건으로 파손주의 부탁드리겠습니다.!';
    const HEADERS = ['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처', '박스타입(입력x)', '보내는이 변경주소'];
    const WIDTHS = [20.6, 14.9, 51.3, 18.3, 60.9, 6.1, 15.3, 15.3, 69.4, 72.5, 13.6, 13.6, 17.3];
    const PLACEHOLDER = new Set(['01000000000', '0000000000', '00000000000']);   // 선물하기 등 번호 비공개 주문의 자리표시 — 어떤 대조에도 쓰지 않는다(v2 와 같은 목록)
    const CAT_RGB = { yellow: 'FFFF00', orange: 'F4B183', blue: 'BDD7EE', green: 'C6E0B4', pink: 'F4CCCC' };   // 중간발주 색표(#502 · styles.css .qty-cat-*)
    const dg = v => String(v == null ? '' : v).replace(/\D/g, '');
    const validDigits = d => d.length >= 8 && !PLACEHOLDER.has(d);
    const cmpOpt = (a, b) => { const c = a.localeCompare(b, 'ko'); return c !== 0 ? c : (a < b ? -1 : a > b ? 1 : 0); };   // v2 정렬과 같은 가나다순 · 같은 값 판정은 글자 그대로

    // ── 서식(시트1: app.js exportInvoiceExcel · invoice-v2.js markSheet1 과 같은 꼴) ─────────────────────────
    const BORDER = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    const ST_BASE = { border: BORDER, font: { name: '맑은 고딕', sz: 11 }, alignment: { vertical: 'center' } };
    const ST_YELLOW = { border: BORDER, font: { name: '맑은 고딕', sz: 11 }, fill: { fgColor: { rgb: 'FFFF00' } }, alignment: { vertical: 'center' } };
    const ST_BLUE = { border: BORDER, font: { name: '맑은 고딕', sz: 11, bold: true, color: { rgb: '1F4E79' } }, fill: { fgColor: { rgb: 'DDEBF7' } }, alignment: { vertical: 'center' } };
    const headStyle = rgb => ({ fill: { fgColor: { rgb } }, font: { bold: true, name: '맑은 고딕', sz: 11 }, border: BORDER, alignment: { horizontal: 'center', vertical: 'center' } });
    const HEAD_FILL = ['92D050', '92D050', '92D050', 'FFFF00', 'FFFF00', 'FFFF00', 'FFFF00', 'FFFF00', 'FFFF00', 'FFFF00', 'FFFF00', '92D050', 'FFFF00'];
    const fillRgb = s => (s && ((s.fill && s.fill.fgColor && s.fill.fgColor.rgb) || (s.fgColor && s.fgColor.rgb))) || '';

    // ── 날짜·줄 읽기(v2 와 같은 규칙) ─────────────────────────────────────────────────────────────────────
    const isoOf = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return isNaN(dt) ? null : dt.toISOString().slice(0, 10); };
    // v2 parseDate(invoice-v2.js 69~86) 그대로: 9/20/26 · 2026-09-20 · 9.20 · 9월 20일 · 20일 · 오늘/내일
    function parseDate(s, today) {
        s = String(s || '').trim(); if (!s) return null;
        const ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
        if (/^오늘$/.test(s)) return today;
        if (/^내일$/.test(s)) return new Date(Date.parse(today) + 86400e3).toISOString().slice(0, 10);
        let m, y = null, mo = null, d = null;
        if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
        else if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})(?:[-./](\d{2,4}))?/))) { mo = +m[1]; d = +m[2]; if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
        else if ((m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/))) { mo = +m[1]; d = +m[2]; }
        else if ((m = s.match(/^(\d{1,2})\s*일/))) { d = +m[1]; mo = tm; if (d < td - 15) { mo = tm + 1; } }
        else return null;
        if (mo > 12 && d <= 12 && !y) return null;
        if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
        if (y == null) { y = ty; if (mo > 12) { mo -= 12; y++; } }
        let iso = isoOf(y, mo, d); if (!iso) return null;
        if (!m[3] && !/^\d{4}/.test(s) && Date.parse(iso) < Date.parse(today) - 300 * 86400e3) iso = isoOf(y + 1, mo, d);
        return iso;
    }
    const chOfText = t => /자사몰|카페|cafe/i.test(t) ? 'cafe24' : /쿠팡|coupang/i.test(t) ? 'coupang' : /네이버|스토어|스마트|naver/i.test(t) ? 'naver' : null;
    const HEADER_LINE = /^요청일자|전화번호 또는 상품주문번호|^플[렛랫]폼/;
    const EXAMPLE_LINE = /(?:^|["\t])\s*ex\)/i;   // 정리 파일 머리말의 예시 줄(「ex) 10박스 중 2박스 …」)이 딸려 와도 손대지 않는다
    const NOTE_DATE = /\d{1,2}\s*[\/.월]\s*\d{1,2}\s*일?|\d{1,2}\s*일|오늘|내일/;
    const WEEKDAY = /([월화수목금토일])\s*요일|([월화수목금토일])욜/g;
    const WD_IDX = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
    const hasKey = tok => { const d = dg(tok); return !!tok && (d.length >= 8 || /\d{8,}/.test(tok)); };
    // 한 줄을 v2 와 같은 방식으로 칸으로 나눈다. form: tab(요청일자⇥번호⇥비고⇥플랫폼) · tabkey(번호가 첫 칸) · sp-date(날짜 번호 비고…) · sp-key(번호 비고…)
    function readLine(line, today) {
        if (line.includes('\t')) {
            const c = line.split('\t').map(s => s.trim());
            const date = parseDate(c[0], today);
            if (!date && c[0] && /\d{8,}/.test(c[0].replace(/\D/g, ''))) {
                // 첫 칸이 번호인 줄(엑셀에서 빈 요청일자 칸이 잘려 들어온 꼴): v2 는 비고 = 둘째+셋째 칸, 플랫폼 = 넷째(없으면 셋째) 칸으로 읽는다. 셋째 칸이 플랫폼 낱말뿐이면 비고에 겹쳐 넣지 않는다
                const platOnly = !c[3] && c[2] && c[2].length <= 6 && !!chOfText(c[2]);
                return { form: 'tabkey', c, date: null, key: c[0], note: platOnly ? (c[1] || '') : [c[1], c[2]].filter(Boolean).join(' '), plat: c[3] || c[2] || '', lead: '' };
            }
            return { form: 'tab', c, date, key: c[1] || '', note: c[2] || '', plat: c[3] || '', lead: date ? '' : c[0] };
        }
        const t = line.split(/\s+/);
        if (parseDate(t[0], today)) return { form: 'sp-date', t, date: parseDate(t[0], today), key: t[1] || '', note: t.slice(2).join(' '), plat: '', lead: '' };
        // 「금요일 010-… 발송」처럼 번호가 첫 낱말이 아닌 줄: v2 는 형식 오류로 읽는다. 요일을 날짜로 바꿀 수 있을 때만 여기서 번호를 찾아 쓴다(keyAt > 0)
        const keyAt = hasKey(t[0]) ? 0 : t.findIndex(hasKey);
        if (keyAt > 0) return { form: 'sp-key', t, date: null, key: t[keyAt], note: t.filter((_, i) => i !== keyAt).join(' '), plat: '', lead: '', keyAt };
        const note = t.slice(1).join(' '); const dm = note.match(NOTE_DATE);
        return { form: 'sp-key', t, date: dm ? parseDate(dm[0], today) : null, key: t[0], note, plat: '', lead: '', keyAt: 0 };
    }
    // spaced = 공백 줄을 공백 줄로 유지(맨 앞에 「M/D 」) — 기준일을 붙일 때. 요일을 날짜로 바꿀 때는 탭 줄로 낸다.
    function rebuild(f, dateText, note, spaced) {
        if (f.form === 'sp-key' && spaced && dateText) return [dateText, f.key, note].filter(Boolean).join(' ');
        if (f.form === 'tab') { const c = f.c.slice(); while (c.length < 3) c.push(''); if (dateText) c[0] = dateText; c[2] = note; return c.join('\t'); }
        if (f.form === 'tabkey') return dateText ? [dateText, f.key, note].concat(f.plat ? [f.plat] : []).join('\t') : (f.plat ? [f.key, note, '', f.plat] : [f.key, note]).join('\t');
        if (f.form === 'sp-date') return [f.t[0], f.key, note].filter(Boolean).join(' ');
        return dateText ? [dateText, f.key, note].join('\t') : [f.key, note].filter(Boolean).join(' ');
    }

    // ── 직원 메모의 보내는이 지정 읽기 ──────────────────────────────────────────────────────────────────
    const SENDER_KEY = /보내는\s*(?:이|사람|분)|보낸\s*(?:이|사람|분)|발신(?:자|인)?|발송인/;
    const RECIPIENT = /\(?\s*수취인\s*[:：]?\s*([가-힣]{2,5})(?:\s*만)?\s*\)?/;
    // 전화번호 꼴(0으로 시작 · 숫자 9~12자리). 더 긴 숫자(주문번호 등)의 일부는 번호로 보지 않는다 — 구형 브라우저를 위해 뒤돌아보기(lookbehind) 없이 앞 글자를 직접 본다
    function findPhones(text) {
        const s = String(text == null ? '' : text), re = /0\d{1,3}[\s\-.]?\d{3,4}[\s\-.]?\d{4}(?!\d)/g, out = []; let m;
        while ((m = re.exec(s))) { const n = dg(m[0]).length; if ((m.index === 0 || !/\d/.test(s[m.index - 1])) && n >= 9 && n <= 12) out.push({ text: m[0], index: m.index, digits: dg(m[0]) }); }
        return out;
    }
    const TAIL = /^(으로|이라고|라고|로)?(\s*)(?:꼭\s*)?(변경|표기|기재|기입|수정|바꿔|바꾸|해\s*주|부탁|요청|적어|써\s*주|넣어)/;
    // 꼬리가 요청 말로만 이루어졌는가(「으로 변경 부탁드립니다」「라고 적어주세요」) — 요청 낱말(+어미)의 나열과 문장부호뿐
    const TAIL_ONLY = /^(?:으로|이라고|라고|로)?\s*(?:꼭\s*)?(?:(?:변경|표기|기재|기입|수정|바꿔|바꾸|해\s*주|부탁|요청|적어|써\s*주|넣어|보내)[가-힣]*[\s.,!~^]*)+$/;
    const TAIL_PLAT = /\s+(네이버|스마트스토어|스토어|자사몰|쿠팡)\s*$/;
    const INDIV = /입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제/i;   // v2 가 개별발송으로 읽는 말
    const INDIV_WORD = /개별\s*발송/;
    const OTHER_ORDER = /개별\s*발송|입력\s*[oO○0]?\s*[·,]?\s*삭제|메모\s*무시/;   // 날짜가 없어도 v2 에 넘겨야 하는 다른 지시
    const SPLIT_NOTE = /\d+\s*(?:박스|상자|개)\s*중\s*\d+\s*(?:박스|상자|개)?|(?:\d+|한|두|세|네)\s*(?:박스|상자)\s*(?:는|은|만)|나머지/;
    function fmtPhone(raw) {
        const d = dg(raw);
        if (d.length === 11) return d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
        if (d.length === 12) return d.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3');
        if (d.length === 10) return d.startsWith('02') ? d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3') : d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
        if (d.length === 9 && d.startsWith('02')) return d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3');
        return String(raw).trim();
    }
    const hasBatchim = ch => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c <= 11171 ? c % 28 : -1; };   // 0 = 받침 없음 · 8 = ㄹ · -1 = 한글 아님
    // seg = 보내는이 낱말 바로 뒤부터의 글 → { name, phone, addr, ambiguous, why }
    function readSender(seg, keyCount) {
        let r = String(seg || ''), why = '', extra = '';   // extra = 이름 뒤에 남은, 뜻을 알 수 없는 글(주소처럼 생겼으면 주소 후보로 돌려준다)
        const amb = w => { if (!why) why = w; };
        const MORE = '「주소」 낱말 없이 이름 뒤에 글이 더 있어요. 이름과 주소를 확인해 주세요.';
        if (keyCount >= 2) amb('보내는이가 한 줄에 두 번 적혀 있어요.');
        // 조사(은·는·을·를)는 낱말에 붙어 있고 뒤가 빈칸·기호일 때만 뗀다(「보내는이 은지원」「주소 은평구」의 첫 글자를 먹지 않게)
        r = r.replace(/^(?:은|는|을|를)(?=[\s:：=])/, '').replace(/^\s*(?:이름|성함)(?:은|는|을|를)?(?=[\s:：=]|$)/, '').replace(/^[\s:：=\-ㅡ—>→,.]+/, '').replace(/^(?:변경|표기|수정)\s*[:：]?\s+/, '');
        let addr = '';
        const am = r.match(/주소(?:(?:는|은)(?=[\s:：=]))?\s*[:：=]?\s*/);
        if (am) { addr = r.slice(am.index + am[0].length).trim(); r = r.slice(0, am.index); if (!addr) amb('「주소」 뒤에 적힌 글이 없어요.'); }
        let phone = '';
        const pm = findPhones(r)[0];
        let name = r;
        if (pm) {
            phone = fmtPhone(pm.text); name = r.slice(0, pm.index);
            const afterRaw = r.slice(pm.index + pm.text.length), after = afterRaw.replace(/연락처|전화번호|전화|번호|핸드폰|휴대폰|[\s,.()\-:：/|·]/g, '');
            if (after) { amb(am ? '번호와 주소 사이에 다른 글이 있어요.' : '「주소」 낱말 없이 번호 뒤에 글이 더 있어요. 주소인지 확인해 주세요.'); if (!am) extra = afterRaw; }
        }
        name = name.replace(/[<>〈〉《》「」『』'"‘’“”`\[\]]/g, ' ').replace(/[\s,(:：\-/|·]*(?:연락처|전화번호|전화|번호|핸드폰|휴대폰|HP|H\.P|TEL|tel)?[\s:：(\-/|·]*$/, '');
        // 「○○○으로 변경」「○○○ 변경」 꼬리를 뗀다. 가장 앞의 꼬리에서 자르되 앞부분이 한 글자면 이름 속 글자(「김수정」의 「수정」)로 보고 다음 꼬리로.
        //   조사도 빈칸도 없이 붙은 꼬리는 「변경·표기·기재」만 인정(「남궁수정」을 「남궁」으로 자르지 않게).
        //   붙여 쓴 「로」는 앞 글자에 받침이 있으면(ㄹ 제외) 조사일 수 없으니 이름 글자로 둔다(「김성로 변경」). 받침이 없고 남는 낱말이 두 글자 이하면 알 수 없음 → 애매(「김미로 변경」).
        for (let i = 1; i <= name.length; i++) {
            const m = name.slice(i).match(TAIL); if (!m) continue;
            let head = name.slice(0, i); if (head.trim().length < 2) continue;
            const glued = !m[1] && !m[2] && !/\s$/.test(head);
            if (glued && !/^(?:변경|표기|기재)/.test(m[3])) continue;
            // 꼬리 뒤가 요청 말뿐일 때만 확실(「으로 변경 부탁드립니다」). 다른 글이 더 있으면(「꼭 부탁드립니다 빠르게」) 애매 — 이름은 앞부분까지만 읽어 둔다
            if (!TAIL_ONLY.test(name.slice(i))) { amb(MORE); extra = name.slice(i) + ' ' + extra; }
            if (m[1] === '로' && !/\s$/.test(head)) {
                const b = hasBatchim(head.slice(-1));
                if (b > 0 && b !== 8) head += '로';
                else if (head.trim().split(/\s+/).pop().length <= 2) amb('이름 끝의 「로」가 이름 글자인지 조사인지 알 수 없어요.');
            }
            name = head; break;
        }
        const tidy = s => s.replace(/으로\s*$/, '').replace(/\s*(?:드림|올림)\s*$/, '').replace(/[\s.,!~\-ㅡ:：/|·]+$/, '').replace(/^[\s.,:：\-ㅡ/|·]+/, '').replace(/\s+/g, ' ').trim();
        name = tidy(name);
        // 이름 자리에 다른 글이 섞인 꼴 = 애매. 이때 이름은 첫 덩어리만 남기고 나머지는 extra 로(카드 입력칸에 미리 채울 값 — 사람이 고쳐 확정)
        const mixed = !name ? '' : name.length > 20 ? '이름이 20자를 넘어요. 이름 뒤에 다른 글이 붙었는지 확인해 주세요.'
            : /\d/.test(name) ? MORE
            : /발송|도착|배송|요일|오늘|내일/.test(name) ? '보내는이 이름 뒤에 발송 지시로 보이는 글이 있어요. 이름을 확인해 주세요.'
            : (!am && /[가-힣]+(?:특별시|광역시|시|군|구)\s+[가-힣]+(?:시|군|구|읍|면|동|로|길)(?:\s|$)/.test(name)) ? MORE
            : name.split(' ').length > 4 ? '이름 뒤에 글이 더 있어요. 어디까지가 이름인지 확인해 주세요.' : '';
        if (!name) amb('보내는이 이름이 적혀 있지 않아요.');
        else if (mixed) { amb(mixed); const tk = name.split(' '); if (tk.length > 1) { extra = tk.slice(1).join(' ') + ' ' + extra; name = tk[0]; } }
        // 「주소」 낱말이 없을 때 남은 글이 주소처럼 생겼으면 주소 후보로(자동 적용은 안 됨 — ambiguous)
        if (!addr && why) { const ex = tidy(extra); if (ex && /\d|[가-힣](?:특별시|광역시|시|군|구|읍|면|동|로|길)(?:\s|$)/.test(ex) && !/발송|도착|배송|요일|부탁|주세요/.test(ex)) addr = ex; }
        return { name, phone: phone || null, addr: addr || null, ambiguous: !!why, why };
    }

    // ── 손님 메모의 보내는이 — 카드 입력칸 미리 채움(#512) ────────────────────────────────────────────
    //   자동 적용이 아니라 사람이 확인하는 값이다(v2가 애매하다고 안 바꾼 주문 · 이름만 적힌 메모). 9/15 실파일 애매 12건을 완성본 A칸과 대조해 정했다.
    //   name: 보내는이 낱말 바로 뒤 글자를 번호·닫는 괄호·줄바꿈·마침표 앞까지. 「A/B」「A,B」 두 이름·상호+이름은 그대로. 「상호 ( 이름 번호 )」처럼 괄호 안에 사람 이름이 있으면 그 이름.
    //         못 찾으면 메모에 구매자 이름이 있을 때 구매자 이름. phone: 메모에 전화번호가 정확히 하나일 때만.
    //   nameOnly: 보내는이 낱말 없이 메모가 이름·상호 한 덩어리뿐일 때(사람은 이것을 보내는이로 처리한다) — 아주 좁게: 성씨+이름 글자 3~4자(두 글자는 구매자 이름일 때만) · 「○○○ 드림/올림」 · 법인 표식+이름.
    const HINT_SURNAMES = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육맹제모탁국어은편용';   // = invoice-sender.js SURNAMES
    const HINT_GIVEN = '가강건경고관광구국권규균근금기길나남녀노다단달담대덕도돈동두라락란람래량려련렬령례로록룡류률리린림마만명모목무문미민박배백범병보복봉부비빈사산삼상서석선설섭성세소솔송수숙순슬승시식신실심아안애양언엄여연열염엽영예오옥온완왕용우욱운웅원월위유윤율은을음의이익인일임자잔장재전정제조종주준중지진찬창채천철초춘충치태택평표필하학한해향헌혁현형혜호홍화환황회효후훈휘희흥겸결곤교군랑루얀요울탁흠협';   // = invoice-sender.js GIVEN
    const HINT_NOTNAME = /^(?:문앞|문앞에|조심|조심히|안전|안전히|배송|배송전|선물|선물용|현관|현관앞|주의|전화|연락|문자|정문|후문|경비실|부재시|부재|감사|감사합니다|이상무|고객|성함|주문|주소|직접|수령|전달|보관|상온|냉장|신선|제주|서울|하우스|황금향|한라봉|천혜향|유의|유선|소중|정성|정성껏|신속|이유식|차례상|한가위|명절|추석)$/;
    const HINT_CORP = /\(주\)|㈜|\(유\)|\(사\)|\(재\)|주식회사|유한회사/;
    const personWord = (w, buyer) => {
        const t = String(w || ''); if (!/^[가-힣]{2,4}$/.test(t) || HINT_NOTNAME.test(t)) return false;
        if (buyer && t === buyer) return true;
        if (t.length === 2) return false;   // 두 글자는 「이유」「정말」 같은 낱말과 구별할 수 없다 — 구매자 이름일 때만
        const given = /^(?:남궁|황보|제갈|선우|독고|사공|서문)/.test(t) ? t.slice(2) : HINT_SURNAMES.includes(t[0]) ? t.slice(1) : null;
        return !!given && given.length >= 1 && given.split('').every(ch => HINT_GIVEN.includes(ch));
    };
    const HINT_REQ = /^(?:꼭\s*)?(?:적어|써|해\s*주|해주|넣어|표기|기재|기입|변경|수정|바꿔|부탁|바랍|바래|주세요|요청)/;   // 요청 말로 시작
    const HINT_REQ_END = /(?:주세요|부탁|부탁드립니다|부탁드려요|바랍니다|바래요|변경|해주|해 주)\s*$/;                       // 요청 말로 끝남
    const HINT_GREET = /^(?:즐거운|즐겁|행복|건강|감사|고맙|추석|명절|한가위|새해|풍성|풍요|넉넉|좋은|따뜻|늘|항상|올해|메리|해피|잘|맛있게|맛있는)/;   // 인사말·덕담이 시작되는 낱말
    const HINT_ENDING = /(?:세요|니다|해요|에요|어요|아요|네요|구요|고요)[.!~^]*$/;                                                      // 문장으로 끝나는 낱말(「보내세요」「되세요」「드립니다」)
    const HINT_REGION = /(?:특별시|광역시|특별자치시|특별자치도|시|도)$|^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/;   // 주소가 시작되는 낱말
    const HINT_TITLE = /^(?:대표이사|대표님|대표|이사장|이사|사장님|사장|회장님|회장|원장님|원장|본부장|팀장|과장|부장|차장|실장|소장|교수님|교수|목사님|목사)$/;
    const hintTidy = s => String(s || '').replace(/[<>〈〉《》「」『』'"‘’“”`\[\]]/g, ' ').replace(/\s*(?:드림|올림)\s*$/, '').replace(/^[\s.,:：\-ㅡ=>→/|·ㆍ]+/, '').replace(/^\((?![주유사재]\))\s*/, '').replace(/[\s.,!~^♡♥\-ㅡ:：/|·ㆍ(]+$/, '').replace(/\s+/g, ' ').trim();
    function senderHint(memoRaw, buyerName) {
        const raw = String(memoRaw == null ? '' : memoRaw), buyer = String(buyerName || '').replace(/\s/g, '');
        const memo = raw.replace(/\r/g, '').trim(); const flat = memo.replace(/\s+/g, ' ').trim();
        const phones = findPhones(flat); const phone = phones.length === 1 ? fmtPhone(phones[0].text) : '';
        const buyerIn = buyer && flat.replace(/\s/g, '').includes(buyer) ? buyer : '';
        if (!flat) return { name: '', phone: '', nameOnly: false };
        const km = memo.match(SENDER_KEY);
        if (km) {
            // #517(설날 실자료): 낱말 뒤의 「 은 」(띄어 쓴 조사) · 「;」 「_」 · 「변경-」 「변경:」 라벨도 뗀다(「보낸사람 ; ○○○」 「(보내는이_○○ ○○○팀장)」 「보내는사람 은 ○○」 「발송인 변경-○○○」)
            let r = memo.slice(km.index + km[0].length).replace(/^(?:은|는|을|를)(?=[\s:：=])/, '').replace(/^[ \t]+(?:은|는|을|를)(?=[ \t])/, '').replace(/^\s*(?:이름|성함|명)(?:은|는|을|를)?(?=[\s:：=]|$)/, '').replace(/^[ \t:：;_=\-ㅡ—>→,.]+/, '').replace(/^(?:변경|표기|수정)\s*(?:요청|부탁)?\s*[:：\-ㅡ→>]\s*(?=[가-힣(㈜])/, '');
            r = r.split('\n')[0];                                    // 줄바꿈 앞까지
            const pm = findPhones(r)[0]; if (pm) r = r.slice(0, pm.index);   // 번호 앞까지
            r = r.split(/[.!?]/)[0];                                 // 마침표(인사말) 앞까지
            const reqOnly = !r.trim() || TAIL_ONLY.test(r) || HINT_REQ.test(r.trim());   // 낱말 뒤(그 줄)에 이름이 없다
            if (TAIL_ONLY.test(r) || HINT_REQ.test(r.trim())) r = '';   // 낱말 뒤가 요청 말뿐(「보내는사람 적어주세요」) = 이름이 아니다 → 낱말 앞쪽을 본다
            for (let i = 1; i <= r.length; i++) {                    // 「으로 변경 부탁」 꼬리 — readSender 와 같은 기준(앞부분이 두 글자 이상 · 붙은 꼬리는 변경·표기·기재만)
                const m = r.slice(i).match(TAIL); if (!m) continue;
                const head = r.slice(0, i); if (head.trim().length < 2) continue;
                if (!m[1] && !m[2] && !/\s$/.test(head) && !/^(?:변경|표기|기재)/.test(m[3])) continue;
                r = head; break;
            }
            let name = '';
            const corp = HINT_CORP.test(r); const po = corp ? -1 : r.indexOf('(');
            if (po >= 0) {                                          // 「상호 ( 이름 」·「(이름, 」 — 괄호 안이 사람 이름이면 그 이름, 아니면 괄호 앞 글
                const inner = hintTidy(r.slice(po + 1).split(')')[0]), outer = hintTidy(r.slice(0, po));
                name = (!outer || personWord(inner.replace(/\s/g, ''), buyer)) ? inner : outer;
            } else name = corp ? hintTidy(r) : hintTidy(r.split(')')[0]);
            const tk = name.split(' '); if (tk.length > 1 && tk.every(x => /^[가-힣]$/.test(x))) name = tk.join('');   // 「류 현」 → 「류현」(완성본도 붙여 적는다 · v2 와 같음)
            // 사람이 그대로 [이대로 넣기]를 누르면 A칸에 들어가므로 짧게 맞춘다: ①이름 뒤 인사말·덕담은 뗀다 ②이름 앞 주소 낱말(○○시 ○○구 …)은 뗀다
            { let w = name.split(' ').filter(Boolean);
              if (w.slice(1).some(t => HINT_GREET.test(t) || HINT_ENDING.test(t))) { const cut = w.findIndex((t, i) => i >= 1 && (HINT_GREET.test(t) || HINT_ENDING.test(t) || (/[운한은는을를의]$/.test(t) && !personWord(t, buyer)))); if (cut >= 1) w = w.slice(0, cut); }
              if (w.length > 1 && HINT_REGION.test(w[0]) && !HINT_CORP.test(w[0])) { while (w.length && w[0] !== buyer && !HINT_CORP.test(w[0]) && (HINT_REGION.test(w[0]) || /\d/.test(w[0]) || (/(?:구|군|읍|면|동|리|로|길)$/.test(w[0]) && !personWord(w[0], buyer)))) w.shift(); }   // 「서울시」는 이름 글자 꼴이어도 주소 · 「홍길동」처럼 사람 이름이면 「동」으로 끝나도 남긴다
              name = w.join(' '); }
            if (/받는|주소|카톡|톡톡|메일|문자|연락|배송|발송/.test(name)) name = '';                // 「보내는분·받는분 주소는 카톡으로」 같은 글은 이름이 아니다
            else if (/\d/.test(name) || name.length > 20) { const first = name.split(' ')[0]; name = /^[가-힣()㈜]{2,12}$/.test(first) ? first : ''; }   // 이름 뒤에 주소·숫자가 이어진 꼴 = 첫 덩어리만
            if (HINT_REQ.test(name) || HINT_REQ_END.test(name)) name = '';                            // 요청 말로 시작하거나 끝나는 글은 이름이 아니다
            // 이름이 낱말 앞에 온 꼴: 「○○○(으)로 보내는사람 적어주세요」 「○○○ 이름으로 보내는 사람 …」 — 조사 바로 앞 낱말이 사람 이름(또는 구매자 이름·법인 표식)일 때만
            if (!name) {
                const before = memo.slice(0, km.index).split('\n').pop(); const cut = before.replace(/\s*(?:이름|성함)?\s*(?:으로|이라고|라고|로)\s*$/, '');
                if (cut !== before) { const tok = hintTidy(cut).split(' ').pop() || ''; if (personWord(tok, buyer) || HINT_CORP.test(tok)) name = tok; }
            }
            // #517: 이름이 다음 줄에 오는 꼴(「보내는사람 변경부탁드립니다. ⏎ ⏎ ○○○ ⏎ 010-…」) — 낱말 줄에 이름이 없을 때만, 바로 다음 글 줄이 이름(사람 이름 · 법인 표식)일 때만
            if (!name && reqOnly) {
                const next = memo.slice(km.index).split('\n').slice(1).map(x => x.trim()).filter(Boolean)[0] || ''; const np = findPhones(next)[0];
                const cand = hintTidy(np ? next.slice(0, np.index) : next), cw = cand.split(' ').filter(Boolean);
                if (cand && cw.length <= 3 && cand.length <= 20 && !/\d/.test(cand) && !HINT_REQ.test(cand) && !HINT_REQ_END.test(cand) && (personWord(cw[cw.length - 1], buyer) || HINT_CORP.test(cand))) name = cand;
            }
            // #517: 「○○○님 으로 부탁」 — 사람 이름 뒤의 「님」은 뗀다(「대표님」 같은 직함은 그대로)
            if (/님$/.test(name)) { const base = name.slice(0, -1).trim(); if (personWord(base.split(' ').pop(), buyer)) name = base; }
            return { name: name || buyerIn, phone, nameOnly: false };
        }
        // 보내는이 낱말은 없지만 줄(문장) 끝이 「○○○ 드림/올림」인 메모(인사말 + 맺음) — 그 맺음 앞 글을 이름 후보로
        //   #517(설날 실자료): 맺음 뒤에 닫는 기호(「)」 「>」 「_」)나 요청 꼬리(「드림 으로 보내주세요」)가 붙은 꼴 · 맺음 앞이 여는 기호(「(」 「<」 「-」)로 끊긴 꼴도 읽는다
        //   — 「감사합니다(○○드림)」 「<○○○ 드림> 으로 보내주세요」 「…받으세요-○○드림」 「(○○○,○○○ 올림)」. 두 이름(「A&B」 「A,B」)은 그대로 둔다.
        {
            const CLOSE_AFTER = /^[\s)>〉」』'"’”_\/~^♡♥\-.!]*(?:(?:으로|로|이라고|라고)\s*(?:꼭\s*)?(?:보내|변경|표기|기재|작성|적어|써|해\s*주|부탁)[가-힣\s.!~^]*)?$/;
            const multi = /\n/.test(memo) || /[.!?]/.test(flat.replace(/[.!?~^\s]+$/, ''));
            for (const line of memo.split('\n')) {
                const k = Math.max(line.lastIndexOf('드림'), line.lastIndexOf('올림')); if (k < 0) continue;
                const after = line.slice(k + 2); if (!CLOSE_AFTER.test(after)) continue;
                let before = line.slice(0, k); const sb = before.search(/[.!?][^.!?]*$/); if (sb >= 0 && before.slice(sb + 1).trim()) before = before.slice(sb + 1);
                const om = before.match(/[(<〈「『'"‘“\-–—_:：][^(<〈「『'"‘“\-–—_:：]*$/); const opened = !!(om && om[0].slice(1).trim());
                if (!(multi || opened || after.trim())) continue;   // 한 줄에 「○○○ 드림」뿐 = 아래 「이름뿐」 판정이 본다
                const nm = hintTidy(opened ? om[0].slice(1) : before);
                if (nm.length >= 2 && nm.length <= 20 && !/\d/.test(nm) && !nm.split(' ').some(w => HINT_NOTNAME.test(w))) return { name: nm, phone, nameOnly: false };
            }
        }
        // 보내는이 낱말이 없는 메모: 이름·상호 한 덩어리뿐인가
        if (!/\n/.test(memo) && flat.length <= 24 && !/\d/.test(flat) && !/[.!?]/.test(flat.replace(/[.!?~^\s]+$/, ''))) {
            const body = flat.replace(/[.!?~^\s]+$/, ''); const closing = /\s*(드림|올림)$/.test(body); const chunk = hintTidy(body);
            const words = chunk.split(' ');
            const person = words.length === 1 && personWord(chunk, buyer);
            // 「○○○ 드림」: 맺음 바로 앞 낱말(직함은 건너뜀)이 사람 이름일 때만 — 「경비실에 맡겨 드림」 같은 문장을 이름으로 읽지 않게
            const core2 = words.filter(w => !HINT_TITLE.test(w)); const lastW = core2[core2.length - 1] || '';
            const closed = closing && chunk.length >= 2 && chunk.length <= 16 && words.length <= 3 && !words.some(w => HINT_NOTNAME.test(w)) && personWord(lastW, buyer);
            const corpOne = HINT_CORP.test(chunk) && words.length <= 3 && chunk.replace(HINT_CORP, '').trim().length >= 2;
            if (person || closed || corpOne) return { name: chunk.replace(/^(?:주문자명?|구매자명?)\s*[:：]\s*/, ''), phone, nameOnly: true };   // #517: 「주문자: (주)○○ ○○○」의 라벨은 이름 칸에 넣지 않는다(판정은 종전 그대로 — 라벨을 떼고 다시 판정하지 않는다)
        }
        // #517: 보내는이 단서 낱말(senderCue) 뒤·앞의 이름 — 「보내시는 분 : ○○○」 「FROM: ○○○」 「보내는 곳 : ○○」 「○○○님이 보내셨습니다」
        {
            const cm = memo.match(CUE_KEY_AFTER);
            if (cm) { const sub = senderHint('보내는이' + memo.slice(cm.index + cm[0].length), buyerName); if (sub && sub.name) return { name: sub.name, phone, nameOnly: false }; }
            const bm = memo.match(/([가-힣A-Za-z()㈜]{2,12})\s*님이\s*보내/);
            if (bm) { const nm = hintTidy(bm[1]); if (personWord(nm, buyer) || HINT_CORP.test(nm)) return { name: nm, phone, nameOnly: false }; }
            // 서명 줄이 「상호·부서 + 구매자 이름」뿐이면 그 글 그대로(대표 9/18: 회사명·직함은 손님 원문 + 드림 · 9월 실자료 6건 모두 사람이 그대로 적음). 인사말에 붙은 이름은 이름만.
            if (buyerIn) for (const line of memo.split('\n')) {
                const t = line.trim().replace(/[\s\-_~^)\]>.!♡♥*/]+$/, ''); if (!t.endsWith(buyer)) continue;
                const chunk = t.split(/[\[(<\-_~:：.!?^♡♥*/]/).pop().trim(), words = chunk.split(/\s+/);
                if (words.length >= 2 && words.length <= 3 && chunk.length <= 16 && words[words.length - 1] === buyer && words.every(w => /^[가-힣A-Za-z0-9㈜&]{1,12}$/.test(w) && !HINT_GREET.test(w) && !HINT_ENDING.test(w) && !HINT_NOTNAME.test(w))) return { name: chunk, phone, nameOnly: false };
            }
        }
        return { name: buyerIn, phone, nameOnly: false };
    }

    // ── 보내는이 단서(#517) — v2 가 보내는이 판정을 하지 않은 메모 가운데 사람이 보내는이로 처리한 꼴. 자동 적용이 아니라 「보내는이 카드를 띄울지」의 신호다 ──
    //   senderCue(memo, buyerName) → null | { why }
    //   ⓐ보내는이 낱말의 다른 꼴: 「보내시는 분」 「보내는 곳」 「보낸는이·보내는 시람」(오타) 「FROM:」 「○○○님이 보내셨습니다/보냅니다」
    //   ⓑ구매자 본인 이름이 서명처럼 적힌 꼴: 줄(메모) 끝의 이름(「새해 복 많이 받으세요 _○○○」 「-상호 ○○○-」 「(○○○)」) · 이름만 있는 줄
    //   넣지 않는 것: 「주문자 ○○로 변경」 「주문자명 ○○ 표기」(9/18 대표 확정) · 보내는이 낱말·「드림/올림」이 있는 메모(v2 가 판정) · 받는 분 이야기가 있는 줄
    // #583-d(대표 10/8 실사고 「배송자명 ○○○ 으로 부탁드려요 (번호)」 — 카드 0 · 글이 배송메세지에 그대로): 보내는이를 가리키는 다른 낱말들. v2 는 이 낱말을 모르므로 자동이 아니라 「보내는이」 카드로(이름·번호 미리 채움)
    const CUE_NAME_KEY = /(?:배송|발송|발신)자\s*명|(?:배송자|발송자)(?=\s*[:：]|\s+[가-힣(㈜])(?!\s*(?:님|분|께|에게|한테|가\s|는\s|도\s))|보내는\s*자(?![가-힣])|송하인/;
    const CUE_KEY_AFTER = /(?:배송|발송|발신)자\s*명|(?:배송자|발송자)(?=\s*[:：]|\s+[가-힣(㈜])(?!\s*(?:님|분|께|에게|한테|가\s|는\s|도\s))|보내는\s*자(?![가-힣])|송하인|보내시는\s*분|보내는\s*곳|보낸는\s*(?:이|사람|분)|보내는\s*시람|보네는\s*(?:이|사람|분)|(?:FROM|From|from)(?=\s*[:：.]|\s+[가-힣(㈜])/;
    const CUE_SENT_BY = /[가-힣A-Za-z)]\s*님이\s*보내(?:셨|십|시는|는|드리는)|[가-힣A-Za-z)]\s*님이\s*보냅니다/;
    function senderCue(memoRaw, buyerName) {
        const memo = String(memoRaw == null ? '' : memoRaw).replace(/\r/g, '').trim(); const buyer = String(buyerName || '').replace(/\s/g, '');
        if (!memo || /주문자/.test(memo)) return null;
        if (CUE_NAME_KEY.test(memo)) return { why: '보내는 분을 적은 것으로 보이는 낱말(「배송자명」 「발송자명」 「송하인」)' };   // #583-d: v2 가 이미 판정한 주문(e.sender)에는 화면이 이 신호를 쓰지 않는다
        if (SENDER_KEY.test(memo) || /드림|올림/.test(memo)) return null;
        if (CUE_KEY_AFTER.test(memo)) return { why: '보내는 분을 적은 것으로 보이는 낱말(「보내시는 분」 「보내는 곳」 「FROM」 · 오타)' };
        if (CUE_SENT_BY.test(memo)) return { why: '「○○님이 보냅니다」 꼴' };
        if (buyer.length >= 2) {
            const esc = buyer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sign = new RegExp('(?:^|[\\s\\-_~(\\[<:：.,!^♡♥*/])' + esc + '[\\s\\-_~^)\\]>.!♡♥*/]*$');
            for (const line of memo.split('\n')) {
                const t = line.trim(); if (!t || /받는|수취인|수령인|고객|성함|이름|님께|에게|한테/.test(t)) continue;
                if (sign.test(t) && !(memo.replace(/\s/g, '') === buyer)) return { why: '메모에 구매자 이름이 서명처럼 적혀 있어요' };   // 메모 전체가 이름뿐인 것은 「이름뿐」 판정이 본다
            }
        }
        return null;
    }

    // 손님 메모의 날짜가 전부 기준 발송일인가(#512) — true 면 「그날 발송」이 곧 요청대로라 주문 확인 카드가 필요 없다. 조금이라도 다르면 false(카드 유지).
    //   조건: 날짜가 하나 이상 · 전부 기준일 · 요일이 적혀 있으면 기준일의 요일 · 도착·범위 말(도착·받·수령·까지·사이·~ …)과 다른 날짜 표현(늦게·다음주·주말 …)이 없음.
    //   #517(설날 실자료): ⓐ요일만 적은 요청(「수요일 발송 부탁」)도 그 요일이 기준일의 요일이고 발송·출고·배송 낱말이 있으면 참 ⓑ물결은 날짜·숫자 뒤에 올 때만 범위(「11일~」 「2/9~11」) — 문장 끝 「부탁드립니다~!」는 범위가 아니다
    //   ⓒ「배송」 낱말로 적은 요청(「2월 11일 배송 요청」)도 날짜가 기준일이면 참(도착·받·수령·까지 … 가 있으면 거짓) — 화면이 서버 확인형일 때도 이 함수를 부른다.
    const SD_BLOCK = /도착|받|수령|까지|전후|사이|이후|이전|전에|부터|안에|내로|이내|다음\s*주|다다음|다음\s*날|내일|모레|글피|주말|평일|늦게|천천히|나중|이번\s*주|일주일|연휴|추석|명절|한가위|오늘/;
    const SD_RANGE = /(?:\d|일|월|요일|욜|\))\s*[~∼〜]/;
    function sameDayOnly(memoRaw, shipDate) {
        const memo = String(memoRaw == null ? '' : memoRaw).replace(/\s+/g, ' ').trim();
        if (!memo || !/^\d{4}-\d{2}-\d{2}$/.test(String(shipDate || ''))) return false;
        // 「추석전 16일 경에 발송」처럼 날짜를 꾸미는 「추석 전·명절 전」은 그 날짜와 어긋나지 않는다(실물 9/15). 그 밖의 추석·명절·연휴 말은 다른 날짜 표현으로 본다
        //   인사말 「복 많이 받으세요」의 「받」은 도착 요청이 아니다(#517)
        if (SD_BLOCK.test(memo.replace(/(?:추석|명절|한가위|연휴)\s*전(?:에)?(?!후)/g, ' ').replace(/복\s*(?:많이|마니)?\s*받(?:으세요|으시|으십시|으셔)/g, ' ')) || SD_RANGE.test(memo)) return false;
        const sm = +shipDate.slice(5, 7), sd = +shipDate.slice(8, 10), wd = '일월화수목금토'[new Date(shipDate + 'T00:00:00Z').getUTCDay()];
        let rest = memo, found = 0, bad = false;
        const take = (re, fn) => { rest = rest.replace(re, (...m) => { found++; if (!fn(m)) bad = true; return ' '; }); };
        take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g, m => +m[1] === sm && +m[2] === sd);
        take(/(\d{1,2})\s*[\/.]\s*(\d{1,2})(?!\d|[.\/]\d)/g, m => +m[1] === sm && +m[2] === sd);
        if (/\d+\s*일\s*(?:후|뒤|간|동안|정도|만에|내)/.test(rest)) return false;   // 기간(「3일 후」)은 날짜가 아니다
        take(/(\d{1,2})\s*일/g, m => +m[1] === sd);
        if (bad) return false;
        if (/\d/.test(rest.replace(/\d+\s*(?:박스|상자|개|kg|과|호|동|층|번|시|분)/gi, ' '))) return false;   // 날짜로 못 읽은 숫자가 남으면 판단하지 않는다
        let m, days = 0; const W = /([월화수목금토일])\s*요일|\(\s*([월화수목금토일])\s*\)|([월화수목금토일])욜/g;
        while ((m = W.exec(memo))) { days++; if ((m[1] || m[2] || m[3]) !== wd) return false; }
        if (!found) return days > 0 && /발송|출고|출발|보내|배송/.test(memo);   // 날짜 없이 요일만(「수요일 발송 부탁」) — 그 요일이 기준일이고 발송 낱말이 있을 때만
        return true;
    }

    // ── 택배사 양식 배송메세지에서 「요청 글」 떼어 내기(#516) ─────────────────────────────────────────
    //   사람이 하던 방식: 보내는이를 바꿨거나 당일 발송 요청이면 그 요청 글은 지우고 기본 문구로 — 단 받는 분·기사에게 전하는 글(인사말·「문 앞」·동호수)은 남긴다.
    //   memoRest(memo, { sender, sameDay, buyerName }) → { rest, removed, sure }
    //     sender  = 이 주문은 보내는이를 바꾼다 → 보내는이 요청 부분을 뺀다        sameDay = 메모의 날짜가 전부 기준 발송일 → 당일 발송 요청 부분을 뺀다
    //     rest    = 요청 부분을 뺀 나머지 글('' = 남는 글 없음)                   removed = 뺀 글(카드에 보여 줄 용도)
    //     sure    = 뺀 부분이 「요청 글뿐인 문장(줄)」이라고 자신할 때만 true. 한 문장 안에 요청과 다른 글이 섞였거나, 뺄 부분을 못 찾았으면 false(화면은 카드로 보낸다).
    //   문장(줄) 단위로만 뺀다 — 문장 중간을 잘라 내는 일은 sure=false 일 때의 「미리 채움」뿐이다. 인사말을 요청 꼬리로 같이 지우지 않는다.
    const MR_KEY = /(?:배송|발송|발신)자\s*명|(?:배송자|발송자)(?=\s*[:：]|\s+[가-힣(㈜])(?!\s*(?:님|분|께|에게|한테|가\s|는\s|도\s))|보내는\s*자(?![가-힣])|송하인|보내는\s*(?:이|사람|분)|보낸\s*(?:이|사람|분)|발신(?:자|인)?|발송(?:인|자)/;
    const MR_QUOTE = /[<>〈〉《》「」『』'"‘’“”`\[\]]/g;
    const MR_PHONE_LABEL = /(?:연락처|전화번호|전화|번호|핸드폰|휴대폰|HP|H\.P|TEL|tel)\s*(?:는|은)?\s*[:：]?/g;
    const MR_PUNCT_ONLY = /^[\s.,!?~^♡♥()\-ㅡ:：/|·ㆍ*]*$/;
    const MR_REQ_WORDS = /으로|이라고|라고|변경|표기|기재|기입|수정|바꿔|부탁|드리겠습니다|드립니다|드려요|드릴게요|드리고|합니다|해\s*주시면|해\s*주시고|해\s*주세요|해서|보내\s*주세요|주세요|바랍니다|감사하겠습니다|요청|요망|꼭|로(?=\s|$)/g;   // 요청 꼬리에만 쓰이는 낱말(이 낱말들만 남은 줄 = 요청 꼬리)
    // 우리(판매자)에게 한 내용 없는 인사 — 이것만 남으면 남는 글로 치지 않는다. 받는 분에게 전하는 덕담(「즐거운 명절 보내세요」「건강하세요」)은 여기에 넣지 않는다
    const MR_COURTESY = /안녕하세요|안녕하십니까|감사합니다|감사드립니다|감사해요|고맙습니다|수고하세요|수고하십시오|수고\s*많으십니다|잘\s*부탁\s*드립니다|잘\s*부탁\s*드려요|잘\s*부탁\s*드릴게요|잘\s*부탁합니다|좋은\s*하루\s*(?:되세요|보내세요)|번창하세요/g;
    // 미리 채움에 남길 글(#517 완성본 기준): 기사에게 전하는 글 · 받는 분에게 전하는 인사 · 과수 지정(v2 가 옵션명으로 옮기지 않아 지우면 정보가 사라진다)
    const MR_DELIV = /문\s*앞|현관|경비|공동|비번|비밀번호|출입|[#*]\s*\d|\d\s*[#*]|부재|연락|문자|전화|통화|택배함|보관|맡겨|맡기|계단|엘리베이터|\d+\s*층|\d+\s*호|\d+\s*동|놓아|놔\s*주|두고|올려|벨|초인종|파손|조심|던지/;
    const MR_TO_RECV = /보내세요|보내시|되세요|되셔요|되시길|되십시오|받으세요|받으십시오|건강하|행복하|축하|사랑|쾌유|응원|힘내|즐거운|풍성한|새해|명절|한가위|추석|설날|생신|생일|드림|올림|[가-힣]{1,4}(?:이가|가)[\s!.~^]*$/;
    const mrKeepForCourier = seg => MR_DELIV.test(seg) || MR_TO_RECV.test(seg) || /\d+\s*(?:~|-|,)?\s*\d*\s*과(?![가-힣])|\d+\s*과로/.test(seg);
    // 이름(상호) 낱말: 한글·영문·법인 표식만. 인사말·문장 꼴·주소·지시 낱말이면 이름이 아니다
    const mrNameWord = w => /^[가-힣A-Za-z㈜()&.]{1,14}$/.test(w) && !HINT_GREET.test(w) && !HINT_ENDING.test(w) && !HINT_NOTNAME.test(w) && !/받는|주소|배송|발송|도착|출고|택배|선물|맛있|예쁜|좋은|것으로|부탁|주세요|감사|입니다|합니다/.test(w);
    //   낱말이 둘 이상인데 주소가 시작되는 낱말(「서울시」「충남」)이 끼어 있으면 이름이 아니다(「보내는 사람은 서울시 ○○구 ○○○ 으로 표기」)
    const mrNameOk = s => { const w = String(s || '').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean); return w.length >= 1 && w.length <= 3 && w.join('').length >= 2 && w.join('').length <= 20 && w.every(mrNameWord) && !(w.length > 1 && w.some(x => HINT_REGION.test(x) && !HINT_CORP.test(x))); };
    // 한 문장이 「보내는이 요청뿐」인가 → { strict, rest }  (strict=false 면 rest = 이름 뒤에 남는 글 추정)
    function mrSenderSeg(seg, buyer) {
        const s = String(seg || '').trim(), km = s.match(MR_KEY); if (!km) return null;
        const before = s.slice(0, km.index), after = s.slice(km.index + km[0].length);
        // 「보내는 번호 000 로 변경」
        const bn = after.match(/^\s*(?:번호|연락처|전화번호)\s*(?:는|은)?\s*[:：]?\s*/);
        if (bn && MR_PUNCT_ONLY.test(before)) { const ph = findPhones(after)[0]; if (ph) { const tail = after.slice(ph.index + ph.text.length); return { strict: !tail.trim() || TAIL_ONLY.test(tail.trim()) || MR_PUNCT_ONLY.test(tail), rest: '' }; } }
        // 이름이 앞에 오는 꼴: 「○○○(으)로 보내는사람 적어주세요」
        if (!MR_PUNCT_ONLY.test(before)) {
            const cut = before.replace(/\s*(?:이름|성함)?\s*(?:으로|이라고|라고|로)\s*$/, ''); const nm = hintTidy(cut.replace(MR_QUOTE, ' '));
            const reqAfter = !after.trim() || TAIL_ONLY.test(after.trim()) || (HINT_REQ.test(after.trim()) && TAIL_ONLY.test(after.trim().replace(/^(?:으로|로)\s*/, '')));
            if (cut !== before && reqAfter && nm.split(' ').length === 1 && (personWord(nm, buyer) || HINT_CORP.test(nm))) return { strict: true, rest: '' };
            return { strict: false, rest: s };   // 낱말 앞에 다른 글이 있다 — 어디까지가 요청인지 모른다(그대로 사람에게)
        }
        // 「보내는이 ○○○ [번호] [으로 변경 부탁]」
        let r = after.replace(/^(?:은|는|을|를)(?=[\s:：=])/, '').replace(/^\s*(?:이름|성함|명|변경\s*요청|변경요청)(?:은|는|을|를)?(?=[\s:：=(]|$)/, '').replace(/^[\s:：=\-ㅡ—>→,.]+/, '');
        const phones = findPhones(r); if (phones.length > 1) return { strict: false, rest: '' };
        if (phones.length) r = r.slice(0, phones[0].index) + ' ' + r.slice(phones[0].index + phones[0].text.length);
        r = r.replace(MR_PHONE_LABEL, ' ').replace(MR_QUOTE, ' ').replace(/\s+/g, ' ').trim();
        // 낱말 뒤가 비었거나 요청 말뿐(「보내는이」「보내는사람 변경부탁드립니다.」) — 이름이 다음 줄에 온다(부르는 쪽이 다음 줄을 본다). 번호만 적힌 경우는 이름을 더 찾지 않는다
        if (MR_PUNCT_ONLY.test(r.replace(MR_REQ_WORDS, ' '))) return { strict: true, rest: '', needName: !phones.length };
        let name = r, tail = '';
        for (let i = 1; i <= r.length; i++) {
            const m = r.slice(i).match(TAIL); if (!m) continue;
            const head = r.slice(0, i); if (head.trim().length < 2) continue;
            if (!m[1] && !m[2] && !/\s$/.test(head) && !/^(?:변경|표기|기재)/.test(m[3])) continue;
            name = head; tail = r.slice(i); break;
        }
        name = name.replace(/\s*(?:드림|올림)\s*$/, '').replace(/[\s.,!~^\-ㅡ:：/|·ㆍ]+$/, '').replace(/^[\s.,:：\-ㅡ/|·ㆍ]+/, '').trim();
        const tailOk = !tail.trim() || TAIL_ONLY.test(tail.trim()) || MR_PUNCT_ONLY.test(tail.replace(MR_REQ_WORDS, ' '));   // 「로 변경 부탁 드립니다^^」처럼 띄어 쓴 요청 꼬리도
        if (tailOk && mrNameOk(name) && !/[,/]/.test(name)) return { strict: true, rest: '' };
        // 애매: 이름 뒤에 남는 글을 추정해 돌려준다(카드 미리 채움용). 이름 = 구매자 이름 또는 첫 낱말
        const words = r.split(' ').filter(Boolean); let k = 0;
        const clean = w => w.replace(/[,()]/g, ''); const bi = buyer ? words.findIndex(w => clean(w) === buyer) : -1;
        if (bi >= 0) k = bi + 1;                                                                     // 구매자 이름이 있으면 그 낱말까지가 이름 쪽(앞의 주소·상호 포함)
        else if (words.length && HINT_REGION.test(words[0])) k = 0;                                   // 주소로 시작 — 어디까지인지 모른다(남는 글 추정 안 함)
        else if (words.length && personWord(clean(words[0]), buyer)) k = 1;
        else if (words.length > 1 && mrNameWord(words[0]) && personWord(clean(words[1]), buyer)) k = 2;
        let left = k ? words.slice(k).join(' ') : ''; left = left.replace(/^[\s,.)]+/, '');
        left = left.replace(/^(?:드림|올림)\s*\)?[\s,.]*/, '').replace(/[\s*★※]+$/, '');   // 「(보내는 이:○○○ 드림) 즐거운 명절…**」의 맺음·꾸밈 기호
        // 이름 바로 뒤의 요청 마디(「로 변경해 주세요 」「로 변경 부탁드리고 」)는 보내는이 부분이다 — 요청 낱말뿐인 마디가 끝나는 곳까지 뗀다
        { const m = left.match(/^(.*?(?:부탁\s*드리고|해\s*주시고|하시고|해\s*주세요|해주세요|보내\s*주세요|바랍니다|부탁\s*드립니다|부탁\s*드려요|부탁\s*드릴게요|부탁\s*드리겠습니다|부탁합니다|요청\s*드립니다|요청합니다))[\s,.!~^]*/); if (m && MR_PUNCT_ONLY.test(m[1].replace(MR_REQ_WORDS, ' '))) left = left.slice(m[0].length); }
        if (TAIL_ONLY.test(left) || MR_PUNCT_ONLY.test(left.replace(MR_REQ_WORDS, ' '))) left = '';
        return { strict: false, rest: left };
    }
    // 한 문장이 「당일 발송 요청뿐」인가(날짜가 기준일인지는 부르는 쪽이 sameDayOnly 로 이미 확인했다)
    //   #517: 「발송지정」「발송일:」「배송일 지정」「예약발송」「발송 희망일」「발송 요망」「배송되었으면 합니다」 · 「배송메모:」 머리 · 요일만 적은 꼴(「수요일 발송요청」)도
    const MR_DAY_WORDS = /(?:추석|명절|한가위|연휴|설)\s*전(?:에)?|배송\s*메모|메모|마지막|발송일|배송일|출고일|희망일|발송|날짜인|날짜는|날짜|일자|출고|출구|출발|배송|택배|보내|전부|모두|모든|꼭|반드시|가능하시면|가능하면|경에|경|쯤에|쯤|지정|예약|요망|되었으면|됐으면|되도록|하는\s*걸로|걸로|해\s*주세요|해\s*주시면|주세요|부탁\s*드려요|부탁\s*드립니다|부탁\s*드릴게요|부탁\s*드리겠습니다|부탁합니다|부탁해요|부탁|바랍니다|바래요|요청\s*드립니다|요청\s*드려요|요청합니다|요청|드리겠습니다|드립니다|드려요|감사하겠습니다|감사합니다|희망합니다|희망해요|희망|원합니다|원해요|입니다|합니다|으로|에는|에|로|은|는|이|가|을|를|날|요/g;
    const MR_WEEKDAY = /[월화수목금토일]\s*요일|\(\s*[월화수목금토일]\s*\)|[월화수목금토일]욜/g;
    function mrDaySeg(seg) {
        let s = String(seg || ''); const had = /\d{1,2}\s*월\s*\d{1,2}\s*일?|\d{1,2}\s*[\/.]\s*\d{1,2}|\d{1,2}\s*일/.test(s) || (/[월화수목금토일]\s*요일|[월화수목금토일]욜/.test(s) && /발송|출고|배송|보내/.test(s)); if (!had) return null;
        s = s.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일?/g, ' ').replace(/\d{1,2}\s*[\/.]\s*\d{1,2}(?!\d)\s*일?/g, ' ').replace(/\d{1,2}\s*일/g, ' ')
            .replace(/[월화수목금토일]\s*요일|\(\s*[월화수목금토일]\s*\)|[월화수목금토일]욜/g, ' ').replace(MR_QUOTE, ' ').replace(MR_DAY_WORDS, ' ');
        return { strict: !/[가-힣A-Za-z0-9]/.test(s) };
    }
    function memoRest(memoRaw, opt) {
        const memo = String(memoRaw == null ? '' : memoRaw).replace(/\r/g, ''); const o = opt || {}; const buyer = String(o.buyerName || '').replace(/\s/g, '');
        if (!memo.trim() || (!o.sender && !o.sameDay)) return { rest: memo.trim(), removed: '', sure: true };
        // 줄 → 문장(마침표·느낌표·물음표 뒤에 빈칸이나 줄 끝이 올 때만 끊는다 — 「010.1234.5678」「9.19일」은 끊지 않는다)
        const lines = memo.split('\n').map(line => line.replace(/([.!?]+[~^]*)(\s+|$)/g, '$1\u0001').split('\u0001').map(x => x.trim()).filter(Boolean));
        let sure = true, hitSender = false, hitKey = false, hitClose = false, hitDay = false, pend = false, closeUp = false; const removed = [];
        const out = lines.map(segs => {
            const keep = [];
            segs.forEach(seg => {
                if (o.sender) {
                    // 앞 줄이 「보내는이」 낱말뿐이었다 → 이 줄이 이름(상호)이면 보내는이 부분(「보내는사람 변경부탁드립니다. ⏎ □□□ ⏎ 000 ⏎ 으로 바꿔주세요」)
                    if (pend && !MR_KEY.test(seg) && !findPhones(seg).length) {
                        const nm = seg.replace(MR_QUOTE, ' ').replace(/[\s.,!~^\-ㅡ:：/|·ㆍ]+$/, '').replace(/\s*(?:드림|올림)$/, '').replace(/^[\s\-ㅡ:：]+/, '').trim();
                        if (mrNameOk(nm)) { pend = false; removed.push(seg); return; }
                        if (!MR_PUNCT_ONLY.test(seg.replace(MR_REQ_WORDS, ' '))) { pend = false; sure = false; }   // 이름이 아닌 글이 왔다 — 이름을 못 찾음
                    }
                    const r = mrSenderSeg(seg, buyer);
                    if (r) { hitSender = true; hitKey = true; removed.push(seg); if (r.needName) pend = true; if (!r.strict) { sure = false; if (r.rest) keep.push(r.rest); } return; }
                    // 「○○○ 드림(으)로 변경 부탁드립니다」「<○○○ 드림> 으로 보내주세요」 — 낱말 없이 맺음 꼴로 적은 보내는이 요청
                    { const q = seg.replace(MR_QUOTE, ' ').replace(/\s+/g, ' ').trim(), cm = q.match(/^(.*?)\s*(?:드림|올림)\s*(?:으로|이라고|라고|로)\s*(.*)$/);
                      if (cm && mrNameOk(cm[1].replace(/^[\s\-ㅡ(]+/, '').trim()) && MR_PUNCT_ONLY.test(cm[2].replace(MR_REQ_WORDS, ' '))) { hitSender = true; hitKey = true; removed.push(seg); return; } }
                    // 「연락처: 000」뿐인 줄 · 「○○○ 드림」뿐인 줄(맺음) — 보내는이 요청의 일부
                    const ph = findPhones(seg);
                    if (ph.length === 1 && MR_PUNCT_ONLY.test(seg.replace(ph[0].text, ' ').replace(/보내는\s*(?:이|사람|분)?/g, ' ').replace(MR_PHONE_LABEL, ' ').replace(MR_REQ_WORDS, ' '))) { removed.push(seg); hitSender = true; return; }
                    // 앞 줄의 보내는이 요청에서 줄이 바뀌어 넘어온 꼬리(「으로 변경 부탁 드립니다.」)
                    if (hitKey && MR_PUNCT_ONLY.test(seg.replace(MR_REQ_WORDS, ' '))) { removed.push(seg); return; }   // 「으로 변경 부탁 드립니다.」「기입해주세요.」
                    // 「○○○ 드림」뿐인 줄(맺음 · 번호가 괄호로 붙어도) — 다른 글(인사말)과 함께 있으면 사람은 맺음까지 그대로 남긴다 → 아래에서 되돌린다
                    const cs = ph.length === 1 ? seg.replace(ph[0].text, ' ').replace(/\(\s*\)/g, ' ').trim() : seg;
                    if (/(?:드림|올림)[\s.!~^♡♥\-]*$/.test(cs)) {
                        const nm = cs.replace(/[\s.!~^♡♥\-]+$/, '').replace(/\s*(?:드림|올림)$/, '').replace(MR_QUOTE, ' ').replace(/^[\s\-ㅡ]+/, '').trim();
                        if (mrNameOk(nm)) { removed.push(seg); hitSender = true; hitClose = true; if (/올림[\s.!~^♡♥\-]*$/.test(cs)) closeUp = true; return; }
                    }
                }
                if (o.sameDay) { const d = mrDaySeg(seg); if (d) { hitDay = true; removed.push(seg); if (!d.strict) { sure = false; keep.push(seg); } return; } }
                keep.push(seg);
            });
            return keep;
        });
        if (pend) sure = false;                                                               // 「보내는이」 낱말만 있고 이름 줄을 못 찾았다
        if ((o.sender && !hitSender) || (o.sameDay && !hitDay && !o.sender)) sure = false;   // 뺄 부분을 못 찾았다 → 사람에게
        const join = ls => ls.map(k => k.join(' ')).filter(Boolean).join('\n').replace(/^[\s,\-ㅡ/|·ㆍ]+/, '').replace(/[\s,\-ㅡ/|·ㆍ]+$/, '').trim();
        // 인사말 + 「○○○ 드림」 맺음: 완성본은 맺음까지 그대로 둔다(9/17·9/18 실물) → 아무것도 빼지 않고 사람에게
        if (hitClose && !hitKey && !hitDay && join(out)) return { rest: memo.trim(), removed: '', sure: false };
        // 메모 전체가 「○○○ 올림」: 완성본이 그대로 둔 실물이 있다(설 2/11) → 지우지 않고 사람에게(「○○○ 드림」은 기본 문구가 맞았다)
        if (closeUp && !hitKey && !hitDay) return { rest: memo.trim(), removed: '', sure: false };
        if (!removed.length) return { rest: join(out), removed: '', sure };
        // 메모에 「받는이 ㅡ 주소 · 이름 · 번호」를 따로 적은 꼴(받는 곳이 주문과 다르다는 뜻 — 사람이 처리) → 주소 조각을 미리 채우지 않는다
        if (/받는\s*(?:이|분|사람)/.test(memo)) return { rest: '', removed: removed.join(' / '), sure: false };
        // 남는 글 고르기(미리 채움): ①우리에게 한 내용 없는 인사(감사합니다·안녕하세요)는 남는 글이 아니다 ②기사·받는 분에게 전하는 글과 과수 지정만 남긴다 —
        //   판매자에게 한 부탁(「선물용입니다」「좋은 걸로」)을 뺐으면 사람이 확인해야 하므로 sure=false(자동 비움 조건은 넓히지 않는다)
        const picked = out.map(k => k.filter(seg => {
            if (MR_PUNCT_ONLY.test(seg.replace(MR_COURTESY, ' '))) return false;
            if (mrKeepForCourier(seg)) return true;
            sure = false; return false;
        }));
        return { rest: join(picked), removed: removed.join(' / '), sure };
    }

    // ── §5 메모 줄 다듬기 ────────────────────────────────────────────────────────────────────────────
    // 줄 수·줄 번호는 그대로(뺄 줄은 빈 줄). v2 가 이미 읽는 보통 줄은 한 글자도 바꾸지 않는다.
    // #548(대표 10/6 「010-…-… 2s」): 메모 줄의 「번호 + 사이즈」 — 사이즈 낱말(2S·S·M·L·2L · 「2s로」「2S 사이즈」「s사이즈로」)만 떼어 따로 돌려주고, 나머지 글은 종전 규칙으로 읽게 남긴다.
    //   줄 수는 그대로(사이즈뿐인 줄 = 빈 줄로). 번호가 없는 줄은 손대지 않는다. 어느 주문에 붙일지는 화면이 정한다(귤 품목만).
    // #570(대표 10/7 실사고): 「.2S사이즈」처럼 앞에 기호가 붙은 것도 읽고(「·」「,」「.」「/」), 「s사이즈 2건」의 「N건」은 그 손님 주문 건수를 적은 것이라
    //   따로 떼어(expect) 메모 줄에 남기지 않는다 — 남기면 「번호 2건」이 「오늘 발송·손님 메모 무시」 줄로 읽혀 손님 메모가 조용히 무시되고 건수 카드가 떴다.
    const SIZE_TOK = /(^|[ \t])[.,·/:;\-]*(2s|2l|s|m|l)[ ]*(?:사이즈|싸이즈|size)?[ ]*(?:으로|로)?!?[.,]?(?=$|[ \t])/i;
    const SIZE_CNT = /^(\d{1,2})건(?:만|은|씩)?$/;   // #601: 「1건만」「1건은」(직원 실제 글)
    const SIZE_FILLER = /^(?:사이즈|싸이즈|size|업그레이드|업글|요청|부탁|부탁해요?|부탁드려요?|부탁드립니다|해\s*줘요?|해주세요|로|으로|요)[!.]*$/i;
    // #583(대표 10/8 「번호 업그레이드」): 사이즈 글자 없이 「업그레이드」만 적은 줄 — 어느 사이즈인지는 화면 카드에서 사람이 고른다(ups).
    //   줄에 번호·날짜·플랫폼·건수 말고 다른 낱말이 있으면(「4kg 업그레이드」) 손대지 않는다 — 종전 규칙이 읽는다.
    const UP_TOK = /^(?:사이즈)?(?:업그레이드|업글|upgrade)(?:로|요)?[!.]*$/i;
    const UP_OK = /^(?:\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2}|네이버|자사몰|쿠팡|카페24|스마트스토어)$/;
    function upLine(line, srcLine) {
        const toks = line.split(/[ \t]+/).filter(Boolean); if (!toks.some(t => UP_TOK.test(t))) return null;
        const key = toks.find(t => /^0\d{1,2}[-.]?\d{3,4}[-.]?\d{4}$/.test(t) || /^\d{8}-\d{7}$/.test(t) || /^\d{10,}$/.test(t)) || toks.find(hasKey);
        if (!key) return null;
        let expect = null; const keep = [];
        for (const t of toks) {
            if (t === key || UP_OK.test(t)) { keep.push(t); continue; }
            if (UP_TOK.test(t) || SIZE_FILLER.test(t)) continue;
            if (SIZE_CNT.test(t)) { expect = parseInt(t.match(SIZE_CNT)[1], 10); continue; }
            return null;
        }
        let kept = line; toks.filter(t => !keep.includes(t)).forEach(tok => { kept = kept.replace(new RegExp('(^|[ \\t])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[ \\t])'), '$1'); });
        return { up: { srcLine, raw: line.trim(), key, digits: dg(key), expect }, text: keep.length === 1 ? '' : kept.replace(/[ ]{2,}/g, ' ').replace(/[ ]+(\t)/g, '$1').replace(/(\t)[ ]+/g, '$1').replace(/[ ]+$/, '') };
    }
    // #601(대표 10/9 「1건 S · 1건 M」): 한 줄에 사이즈 낱말이 둘 이상이면 「사이즈 + 건수」 짝으로 읽는다(박스마다 다른 사이즈).
    //   짝 = 사이즈 바로 뒤 건수 또는 건수 바로 뒤 사이즈(군더더기 낱말은 건너뜀 · 번호·다른 낱말이 끼면 짝이 아니다). 왼쪽부터 차례로 짝짓는다.
    //   전부 짝이 맞으면 { parts, expect(합), text } · 하나라도 안 맞으면 { bad } — 그 줄은 sizes 에 넣지 않고 줄도 그대로 둔 채 반환의 bad[] 로 따로 알린다(사이즈를 하나도 붙이지 않는다). 사이즈 낱말이 하나뿐이면 null(종전 길 그대로).
    function sizeParts(line, key) {
        let s = line; const found = [];
        for (let g = 0; g < 12; g++) {
            const m = s.match(SIZE_TOK); if (!m) break;
            found.push(m[2].toUpperCase());
            s = s.slice(0, m.index) + (m[1] || '') + '\u0001' + (found.length - 1) + '\u0001' + s.slice(m.index + m[0].length);
        }
        if (found.length < 2) return null;
        const toks = s.split(/[ \t]+/).filter(Boolean), seq = [], gone = []; let keySeen = false;
        toks.forEach(t => {
            const z = t.match(/^\u0001(\d+)\u0001$/);
            if (z) { seq.push({ k: 'S', size: found[+z[1]] }); gone.push(t); return; }
            if (t === key && !keySeen) { keySeen = true; seq.push({ k: 'X' }); return; }
            if (SIZE_CNT.test(t)) { seq.push({ k: 'C', n: parseInt(t.match(SIZE_CNT)[1], 10) }); gone.push(t); return; }
            if (SIZE_FILLER.test(t)) { gone.push(t); return; }
            seq.push({ k: 'X' });
        });
        const pairs = []; let bad = '';
        for (let i = 0; i < seq.length; i++) {
            const a = seq[i], b = seq[i + 1]; if (a.k === 'X') continue;
            if (b && b.k !== 'X' && b.k !== a.k) { const S = a.k === 'S' ? a : b, C = a.k === 'C' ? a : b; if (C.n < 1) bad = bad || '건수 0'; pairs.push({ size: S.size, n: C.n }); i++; continue; }
            bad = bad || (a.k === 'S' ? '건수 없음' : '건수 짝 안 맞음');
        }
        if (bad) return { bad };
        const parts = []; pairs.forEach(p => { const hit = parts.find(x => x.size === p.size); if (hit) hit.n += p.n; else parts.push({ size: p.size, n: p.n }); });
        let kept = s; gone.forEach(tok => { kept = kept.replace(new RegExp('(^|[ \\t])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[ \\t])'), '$1'); });
        const text = toks.length - gone.length === 1 ? '' : kept.replace(/[ ]{2,}/g, ' ').replace(/[ ]+(\t)/g, '$1').replace(/(\t)[ ]+/g, '$1').replace(/[ ]+$/, '');
        return { parts, first: pairs[0].size, expect: pairs.reduce((n, p) => n + p.n, 0), text };
    }
    // #601: 박스별 꼬리 — parts(sizeLines) 를 주문 박스 수(qty)에 맞춰 편다. mk = 사이즈 → 꼬리 글(기본 「○사이즈로!」). 순수 함수 · 입력을 바꾸지 않는다.
    //   합 = qty → 그대로 · 합 < qty → 남는 박스는 { tail:null }(맨 뒤 · note) · 합 > qty → ok:false(사람이 확인)
    function boxTails(parts, qty, mk) {
        const list = Array.isArray(parts) ? parts.filter(p => p && p.size && Number(p.n) > 0) : [];
        if (!list.length) return { ok: false, why: '박스별 사이즈 없음' };
        const q = Number(qty); if (!Number.isInteger(q) || q < 1) return { ok: false, why: '주문 박스 수를 알 수 없어요' };
        const f = typeof mk === 'function' ? mk : (s => s + '사이즈로!');
        const sum = list.reduce((n, p) => n + Number(p.n), 0);
        if (sum > q) return { ok: false, why: `메모 줄은 ${sum}건인데 주문은 ${q}박스예요` };
        const boxes = list.map(p => ({ tail: f(String(p.size)), qty: Number(p.n) }));
        if (sum === q) return { ok: true, boxes };
        boxes.push({ tail: null, qty: q - sum });
        return { ok: true, boxes, note: `꼬리 없는 박스 ${q - sum}` };
    }
    // #615(대표 10/10 「L은 로얄이 아니야」): 로얄과 사이즈는 2S·S·M 세 가지 — 「L」「2L」이 적힌 줄은 사이즈를 붙이지 않고 bad[](kind 'size')로 알린다.
    //   사이즈 낱말은 종전처럼 줄에서 뗀다(남기면 「번호 L사이즈」가 「오늘 발송·손님 메모 무시」 줄로 읽힌다 — #570 과 같은 이유) · 요청일 같은 나머지 글은 그대로 읽힌다.
    const ROYAL_SIZE = new Set(['2S', 'S', 'M']), NOT_ROYAL = '로얄과 사이즈가 아니에요(2S·S·M)';
    function sizeLines(text) {
        const lines = String(text == null ? '' : text).split('\n'), sizes = [], ups = [], bad = [];
        const out = lines.map((raw, srcLine) => {
            const line = raw.replace(/\r/g, ''); const m = line.match(SIZE_TOK);
            if (!m) { const u = upLine(line, srcLine); if (!u) return raw; ups.push(u.up); return u.text; }
            const rest = line.slice(0, m.index) + (m[1] || '') + line.slice(m.index + m[0].length);
            let toks = rest.split(/[ \t]+/).filter(Boolean);
            const key = toks.find(t => /^0\d{1,2}[-.]?\d{3,4}[-.]?\d{4}$/.test(t) || /^\d{8}-\d{7}$/.test(t) || /^\d{10,}$/.test(t)) || toks.find(hasKey);
            if (!key) return raw;
            const mp = sizeParts(line, key);   // #601: 사이즈 낱말이 둘 이상일 때만 값이 온다
            if (mp && mp.parts && mp.parts.some(p => !ROYAL_SIZE.has(p.size))) { bad.push({ srcLine, raw: line.trim(), key, digits: dg(key), why: NOT_ROYAL, kind: 'size', size: mp.parts.filter(p => !ROYAL_SIZE.has(p.size)).map(p => p.size).join('·') }); return mp.text; }
            if (mp && mp.parts) { sizes.push({ srcLine, raw: line.trim(), key, digits: dg(key), size: mp.first, expect: mp.expect, parts: mp.parts }); return mp.text; }
            if (mp && mp.bad) { bad.push({ srcLine, raw: line.trim(), key, digits: dg(key), why: mp.bad }); return raw; }   // 짝이 안 맞으면 사이즈를 하나도 붙이지 않고 줄도 그대로(사람이 정한다)
            let expect = null, kept = rest;
            const drop = tok => { toks = toks.filter(t => t !== tok); kept = kept.replace(new RegExp('(^|[ \\t])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[ \\t])'), '$1'); };
            const cnt = toks.find(t => t !== key && SIZE_CNT.test(t));
            if (cnt) { expect = parseInt(cnt.match(SIZE_CNT)[1], 10); drop(cnt); }
            // #572: 「번호 사이즈 S 로 부탁」처럼 사이즈 낱말과 글자가 떨어져 있거나 「요청」「부탁」이 붙은 꼴 — 남는 군더더기 낱말은 메모 줄에 두지 않는다(남으면 「오늘 발송·메모 무시」 줄로 읽힌다)
            toks.filter(t => t !== key && SIZE_FILLER.test(t)).forEach(drop);
            if (!ROYAL_SIZE.has(m[2].toUpperCase())) bad.push({ srcLine, raw: line.trim(), key, digits: dg(key), why: NOT_ROYAL, kind: 'size', size: m[2].toUpperCase() });
            else sizes.push({ srcLine, raw: line.trim(), key, digits: dg(key), size: m[2].toUpperCase(), expect });
            if (toks.length === 1) return '';
            return kept.replace(/[ ]{2,}/g, ' ').replace(/[ ]+(\t)/g, '$1').replace(/(\t)[ ]+/g, '$1').replace(/[ ]+$/, '');   // 탭 줄은 탭 칸을 그대로(비고 칸만 비워짐) · 빈칸 줄은 빈칸 하나로
        });
        return { text: out.join('\n'), sizes, ups, bad };
    }
    function prepLines(text, opt) {
        const o = opt || {}; const today = o.realToday || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); const shipDays = Array.isArray(o.shipDays) ? o.shipDays : [];
        const noShip = o.noShip instanceof Set ? o.noShip : new Set(o.noShip || []);
        const shipDate = /^\d{4}-\d{2}-\d{2}$/.test(String(o.shipDate || '')) ? String(o.shipDate) : null;   // 고른 기준 발송일(날짜 없는 개별발송 줄에 붙인다)
        const out = [], senders = [], notes = [];
        const lines = String(text == null ? '' : text).split('\n');
        lines.forEach((raw, srcLine) => {
            const line = raw.replace(/\r/g, '').trim();
            if (!line || HEADER_LINE.test(line) || EXAMPLE_LINE.test(line)) { out.push(raw); return; }
            const f = readLine(line, today);
            if (!hasKey(f.key)) { out.push(raw); return; }   // 번호가 없는 줄 = v2 가 형식 오류로 알린다
            // 보내는이 지정 떼어 내기(수취인 한정과 끝의 플랫폼 낱말은 남는 글 쪽에 둔다)
            let keep = f.note, seg = null, keyCount = 0;
            const km = f.note.match(SENDER_KEY);
            if (km) {
                keyCount = (f.note.match(new RegExp(SENDER_KEY.source, 'g')) || []).length;
                keep = f.note.slice(0, km.index); seg = f.note.slice(km.index + km[0].length);
                const pl = seg.match(TAIL_PLAT); if (pl && f.form !== 'tab') { seg = seg.slice(0, pl.index); keep = (keep + ' ' + pl[1]); }
                const rc = seg.match(RECIPIENT); if (rc) { seg = seg.replace(RECIPIENT, ' '); keep = (keep + ' 수취인 ' + rc[1]); }
                keep = keep.replace(/\s+/g, ' ').trim();
            }
            const recM = f.note.match(/수취인\s*[:：]?\s*([가-힣]{2,5})/);
            // 날짜: 칸에 적힌 날짜 → (공백 줄) 남는 글 안의 날짜 → 요일
            let date = f.form === 'sp-key' ? (f.keyAt === 0 ? ((keep.match(NOTE_DATE) || [])[0] ? parseDate(keep.match(NOTE_DATE)[0], today) : null) : null) : f.date;
            let dateText = null, converted = false;
            if (!date) {
                const src = (f.lead ? f.lead + ' ' : '') + keep;
                const wds = new Set(); let wm; WEEKDAY.lastIndex = 0; while ((wm = WEEKDAY.exec(src))) wds.add(wm[1] || wm[2]);
                if (wds.size === 1 && !/다음\s*주|다다음|차주|담주|내주/.test(src)) {
                    const want = WD_IDX[[...wds][0]];
                    let iso = today; for (let i = 0; i < 7; i++) { if (new Date(iso + 'T00:00:00Z').getUTCDay() === want) break; iso = new Date(Date.parse(iso + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10); }
                    date = iso; dateText = `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`; converted = true;
                    const label = `${dateText} (${[...wds][0]}요일)`;
                    notes.push({ srcLine, raw: line, type: 'weekday', detail: label, date: iso });
                    const sat = want === 6, off = noShip.has(iso), outOfList = shipDays.length && iso >= shipDays[0] && iso <= shipDays[shipDays.length - 1] && !shipDays.includes(iso);
                    if (sat || off || outOfList) notes.push({ srcLine, raw: line, type: 'line-noship', detail: `${label}은 ${sat ? '토요일이라' : '발송휴무일이라'} 발송이 없는 날이에요.`, date: iso });
                }
            }
            let note = keep, appended = false;
            if (INDIV_WORD.test(note) && !INDIV.test(note)) { note = (note + ' 입력o삭제x').trim(); appended = true; }
            // 날짜 없는 개별발송·입력삭제 줄 = 기준 발송일로 읽는다(대표 메모는 「번호 개별발송처리」처럼 짧게 적는다 · 잘못 읽혀도 현금파일에 줄이 없으면 카드가 막는다). 기준일을 못 받았으면 안내만.
            const indivNoDate = !date && (appended || INDIV.test(note)); let stamped = false;
            if (indivNoDate && shipDate) { date = shipDate; dateText = `${+shipDate.slice(5, 7)}/${+shipDate.slice(8, 10)}`; stamped = true; }
            if (f.form === 'sp-key' && f.keyAt > 0 && !converted && !stamped) { out.push(raw); return; }   // 번호가 첫 낱말이 아닌데 날짜를 못 붙인 줄 = 그대로(v2 형식 오류)
            if (stamped) notes.push({ srcLine, raw: line, type: 'indiv-today', detail: `날짜가 없어 기준일 ${dateText} 개별발송으로 읽었어요`, date: shipDate });
            else if (indivNoDate) notes.push({ srcLine, raw: line, type: 'indiv-nodate', detail: '개별발송 줄에 요청일자가 없어요. 날짜가 없으면 입력삭제로 처리되지 않아요.' });   // v2 는 날짜 없는 줄을 「날짜 없음 확인」으로만 읽는다
            if (SPLIT_NOTE.test(keep)) notes.push({ srcLine, raw: line, type: 'line-split', detail: keep });
            if (seg != null) {
                const s = readSender(seg, keyCount); const digits = dg(f.key);
                senders.push({ srcLine, raw: line, key: f.key, digits, ch: chOfText(f.plat) || chOfText(keep) || (/^\d{8}-\d{7}$/.test(f.key) ? 'cafe24' : 'naver'), recipient: recM ? recM[1] : null, name: s.name, phone: s.phone, addr: s.addr, ambiguous: s.ambiguous, why: s.why });
                // 날짜도 다른 지시도 없는 보내는이 줄은 v2 에 넘기지 않는다(발송 판정에 영향 0)
                if (!date && !OTHER_ORDER.test(note)) { out.push(''); return; }
            }
            if (seg == null && !converted && !appended && !stamped) { out.push(raw); return; }   // 보통 줄 = 무변경
            out.push(rebuild(f, dateText, note, stamped));
        });
        return { v2Text: out.join('\n'), senders, notes };
    }

    // 보내는이 지정을 주문에 맞춘다. orders: [{ key, digits, ids:[…], recipient, ch? }] — 번호(구매자연락처 숫자 전체) 또는 주문번호가 같은 주문 전부, 「수취인 ○○○」가 있으면 그 수취인만
    function applySenders(senders, orders) {
        const byKey = new Map(), nohit = [], conflicts = [];
        (senders || []).forEach(s => {
            if (!s || s.ambiguous || !s.name) return;
            const hits = (orders || []).filter(od => ((validDigits(s.digits || '') && od.digits === s.digits) || (s.key && (od.ids || []).map(String).includes(String(s.key))))
                && (!s.ch || !od.ch || od.ch === s.ch) && (!s.recipient || String(od.recipient || '').trim() === s.recipient));
            if (!hits.length) { nohit.push(s); return; }
            hits.forEach(od => { const prev = byKey.get(od.key); if (prev && (prev.name !== s.name || prev.phone !== (s.phone || null) || prev.addr !== (s.addr || null))) conflicts.push({ key: od.key, srcLine: s.srcLine }); byKey.set(od.key, { name: s.name, phone: s.phone || null, addr: s.addr || null }); });
        });
        return { byKey, nohit, conflicts };
    }

    // ── 현금파일 ─────────────────────────────────────────────────────────────────────────────────────
    // aoa = sheet_to_json(header:1). 13칸(또는 L·M 없는 11칸) 머리글이어야 한다. no = 엑셀 행 번호.
    function parseCash(aoa) {
        const H = (Array.isArray(aoa) && Array.isArray(aoa[0]) ? aoa[0] : []).map(h => String(h == null ? '' : h).replace(/\s+/g, ' ').trim());
        while (H.length && !H[H.length - 1]) H.pop();
        const headOk = HEADERS.slice(0, 11).every((h, i) => H[i] === h) && (H.length <= 11 || (/^박스타입/.test(H[11] || '') && (H.length < 13 || /변경주소/.test(H[12] || ''))));
        if (!headOk) return { ok: false, error: '현금파일 첫 줄이 택배사 양식 머리글(보내는사람 ~ 구매자연락처 · 박스타입 · 보내는이 변경주소)이 아닙니다', errors: [{ no: 1, why: '머리글' }], rows: [] };
        const rows = [], errors = [];
        for (let r = 1; r < aoa.length; r++) {
            const src = aoa[r]; if (!Array.isArray(src) || !src.some(v => v != null && String(v).trim() !== '')) continue;
            const cells = []; for (let c = 0; c < 13; c++) cells.push(src[c] == null ? '' : String(src[c]));
            const q = Number(String(cells[5]).trim()); const qty = Number.isInteger(q) && q > 0 ? q : 0;
            if (!qty) errors.push({ no: r + 1, why: '수량이 숫자가 아님' });
            if (!cells[8].trim()) errors.push({ no: r + 1, why: '배송지 빈칸' });
            if (!cells[4].trim()) errors.push({ no: r + 1, why: '옵션정보 빈칸' });
            rows.push({ no: r + 1, cells, bang: /[!！]/.test(cells[0]), digits: dg(cells[10]), opt: cells[4].trim(), qty, addr: cells[8].trim() });
        }
        const error = errors.length ? errors.slice(0, 5).map(e => `${e.no}행 ${e.why}`).join(' · ') + (errors.length > 5 ? ` 외 ${errors.length - 5}건` : '') : '';
        return { ok: !errors.length, error, errors, rows };
    }
    // 주문 ↔ 현금파일(「!」 없는 행 = 입력삭제 건의 주소 줄) 대조. 구매자 = K칸 숫자 전체 · 자리표시·8자리 미만은 대조에서 뺀다.
    function cashCheck(arg) {
        const orders = (arg && arg.orders) || []; const cashRows = (arg && arg.cash && (Array.isArray(arg.cash) ? arg.cash : arg.cash.rows)) || [];
        const cashBy = new Map(), strangersBad = [];
        cashRows.filter(r => !r.bang).forEach(r => { if (!validDigits(r.digits)) { strangersBad.push(r); return; } const g = cashBy.get(r.digits) || cashBy.set(r.digits, { rows: [], qty: 0 }).get(r.digits); g.rows.push(r.no); g.qty += r.qty; });
        const byBuyer = new Map(), unchecked = [];
        orders.forEach(od => { if (!validDigits(od.digits || '')) { if (od.individual) unchecked.push({ key: od.key, buyer: od.buyer || '', qty: Number(od.qty) || 0 }); return; } const g = byBuyer.get(od.digits) || byBuyer.set(od.digits, { buyer: od.buyer || '', list: [] }).get(od.digits); g.list.push(od); });
        const missing = [], notIndiv = [], boxDiff = [], strangers = [], mixed = [];
        const sumQty = l => l.reduce((s, x) => s + (Number(x.qty) || 0), 0);
        byBuyer.forEach((g, digits) => {
            const indiv = g.list.filter(x => x.individual && !x.excluded), cash = cashBy.get(digits);
            if (indiv.length && !cash) { missing.push({ digits, buyer: g.buyer, qty: sumQty(indiv) }); return; }
            if (!cash) return;
            const going = g.list.filter(x => !x.individual && !x.excluded);   // 시트1 로도 나가는 주문
            // 개별발송이 하나도 없는데 현금파일에 줄이 있음 = 이중 발송 위험. allExcluded = 그 구매자의 주문이 전부 뒤 날짜로 빠진 경우(오늘은 현금 줄만 나감)
            if (!indiv.length) { notIndiv.push({ digits, buyer: g.buyer, cashRows: cash.rows.slice(), orderKeys: (going.length ? going : g.list).map(x => x.key), allExcluded: !going.length }); return; }
            if (going.length) mixed.push({ digits, buyer: g.buyer, cashRows: cash.rows.slice(), orderKeys: going.map(x => x.key) });   // 개별발송 주문도 있고 시트1 로 나가는 주문도 있는 구매자(안내용)
            if (sumQty(indiv) !== cash.qty) boxDiff.push({ digits, buyer: g.buyer, orderQty: sumQty(indiv), cashQty: cash.qty });
        });
        cashBy.forEach((g, digits) => { if (!byBuyer.has(digits)) strangers.push({ digits, rows: g.rows.slice() }); });
        if (strangersBad.length) strangers.push({ digits: '', rows: strangersBad.map(r => r.no) });
        return { missing, notIndiv, boxDiff, strangers, mixed, unchecked };
    }

    // ── 나눠 보내기 신호(손님 배송메세지) — 자동 처리가 아니라 확인 카드로 올릴 신호만 ─────────────────
    const SP_ROAD = /[가-힣]+(?:시|군|구|읍|면)\s+[가-힣0-9]+(?:대로|로|길)\s*\d+|\d+\s*번지/;
    const SP_DONGHO = /\d+\s*동\s*\d+\s*호/;
    const SP_DOOR = /공동\s*현관|현관|비밀\s*번호|비번|문\s*앞|경비실|부재|택배함|무인/;
    const SP_CONTACT = /부재|연락|전화\s*(?:주|바|부탁|요망|드)|문자|통화|안\s*받/;
    const SP_SENDER = /보내는|보낸|발신|드림|올림/;
    const SP_BOX = /(?:\d+|한|두|세|네|하나|둘)\s*(?:박스|상자|개)\s*(?:는|은|씩|만)/;
    const SP_WORD = /따로|각각|나머지|나눠|나누어|다른\s*(?:주소|곳|배송지)/;
    // #517(설날 실자료 38건): 「주소」 낱말만으로는 신호가 아니다 — 주소를 따로 보낸다·여러 곳이다·이 주소가 아니다 라는 말이 함께 있을 때만(「회사주소인데 13일 도착」 「상세배송지_○○」는 헛카드였다).
    //   명단·리스트·주소록·엑셀·파일 · 메일·톡톡·문자·카톡으로 「보냈다/보내겠다/전달한다」(손님이 한 일 — 기사에게 「문자 보내 주세요」라고 부탁하는 말은 아님)도 신호.
    //   수량 1 이라도 「주소는 따로 보냄 / 이 주소 말고 / 배송지 별도 전달」 꼴이면 신호(한 박스씩 여러 건 주문하고 주소를 따로 보내는 손님 — 실자료 6건 중 4건이 다른 곳으로 나갔다).
    const SP_ADDR = /주소|배송지|배송처|도착지/;
    const SP_LIST = /리스트|명단|주소록|엑셀|파일/;
    const SP_SENT_SRC = '보내\\s*드리|보내\\s*드렸|보내\\s*드린|보낸\\s*(?:주소|배송지|명단|리스트|파일|메일)|메일\\s*보낸|전달\\s*드린|알려\\s*드린|보낼게|보낼께|보냈|보내겠|보내려|전달\\s*드리|전달\\s*하겠|전달\\s*했|전달\\s*예정|전달\\s*할|드렸|드리겠|드릴게|드릴께|남기겠|남길게|남길께|남겼|남겨\\s*놓|남겨\\s*드|남깁니다|납깁니다|(?:^|[^배발])송부|발송\\s*했|발송\\s*하겠|발송\\s*드리|공유|알려\\s*드';
    const SP_SENT = new RegExp(SP_SENT_SRC);
    const SP_VIA = new RegExp('(?:이메일|메일|톡톡|문자|카톡|카카오톡|카카오|메시지|메세지)(?:으로|로|에|를|을)?[가-힣\\s]{0,8}?(?:' + SP_SENT_SRC + ')');
    const SP_ELSE = /별도|따로|각각|개별|다른|다르|말고|무시|아니|아닌|여러|다수|\d+\s*(?:곳|군데|개소|건|명|개)/;
    const SP_NOTHERE = /(?:이|위|해당)\s*주소\s*(?:는|가|로)?\s*(?:말고|무시|아니|아닌)/;
    function splitSignal(arg) {
        const a = arg || {}; const memo = String(a.memo == null ? '' : a.memo).replace(/\s+/g, ' ').trim();
        const qty = Number(a.qty);
        if (!memo || !(qty >= 1)) return null;
        const addrWord = SP_ADDR.test(memo), listWord = SP_LIST.test(memo);
        if (qty < 2) return ((addrWord || listWord) && (SP_SENT.test(memo) || /별도|따로/.test(memo))) || SP_NOTHERE.test(memo) ? { why: '주소를 따로 보낸다는 말' } : null;
        const why = [];
        if (addrWord && (SP_SENT.test(memo) || SP_ELSE.test(memo))) why.push('「주소」 낱말');
        if (listWord) why.push('명단·리스트·파일 낱말');
        if (SP_VIA.test(memo)) why.push('따로 보냈다는 말');
        if (/개별\s*(?:발송|배송)/.test(memo)) why.push('「개별발송」');
        if (SP_ROAD.test(memo) || (SP_DONGHO.test(memo) && !SP_DOOR.test(memo))) why.push('주소로 보이는 글');
        const known = [].concat(a.buyerDigits == null ? [] : a.buyerDigits, a.recvDigits == null ? [] : a.recvDigits).map(dg).filter(Boolean);   // recvDigits = 글자 또는 배열(수취인연락처1·2)
        const third = findPhones(memo).map(p => p.digits).filter(d => !known.includes(d));
        if (third.length && !SP_SENDER.test(memo) && !SP_CONTACT.test(memo)) why.push('다른 전화번호');
        if (SP_BOX.test(memo) && SP_WORD.test(memo)) why.push('박스를 나눠 달라는 말');
        return why.length ? { why: why.join(' · ') } : null;
    }

    // ── 거래처 · 제주 ────────────────────────────────────────────────────────────────────────────────
    const SIZE_TAIL = /\s(?:2S|S|M)사이즈로!$/;
    function partnerOf(opt, byPartner) {
        const name = String(opt == null ? '' : opt).trim(); if (!name || name.startsWith('[미매칭]')) return null;
        const find = n => { for (const [p, arr] of Object.entries(byPartner || {})) { if ((arr instanceof Set ? arr.has(n) : (arr || []).includes(n))) return p; } return null; };
        return find(name) || (SIZE_TAIL.test(name) ? find(name.replace(SIZE_TAIL, '').trim()) : null) || find(stripTail(name, find));
    }
    // #525: 품목 뒤 「요청 꼬리」(빈칸 + 글 + ! — 「 17과로!」 「 S사이즈로!」)를 뗀 품목 이름. 단가표에 그대로 있는 이름이면 손대지 않고,
    //   「!」로 끝날 때만 오른쪽 빈칸부터 차례로 잘라 단가표에 있는 이름이 나오는 곳에서 멈춘다(꼬리 안에 빈칸이 있어도 된다). 못 찾으면 원래 글자 그대로.
    //   has = 이름 → 단가표에 있으면 참(값)
    function stripTail(name, has) {
        const n = String(name == null ? '' : name).trim(); if (!n.endsWith('!') || has(n)) return n;
        for (let i = n.lastIndexOf(' '); i > 0; i = n.lastIndexOf(' ', i - 1)) { const head = n.slice(0, i).trim(); if (has(head)) return head; }
        return SIZE_TAIL.test(n) ? n.replace(SIZE_TAIL, '').trim() : n;
    }
    const shortPartner = name => { const s = String(name == null ? '' : name).replace(/\([^)]*\)/g, '').replace(/농협/g, '').trim(); return s || String(name || '').trim(); };
    const isJeju = addr => String(addr == null ? '' : addr).trim().startsWith('제주');

    // ── §7 결과물: 거래처별 행 묶음 ──────────────────────────────────────────────────────────────────
    // program: [{ key, cells:[{v,s}×11] }](v2 시트1 순서) · cash: parseCash().rows · picks: { 옵션글자: 거래처 } · senderByKey: Map|객체(key → { name, phone, addr }) · catOf: 이름 → 색 분류(선택)
    function buildRows(arg) {
        const a = arg || {}; const byPartner = a.byPartner || {}; const picks = a.picks || {}; const memoDef = a.defaultMemo == null ? DEFAULT_MEMO : a.defaultMemo;
        const senderOf = k => (a.senderByKey instanceof Map ? a.senderByKey.get(k) : (a.senderByKey || {})[k]) || null;
        const blank = () => ({ v: '', t: 's', s: ST_BASE });
        const all = [], unknown = [];
        const place = (cells, src, seq) => {
            const opt = String(cells[4].v == null ? '' : cells[4].v).trim();
            const partner = partnerOf(opt, byPartner) || picks[opt] || null;
            if (!partner) { if (!unknown.includes(opt)) unknown.push(opt); return; }
            const jeju = isJeju(cells[8].v);
            if (jeju) cells[8] = Object.assign({}, cells[8], { s: ST_YELLOW });
            else if (fillRgb(cells[8].s) === 'FFFF00') cells[8] = Object.assign({}, cells[8], { s: ST_BASE });   // v2 는 「제주」가 들어 있기만 해도 칠한다 — 사람 기준은 「제주로 시작」
            if (String(cells[9].v == null ? '' : cells[9].v).trim() === '') cells[9] = Object.assign({}, cells[9], { v: memoDef, t: 's' });   // 빈칸에만 기본 문구(글자가 있으면 손대지 않는다)
            all.push({ partner, src, seq, opt, jeju, cells });
        };
        (a.cash || []).forEach((r, i) => {
            const cells = r.cells.map((v, c) => (c === 5 ? { v: r.qty || Number(v) || 0, t: 'n', s: ST_BASE } : { v: String(v == null ? '' : v), t: 's', s: ST_BASE }));
            while (cells.length < 13) cells.push(blank());
            place(cells, 'cash', i);
        });
        (a.program || []).forEach((p, i) => {
            const cells = []; for (let c = 0; c < 11; c++) { const x = (p.cells || [])[c]; cells.push(x ? Object.assign({}, x) : blank()); }
            cells.push(blank(), blank());
            const sd = senderOf(p.key);
            if (sd && sd.name) {
                cells[0] = { v: /드림$/.test(sd.name) ? sd.name : sd.name + ' 드림', t: 's', s: ST_BLUE };
                if (sd.phone) cells[1] = { v: sd.phone, t: 's', s: ST_BLUE };
                if (sd.addr) cells[12] = { v: sd.addr, t: 's', s: ST_BLUE };
            }
            place(cells, 'program', i);
        });
        const rank = r => (r.src === 'cash' ? 0 : 1);
        const order = (x, y) => (x.jeju - y.jeju) || cmpOpt(x.opt, y.opt) || (rank(x) - rank(y)) || (x.seq - y.seq);   // 제주 아닌 행 → 제주 행 · 옵션 글자순 · 같은 옵션은 현금 먼저
        const names = [...new Set(all.map(r => r.partner))].sort((x, y) => x.localeCompare(y, 'ko'));   // 행이 있는 거래처만 · 이름순
        const partners = [];
        names.forEach(name => {
            const rows = all.filter(r => r.partner === name).sort(order); if (!rows.length) return;
            const sum = new Map(); rows.forEach(r => sum.set(r.opt, (sum.get(r.opt) || 0) + (Number(r.cells[5].v) || 0)));
            const qty = [...sum.keys()].sort(cmpOpt).map(n => ({ name: n, qty: sum.get(n), cat: typeof a.catOf === 'function' ? a.catOf(n) : null }));
            partners.push({ name, short: shortPartner(name), rows: rows.map(r => ({ src: r.src, cells: r.cells, jeju: r.jeju })), qty, total: qty.reduce((s, q) => s + q.qty, 0) });
        });
        return { partners, unknown };
    }

    // 택배사 양식 워크시트(머리글 13칸 · 너비 · 서식). XLSX 는 인자로 받는다(xlsx-js-style).
    function sheetOf(XLSX, partner) {
        const ws = {}; const enc = (r, c) => XLSX.utils.encode_cell({ r, c });
        HEADERS.forEach((h, c) => { ws[enc(0, c)] = { t: 's', v: h, s: headStyle(HEAD_FILL[c]) }; });
        const rows = (partner && partner.rows) || [];
        rows.forEach((row, i) => { for (let c = 0; c < 13; c++) { const x = row.cells[c] || { v: '', s: ST_BASE }; const num = typeof x.v === 'number'; ws[enc(i + 1, c)] = { t: x.t === 'n' || num ? 'n' : 's', v: num || x.t === 'n' ? Number(x.v) : String(x.v == null ? '' : x.v), s: x.s || ST_BASE }; } });
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 12 } });
        ws['!cols'] = WIDTHS.map(wch => ({ wch }));
        return ws;
    }
    // 「수량」 워크시트(본보기 = 발주피벗저장소): 머리글 줄 없이 「품목 | 수량」 줄들 + 맨 아래 합계 줄(품목 칸 빈칸 · 수량 칸 = 합).
    //   colorOf(이름) → 'FFFF00' 같은 RGB 글자 또는 null(색 분류 낱말 yellow… 도 받는다). 품목 칸만 그 색 · 수량 칸과 합계 줄은 무색 · 테두리 thin.
    function qtySheetOf(XLSX, partner, colorOf) {
        const ws = {}; const enc = (r, c) => XLSX.utils.encode_cell({ r, c });
        const cell = (fill, bold) => Object.assign({ border: BORDER, font: { name: '맑은 고딕', sz: 11, bold: !!bold }, alignment: { vertical: 'center' } }, fill ? { fill: { fgColor: { rgb: fill } } } : {});
        const rgbOf = q => { const c = typeof colorOf === 'function' ? colorOf(q.name) : q.cat; return !c ? '' : CAT_RGB[c] || (/^[0-9A-Fa-f]{6}$/.test(c) ? String(c).toUpperCase() : ''); };
        const list = (partner && partner.qty) || [];
        list.forEach((q, i) => { ws[enc(i, 0)] = { t: 's', v: q.name, s: cell(rgbOf(q)) }; ws[enc(i, 1)] = { t: 'n', v: q.qty, s: cell('') }; });   // 색은 품목 칸만(대표가 보내던 표와 같게) · 수량 칸은 흰색
        ws[enc(list.length, 0)] = { t: 's', v: '', s: cell('') }; ws[enc(list.length, 1)] = { t: 'n', v: (partner && partner.total) || 0, s: cell('', true) };
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length, c: 1 } });
        ws['!cols'] = [{ wch: 62 }, { wch: 8 }];
        return ws;
    }

    // #623(대표 10/10 「소과로 부탁드립니다」가 양식에 그대로 실림): 손님 메모가 「사이즈 말 + 부탁 말씨」뿐인가 — 사이즈 말과 부탁 말씨를 지우고 글자·숫자가 하나도 안 남을 때만 참.
    //   화면은 그 요청이 이미 옵션 꼬리(「…2S사이즈로!」)로 붙은 주문에만 쓴다 → AI 에 보내지 않고 규칙으로 기본 문구. 기사님 말·날짜·이름 등 다른 글이 한 글자라도 있으면 거짓(종전대로 AI).
    const SO_SIZE = /투\s*에스|2\s*에스|에스|스몰|엠|미디엄|미듐|2\s*s|(?<![a-z])[sm](?![a-z])|소과|작은|작게|작다|작아|작았으면/gi;
    const SO_WORDS = /사이즈|싸이즈|size|크기|로얄과|귤|것|걸|거|알|부탁\s*(?:드립니다|드려요|드릴게요|드리겠습니다|드림|합니다|해요)?|보내\s*(?:주세요|주시면|주십시오|주셔요|줘요)|해\s*주(?:세요|시면|십시오|셔요)?|주세요|주시면|주십시오|주셔요|원합니다|원해요|희망합니다|희망해요|희망|바랍니다|좋겠습니다|좋겠어요|감사\s*(?:합니다|해요|드립니다|드려요)?|입니다|이에요|예요|이요|꼭|되도록|가능하면|가능하시면|으로|로|는|은|을|를|요/g;
    function sizeOnlyMemo(memoRaw) {
        const m = String(memoRaw == null ? '' : memoRaw).replace(/\s+/g, ' ').trim(); if (!m) return false;
        SO_SIZE.lastIndex = 0; if (!SO_SIZE.test(m)) return false;
        return !/[가-힣A-Za-z0-9]/.test(m.replace(SO_SIZE, ' ').replace(SO_WORDS, ' '));
    }

    const api = { sizeOnlyMemo, prepLines, sizeLines, boxTails, parseCash, cashCheck, splitSignal, partnerOf, stripTail, shortPartner, isJeju, applySenders, buildRows, buildOutput: buildRows, sheetOf, qtySheetOf, senderHint, senderCue, sameDayOnly, memoRest,
        parseDate, fmtPhone, readSender, DEFAULT_MEMO, HEADERS, WIDTHS, CAT_RGB };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.FinalOrderCore = api;
})(typeof window !== 'undefined' ? window : null);
