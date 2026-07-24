require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool, types } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const officeCrypto = require('officecrypto-tool');
const { VERSION } = require('./version.js');
const { parseExplicitDate, parseExplicitMonth, hasExplicitDay, periodRangeOf, needsQueryConfirm, isValidDateStr, parseExplicitRange, parseComparePeriods, parseWeekSpec, parseWeekdayRange } = require('./date-utils.js');
const naverRelay = require('./naver-relay.js'); // 대표 7/24: 네이버 커머스API 중계서버 호출 클라이언트

// DATE 타입을 문자열로 반환 (타임존 이슈 방지)
types.setTypeParser(1082, val => val);

const app = express();
const PORT = process.env.PORT || 3000;
// 5단계 (지시 #22-2): 하드코딩 폴백 제거 — 미설정 시 기동 실패 (fail-closed).
// 리포에 노출된 기본값으로 토큰 위조가 가능했던 구조 차단 (실서버는 환경변수 설정 확인됨 — 위조 401 실측)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('JWT_SECRET 환경변수가 설정되지 않았습니다 — 서버를 시작할 수 없습니다 (fail-closed)');
    process.exit(1);
}

// DB 연결
const dbConfig = {
    connectionString: process.env.DATABASE_URL
};
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(dbConfig);

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === JWT 인증 미들웨어 ===
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '인증이 필요합니다' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다' });
    next();
}

// 카드내역 조회 권한: admin + accountant
function adminOrAccountant(req, res, next) {
    if (req.user.role !== 'admin' && req.user.role !== 'accountant') {
        return res.status(403).json({ error: '권한이 없습니다' });
    }
    next();
}

// === DB 테이블 자동 생성 ===
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settlements (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            partner VARCHAR(50) NOT NULL,
            amount NUMERIC DEFAULT 0,
            items JSONB DEFAULT '[]'::jsonb,
            from_pricing BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cj_carryover (
            id SERIAL PRIMARY KEY,
            month VARCHAR(7) NOT NULL,
            amount INTEGER DEFAULT 0,
            note VARCHAR(200),
            start_date DATE,
            end_date DATE,
            updated_by INTEGER REFERENCES users(id),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(month)
        )
    `);
    // 기존 cj_carryover 테이블에 start_date, end_date 컬럼 추가 (이미 있으면 무시)
    await pool.query(`ALTER TABLE cj_carryover ADD COLUMN IF NOT EXISTS start_date DATE`);
    await pool.query(`ALTER TABLE cj_carryover ADD COLUMN IF NOT EXISTS end_date DATE`);
    // 결재 도장/사인 이미지
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_image TEXT`);
    // 정산 결제완료 상태 컬럼 추가
    await pool.query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);
    // 박스재고 차감 완료 표시 (NULL = 미적용, NOT NULL = 적용 시각)
    await pool.query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS box_adjusted_at TIMESTAMP`);
    // CJ택배 일별 결제완료 상태
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cj_daily_payments (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL UNIQUE,
            amount INTEGER DEFAULT 0,
            is_paid BOOLEAN DEFAULT false,
            paid_at TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS expense_reports (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            applicant_id INTEGER REFERENCES users(id),
            total_amount INTEGER DEFAULT 0,
            purpose TEXT,
            items JSONB DEFAULT '[]'::jsonb,
            status VARCHAR(20) DEFAULT 'pending',
            manager_id INTEGER REFERENCES users(id),
            manager_status VARCHAR(20) DEFAULT 'pending',
            manager_approved_at TIMESTAMP,
            ceo_id INTEGER REFERENCES users(id),
            ceo_status VARCHAR(20) DEFAULT 'pending',
            ceo_approved_at TIMESTAMP,
            rejected_by INTEGER REFERENCES users(id),
            reject_reason TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pricing (
            id SERIAL PRIMARY KEY,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            partner VARCHAR(50) NOT NULL,
            items JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            name VARCHAR(50) NOT NULL,
            position VARCHAR(50) DEFAULT '',
            color VARCHAR(20) DEFAULT '#3b82f6',
            role VARCHAR(20) DEFAULT 'user',
            annual_leave NUMERIC DEFAULT 15,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schedules (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            title VARCHAR(200) NOT NULL,
            type VARCHAR(20) DEFAULT 'normal',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false`);
    // v5.0 3단계: 일정 카테고리 (휴가/톡톡발송/문자발송/할인·이벤트/일반) + 기간형 일정 종료일
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT '일반'`);
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS end_date DATE`);

    // notifications 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            message TEXT,
            link VARCHAR(100),
            is_read BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // documents 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            type VARCHAR(20) NOT NULL,
            sub_type VARCHAR(50) NOT NULL,
            applicant_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            approver_id INTEGER REFERENCES users(id),
            start_date DATE NOT NULL,
            end_date DATE,
            reason TEXT DEFAULT '',
            status VARCHAR(20) DEFAULT 'pending',
            deducted_leave NUMERIC DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            processed_at TIMESTAMP
        )
    `);

    // schedules에 document_id 컬럼 추가 (기안서류 연동)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE schedules ADD COLUMN document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    `);

    // documents에 start_time, end_time 컬럼 추가 (시간차용)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE documents ADD COLUMN start_time VARCHAR(10);
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    `);
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE documents ADD COLUMN end_time VARCHAR(10);
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    `);

    // documents에 수정요청 관련 컬럼 추가
    const modCols = [
        ['modification_type', 'VARCHAR(20)'],
        ['modification_reason', 'TEXT'],
        ['new_start_date', 'DATE'],
        ['new_end_date', 'DATE'],
        ['new_start_time', 'VARCHAR(10)'],
        ['new_end_time', 'VARCHAR(10)'],
    ];
    for (const [col, type] of modCols) {
        await pool.query(`DO $$ BEGIN ALTER TABLE documents ADD COLUMN ${col} ${type}; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
    }

    // 업무일지 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS work_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, date)
        )
    `);

    // 연차 조정 이력 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS leave_adjustments (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            adjustment DECIMAL(5,2) NOT NULL,
            reason VARCHAR(200) NOT NULL,
            adjusted_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 잘못 생성된 ceo 계정 정리
    await pool.query("DELETE FROM users WHERE username = 'ceo' AND (SELECT COUNT(*) FROM users WHERE username = 'admin') > 0");

    // 🔴 [제거됨 2026-07-22 — 심각한 데이터 손실 버그] 아래 일회성 정리 코드가 initDB()(매 부팅) 안에 있어
    //    서버 재시작·배포 때마다 정산관리(from_pricing=true) 데이터를 전부 삭제하고 있었음.
    //    → 대표가 올린 정산관리 매출이 배포할 때마다 사라짐. 절대 되살리지 말 것.
    // (구 코드: await pool.query("DELETE FROM settlements WHERE from_pricing = true");)

    // 초기 관리자 계정 생성
    const adminCheck = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
        const hash = await bcrypt.hash('admin123', 10);
        await pool.query(
            "INSERT INTO users (username, password_hash, name, position, color, role, annual_leave) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            ['admin', hash, '전승범', '대표', '#ef4444', 'admin', 15]
        );
        console.log('초기 관리자 계정 생성: admin / admin123');
    }

    // 선결제 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS prepayments (
            id SERIAL PRIMARY KEY,
            partner VARCHAR(50) NOT NULL,
            amount NUMERIC NOT NULL,
            date DATE NOT NULL,
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 품목명 수동 매칭 기억
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_mappings (
            id SERIAL PRIMARY KEY,
            sales_name TEXT NOT NULL,
            pricing_name TEXT NOT NULL,
            partner VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(sales_name, partner)
        )
    `);

    // 주간 정산 완료 기록
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settlement_completions (
            id SERIAL PRIMARY KEY,
            partner VARCHAR(50) NOT NULL,
            week_start DATE NOT NULL,
            week_end DATE NOT NULL,
            total_amount NUMERIC DEFAULT 0,
            completed_by INTEGER REFERENCES users(id),
            completed_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(partner, week_start)
        )
    `);

    // 박스재고 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS box_inventory (
            id SERIAL PRIMARY KEY,
            product_name VARCHAR(50) NOT NULL UNIQUE,
            company_stock INTEGER DEFAULT 0,
            daesong_stock INTEGER DEFAULT 0,
            updated_by INTEGER REFERENCES users(id),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // [A안] 박스재고 단일 진실원천 모델
    // company_stock / daesong_stock = "base_date 시점의 실재고(기준값)"로 의미 변경
    // 표시 재고 = 기준값 + (base_date 이후 입고/이동/정산차감 재계산)  → computeBoxStocks()
    await pool.query(`ALTER TABLE box_inventory ADD COLUMN IF NOT EXISTS base_date DATE`);
    // 기존 행: 현재 컬럼값을 '오늘 기준값'으로 고정 (오늘 이전 이력은 이미 컬럼값에 반영된 상태 → 보존)
    await pool.query(`UPDATE box_inventory SET base_date = CURRENT_DATE WHERE base_date IS NULL`);
    // 효돈 박스재고 (대표 7/20): 대성(시온) 외 거래처도 자체 박스 차감 지원 — 효돈 정산의 박스 세팅 품목 차감용
    await pool.query(`ALTER TABLE box_inventory ADD COLUMN IF NOT EXISTS hyodon_stock INTEGER DEFAULT 0`);
    // 키워드 순위 (네이버 쇼핑/광고/파워링크 추이)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS keyword_rankings (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            keyword VARCHAR(80) NOT NULL,
            shopping_rank INTEGER,
            ad_rank INTEGER,
            powerlink_rank INTEGER,
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(date, keyword)
        )
    `);

    // 박스 입고/이동 기록 — 거래처 자료 + 이력 추적용
    await pool.query(`
        CREATE TABLE IF NOT EXISTS box_movements (
            id SERIAL PRIMARY KEY,
            product_name VARCHAR(50) NOT NULL,
            movement_type VARCHAR(20) NOT NULL,   -- 'order' (업체 입고) | 'transfer' (업체→대성 이동)
            qty INTEGER NOT NULL,
            date DATE NOT NULL,
            note TEXT DEFAULT '',
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 초기 데이터 삽입 (이미 있으면 무시)
    const boxProducts = ['귤 박스 3kg', '귤 박스 5kg', '귤 박스 10kg', '만감 박스 3kg', '만감 박스 5kg', '만감 박스 10kg'];
    for (const name of boxProducts) {
        await pool.query('INSERT INTO box_inventory (product_name) VALUES ($1) ON CONFLICT (product_name) DO NOTHING', [name]);
    }

    // 마이 플래너 테이블
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_todos (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        date DATE NOT NULL, content VARCHAR(200) NOT NULL,
        is_completed BOOLEAN DEFAULT false, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_memos (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        date DATE NOT NULL, content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id, date)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_ddays (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        title VARCHAR(100) NOT NULL, target_date DATE NOT NULL,
        color VARCHAR(7) DEFAULT '#F5A623', created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_habits (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        title VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_habit_logs (
        id SERIAL PRIMARY KEY, habit_id INTEGER REFERENCES planner_habits(id) ON DELETE CASCADE,
        date DATE NOT NULL, is_done BOOLEAN DEFAULT true, UNIQUE(habit_id, date)
    )`);

    // CS 카테고리
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cs_categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(50) NOT NULL UNIQUE,
            color VARCHAR(20) DEFAULT '#9E9E9E',
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 초기 카테고리 데이터
    const csCatCount = await pool.query('SELECT COUNT(*) FROM cs_categories');
    if (parseInt(csCatCount.rows[0].count) === 0) {
        const catSeeds = [
            ['간편인사', '#4CAF50', 1],
            ['클레임', '#F44336', 2],
            ['주문안내/가격정보', '#2196F3', 3],
            ['도착정보', '#FF9800', 4],
        ];
        for (const [name, color, order] of catSeeds) {
            await pool.query('INSERT INTO cs_categories (name, color, sort_order) VALUES ($1, $2, $3)', [name, color, order]);
        }
    }

    // CS 템플릿
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cs_templates (
            id SERIAL PRIMARY KEY,
            category VARCHAR(50) NOT NULL,
            title VARCHAR(100) NOT NULL,
            content TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 초기 데이터 (테이블이 비어있을 때만)
    const csCount = await pool.query('SELECT COUNT(*) FROM cs_templates');
    if (parseInt(csCount.rows[0].count) === 0) {
        const seeds = [
            ['간편인사', '첫 주문 감사', '안녕하세요! 제주아꼼이네입니다 🍊\n첫 주문 감사드립니다! 정성껏 준비하여 보내드리겠습니다.\n감사합니다!', 1],
            ['간편인사', '재주문 감사', '안녕하세요! 제주아꼼이네입니다 🍊\n다시 찾아주셔서 정말 감사합니다!\n이번에도 맛있는 귤 준비해드리겠습니다!', 2],
            ['클레임', '파손 접수', '안녕하세요 고객님, 제주아꼼이네입니다.\n파손된 상품 사진을 보내주시면 빠르게 재발송 또는 환불 처리 도와드리겠습니다.\n불편을 드려 죄송합니다.', 1],
            ['클레임', '교환 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n교환을 원하시면 상품 상태 사진과 함께 말씀해주세요.\n빠르게 처리 도와드리겠습니다.', 2],
            ['클레임', '반품 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n반품 접수 도와드리겠습니다.\n수거 후 환불 처리까지 2~3일 소요됩니다.', 3],
            ['주문안내/가격정보', '주문 확인', '안녕하세요! 제주아꼼이네입니다.\n주문 확인되었습니다. 빠르게 준비하여 발송해드리겠습니다!\n감사합니다 🍊', 1],
            ['주문안내/가격정보', '품절 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n문의하신 상품은 현재 품절 상태입니다.\n입고되는 대로 안내드리겠습니다.', 2],
            ['도착정보', '배송완료 미수령', '안녕하세요 고객님, 제주아꼼이네입니다.\n배송 완료로 확인되나 수령이 안 되셨다면, 경비실이나 문 앞을 확인해주세요.\n확인이 안 되시면 택배사에 문의 도와드리겠습니다.', 1],
            ['도착정보', '부분배송 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n나머지 상품은 별도 발송되어 1~2일 내 도착 예정입니다.\n불편을 드려 죄송합니다.', 2],
        ];
        for (const [cat, title, content, order] of seeds) {
            await pool.query('INSERT INTO cs_templates (category, title, content, sort_order) VALUES ($1, $2, $3, $4)', [cat, title, content, order]);
        }
    }

    // 정산현황 (날짜별 정산 현황 데이터)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settlement_status (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL UNIQUE,
            current_cash NUMERIC DEFAULT 0,
            settlement_scheduled NUMERIC DEFAULT 0,
            unsettled NUMERIC DEFAULT 0,
            coupang_unpaid NUMERIC DEFAULT 0,
            selfmall_unpaid NUMERIC DEFAULT 0,
            ad_naver NUMERIC DEFAULT 0,
            ad_gfa NUMERIC DEFAULT 0,
            card_fee NUMERIC DEFAULT 0,
            corp_card NUMERIC DEFAULT 0,
            hyodong NUMERIC DEFAULT 0,
            daesong NUMERIC DEFAULT 0,
            aewol NUMERIC DEFAULT 0,
            delivery NUMERIC DEFAULT 0,
            memo TEXT DEFAULT '',
            updated_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 기타거래처 컬럼 추가 (기존 DB 마이그레이션)
    await pool.query(`ALTER TABLE settlement_status ADD COLUMN IF NOT EXISTS aewol NUMERIC DEFAULT 0`);

    // 거래처명 변경: 애월취나물 → 기타거래처 (기존 데이터 보존용, 멱등)
    await pool.query(`UPDATE settlements SET partner = '기타거래처' WHERE partner = '애월취나물'`);
    await pool.query(`UPDATE pricing SET partner = '기타거래처' WHERE partner = '애월취나물'`);
    await pool.query(`UPDATE prepayments SET partner = '기타거래처' WHERE partner = '애월취나물'`);
    await pool.query(`UPDATE product_mappings SET partner = '기타거래처' WHERE partner = '애월취나물'`).catch(() => {});

    // 지출결의서 사용날짜 컬럼 (작성일과 별개)
    await pool.query(`ALTER TABLE expense_reports ADD COLUMN IF NOT EXISTS use_date DATE`);

    // 카드이용내역 (지출결의서 연동)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS card_transactions (
            id SERIAL PRIMARY KEY,
            transaction_date DATE NOT NULL,
            merchant_name VARCHAR(200) NOT NULL,
            amount NUMERIC NOT NULL DEFAULT 0,
            category VARCHAR(50) DEFAULT '기타',
            memo TEXT DEFAULT '',
            expense_report_id INTEGER REFERENCES expense_reports(id) ON DELETE SET NULL,
            card_name VARCHAR(100) DEFAULT '제주은행 법인카드',
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_card_tx_date ON card_transactions(transaction_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_card_tx_dup ON card_transactions(transaction_date, merchant_name, amount)`);
    // 처리상태 컬럼 (지출결의서 연동 대체 - 05.22)
    await pool.query(`ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS is_processed BOOLEAN DEFAULT false`);

    // === 관리 API / MCP 1단계: 품목 마스터 + 변경이력 + soft-delete ===
    // items: 품목 마스터 (송장변환 PRODUCT_CATALOG와 별개의 독립 목록. 송장변환 매칭엔 영향 없음)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            name VARCHAR(300) NOT NULL,
            alias VARCHAR(300) DEFAULT '',
            spec VARCHAR(100) DEFAULT '',
            is_active BOOLEAN DEFAULT true,
            is_deleted BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)`);

    // audit_logs: 관리 API/MCP를 통한 모든 쓰기 작업 추적 (누가·언제·무엇을·before/after)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            action VARCHAR(50) NOT NULL,
            target_type VARCHAR(50) NOT NULL,
            target_id INTEGER,
            changes JSONB,
            source VARCHAR(20) DEFAULT 'mcp',
            actor_id INTEGER REFERENCES users(id),
            actor_name VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`);

    // v5.0 4단계: 보고서 파일 (xlsx) — Render 디스크는 재배포 시 소실되므로 DB에 보관
    // soft-delete 원칙 + 90일 경과분만 물리 정리 허용(purged_at 기록)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS report_files (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(200) NOT NULL,
            run_id INTEGER,
            data BYTEA NOT NULL,
            size_bytes INTEGER,
            created_at TIMESTAMP DEFAULT NOW(),
            is_deleted BOOLEAN DEFAULT false,
            purged_at TIMESTAMP
        )
    `);

    // v5.0 D: 똑똑이 직통 지시함 — 전략 Claude가 MCP로 등록, 클로드 코드가 폴링 실행·응답
    // 전달 통로일 뿐 권한 확대 아님. 원문·응답 전문 보존 (삭제 컬럼 자체가 없음 — 삭제 불가)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cc_instructions (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            status VARCHAR(10) DEFAULT '대기',
            source VARCHAR(50) DEFAULT '똑똑이',
            response TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            responded_at TIMESTAMP
        )
    `);
    // 지시 #10: 텔레그램 알림 기준선 (상태 변화 감지용)
    await pool.query(`ALTER TABLE cc_instructions ADD COLUMN IF NOT EXISTS notified_status VARCHAR(10)`);
    // b안 (대표 결정 2026-07-19): 상태 동일해도 응답 갱신 시 '경과 갱신' 알림 — 마지막 알림 시점의 응답 지문
    await pool.query(`ALTER TABLE cc_instructions ADD COLUMN IF NOT EXISTS notified_resp_hash VARCHAR(40)`);

    // schedules: soft-delete + 관리 API용 선택 컬럼(시간/내용). 기존 화면엔 영향 없음(전부 nullable)
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS start_time VARCHAR(10)`);
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS content TEXT`);

    // 품목 마스터 최초 1회 시드 (비어있을 때만 — 재배포 시 중복 방지)
    const itemCount = await pool.query('SELECT COUNT(*)::int AS c FROM items');
    if (itemCount.rows[0].c === 0) {
        const ITEM_SEED = [
            "★추천 선물세트 / 상품 및 과수: 한라봉&카라향 3kg(2종세트)",
            "★추천 선물세트 / 상품 및 과수: 한라봉&카라향 5kg(2종세트)",
            "과수 및 크기: 제주 레몬3kg(혼합과)",
            "과수 및 크기: 제주 레몬5kg(혼합과)",
            "과수 및 크기: 제주 레몬10kg(혼합과)",
            "과수 및 크기: 제주 못난이 레몬5kg(랜덤과)",
            "과수 및 크기: 제주 못난이 레몬10kg(랜덤과)",
            "과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)",
            "과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 5kg(중소과 27과 전후)",
            "과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(대과 7~15과)",
            "과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(대과 13~23과)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 3kg(중소과 18과 전후)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 5kg(중소과 28과 전후)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 10kg(중소과 55과 전후)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 선물용 - 3kg(대과 7~13과)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 선물용 - 5kg(대과 12~22과)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 못난이 - 5kg(랜덤과)",
            "하우스 한라봉 / 상품 및 과수: 한라봉 못난이 - 10kg(랜덤과)",
            "제주자몽 / 상품 및 과수: 제주자몽 가정용 3kg(10과전후)",
            "제주자몽 / 상품 및 과수: 제주자몽 가정용 5kg(17과전후)",
            "제주자몽 / 상품 및 과수: 제주자몽 선물용 3kg(10과전후)",
            "제주자몽 / 상품 및 과수: 제주자몽 선물용 5kg(17과전후)",
            "제주자몽 / 상품 및 과수: 제주자몽 못난이 5kg(랜덤과)",
            "제주자몽 / 상품 및 과수: 제주자몽 못난이 10kg(랜덤과)",
            "블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 5kg(랜덤과)",
            "블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 3kg(랜덤과)",
            "블러드오렌지 / 상품 및 과수: 블러드오렌지 못난이 5kg(랜덤과)",
            "살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - 5kg(랜덤과)",
            "살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - 3kg(랜덤과)",
            "살살녹는 수라향 / 상품 및 과수: 수라향 못난이 - 5kg(랜덤과)",
            "제주 하귤 / 상품 및 과수: 하귤 가정용 4.5kg(랜덤과)",
            "제주 하귤 / 상품 및 과수: 하귤 가정용 9kg(랜덤과)",
            "새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 3kg(24과 전후)",
            "새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 5kg(40과 전후)",
            "새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 9kg(72과 전후)",
            "새콤달콤 카라향 / 상품 및 과수: 카라향 선물용 - 2kg(10~17과)",
            "맛이진한 세미놀귤 / 세미놀귤 가정용 - 3kg(랜덤과)",
            "맛이진한 세미놀귤 / 세미놀귤 가정용 - 5kg(랜덤과)",
            "맛이진한 세미놀귤 / 세미놀귤 가정용 - 10kg(랜덤과)",
            "맛이진한 세미놀귤 / 세미놀귤 못난이 - 5kg(랜덤과)",
            "고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(로얄과)",
            "고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(소과)",
            "고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)",
            "고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 10kg(로얄과)",
            "고당도 하우스감귤 / 상품 및 과수: 하우스감귤 선물용 - 3kg(로얄과)",
            "미니밤호박 특품최상급 / 상품 및 과수: 특품 3kg(6~12개)",
            "미니밤호박 특품최상급 / 상품 및 과수: 특품 5kg(10~20개)",
            "미니밤호박 특품최상급 / 상품 및 과수: 특품 10kg(20~40개)",
            "미니밤호박 중품못난이 / 상품 및 과수: 못난이 3kg(랜덤과)",
            "미니밤호박 중품못난이 / 상품 및 과수: 못난이 5kg(랜덤과)",
            "미니밤호박 중품못난이 / 상품 및 과수: 못난이 10kg(랜덤과)",
            "미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 3kg(15과 전후)",
            "미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 5kg(25과 전후)",
            "미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 10kg(50과 전후)",
            "초당옥수수 / 중품 10+1개입",
            "초당옥수수 / 중품 20+2개입",
        ];
        for (const name of ITEM_SEED) {
            await pool.query('INSERT INTO items (name) VALUES ($1)', [name]);
        }
        console.log(`items 품목 마스터 시드 완료: ${ITEM_SEED.length}건`);
    }

    // ============================================================
    // === AGENT OFFICE 1차: AI 에이전트 조직 + 실행/로그 + 성장 구조 ===
    // 기존 테이블 무변경 — 순수 추가만. soft-delete + audit_logs 원칙 유지.
    // ============================================================
    await pool.query(`
        CREATE TABLE IF NOT EXISTS agents (
            id SERIAL PRIMARY KEY,
            code VARCHAR(30) UNIQUE NOT NULL,
            name VARCHAR(20) NOT NULL,
            role VARCHAR(10) NOT NULL,
            team VARCHAR(30) NOT NULL,
            duty VARCHAR(50) DEFAULT '',
            description TEXT DEFAULT '',
            workplace VARCHAR(20) DEFAULT '공통',
            knowledge_files JSONB DEFAULT '[]',
            status VARCHAR(20) DEFAULT 'idle',
            last_run_at TIMESTAMP,
            sort_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            is_deleted BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // agent_runs: 실행 기록 — 단계 로그(steps)는 반드시 서버 코드가 기록 (허위 보고 방지)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_runs (
            id SERIAL PRIMARY KEY,
            agent_id INTEGER REFERENCES agents(id),
            status VARCHAR(20) DEFAULT 'running',
            steps JSONB DEFAULT '[]',
            result JSONB,
            started_at TIMESTAMP DEFAULT NOW(),
            finished_at TIMESTAMP,
            is_deleted BOOLEAN DEFAULT false
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, started_at DESC)`);
    // v5.0 1단계: 역량 테스트 실행분 격리 (보고서함·피드백·통계에서 제외 — 자기오염 루프 차단)
    await pool.query(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE`);
    // agent_feedback: 대표가 결과물에 준 피드백 (👍/✏️/👎/💬) — 성장 시스템 1차 구조
    await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_feedback (
            id SERIAL PRIMARY KEY,
            agent_id INTEGER REFERENCES agents(id),
            run_id INTEGER REFERENCES agent_runs(id),
            feedback_type VARCHAR(10) NOT NULL,
            original_output TEXT,
            corrected_output TEXT,
            comment TEXT,
            is_deleted BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // agent_lessons: 요원별 학습 노트 (교훈) — AI 연결 차수에서 실동작
    await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_lessons (
            id SERIAL PRIMARY KEY,
            agent_id INTEGER REFERENCES agents(id),
            lesson TEXT NOT NULL,
            source_feedback_ids JSONB DEFAULT '[]',
            category VARCHAR(20) DEFAULT '',
            status VARCHAR(20) DEFAULT 'active',
            is_deleted BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // agent_tools: 요원별 도구함 (시크릿은 환경변수 참조만 — config에 키 저장 금지)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_tools (
            id SERIAL PRIMARY KEY,
            agent_id INTEGER REFERENCES agents(id),
            tool_name VARCHAR(100) NOT NULL,
            tool_type VARCHAR(20) NOT NULL,
            config JSONB DEFAULT '{}',
            enabled BOOLEAN DEFAULT true,
            is_deleted BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // agent_office_config: 라우팅 테이블·운영 규칙·직원 명단 (마스터 지시문 3·4·5절)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_office_config (
            key VARCHAR(50) PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 9차: 교훈 승인 시각 (성장 위젯 모달의 '승인일' 표시용)
    await pool.query(`ALTER TABLE agent_lessons ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`);

    // pending_orders: 상시 지시 입력바로 접수된 대표 지시 큐 (3차: 마루 AI가 처리)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pending_orders (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            status VARCHAR(20) DEFAULT '대기',
            created_at TIMESTAMP DEFAULT NOW(),
            is_deleted BOOLEAN DEFAULT false
        )
    `);
    // 3차: 마루 처리 결과 컬럼 (멱등 추가)
    await pool.query(`ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS result JSONB`);
    await pool.query(`ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS run_id INTEGER`);
    await pool.query(`ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP`);
    // 정산관리 이미지 자동 입력 (대표 7/20 지시): 지시에 첨부된 이미지 (base64 data URL) — 마루 비전 판독용
    await pool.query(`ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS image_data TEXT`);
    await pool.query(`ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS image_mime VARCHAR(40)`);
    // 서버 재시작으로 '처리중' 상태로 남은 지시 → 대기로 복구 (재처리 가능)
    await pool.query(`UPDATE pending_orders SET status='대기' WHERE status='처리중'`);

    // 서버 재시작으로 중단된 실행 정리 ('실행중'으로 남은 기록 → 오류 처리)
    await pool.query(`UPDATE agent_runs SET status='error', finished_at=NOW(),
        result=COALESCE(result, '{"summary":"서버 재시작으로 실행이 중단되었습니다"}'::jsonb)
        WHERE status='running'`);
    // 대표 7/22: 부팅 시 남아있던 running뿐 아니라 done/error 상태도 대기(idle)로 초기화
    //   (오류 상태가 조직도에 영영 남아 '오류 마크'가 안 사라지던 것 해소 — 오류 기록은 실행 이력에 그대로 남음)
    await pool.query(`UPDATE agents SET status='idle' WHERE status IN ('running','done','error')`);

    // 조직도 시드 (비어있을 때만) — 마스터 지시문 1절 확정 조직 10명
    const agentCount = await pool.query('SELECT COUNT(*)::int AS c FROM agents');
    if (agentCount.rows[0].c === 0) {
        const MK_DOCS = [
            'marketing/문자톡톡_전문가_지침.md', 'marketing/상품별_톤앤매너_가이드.md',
            'marketing/마케팅_문자_가이드북.md', 'marketing/명분_라이브러리.md',
            'marketing/검증된_카피_자산집.md', 'marketing/마케팅_전문팀_시스템.md',
        ];
        const AGENT_SEED = [
            { code: 'maru', name: '마루', role: 'chief', team: '기획팀', duty: '총괄', workplace: '공통', sort: 1,
              description: '오더 접수 → 담당 팀 배정 → 통합 보고 / 회사 데이터 질문 즉답',
              knowledge: ['company/운영_지시규칙.md', 'company/비전과목표.md'] },
            { code: 'hangyeol', name: '한결', role: 'manager', team: '마케팅팀', duty: '팀 관리·검수', workplace: '공통', sort: 2,
              description: '대표 지시 정리 → 전문 프롬프트 변환 → 팀원 배분·검수',
              knowledge: [...MK_DOCS, 'company/비전과목표.md'] },
            { code: 'miso', name: '미소', role: 'worker', team: '마케팅팀', duty: '디자인', workplace: '공통', sort: 3,
              description: '시안 방향·Gemini 이미지/영상 프롬프트 제작',
              knowledge: ['marketing/마케팅_전문팀_시스템.md'] },
            { code: 'geulsaem', name: '글샘', role: 'worker', team: '마케팅팀', duty: '문구', workplace: '공통', sort: 4,
              description: 'LMS/톡톡/상세페이지 카피 작성',
              knowledge: MK_DOCS },
            { code: 'yeri', name: '예리', role: 'worker', team: '마케팅팀', duty: '분석', workplace: '공통', sort: 5,
              description: '인스타 성과 기록·추이 + 타사 경쟁상품/가격/신제품 분석',
              knowledge: ['company/비전과목표.md'] },
            { code: 'hansu', name: '한수', role: 'manager', team: '재무팀', duty: '팀 관리', workplace: '법인', sort: 6,
              description: '질문을 정확한 조회 지시로 정리',
              knowledge: [] },
            { code: 'semi', name: '세미', role: 'worker', team: '재무팀', duty: '회계조회', workplace: '법인', sort: 7,
              description: '정산현황·품목별 금액·비용 조회, 전년 동기대비 품목 매출 증감 분석 (※ 2차에서 정산 DB 실제 연결)',
              knowledge: ['company/운영_지시규칙.md'] },
            { code: 'jiyul', name: '지율', role: 'manager', team: '법무팀', duty: '노무·법률', workplace: '공통', sort: 8,
              description: '노무/법률 자문 보조 (팀원 없음) — 모든 자문에 "최종 확정 전 노무사 검토 필요" 표시',
              knowledge: ['legal/노무자문_페르소나.md'] },
            { code: 'mirae', name: '미래', role: 'manager', team: '개발부서', duty: '팀 관리', workplace: '공통', sort: 9,
              description: '정리·지시·기획안 검토',
              knowledge: [] },
            { code: 'gian', name: '기안', role: 'worker', team: '개발부서', duty: '기획', workplace: '공통', sort: 10,
              description: '대표 미팅 내용 → 기획 보고서 작성 (상세페이지 방향·타사 가격비교·판매 계획·출장 촬영 가이드)',
              knowledge: ['company/비전과목표.md'] },
        ];
        for (const a of AGENT_SEED) {
            await pool.query(
                `INSERT INTO agents (code, name, role, team, duty, description, workplace, knowledge_files, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [a.code, a.name, a.role, a.team, a.duty, a.description, a.workplace, JSON.stringify(a.knowledge), a.sort]);
        }
        console.log(`agents 조직도 시드 완료: ${AGENT_SEED.length}명`);

        // 도구 로드맵 시드 (전부 enabled=false 예정 상태 — 각 차수에서 연결, 성장시스템 지시문 4절)
        const TOOL_SEED = [
            ['miso', 'Higgsfield 영상 생성', 'mcp', { planned: '후속 차수', purpose: 'AI 영상 직접 제작' }],
            ['miso', 'Gemini 이미지 API', 'api', { planned: '후속 차수', purpose: '이미지 시안 직접 생성' }],
            ['geulsaem', '알리고 문자 발송', 'api', { planned: '후속 차수', purpose: '문자 발송 (반드시 대표 승인 후)' }],
            ['yeri', 'Instagram Graph API', 'api', { planned: '후속 차수', purpose: '인스타 성과 자동 수집' }],
            ['yeri', '네이버 쇼핑 검색 API', 'api', { planned: '후속 차수', purpose: '타사 가격·신제품 자동 조사' }],
            ['semi', '내부 정산·품목 DB', 'internal', { planned: '2차', purpose: '정산현황·품목별 금액 조회' }],
            ['maru', '내부 전체 조회 API', 'internal', { planned: '3차', purpose: '회사 데이터 Q&A 즉답' }],
        ];
        for (const [code, toolName, toolType, config] of TOOL_SEED) {
            await pool.query(
                `INSERT INTO agent_tools (agent_id, tool_name, tool_type, config, enabled)
                 SELECT id, $2, $3, $4, false FROM agents WHERE code = $1`,
                [code, toolName, toolType, JSON.stringify(config)]);
        }
    }

    // 라우팅 테이블·운영 규칙·직원 명단 시드 (이미 있으면 건드리지 않음)
    const AGENT_OFFICE_CONFIG_SEED = {
        // 마스터 3절: 오더 라우팅 규칙 (마루 실장용 — 지금은 데이터로만, AI 연결은 후속)
        routing_table: [
            { keywords: ['문자', 'LMS', '톡톡', '카피', '문구', '홍보글'], team: '마케팅팀', assignee: '글샘', reviewer: '한결' },
            { keywords: ['이미지', '시안', '디자인', '영상', '프롬프트'], team: '마케팅팀', assignee: '미소', reviewer: '한결' },
            { keywords: ['인스타', '릴스 성과', '경쟁사', '타사 가격', '신제품 조사'], team: '마케팅팀', assignee: '예리', reviewer: null },
            { keywords: ['매출', '정산', '비용', '품목 금액', '동기대비', '증감'], team: '재무팀', assignee: '세미', reviewer: '한수' },
            { keywords: ['알바', '직원', '근로계약', '주휴수당', '4대보험', '노무', '법률'], team: '법무팀', assignee: '지율', reviewer: null },
            { keywords: ['미팅 정리', '기획안', '신상품', '상품 출시', '보고서'], team: '개발부서', assignee: '기안', reviewer: '미래' },
            { keywords: ['일정', '등록', '조회'], team: '기획팀', assignee: '마루', reviewer: null, note: '회사프로그램 운영 지시 — 운영 규칙(문서 I) 적용' },
            { keywords: [], team: null, assignee: '마루', reviewer: null, note: '분야 불명확 → 마루가 확인 질문' },
        ],
        // 마스터 4절: 실행 등급 + 공통 안전 규칙 (전 에이전트 공통, 문서 I 기반)
        action_grades: {
            grades: [
                { grade: '조회', emoji: '🟢', rule: '확인 없이 즉시 실행', examples: ['일정·정산·품목·로그 보기'] },
                { grade: '등록·수정', emoji: '🟡', rule: '정리해서 보여주기 → 확인 1회 → 실행 → ✅ 결과 보고', examples: ['일정 등록', '데이터 기록'] },
                { grade: '결재(승인/반려)', emoji: '🔴', rule: '에이전트 실행 불가. "프로그램에서 직접 눌러주세요" 안내. 단 대기 기안 내용 조회·요약은 가능', examples: ['승인', '반려'] },
                { grade: '삭제·비활성', emoji: '⛔', rule: '에이전트 실행 불가. 프로그램에서 직접 처리 안내', examples: ['삭제', '비활성'] },
            ],
            common_rules: [
                '애매한 지시는 추측 실행 금지, 되묻기는 한 번에 하나만',
                '애매한 날짜("금요일쯤")는 구체 날짜로 제안하되 확인 문구에 표시',
                '여러 건 동시 변경은 전체 목록 확인 후 일괄 실행',
                '품목 관련은 중복 여부 먼저 확인 후 등록',
                'MCP URL(시크릿 포함)은 어떤 화면·로그에도 출력 금지',
                '실행 기록·보고는 반드시 서버 코드가 기록 (에이전트 자가 보고 금지)',
            ],
            formats: { schedule: '날짜(요일) 시간 — 내용 (담당자)', done_report: '✅ + 요약', default_assignee: '대표' },
        },
        // 마스터 5절: 실제 직원 명단 (에이전트와 구분! 일정·담당자 배정용 참조 데이터)
        staff_roster: {
            '농업회사법인': [
                { name: '전승범', title: '대표', note: '범 대표님' },
                { name: '김민주', title: '팀장' },
                { name: '현승협', title: '대리' },
                { name: '조가영', title: '과장' },
                { name: '정지현', title: '팀장' },
            ],
            '오션라운지': [
                { name: '김지아', title: '점장' },
                { name: '이지은', title: '총괄' },
                { name: '김소희', title: '파트', note: '평일 오후 16:30~21:30' },
                { name: '전민희', title: '매니저', note: '주말·공휴일 09:30~21:30' },
                { name: '조현준', title: '파트', note: '주말·공휴일 11:00~18:00' },
            ],
            note: 'AI 에이전트(마루·한결 등)와 실제 직원은 절대 혼동 금지 — 에이전트에는 🤖 배지 표시',
        },
    };
    for (const [key, value] of Object.entries(AGENT_OFFICE_CONFIG_SEED)) {
        await pool.query(
            `INSERT INTO agent_office_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
            [key, JSON.stringify(value)]);
    }

    // 2차: 세미 정산 DB 연결 완료 반영 (멱등 UPDATE — 도구 활성 + 설명 갱신)
    await pool.query(`UPDATE agent_tools SET enabled = true, config = config || '{"connected":"2차"}'::jsonb
        WHERE tool_name = '내부 정산·품목 DB' AND is_deleted = false AND enabled = false`);
    await pool.query(`UPDATE agents SET description = '정산현황·품목별 금액·비용 조회, 전년 동기대비 품목 매출 증감 분석 (✅ 정산 DB 연결됨 — 2차)'
        WHERE code = 'semi' AND is_deleted = false`);
    // 4차: 글샘 카피 생성 연결 반영 (발송은 대표가 알리고에서 직접 — 자동 발송 없음)
    await pool.query(`UPDATE agents SET description = 'LMS/톡톡/상세페이지 카피 작성 (✅ 카피 생성 연결됨 — 4차 · 발송은 대표가 알리고에서 직접)'
        WHERE code = 'geulsaem' AND is_deleted = false`);
    // 5차: 미소 프롬프트 작성 연결 반영 → v5.1: 원스톱 생성 (대표 건별 승인 게이트)
    await pool.query(`UPDATE agents SET description = '시안 방향·Gemini 프롬프트 제작 + 이미지·영상 원스톱 생성 (✅ v5.1 — 건별 대표 승인 게이트)'
        WHERE code = 'miso' AND is_deleted = false`);
    // 지시 #54: 개발 백로그 (미래 실무 — "나중에 만들자" 항목, soft-delete)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS dev_backlog (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            note TEXT,
            status VARCHAR(10) DEFAULT '대기',
            created_at TIMESTAMP DEFAULT NOW(),
            is_deleted BOOLEAN DEFAULT false
        )
    `);
    // 지시 #54: 조직 개편 — 한결 비활성 (삭제 없음 원칙: is_active만 해제, 기록·파일 보관)
    await pool.query(`UPDATE agents SET is_active = false,
        description = '(비활성 — 지시 #54 조직 개편: 최종 검토는 대표가 직접. AI 검수 제거, 코드 안전망·기록은 유지)'
        WHERE code = 'hangyeol' AND is_deleted = false`);
    await pool.query(`UPDATE agents SET duty = '검산·재무 브리핑·마진 계산',
        description = '세미 보고 자동 검산(🧮) + 주간 재무 브리핑(월) + 신규 품목 마진 계산 + 단가 변경 감지 (✅ 지시 #54 — 전부 0원 코드)'
        WHERE code = 'hansu' AND is_deleted = false`);
    await pool.query(`UPDATE agents SET duty = '백로그·버전 안내',
        description = '개발 백로그 관리("백로그에 추가/보여줘") + 버전·변경사항 안내 (✅ 지시 #54 — 0원 코드. 기안 검수는 제거 — 대표 직행)'
        WHERE code = 'mirae' AND is_deleted = false`);
    // 지시 #45: 지율 노무 자문 가동 — 조직도 반영 (멱등)
    await pool.query(`UPDATE agents SET description = '노무·법률 자문 — 노무지침_v1 근거 (✅ 지시 #45 가동 · 법인 5인↑/오션라운지 5인↓ 구분, 지침 밖은 노무사 안내)'
        WHERE code = 'jiyul' AND is_deleted = false`);
    // 대표 7/22: 예리 인스타 전담 — 조직도 반영 (멱등)
    await pool.query(`UPDATE agents SET duty = '인스타 담당',
        description = '인스타그램 전담 — 계정 아이디 추천·첫 영상 방향·릴스/영상 대본·게시물 문구·해시태그 작성 + 성과 분석(데이터 제공 시). 실제 이미지·영상 생성은 미소'
        WHERE code = 'yeri' AND is_deleted = false`);
    // (구) v5.2 지시 #38 한결 검수 게이트 UPDATE — 지시 #54로 비활성 전환되며 제거 (위 #54 블록이 최종)

    console.log('DB 테이블 초기화 완료');
}

// === Auth API ===

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

        const token = jwt.sign(
            { id: user.id, username: user.username, name: user.name, position: user.position, color: user.color, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, name: user.name, position: user.position, color: user.color, role: user.role, annualLeave: Number(user.annual_leave) }
        });
    } catch (err) {
        console.error('POST /api/auth/login error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === 버전 조회 (0단계 버전 시스템) ===
app.get('/api/version', authMiddleware, adminOnly, (req, res) => {
    res.json({ version: VERSION });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave, signature_image FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave), hasSignature: !!u.signature_image });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 송장변환: 스마트스토어 발주 파일 복호화 ===
// 스마트스토어 발주 엑셀은 암호화(agile encryption)되어 브라우저 XLSX로 못 엶.
// 서버에서 고정 비번으로 복호화만 수행하고, 파싱은 클라이언트(기존 matchProduct)가 담당.
app.post('/api/invoice/decrypt', authMiddleware, async (req, res) => {
    try {
        const { fileBase64 } = req.body || {};
        if (!fileBase64) return res.status(400).json({ error: '파일 데이터가 없습니다' });
        const password = process.env.SMARTSTORE_FILE_PASSWORD || '4031';
        const input = Buffer.from(fileBase64, 'base64');
        const decrypted = await officeCrypto.decrypt(input, { password });
        res.json({ fileBase64: decrypted.toString('base64') });
    } catch (err) {
        res.status(400).json({ error: '복호화 실패: ' + err.message });
    }
});

// === 비밀번호 변경 (본인) ===
app.put('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요' });
        if (newPassword.length < 4) return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다' });

        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });

        const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

        res.json({ success: true, message: '비밀번호가 변경되었습니다' });
    } catch (err) {
        console.error('PUT /api/auth/change-password error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Signature API (결재 도장/사인) ===

app.put('/api/users/signature', authMiddleware, async (req, res) => {
    try {
        const { signatureImage } = req.body;
        if (!signatureImage) return res.status(400).json({ error: '이미지 데이터가 없습니다' });
        // base64 크기 체크 (약 2MB = ~2.7MB base64)
        if (signatureImage.length > 3 * 1024 * 1024) return res.status(400).json({ error: '이미지 크기가 2MB를 초과합니다' });
        await pool.query('UPDATE users SET signature_image = $1 WHERE id = $2', [signatureImage, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/signature', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE users SET signature_image = NULL WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id/signature', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT signature_image FROM users WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        res.json({ signatureImage: result.rows[0].signature_image || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Users API (관리자 전용) ===

app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave, created_at FROM users ORDER BY id');
        res.json(result.rows.map(u => ({
            id: u.id, username: u.username, name: u.name, position: u.position,
            color: u.color, role: u.role, annualLeave: Number(u.annual_leave)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { username, password, name, position, color, role, annualLeave } = req.body;
        if (!username || !password || !name) return res.status(400).json({ error: '아이디, 비밀번호, 이름은 필수입니다' });

        const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (exists.rows.length > 0) return res.status(400).json({ error: '이미 존재하는 아이디입니다' });

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, name, position, color, role, annual_leave) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [username, hash, name, position || '', color || '#3b82f6', role || 'user', annualLeave ?? 15]
        );
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 결재자 목록 - 직원→전연희, 전연희→전승범, 전승범→전승범(자체결재)
app.get('/api/users/approvers', authMiddleware, async (req, res) => {
    try {
        let result;
        if (req.user.position === '대표') {
            // 대표(전승범): 자체 결재 → 본인만 반환
            result = await pool.query(
                "SELECT id, name, position FROM users WHERE id = $1", [req.user.id]
            );
        } else if (req.user.role === 'admin') {
            // 관리자(전연희 등, 대표 아닌): 대표만 반환
            result = await pool.query(
                "SELECT id, name, position FROM users WHERE position = '대표' AND role = 'admin'"
            );
        } else {
            // 일반 직원: 대표 단독 결재 (부장 퇴사로 대표가 모든 결재 처리)
            result = await pool.query(
                "SELECT id, name, position FROM users WHERE position = '대표' AND role = 'admin'"
            );
        }
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 대표 정보 (재직증명서 등 대표 단독결재용)
app.get('/api/users/ceo', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, position FROM users WHERE position = '대표' AND role = 'admin' LIMIT 1"
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '대표 계정을 찾을 수 없습니다' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 직원 이름 목록 (사다리 게임용)
app.get('/api/users/names', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, position, color FROM users ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 직원별 연차 현황 (관리자 전용)
app.get('/api/users/leave-summary', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.position, u.annual_leave,
                   COALESCE(SUM(CASE WHEN d.status = 'approved' AND d.type = 'vacation' AND d.deducted_leave > 0
                       THEN d.deducted_leave ELSE 0 END), 0) as used_leave,
                   COALESCE(SUM(CASE WHEN d.status = 'pending' AND d.type = 'vacation' AND d.deducted_leave > 0
                       THEN d.deducted_leave ELSE 0 END), 0) as pending_leave
            FROM users u
            LEFT JOIN documents d ON u.id = d.applicant_id
            GROUP BY u.id, u.name, u.position, u.annual_leave
            ORDER BY u.name
        `);
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            position: r.position,
            annualLeave: Number(r.annual_leave),
            usedLeave: Number(r.used_leave),
            pendingLeave: Number(r.pending_leave)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, position, color, role, annualLeave, password } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
        if (position !== undefined) { fields.push(`position = $${idx++}`); values.push(position); }
        if (color !== undefined) { fields.push(`color = $${idx++}`); values.push(color); }
        if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
        if (annualLeave !== undefined) { fields.push(`annual_leave = $${idx++}`); values.push(annualLeave); }
        if (password) { fields.push(`password_hash = $${idx++}`); values.push(await bcrypt.hash(password, 10)); }

        if (fields.length === 0) return res.status(400).json({ error: '수정할 항목이 없습니다' });

        values.push(req.params.id);
        await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values);

        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave FROM users WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const check = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
        if (check.rows.length > 0 && check.rows[0].username === 'admin') {
            return res.status(400).json({ error: '기본 관리자 계정은 삭제할 수 없습니다' });
        }
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Notifications API ===

async function createNotification(userId, type, title, message, link) {
    try {
        await pool.query(
            'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, $2, $3, $4, $5)',
            [userId, type, title, message || '', link || 'documents']
        );
        // 30일 지난 알림 정리
        await pool.query("DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'");
    } catch (err) { console.error('createNotification error:', err); }
}

app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
            [req.user.id]
        );
        res.json(result.rows.map(r => ({
            id: r.id, type: r.type, title: r.title, message: r.message,
            link: r.link, isRead: r.is_read, createdAt: r.created_at
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/unread-count', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND is_read = false',
            [req.user.id]
        );
        res.json({ count: parseInt(result.rows[0].cnt) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/:id/read', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 지시사항/공지 전달 (관리자 전용)
app.post('/api/notifications/announcement', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' });
    try {
        const { message, target, user_ids } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });

        let targetIds = [];
        if (target === 'all') {
            const result = await pool.query('SELECT id FROM users WHERE id != $1', [req.user.id]);
            targetIds = result.rows.map(r => r.id);
        } else if (user_ids && user_ids.length > 0) {
            targetIds = user_ids;
        } else {
            return res.status(400).json({ error: '대상을 선택해주세요.' });
        }

        const title = '📢 지시사항: ' + message.trim().substring(0, 30) + (message.trim().length > 30 ? '...' : '');
        for (const uid of targetIds) {
            await createNotification(uid, 'announcement', title, message.trim(), null);
        }

        res.json({ success: true, count: targetIds.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Schedules API ===

app.get('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            result = await pool.query(
                "SELECT s.*, u.name as user_name, u.color as user_color FROM schedules s JOIN users u ON s.user_id = u.id WHERE TO_CHAR(s.date, 'YYYY-MM') = $1 ORDER BY s.date, s.id",
                [month]
            );
        } else {
            result = await pool.query(
                "SELECT s.*, u.name as user_name, u.color as user_color FROM schedules s JOIN users u ON s.user_id = u.id ORDER BY s.date, s.id"
            );
        }
        res.json(result.rows.map(r => ({
            id: r.id, userId: r.user_id, date: r.date, title: r.title, type: r.type,
            userName: r.user_name, userColor: r.user_color, documentId: r.document_id || null,
            isCompleted: r.is_completed || false,
            category: r.category || '일반', endDate: r.end_date || null
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { date, startDate, endDate, title, type } = req.body;
        if (!title) return res.status(400).json({ error: '일정 내용은 필수입니다' });

        // 날짜 범위 지원 (startDate~endDate) 또는 단일 날짜(date) 호환
        const start = startDate || date;
        const end = endDate || date;
        if (!start) return res.status(400).json({ error: '날짜는 필수입니다' });

        const dates = [];
        const cur = new Date(start);
        const last = new Date(end);
        while (cur <= last) {
            dates.push(cur.toISOString().slice(0, 10));
            cur.setDate(cur.getDate() + 1);
        }
        if (dates.length === 0) dates.push(start);

        const results = [];
        for (const d of dates) {
            const result = await pool.query(
                'INSERT INTO schedules (user_id, date, title, type) VALUES ($1, $2, $3, $4) RETURNING *',
                [req.user.id, d, title, type || 'normal']
            );
            results.push(result.rows[0]);
        }

        const mapped = results.map(r => ({ id: r.id, userId: r.user_id, date: r.date, title: r.title, type: r.type, userName: req.user.name, userColor: req.user.color }));
        res.json(mapped.length === 1 ? mapped[0] : mapped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/schedules/:id', authMiddleware, async (req, res) => {
    try {
        const schedule = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
        if (schedule.rows.length === 0) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

        const s = schedule.rows[0];
        if (s.document_id) return res.status(400).json({ error: '기안서류를 통해 생성된 일정은 서류에서 관리해주세요' });
        if (s.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '본인의 일정만 삭제할 수 있습니다' });
        }

        // 휴가였으면 연차 복구
        if (s.type === 'vacation') {
            await pool.query('UPDATE users SET annual_leave = annual_leave + 1 WHERE id = $1', [s.user_id]);
        }

        await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 일정 완료 토글
app.put('/api/schedules/:id/toggle-complete', authMiddleware, async (req, res) => {
    try {
        const schedule = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
        if (schedule.rows.length === 0) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });
        const s = schedule.rows[0];
        if (s.type !== 'normal') return res.status(400).json({ error: '일반 일정만 완료 처리할 수 있습니다' });

        const newVal = !s.is_completed;
        await pool.query('UPDATE schedules SET is_completed = $1 WHERE id = $2', [newVal, req.params.id]);
        res.json({ success: true, isCompleted: newVal });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 시간차 실근무시간 계산 (점심시간 12:00~13:00 제외)
function calcWorkHours(startTimeStr, endTimeStr) {
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const s = toMin(startTimeStr);
    const e = toMin(endTimeStr);
    const total = (e - s) / 60;
    // 점심시간(720~780분)과 겹치는 부분 제외
    const lunchStart = 720, lunchEnd = 780;
    let lunchOverlap = 0;
    if (s < lunchEnd && e > lunchStart) {
        lunchOverlap = (Math.min(e, lunchEnd) - Math.max(s, lunchStart)) / 60;
    }
    return Math.max(total - lunchOverlap, 0);
}

// === Documents API (기안서류) ===

app.get('/api/documents', authMiddleware, async (req, res) => {
    try {
        const { type, status, mine } = req.query;
        let query = `
            SELECT d.*, u1.name as applicant_name, u1.position as applicant_position, u2.name as approver_name
            FROM documents d
            JOIN users u1 ON d.applicant_id = u1.id
            LEFT JOIN users u2 ON d.approver_id = u2.id
        `;
        const conditions = [];
        const values = [];
        let idx = 1;

        if (type) { conditions.push(`d.type = $${idx++}`); values.push(type); }
        if (status) {
            if (status === 'pending') {
                // pending 조회 시 modification_pending도 포함 + 본인이 결재자인 것만
                conditions.push(`d.status IN ('pending', 'modification_pending')`);
                conditions.push(`d.approver_id = $${idx++}`);
                values.push(req.user.id);
            } else {
                conditions.push(`d.status = $${idx++}`); values.push(status);
            }
        }
        if (mine === 'true' || req.user.role !== 'admin') {
            conditions.push(`d.applicant_id = $${idx++}`);
            values.push(req.user.id);
        }

        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY d.created_at DESC';

        const result = await pool.query(query, values);
        res.json(result.rows.map(r => ({
            id: r.id, type: r.type, subType: r.sub_type,
            applicantId: r.applicant_id, applicantName: r.applicant_name, applicantPosition: r.applicant_position,
            approverId: r.approver_id, approverName: r.approver_name,
            startDate: r.start_date, endDate: r.end_date,
            startTime: r.start_time, endTime: r.end_time,
            reason: r.reason, status: r.status, deductedLeave: Number(r.deducted_leave),
            createdAt: r.created_at, processedAt: r.processed_at,
            modificationType: r.modification_type, modificationReason: r.modification_reason,
            newStartDate: r.new_start_date, newEndDate: r.new_end_date,
            newStartTime: r.new_start_time, newEndTime: r.new_end_time
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 승인 이력 조회 (관리자 전용)
app.get('/api/documents/history', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { employeeId, startDate, endDate, type } = req.query;
        let query = `
            SELECT d.*, u1.name as applicant_name, u1.position as applicant_position,
                   u2.name as approver_name
            FROM documents d
            JOIN users u1 ON d.applicant_id = u1.id
            LEFT JOIN users u2 ON d.approver_id = u2.id
            WHERE d.status IN ('approved', 'rejected')
        `;
        const values = [];
        let idx = 1;

        if (employeeId) {
            query += ` AND d.applicant_id = $${idx++}`;
            values.push(Number(employeeId));
        }
        if (startDate) {
            query += ` AND d.start_date >= $${idx++}`;
            values.push(startDate);
        }
        if (endDate) {
            query += ` AND d.start_date <= $${idx++}`;
            values.push(endDate);
        }
        if (type && type !== 'leave_adjustment') {
            query += ` AND d.type = $${idx++}`;
            values.push(type);
        }

        query += ' ORDER BY d.processed_at DESC';

        // 연차 조정 타입이면 leave_adjustments에서만 조회
        if (type === 'leave_adjustment') {
            let adjQuery = `
                SELECT la.*, u.name as user_name, u.position as user_position,
                       ab.name as adjusted_by_name
                FROM leave_adjustments la
                JOIN users u ON la.user_id = u.id
                JOIN users ab ON la.adjusted_by = ab.id
                WHERE 1=1
            `;
            const adjValues = [];
            let adjIdx = 1;
            if (employeeId) {
                adjQuery += ` AND la.user_id = $${adjIdx++}`;
                adjValues.push(Number(employeeId));
            }
            if (startDate) {
                adjQuery += ` AND la.created_at >= $${adjIdx++}`;
                adjValues.push(startDate);
            }
            if (endDate) {
                adjQuery += ` AND la.created_at <= ($${adjIdx++})::date + INTERVAL '1 day'`;
                adjValues.push(endDate);
            }
            adjQuery += ' ORDER BY la.created_at DESC';
            const adjResult = await pool.query(adjQuery, adjValues);
            return res.json(adjResult.rows.map(r => ({
                id: r.id, type: 'leave_adjustment', subType: '',
                applicantId: r.user_id, applicantName: r.user_name,
                applicantPosition: r.user_position,
                approverId: r.adjusted_by, approverName: r.adjusted_by_name,
                startDate: null, endDate: null,
                startTime: null, endTime: null,
                reason: r.reason, status: 'completed',
                deductedLeave: Number(r.adjustment),
                createdAt: r.created_at, processedAt: r.created_at,
                isLeaveAdjustment: true
            })));
        }

        const result = await pool.query(query, values);
        res.json(result.rows.map(r => ({
            id: r.id, type: r.type, subType: r.sub_type,
            applicantId: r.applicant_id, applicantName: r.applicant_name,
            applicantPosition: r.applicant_position,
            approverId: r.approver_id, approverName: r.approver_name,
            startDate: r.start_date, endDate: r.end_date,
            startTime: r.start_time, endTime: r.end_time,
            reason: r.reason, status: r.status,
            deductedLeave: Number(r.deducted_leave),
            createdAt: r.created_at, processedAt: r.processed_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수기 이력 추가 (관리자 전용)
app.post('/api/documents/manual', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { employeeId, type, subType, startDate, endDate, reason, startTime, endTime, deductedLeave } = req.body;
        if (!employeeId || !type || !subType || !startDate) {
            return res.status(400).json({ error: '필수 항목을 입력해주세요' });
        }

        const actualEndDate = endDate || startDate;
        const leave = Number(deductedLeave) || 0;

        // 연차 차감(양수) 또는 추가(음수)
        if (leave !== 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [leave, employeeId]);
        }

        const result = await pool.query(
            'INSERT INTO documents (type, sub_type, applicant_id, approver_id, start_date, end_date, reason, deducted_leave, start_time, end_time, status, processed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING id',
            [type, subType, employeeId, req.user.id, startDate, actualEndDate, reason || '', leave, startTime || null, endTime || null, 'approved']
        );
        const docId = result.rows[0].id;

        // 캘린더 일정 자동 생성
        if (type === 'vacation' || type === 'attendance') {
            const empResult = await pool.query('SELECT name FROM users WHERE id = $1', [employeeId]);
            const empName = empResult.rows[0]?.name || '';
            let scheduleTitle = `${subType} - ${empName}`;
            if (subType === '시간차' && startTime && endTime) {
                scheduleTitle = `시간차(${startTime}~${endTime}) - ${empName}`;
            }
            const start = new Date(startDate);
            const end = new Date(actualEndDate);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                await pool.query(
                    'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                    [employeeId, dateStr, scheduleTitle, type, docId]
                );
            }
        }

        res.json({ id: docId, success: true });
    } catch (err) {
        console.error('POST /api/documents/manual error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/documents', authMiddleware, async (req, res) => {
    try {
        const { type, subType, approverId, startDate, endDate, reason, startTime, endTime } = req.body;
        if (!type || !subType || !approverId || !startDate) {
            return res.status(400).json({ error: '필수 항목을 입력해주세요' });
        }

        // 휴가 연차 차감 계산
        let deductedLeave = 0;
        if (type === 'vacation') {
            if (subType === '연차') {
                const start = new Date(startDate);
                const end = new Date(endDate || startDate);
                deductedLeave = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
            } else if (subType === '시간차') {
                if (startTime && endTime) {
                    const hours = calcWorkHours(startTime, endTime);
                    deductedLeave = parseFloat((hours / 8).toFixed(4));
                } else {
                    deductedLeave = 0.5;
                }
            }
            // 병가는 차감 없음

            if (deductedLeave > 0) {
                const userResult = await pool.query('SELECT annual_leave FROM users WHERE id = $1', [req.user.id]);
                if (Number(userResult.rows[0].annual_leave) < deductedLeave) {
                    return res.status(400).json({ error: `잔여연차(${userResult.rows[0].annual_leave}일)가 부족합니다.` });
                }
                await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [deductedLeave, req.user.id]);
            }
        }

        const actualEndDate = endDate || startDate;
        const result = await pool.query(
            'INSERT INTO documents (type, sub_type, applicant_id, approver_id, start_date, end_date, reason, deducted_leave, start_time, end_time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [type, subType, req.user.id, approverId, startDate, actualEndDate, reason || '', deductedLeave, startTime || null, endTime || null]
        );
        const docId = result.rows[0].id;

        // 휴가/근태: 캘린더에 일정 자동 생성
        if (type === 'vacation' || type === 'attendance') {
            let scheduleTitle = `${subType} - ${req.user.name}`;
            if ((subType === '시간차' || subType === '기타') && startTime && endTime) {
                scheduleTitle = `${subType}(${startTime}~${endTime}) - ${req.user.name}`;
            }
            const multiDay = subType === '연차' || subType === '시간차';
            if ((type === 'vacation' && multiDay) || type === 'attendance') {
                const start = new Date(startDate);
                const end = new Date(actualEndDate);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    await pool.query(
                        'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                        [req.user.id, dateStr, scheduleTitle, type, docId]
                    );
                }
            } else {
                await pool.query(
                    'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                    [req.user.id, startDate, scheduleTitle, type, docId]
                );
            }
        }

        // 알림: 결재자에게
        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        await createNotification(
            approverId, 'document_submitted',
            '새 서류 신청',
            `${req.user.name}님이 ${typeLabels[type] || type}(${subType})을 신청했습니다.`,
            'documents'
        );

        res.json({ id: docId, success: true });
    } catch (err) {
        console.error('POST /api/documents error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/documents/:id/approve', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        // 지정된 결재자만 승인 가능 (대표 자체결재 포함)
        if (d.approver_id !== req.user.id) {
            return res.status(403).json({ error: '지정된 결재자만 승인할 수 있습니다' });
        }
        if (d.status !== 'pending') return res.status(400).json({ error: '이미 처리된 서류입니다' });

        await pool.query('UPDATE documents SET status = $1, processed_at = NOW() WHERE id = $2', ['approved', req.params.id]);

        // 알림: 신청자에게
        const tl = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        await createNotification(
            d.applicant_id, 'document_approved',
            '서류 승인',
            `${tl[d.type] || d.type}(${d.sub_type}) 신청이 승인되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/documents/:id/reject', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        // 지정된 결재자만 반려 가능
        if (d.approver_id !== req.user.id) {
            return res.status(403).json({ error: '지정된 결재자만 반려할 수 있습니다' });
        }
        if (d.status !== 'pending') return res.status(400).json({ error: '이미 처리된 서류입니다' });

        // 연차 복구 (차감이면 +, 추가였으면 -)
        if (Number(d.deducted_leave) !== 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
        }

        // 연동된 일정 삭제
        await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);

        await pool.query('UPDATE documents SET status = $1, processed_at = NOW() WHERE id = $2', ['rejected', req.params.id]);

        // 알림: 신청자에게
        const tl2 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        await createNotification(
            d.applicant_id, 'document_rejected',
            '서류 반려',
            `${tl2[d.type] || d.type}(${d.sub_type}) 신청이 반려되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수정/취소 요청
app.put('/api/documents/:id/request-modification', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });
        const d = doc.rows[0];
        if (d.applicant_id !== req.user.id) return res.status(403).json({ error: '본인 서류만 수정 요청할 수 있습니다' });
        if (d.status !== 'approved') return res.status(400).json({ error: '승인된 서류만 수정 요청할 수 있습니다' });

        const { modification_type, modification_reason, new_start_date, new_end_date, new_start_time, new_end_time } = req.body;
        if (!modification_type || !modification_reason) return res.status(400).json({ error: '수정 유형과 사유를 입력해주세요' });

        await pool.query(
            `UPDATE documents SET status = 'modification_pending',
             modification_type = $1, modification_reason = $2,
             new_start_date = $3, new_end_date = $4, new_start_time = $5, new_end_time = $6
             WHERE id = $7`,
            [modification_type, modification_reason, new_start_date || null, new_end_date || null, new_start_time || null, new_end_time || null, req.params.id]
        );

        // 알림: 결재자에게
        const tl3 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const modLabel = modification_type === 'cancel' ? '취소' : '수정';
        await createNotification(
            d.approver_id, 'modification_requested',
            '서류 수정 요청',
            `${req.user.name}님이 ${tl3[d.type] || d.type}(${d.sub_type}) ${modLabel}을 요청했습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정 요청 승인
app.put('/api/documents/:id/approve-modification', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });
        const d = doc.rows[0];
        // 지정된 결재자만 처리 가능 (대표 자체결재 포함)
        if (d.approver_id !== req.user.id) return res.status(403).json({ error: '지정된 결재자만 처리할 수 있습니다' });
        if (d.status !== 'modification_pending') return res.status(400).json({ error: '수정 대기 중인 서류가 아닙니다' });

        if (d.modification_type === 'cancel') {
            // 취소: 연차 복구 + 일정 삭제 + status cancelled
            if (Number(d.deducted_leave) !== 0) {
                await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
            }
            await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);
            await pool.query(
                `UPDATE documents SET status = 'cancelled', processed_at = NOW(),
                 modification_type = NULL, modification_reason = NULL,
                 new_start_date = NULL, new_end_date = NULL, new_start_time = NULL, new_end_time = NULL
                 WHERE id = $1`, [req.params.id]
            );
        } else {
            // 수정: 날짜 변경 + 연차 재계산 + 일정 재생성
            const newStart = d.new_start_date || d.start_date;
            const newEnd = d.new_end_date || d.end_date;
            const newStartTime = d.new_start_time || d.start_time;
            const newEndTime = d.new_end_time || d.end_time;
            const oldDeducted = Number(d.deducted_leave);

            // 새 연차 차감량 계산
            let newDeducted = 0;
            if (d.type === 'vacation') {
                if (d.sub_type === '연차') {
                    const s = new Date(newStart);
                    const e = new Date(newEnd);
                    newDeducted = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
                } else if (d.sub_type === '시간차') {
                    if (newStartTime && newEndTime) {
                        const hours = calcWorkHours(newStartTime, newEndTime);
                        newDeducted = parseFloat((hours / 8).toFixed(4));
                    } else { newDeducted = 0.5; }
                }
            }

            // 연차 차이 반영
            const diff = oldDeducted - newDeducted;
            if (diff !== 0) {
                await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [diff, d.applicant_id]);
            }

            // 기존 일정 삭제 + 새 일정 생성
            await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);
            if (d.type === 'vacation' || d.type === 'attendance') {
                const userName = (await pool.query('SELECT name FROM users WHERE id = $1', [d.applicant_id])).rows[0].name;
                let scheduleTitle = `${d.sub_type} - ${userName}`;
                if (d.sub_type === '시간차' && newStartTime && newEndTime) {
                    scheduleTitle = `시간차(${newStartTime}~${newEndTime}) - ${userName}`;
                }
                const start = new Date(newStart);
                const end = new Date(newEnd);
                for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
                    const dateStr = dt.toISOString().split('T')[0];
                    await pool.query(
                        'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                        [d.applicant_id, dateStr, scheduleTitle, d.type, req.params.id]
                    );
                }
            }

            // 서류 업데이트
            await pool.query(
                `UPDATE documents SET status = 'approved', processed_at = NOW(),
                 start_date = $1, end_date = $2, start_time = $3, end_time = $4, deducted_leave = $5,
                 modification_type = NULL, modification_reason = NULL,
                 new_start_date = NULL, new_end_date = NULL, new_start_time = NULL, new_end_time = NULL
                 WHERE id = $6`,
                [newStart, newEnd, newStartTime, newEndTime, newDeducted, req.params.id]
            );
        }

        // 알림: 신청자에게
        const tl4 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const modLabel2 = d.modification_type === 'cancel' ? '취소' : '수정';
        await createNotification(
            d.applicant_id, 'modification_approved',
            '수정 요청 승인',
            `${tl4[d.type] || d.type}(${d.sub_type}) ${modLabel2} 요청이 승인되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정 요청 반려
app.put('/api/documents/:id/reject-modification', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });
        const d = doc.rows[0];
        if (d.approver_id !== req.user.id) return res.status(403).json({ error: '지정된 결재자만 처리할 수 있습니다' });
        if (d.status !== 'modification_pending') return res.status(400).json({ error: '수정 대기 중인 서류가 아닙니다' });
        // 기존 승인 상태로 복원, 수정요청 내용 초기화
        await pool.query(
            `UPDATE documents SET status = 'approved',
             modification_type = NULL, modification_reason = NULL,
             new_start_date = NULL, new_end_date = NULL, new_start_time = NULL, new_end_time = NULL
             WHERE id = $1`, [req.params.id]
        );

        // 알림: 신청자에게
        const tl5 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const modLabel3 = d.modification_type === 'cancel' ? '취소' : '수정';
        await createNotification(
            d.applicant_id, 'modification_rejected',
            '수정 요청 반려',
            `${tl5[d.type] || d.type}(${d.sub_type}) ${modLabel3} 요청이 반려되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 서류 수정
app.put('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        const isApplicant = d.applicant_id === req.user.id;
        const isApprover = d.approver_id === req.user.id;
        // 권한: 대기중/반려 → 신청자 본인 또는 결재자, 승인 → 결재자만
        if (d.status === 'approved') {
            if (!isApprover) return res.status(403).json({ error: '승인된 서류는 결재자만 수정할 수 있습니다' });
        } else {
            if (!isApplicant && !isApprover) return res.status(403).json({ error: '수정 권한이 없습니다' });
        }

        const { subType, startDate, endDate, reason, approverId, startTime, endTime } = req.body;
        const newSubType = subType || d.sub_type;
        const newStartDate = startDate || d.start_date;
        const newEndDate = endDate || startDate || d.end_date;
        const newReason = reason !== undefined ? reason : d.reason;
        const newApproverId = approverId || d.approver_id;
        const newStartTime = startTime !== undefined ? startTime : d.start_time;
        const newEndTime = endTime !== undefined ? endTime : d.end_time;

        // 연차 재계산: 기존 차감분 복구 후 새로 차감
        const oldDeducted = Number(d.deducted_leave);
        if (d.status !== 'rejected' && oldDeducted > 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [oldDeducted, d.applicant_id]);
        }

        let newDeducted = 0;
        if (d.type === 'vacation') {
            if (newSubType === '연차') {
                const s = new Date(newStartDate);
                const e = new Date(newEndDate);
                newDeducted = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
            } else if (newSubType === '시간차') {
                if (newStartTime && newEndTime) {
                    const hours = calcWorkHours(newStartTime, newEndTime);
                    newDeducted = parseFloat((hours / 8).toFixed(4));
                } else {
                    newDeducted = 0.5;
                }
            }
            if (newDeducted > 0) {
                const userResult = await pool.query('SELECT annual_leave FROM users WHERE id = $1', [d.applicant_id]);
                if (Number(userResult.rows[0].annual_leave) < newDeducted) {
                    if (d.status !== 'rejected' && oldDeducted > 0) {
                        await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [oldDeducted, d.applicant_id]);
                    }
                    return res.status(400).json({ error: `잔여연차(${userResult.rows[0].annual_leave}일)가 부족합니다.` });
                }
                await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [newDeducted, d.applicant_id]);
            }
        }

        // 반려 상태에서 수정 → 대기중으로 재제출
        const newStatus = d.status === 'rejected' ? 'pending' : d.status;

        await pool.query(
            'UPDATE documents SET sub_type=$1, start_date=$2, end_date=$3, reason=$4, approver_id=$5, deducted_leave=$6, status=$7, processed_at=$8, start_time=$9, end_time=$10 WHERE id=$11',
            [newSubType, newStartDate, newEndDate, newReason, newApproverId, newDeducted, newStatus, newStatus === 'pending' ? null : d.processed_at, newStartTime || null, newEndTime || null, req.params.id]
        );

        // 연동 일정 재생성
        await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);
        if (d.type === 'vacation' || d.type === 'attendance') {
            const applicant = await pool.query('SELECT name FROM users WHERE id = $1', [d.applicant_id]);
            const userName = applicant.rows[0].name;
            let scheduleTitle = `${newSubType} - ${userName}`;
            if (newSubType === '시간차' && newStartTime && newEndTime) {
                scheduleTitle = `시간차(${newStartTime}~${newEndTime}) - ${userName}`;
            }
            const multiDay = newSubType === '연차' || newSubType === '병가' || newSubType === '시간차';
            if (d.type === 'vacation' && multiDay) {
                const s = new Date(newStartDate);
                const e = new Date(newEndDate);
                for (let dd = new Date(s); dd <= e; dd.setDate(dd.getDate() + 1)) {
                    const dateStr = dd.toISOString().split('T')[0];
                    await pool.query(
                        'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                        [d.applicant_id, dateStr, scheduleTitle, d.type, req.params.id]
                    );
                }
            } else {
                await pool.query(
                    'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                    [d.applicant_id, newStartDate, scheduleTitle, d.type, req.params.id]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('PUT /api/documents/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        const isDaepyo = req.user.position === '대표';
        const isApplicant = d.applicant_id === req.user.id;
        const isApprover = d.approver_id === req.user.id;
        // 대표는 모든 서류 삭제 가능
        if (!isDaepyo) {
            // 대기/반려: 신청자 본인 또는 결재자
            // 승인 완료: 결재자만 (신청자는 수정요청으로)
            if (d.status === 'approved') {
                if (!isApprover) return res.status(403).json({ error: '승인된 서류는 결재자만 삭제할 수 있습니다' });
            } else {
                if (!isApplicant && !isApprover) return res.status(403).json({ error: '삭제 권한이 없습니다' });
            }
        }

        // 반려 아닌 경우 연차 복구
        if (d.status !== 'rejected' && Number(d.deducted_leave) !== 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
        }

        // 연동 일정은 ON DELETE CASCADE로 자동 삭제
        await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Expense Reports API (지출결의서) ===

// 지출결의서 작성
app.post('/api/expense-reports', authMiddleware, async (req, res) => {
    try {
        const { title, purpose, items, useDate } = req.body;
        if (!title) return res.status(400).json({ error: '제목을 입력해주세요' });
        if (!items || items.length === 0) return res.status(400).json({ error: '지출 항목을 추가해주세요' });
        const totalAmount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

        // 결재라인 결정
        let managerId = null, ceoId = null;
        const ceoResult = await pool.query("SELECT id FROM users WHERE position = '대표' AND role = 'admin' LIMIT 1");
        const ceoUser = ceoResult.rows[0];
        if (!ceoUser) return res.status(500).json({ error: '대표 계정을 찾을 수 없습니다' });
        ceoId = ceoUser.id;

        // 부장 퇴사로 모든 결재를 대표가 단독 처리 → 1차(부장) 단계 없음
        managerId = null;

        const result = await pool.query(
            `INSERT INTO expense_reports (title, applicant_id, total_amount, purpose, items, manager_id, ceo_id, use_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [title, req.user.id, totalAmount, purpose || '', JSON.stringify(items), managerId, ceoId, useDate || null]
        );

        // 알림: 1차 결재자 또는 대표에게
        const notifyTo = managerId || ceoId;
        const applicantInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [req.user.id]);
        const applicantName = applicantInfo.rows[0] ? `${applicantInfo.rows[0].position} ${applicantInfo.rows[0].name}` : '';
        await createNotification(notifyTo, 'expense', '지출결의서 결재 요청', `${applicantName}님이 "${title}" 지출결의서를 제출했습니다.`, 'expense');

        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 지출결의서 일괄 업로드 (엑셀에서 파싱한 거래 N건을 한 번에 등록)
// 일괄 업로드 전 중복 사전 체크 (사용날짜+금액+거래처 substring 매칭)
// 미리보기에서 중복 행을 즉시 제외하기 위함 — bulk INSERT의 중복 정책과 동일 조건
app.post('/api/expense-reports/check-duplicates', authMiddleware, async (req, res) => {
    try {
        const { transactions } = req.body;
        if (!Array.isArray(transactions)) return res.status(400).json({ error: '잘못된 요청' });
        const results = [];
        for (const tx of transactions) {
            const useDate = tx.useDate;
            const note = (tx.note || '').toString();
            const amount = Number(tx.amount) || 0;
            let isDuplicate = false;
            if (useDate && amount) {
                const dup = await pool.query(
                    `SELECT id FROM expense_reports
                     WHERE use_date = $1 AND total_amount = $2
                       AND items::text LIKE $3
                     LIMIT 1`,
                    [useDate, amount, `%${note.replace(/[%_\\]/g, m => '\\' + m)}%`]
                );
                isDuplicate = dup.rows.length > 0;
            }
            results.push({ isDuplicate });
        }
        res.json({ results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/expense-reports/bulk', authMiddleware, async (req, res) => {
    try {
        const { transactions } = req.body;
        if (!Array.isArray(transactions) || transactions.length === 0) {
            return res.status(400).json({ error: '업로드할 거래가 없습니다' });
        }

        // 결재라인 결정 (현재 사용자 기준)
        let managerId = null, ceoId = null;
        const ceoResult = await pool.query("SELECT id FROM users WHERE position = '대표' AND role = 'admin' LIMIT 1");
        if (ceoResult.rows.length === 0) return res.status(500).json({ error: '대표 계정을 찾을 수 없습니다' });
        ceoId = ceoResult.rows[0].id;

        // 부장 퇴사로 모든 결재를 대표가 단독 처리 → 1차(부장) 단계 없음 (managerId는 항상 null)

        let inserted = 0, failed = 0, skipped = 0;
        for (const tx of transactions) {
            try {
                const { useDate, category, detail, amount, note, purpose } = tx;
                if (!category || !amount) { failed++; continue; }
                const title = category;
                const items = [{ category, detail: detail || '', amount: Number(amount), note: note || '' }];

                // 중복 체크: 같은 사용날짜+거래처(note)+금액 → 스킵 (카드내역 일괄업로드와 동일 정책)
                if (useDate) {
                    const dup = await pool.query(
                        `SELECT id FROM expense_reports
                         WHERE use_date = $1 AND total_amount = $2
                           AND items::text LIKE $3
                         LIMIT 1`,
                        [useDate, Number(amount), `%${(note || '').replace(/[%_]/g, m => '\\' + m)}%`]
                    );
                    if (dup.rows.length > 0) { skipped++; continue; }
                }

                await pool.query(
                    `INSERT INTO expense_reports (title, applicant_id, total_amount, purpose, items, manager_id, ceo_id, use_date)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [title, req.user.id, Number(amount), purpose || '', JSON.stringify(items), managerId, ceoId, useDate || null]
                );
                inserted++;
            } catch (err) {
                failed++;
                console.error('bulk insert error:', err.message);
            }
        }

        // 결재자에게 일괄 알림 (1건만)
        const notifyTo = managerId || ceoId;
        if (notifyTo && inserted > 0) {
            const applicantInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [req.user.id]);
            const applicantName = applicantInfo.rows[0] ? `${applicantInfo.rows[0].position} ${applicantInfo.rows[0].name}` : '';
            await createNotification(notifyTo, 'expense', '지출결의서 일괄 결재 요청', `${applicantName}님이 ${inserted}건의 지출결의서를 일괄 제출했습니다.`, 'expense');
        }

        res.json({ success: true, inserted, failed, skipped });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 내 신청 목록
app.get('/api/expense-reports/my', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                    m.name as manager_name, m.position as manager_position,
                    c.name as ceo_name, c.position as ceo_position
             FROM expense_reports er
             LEFT JOIN users u ON er.applicant_id = u.id
             LEFT JOIN users m ON er.manager_id = m.id
             LEFT JOIN users c ON er.ceo_id = c.id
             WHERE er.applicant_id = $1
             ORDER BY er.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 결재 대기 목록
app.get('/api/expense-reports/pending', authMiddleware, async (req, res) => {
    try {
        let result;
        if (req.user.position === '대표') {
            // 대표: manager_approved(1차 완료) + ceo_status=pending 이거나, manager 없이 ceo에게 바로 온 것
            result = await pool.query(
                `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                        m.name as manager_name, m.position as manager_position,
                        c.name as ceo_name, c.position as ceo_position
                 FROM expense_reports er
                 LEFT JOIN users u ON er.applicant_id = u.id
                 LEFT JOIN users m ON er.manager_id = m.id
                 LEFT JOIN users c ON er.ceo_id = c.id
                 WHERE er.ceo_id = $1 AND er.ceo_status = 'pending'
                   AND (er.manager_id IS NULL OR er.manager_status = 'approved')
                   AND er.status != 'rejected'
                 ORDER BY er.created_at DESC`,
                [req.user.id]
            );
        } else if (req.user.role === 'admin') {
            // 부장: manager_status=pending인 것
            result = await pool.query(
                `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                        m.name as manager_name, m.position as manager_position,
                        c.name as ceo_name, c.position as ceo_position
                 FROM expense_reports er
                 LEFT JOIN users u ON er.applicant_id = u.id
                 LEFT JOIN users m ON er.manager_id = m.id
                 LEFT JOIN users c ON er.ceo_id = c.id
                 WHERE er.manager_id = $1 AND er.manager_status = 'pending' AND er.status != 'rejected'
                 ORDER BY er.created_at DESC`,
                [req.user.id]
            );
        } else {
            result = { rows: [] };
        }
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 전체 이력 조회 (관리자만)
app.get('/api/expense-reports/history', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { applicant_id, start_date, end_date } = req.query;
        let query = `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                    m.name as manager_name, m.position as manager_position,
                    c.name as ceo_name, c.position as ceo_position
             FROM expense_reports er
             LEFT JOIN users u ON er.applicant_id = u.id
             LEFT JOIN users m ON er.manager_id = m.id
             LEFT JOIN users c ON er.ceo_id = c.id`;
        const conditions = [];
        const params = [];
        if (applicant_id) {
            params.push(applicant_id);
            conditions.push(`er.applicant_id = $${params.length}`);
        }
        // 사용날짜(use_date) 기준 필터링. use_date 없는 기존 데이터는 created_at::date로 fallback.
        if (start_date) {
            params.push(start_date);
            conditions.push(`COALESCE(er.use_date, er.created_at::date) >= $${params.length}::date`);
        }
        if (end_date) {
            params.push(end_date);
            conditions.push(`COALESCE(er.use_date, er.created_at::date) <= $${params.length}::date`);
        }
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        // 사용날짜 기준 정렬 (없으면 작성일)
        query += ' ORDER BY COALESCE(er.use_date, er.created_at::date) DESC, er.created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 상세 조회
app.get('/api/expense-reports/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                    m.name as manager_name, m.position as manager_position,
                    c.name as ceo_name, c.position as ceo_position,
                    r.name as rejected_by_name
             FROM expense_reports er
             LEFT JOIN users u ON er.applicant_id = u.id
             LEFT JOIN users m ON er.manager_id = m.id
             LEFT JOIN users c ON er.ceo_id = c.id
             LEFT JOIN users r ON er.rejected_by = r.id
             WHERE er.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const row = result.rows[0];
        // 본인 또는 관리자만 조회 가능
        if (row.applicant_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '조회 권한이 없습니다' });
        }
        res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 승인
app.put('/api/expense-reports/:id/approve', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const er = result.rows[0];

        // 1차 결재 (부장)
        if (er.manager_id === req.user.id && er.manager_status === 'pending') {
            await pool.query(
                `UPDATE expense_reports SET manager_status = 'approved', manager_approved_at = NOW(), status = 'manager_approved' WHERE id = $1`,
                [req.params.id]
            );
            // 알림: 대표에게 + 신청자에게
            const applicantInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [er.applicant_id]);
            const aName = applicantInfo.rows[0] ? `${applicantInfo.rows[0].position} ${applicantInfo.rows[0].name}` : '';
            await createNotification(er.ceo_id, 'expense', '지출결의서 2차 결재 요청', `${aName}님의 "${er.title}" 지출결의서가 1차 승인되었습니다.`, 'expense');
            await createNotification(er.applicant_id, 'expense', '지출결의서 1차 승인', `"${er.title}" 지출결의서가 1차 승인되었습니다.`, 'expense');
            return res.json({ success: true, status: 'manager_approved' });
        }

        // 2차 결재 (대표) 또는 대표 자체 결재
        if (er.ceo_id === req.user.id && er.ceo_status === 'pending') {
            // 1차가 필요한데 아직 안된 경우 차단
            if (er.manager_id && er.manager_status !== 'approved') {
                return res.status(400).json({ error: '1차 결재가 완료되지 않았습니다' });
            }
            await pool.query(
                `UPDATE expense_reports SET ceo_status = 'approved', ceo_approved_at = NOW(), status = 'approved' WHERE id = $1`,
                [req.params.id]
            );
            // 알림: 신청자에게 (본인이 아닌 경우)
            if (er.applicant_id !== req.user.id) {
                await createNotification(er.applicant_id, 'expense', '지출결의서 최종 승인', `"${er.title}" 지출결의서가 최종 승인되었습니다.`, 'expense');
            }
            return res.json({ success: true, status: 'approved' });
        }

        res.status(403).json({ error: '결재 권한이 없습니다' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 반려
app.put('/api/expense-reports/:id/reject', authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const er = result.rows[0];

        const isManager = er.manager_id === req.user.id && er.manager_status === 'pending';
        const isCeo = er.ceo_id === req.user.id && er.ceo_status === 'pending';
        if (!isManager && !isCeo) return res.status(403).json({ error: '반려 권한이 없습니다' });

        await pool.query(
            `UPDATE expense_reports SET status = 'rejected', rejected_by = $1, reject_reason = $2 WHERE id = $3`,
            [req.user.id, reason || '', req.params.id]
        );

        // 알림: 신청자에게
        const rejectorInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [req.user.id]);
        const rName = rejectorInfo.rows[0] ? `${rejectorInfo.rows[0].position} ${rejectorInfo.rows[0].name}` : '';
        await createNotification(er.applicant_id, 'expense', '지출결의서 반려', `"${er.title}" 지출결의서가 ${rName}님에 의해 반려되었습니다.${reason ? ' 사유: ' + reason : ''}`, 'expense');

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 재요청 (반려된 결의서를 다시 결재대기 상태로 되돌림 — 신청자 본인만)
app.put('/api/expense-reports/:id/resubmit', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const er = result.rows[0];

        if (er.applicant_id !== req.user.id) {
            return res.status(403).json({ error: '본인이 신청한 결의서만 재요청할 수 있습니다' });
        }
        if (er.status !== 'rejected') {
            return res.status(400).json({ error: '반려된 결의서만 재요청할 수 있습니다' });
        }

        await pool.query(
            `UPDATE expense_reports
             SET status = 'pending',
                 manager_status = CASE WHEN manager_id IS NULL THEN manager_status ELSE 'pending' END,
                 manager_approved_at = NULL,
                 ceo_status = 'pending',
                 ceo_approved_at = NULL,
                 rejected_by = NULL,
                 reject_reason = NULL
             WHERE id = $1`,
            [req.params.id]
        );

        // 알림: 1차 결재자(부장 있으면 부장, 없으면 대표)
        const notifyTo = er.manager_id || er.ceo_id;
        if (notifyTo) {
            const applicantInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [req.user.id]);
            const applicantName = applicantInfo.rows[0] ? `${applicantInfo.rows[0].position} ${applicantInfo.rows[0].name}` : '';
            await createNotification(notifyTo, 'expense', '지출결의서 재요청', `${applicantName}님이 "${er.title}" 지출결의서를 재요청했습니다.`, 'expense');
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 삭제 (대표만 가능)
app.delete('/api/expense-reports/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.position !== '대표') {
            return res.status(403).json({ error: '지출결의서 삭제는 대표만 가능합니다' });
        }
        const result = await pool.query('DELETE FROM expense_reports WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Card Transactions API (카드이용내역) ===

// 목록 조회 (월별 필터)
app.get('/api/card-transactions', authMiddleware, adminOrAccountant, async (req, res) => {
    try {
        const { month, start_date, end_date } = req.query;
        let query = `
            SELECT ct.*, er.title AS expense_title, er.status AS expense_status,
                   u.name AS created_by_name
            FROM card_transactions ct
            LEFT JOIN expense_reports er ON ct.expense_report_id = er.id
            LEFT JOIN users u ON ct.created_by = u.id
        `;
        const conditions = [];
        const params = [];
        if (month) {
            params.push(month + '-01');
            conditions.push(`ct.transaction_date >= $${params.length}::date`);
            params.push(month + '-01');
            conditions.push(`ct.transaction_date < ($${params.length}::date + INTERVAL '1 month')`);
        }
        if (start_date) {
            params.push(start_date);
            conditions.push(`ct.transaction_date >= $${params.length}::date`);
        }
        if (end_date) {
            params.push(end_date);
            conditions.push(`ct.transaction_date <= $${params.length}::date`);
        }
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY ct.transaction_date DESC, ct.id DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 일괄 업로드 (엑셀/CSV 파싱 후 클라이언트가 JSON으로 전송)
app.post('/api/card-transactions/bulk', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { transactions } = req.body;
        if (!Array.isArray(transactions) || transactions.length === 0) {
            return res.status(400).json({ error: '업로드할 내역이 없습니다' });
        }
        let inserted = 0, skipped = 0;
        for (const tx of transactions) {
            const date = tx.transaction_date || tx.date;
            const merchant = (tx.merchant_name || tx.merchant || '').toString().trim();
            const amount = Number(tx.amount) || 0;
            if (!date || !merchant || amount === 0) { skipped++; continue; }
            // 중복 체크: 같은 날짜+가맹점+금액
            const dup = await pool.query(
                'SELECT id FROM card_transactions WHERE transaction_date = $1 AND merchant_name = $2 AND amount = $3 LIMIT 1',
                [date, merchant, amount]
            );
            if (dup.rows.length > 0) { skipped++; continue; }
            await pool.query(
                `INSERT INTO card_transactions (transaction_date, merchant_name, amount, category, memo, card_name, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [date, merchant, amount, tx.category || '기타', tx.memo || '', tx.card_name || '제주은행 법인카드', req.user.id]
            );
            inserted++;
        }
        res.json({ success: true, inserted, skipped });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 단건 수정 (카테고리/메모/처리상태)
app.put('/api/card-transactions/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { category, memo, is_processed } = req.body;
        const fields = [];
        const params = [];
        if (category !== undefined) { params.push(category); fields.push(`category = $${params.length}`); }
        if (memo !== undefined) { params.push(memo); fields.push(`memo = $${params.length}`); }
        if (is_processed !== undefined) {
            params.push(!!is_processed);
            fields.push(`is_processed = $${params.length}`);
        }
        if (fields.length === 0) return res.status(400).json({ error: '수정할 내용이 없습니다' });
        params.push(req.params.id);
        const result = await pool.query(
            `UPDATE card_transactions SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING id`,
            params
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '카드내역을 찾을 수 없습니다' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 삭제
app.delete('/api/card-transactions/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM card_transactions WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '카드내역을 찾을 수 없습니다' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 지출결의서 연동용 - 승인된 지출결의서 목록 (날짜 근처 우선)
app.get('/api/card-transactions/link-candidates', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { near_date } = req.query;
        let query = `
            SELECT er.id, er.title, er.total_amount, er.created_at, er.status,
                   u.name AS applicant_name, u.position AS applicant_position
            FROM expense_reports er
            LEFT JOIN users u ON er.applicant_id = u.id
            WHERE er.status IN ('approved', 'manager_approved', 'pending')
        `;
        const params = [];
        if (near_date) {
            params.push(near_date);
            query += ` ORDER BY ABS(EXTRACT(EPOCH FROM (er.created_at - $${params.length}::timestamp))) ASC LIMIT 50`;
        } else {
            query += ' ORDER BY er.created_at DESC LIMIT 50';
        }
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Box Inventory API (박스재고) ===

// [A안] 박스재고 단일 진실원천 계산
// 표시 재고 = 기준값(컬럼) + base_date 이후의 입고/이동/정산차감 재계산
//  - 업체재고 = base_company + Σ(order, date>base) - Σ(transfer, date>base)
//  - 대성재고 = base_daesong + Σ(transfer, date>base) - Σ(정산차감, date>base)
//  - base_date NULL = 처음부터 전체 재계산(기준값 0인 신규 박스)
// 입출고현황(/api/box-inventory/history)과 동일 원본을 사용하므로 두 화면이 항상 일치.
async function computeBoxStocks() {
    const invRes = await pool.query('SELECT id, product_name, company_stock, daesong_stock, hyodon_stock, base_date, updated_at FROM box_inventory ORDER BY id');
    const byName = {};
    invRes.rows.forEach(r => {
        byName[r.product_name] = {
            id: r.id,
            productName: r.product_name,
            company: Number(r.company_stock) || 0,
            daesong: Number(r.daesong_stock) || 0,
            hyodon: Number(r.hyodon_stock) || 0, // 효돈 재고 (대표 7/20)
            baseDate: r.base_date ? normDateSafe(r.base_date) : null,
            updatedAt: r.updated_at
        };
    });

    // 입고/이동 (box_movements) — 기준일 이후만 반영
    const movs = await pool.query('SELECT product_name, movement_type, qty, date FROM box_movements');
    for (const m of movs.rows) {
        const box = byName[m.product_name];
        if (!box) continue;
        const d = normDateSafe(m.date);
        if (box.baseDate && !(d > box.baseDate)) continue;
        const q = Number(m.qty) || 0;
        if (m.movement_type === 'order') {
            box.company += q;          // 업체 입고
        } else if (m.movement_type === 'transfer_hyodon') { // 효돈 이동 (대표 7/20)
            box.company -= q;
            box.hyodon += q;
        } else {                       // transfer: 시온 이동
            box.company -= q;
            box.daesong += q;
        }
    }

    // 정산 차감 — 거래처별 자체 박스 (대성=daesong, 효돈=hyodon). 기준일 이후만, 날짜별 박스타입 매핑
    // 대표 7/20: 대성 전용에서 거래처별로 일반화. 각 거래처 pricing에 박스 세팅된 품목만 차감
    const DEDUCT_PARTNERS = [
        { partner: '대성(시온)', field: 'daesong' },
        { partner: '효돈농협', field: 'hyodon' },
    ];
    for (const { partner, field } of DEDUCT_PARTNERS) {
        const setts = await pool.query('SELECT date, items FROM settlements WHERE partner = $1 ORDER BY date', [partner]);
        const mapCache = {};
        for (const s of setts.rows) {
            const d = normDateSafe(s.date);
            const items = (typeof s.items === 'string' ? JSON.parse(s.items) : s.items) || [];
            if (items.length === 0) continue;
            if (!(d in mapCache)) mapCache[d] = (await getBoxTypeMapFor(partner, d)).boxTypeMap;
            const btMap = mapCache[d];
            for (const it of items) {
                const bt = btMap[it.name];
                if (!bt) continue;
                const box = byName[bt];
                if (!box) continue;
                if (box.baseDate && !(d > box.baseDate)) continue;
                box[field] -= (Number(it.qty) || 0);
            }
        }
    }

    return Object.values(byName);
}

app.get('/api/box-inventory', authMiddleware, async (req, res) => {
    try {
        const boxes = await computeBoxStocks();
        res.json(boxes.map(b => ({
            id: b.id,
            productName: b.productName,
            companyStock: b.company,
            daesongStock: b.daesong,
            hyodonStock: b.hyodon, // 효돈 재고 (대표 7/20)
            baseDate: b.baseDate,
            updatedAt: b.updatedAt
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/box-inventory/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { companyStock, daesongStock, hyodonStock } = req.body;
        // [A안] 수동 수정 = 기준값(base) 재설정 + 기준일을 오늘로 → 이후 입출고만 자동 반영
        // 효돈 재고(대표 7/20): 전달된 필드만 갱신 (미전달 시 기존값 유지 — COALESCE)
        await pool.query(
            `UPDATE box_inventory SET
               company_stock = COALESCE($1, company_stock),
               daesong_stock = COALESCE($2, daesong_stock),
               hyodon_stock = COALESCE($3, hyodon_stock),
               base_date = CURRENT_DATE, updated_by = $4, updated_at = NOW() WHERE id = $5`,
            [companyStock ?? null, daesongStock ?? null, hyodonStock ?? null, req.user.id, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Keyword Rankings API (순위관리) ===

// 목록 조회 (기간 필터)
app.get('/api/rankings', authMiddleware, async (req, res) => {
    try {
        const { startDate, endDate, keyword } = req.query;
        let q = 'SELECT * FROM keyword_rankings WHERE 1=1';
        const params = [];
        if (startDate) { params.push(startDate); q += ` AND date >= $${params.length}::date`; }
        if (endDate)   { params.push(endDate);   q += ` AND date <= $${params.length}::date`; }
        if (keyword)   { params.push(keyword);   q += ` AND keyword = $${params.length}`; }
        q += ' ORDER BY date DESC, keyword';
        const r = await pool.query(q, params);
        res.json(r.rows.map(row => ({
            id: row.id,
            date: row.date instanceof Date
                ? `${row.date.getFullYear()}-${String(row.date.getMonth()+1).padStart(2,'0')}-${String(row.date.getDate()).padStart(2,'0')}`
                : String(row.date).slice(0,10),
            keyword: row.keyword,
            shoppingRank: row.shopping_rank,
            adRank: row.ad_rank,
            powerlinkRank: row.powerlink_rank,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 일괄 저장 (UPSERT — 같은 date+keyword는 덮어쓰기)
app.post('/api/rankings/bulk', authMiddleware, async (req, res) => {
    try {
        const { date, rows } = req.body;
        if (!date) return res.status(400).json({ error: 'date 필요' });
        if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows 비어있음' });
        let inserted = 0, updated = 0;
        for (const r of rows) {
            const k = (r.keyword || '').trim();
            if (!k) continue;
            const sh = r.shoppingRank != null ? Number(r.shoppingRank) : null;
            const ad = r.adRank != null ? Number(r.adRank) : null;
            const pl = r.powerlinkRank != null ? Number(r.powerlinkRank) : null;
            const upsert = await pool.query(
                `INSERT INTO keyword_rankings (date, keyword, shopping_rank, ad_rank, powerlink_rank, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (date, keyword) DO UPDATE
                   SET shopping_rank = EXCLUDED.shopping_rank,
                       ad_rank = EXCLUDED.ad_rank,
                       powerlink_rank = EXCLUDED.powerlink_rank,
                       updated_at = NOW()
                 RETURNING (xmax = 0) AS inserted`,
                [date, k, sh, ad, pl, req.user.id]
            );
            if (upsert.rows[0].inserted) inserted++; else updated++;
        }
        res.json({ success: true, inserted, updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 단건 삭제
app.delete('/api/rankings/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM keyword_rankings WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 박스 입고/이동 등록 + 박스재고 자동 업데이트
// type='order': 업체 입고 → company_stock +qty
// type='transfer': 업체 → 대성 이동 → company_stock -qty, daesong_stock +qty
app.post('/api/box-movements', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { productName, movementType, qty, date, note } = req.body;
        const q = Number(qty) || 0;
        if (!productName) return res.status(400).json({ error: 'productName 필요' });
        if (!['order', 'transfer', 'transfer_hyodon'].includes(movementType)) return res.status(400).json({ error: 'movementType은 order/transfer/transfer_hyodon' });
        if (q <= 0) return res.status(400).json({ error: 'qty는 양수여야 합니다' });
        if (!date) return res.status(400).json({ error: 'date 필요' });

        // 박스재고 존재 확인
        const inv = await pool.query('SELECT * FROM box_inventory WHERE product_name = $1', [productName]);
        if (inv.rows.length === 0) return res.status(404).json({ error: `박스재고 '${productName}'을 찾을 수 없습니다` });

        // [A안] 컬럼(기준값) 직접 변경 금지 — 기록만 남기고 표시 재고는 computeBoxStocks()가 재계산

        // 이동 기록
        const r = await pool.query(
            `INSERT INTO box_movements (product_name, movement_type, qty, date, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [productName, movementType, q, date, note || '', req.user.id]
        );
        res.json({ success: true, movement: r.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 박스 이동 기록 삭제 (잘못 등록한 경우) — 박스재고도 역으로 복구
app.delete('/api/box-movements/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM box_movements WHERE id = $1', [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ error: '기록을 찾을 수 없습니다' });
        // [A안] 컬럼(기준값) 직접 복구 금지 — 기록만 삭제하면 표시 재고는 자동 재계산됨
        await pool.query('DELETE FROM box_movements WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 박스 차감 마킹 초기화 — 모든 대성(시온) 정산의 box_adjusted_at = NULL
// 박스재고 자체는 건들지 않음. 사용자가 박스재고를 수동 입력해 정확한 시작점으로 만든 뒤
// 일괄 적용(markOnly)로 마킹만 다시 해주면 깔끔한 상태가 됨.
app.post('/api/box-inventory/reset-adjustments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE settlements SET box_adjusted_at = NULL
             WHERE partner = $1 AND box_adjusted_at IS NOT NULL RETURNING id`,
            ['대성(시온)']
        );
        res.json({ success: true, cleared: r.rows.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 특정 박스타입의 통합 이력 — 박스재고 카드 클릭 시 보여줄 리스트
// 자동 차감(대성 정산) + 업체 입고 + 시온 이동 모두 시간순
// 응답: { productName, items: [{ date, type, qty, sign, note, ...meta }], summary: {...} }
app.get('/api/box-inventory/history', authMiddleware, async (req, res) => {
    try {
        const { productName, startDate, endDate } = req.query;
        const wantAll = !productName; // productName 없으면 전체 박스 통합 조회

        // 1. 자동 차감 이력 (대성 정산 → daesong_stock 감소)
        let settQuery = 'SELECT id, date, items, box_adjusted_at FROM settlements WHERE partner = $1';
        const settParams = ['대성(시온)'];
        if (startDate) { settParams.push(startDate); settQuery += ` AND date >= $${settParams.length}::date`; }
        if (endDate)   { settParams.push(endDate);   settQuery += ` AND date <= $${settParams.length}::date`; }
        settQuery += ' ORDER BY date';
        const settResult = await pool.query(settQuery, settParams);

        const events = [];
        let totalConsumed = 0;
        for (const sett of settResult.rows) {
            const dateStr = sett.date instanceof Date
                ? `${sett.date.getFullYear()}-${String(sett.date.getMonth() + 1).padStart(2, '0')}-${String(sett.date.getDate()).padStart(2, '0')}`
                : String(sett.date).slice(0, 10);
            const items = (typeof sett.items === 'string' ? JSON.parse(sett.items) : sett.items) || [];
            if (items.length === 0) continue;

            const { boxTypeMap, count } = await getDaesongBoxTypeMap(dateStr);
            if (count === 0) continue;

            // 박스 종류별로 그룹화 (전체 조회 시 한 정산에 여러 박스가 섞일 수 있음)
            const byBox = {};
            items.forEach(it => {
                const bt = boxTypeMap[it.name];
                if (!bt) return;
                if (!wantAll && bt !== productName) return;
                (byBox[bt] = byBox[bt] || []).push(it);
            });
            for (const [bt, matched] of Object.entries(byBox)) {
                const totalQty = matched.reduce((s, it) => s + (Number(it.qty) || 0), 0);
                if (totalQty === 0) continue;

                totalConsumed += totalQty;
                events.push({
                    date: dateStr,
                    productName: bt,
                    type: 'consume',                 // 정산 차감
                    qty: totalQty,
                    sign: -1,
                    stockTarget: 'daesong',
                    note: matched.map(i => `${i.name}(${i.qty})`).join(', '),
                    isAdjusted: true,   // [A안] 기준일 이후 차감은 항상 재고에 자동 반영됨
                    refId: sett.id
                });
            }
        }

        // 2. 입고/이동 기록 조회
        let movQuery = 'SELECT id, product_name, movement_type, qty, date, note FROM box_movements';
        const movParams = [];
        const movConds = [];
        if (productName) { movParams.push(productName); movConds.push(`product_name = $${movParams.length}`); }
        if (startDate)   { movParams.push(startDate);   movConds.push(`date >= $${movParams.length}::date`); }
        if (endDate)     { movParams.push(endDate);     movConds.push(`date <= $${movParams.length}::date`); }
        if (movConds.length) movQuery += ' WHERE ' + movConds.join(' AND ');
        movQuery += ' ORDER BY date';
        const movResult = await pool.query(movQuery, movParams);

        let totalOrdered = 0, totalTransferred = 0;
        for (const m of movResult.rows) {
            const dateStr = m.date instanceof Date
                ? `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}-${String(m.date.getDate()).padStart(2, '0')}`
                : String(m.date).slice(0, 10);
            if (m.movement_type === 'order') {
                totalOrdered += Number(m.qty) || 0;
                events.push({
                    date: dateStr,
                    productName: m.product_name,
                    type: 'order',                // 업체 입고
                    qty: Number(m.qty) || 0,
                    sign: +1,
                    stockTarget: 'company',
                    note: m.note || '',
                    refId: m.id
                });
            } else {
                totalTransferred += Number(m.qty) || 0;
                events.push({
                    date: dateStr,
                    productName: m.product_name,
                    type: m.movement_type === 'transfer_hyodon' ? 'transfer_hyodon' : 'transfer', // 업체→대성/효돈 이동 (대표 7/20)
                    qty: Number(m.qty) || 0,
                    sign: 0,                      // 회사 전체 합은 변동 없음 (재배치)
                    stockTarget: m.movement_type === 'transfer_hyodon' ? 'transfer_hyodon' : 'transfer',
                    note: m.note || '',
                    refId: m.id
                });
            }
        }

        // 날짜 오름차순 정렬 (같은 날은 자동차감 → 입고 → 이동 순)
        const typeOrder = { consume: 0, order: 1, transfer: 2 };
        events.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            const t = (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
            if (t !== 0) return t;
            return String(a.productName || '').localeCompare(String(b.productName || ''), 'ko');
        });

        res.json({
            productName,
            events,
            summary: {
                consumed: totalConsumed,       // 대성에서 정산으로 빠진 총 박스 수
                ordered: totalOrdered,         // 업체에 신규 주문 입고된 총 수
                transferred: totalTransferred, // 업체→대성 이동된 총 수
                count: events.length
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 박스재고 차감 일괄 적용 — 특정 시작일 이후 대성(시온) 정산을 모두 순회하며 daesong_stock 차감
// 매칭 결과 상세 반환: 적용 정산 수, 박스타입별 누적 차감, 매칭 실패 항목, pricing 누락 날짜
app.post('/api/box-inventory/reapply-adjustments', authMiddleware, adminOnly, async (req, res) => {
    // [A안] 폐기: 박스재고는 표시 시점에 재계산되므로 일괄 차감(컬럼 직접 변경)은 기준값을 오염시킴.
    return res.status(410).json({ error: '폐기된 기능입니다. 박스재고는 자동 재계산되며, 실재고는 카드에서 직접 수정하세요.' });
    /* eslint-disable no-unreachable */
    try {
        const { startDate, markOnly } = req.body;
        if (!startDate) return res.status(400).json({ error: 'startDate 필요 (YYYY-MM-DD)' });

        // 이미 차감 적용된 정산(box_adjusted_at IS NOT NULL)은 자동 제외 — 이중 차감 방지
        const settResult = await pool.query(
            `SELECT * FROM settlements
             WHERE partner = $1 AND date >= $2::date AND box_adjusted_at IS NULL
             ORDER BY date`,
            ['대성(시온)', startDate]
        );
        // 별도로 이미 적용된 정산 수 카운트 (사용자에게 안내)
        const alreadyResult = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM settlements
             WHERE partner = $1 AND date >= $2::date AND box_adjusted_at IS NOT NULL`,
            ['대성(시온)', startDate]
        );

        const result = {
            settlementsProcessed: 0,
            boxAdjustments: {},      // { '귤 박스 3kg': 차감수량 누적, ... }
            unmatchedItems: [],      // [{ date, name }] — boxType 매핑 안 된 정산 품목
            pricingMissingDates: [], // [date] — pricing 자체가 없는 날짜
            settlementCount: settResult.rows.length,
            alreadyAppliedCount: alreadyResult.rows[0].cnt
        };

        for (const sett of settResult.rows) {
            const dateStr = sett.date instanceof Date
                ? `${sett.date.getFullYear()}-${String(sett.date.getMonth() + 1).padStart(2, '0')}-${String(sett.date.getDate()).padStart(2, '0')}`
                : String(sett.date).slice(0, 10);
            const items = (typeof sett.items === 'string' ? JSON.parse(sett.items) : sett.items) || [];
            if (items.length === 0) continue;

            const { boxTypeMap, count } = await getDaesongBoxTypeMap(dateStr);
            if (count === 0) {
                if (!result.pricingMissingDates.includes(dateStr)) result.pricingMissingDates.push(dateStr);
                continue;
            }

            const adj = {};
            let matched = false;
            for (const it of items) {
                const bt = boxTypeMap[it.name];
                const qty = Number(it.qty) || 0;
                if (bt && qty > 0) {
                    adj[bt] = (adj[bt] || 0) + qty;
                    result.boxAdjustments[bt] = (result.boxAdjustments[bt] || 0) + qty;
                    matched = true;
                } else if (qty > 0) {
                    result.unmatchedItems.push({ date: dateStr, name: it.name, qty });
                }
            }
            // markOnly=true이면 박스재고는 건들지 않고 box_adjusted_at만 마킹 (이미 수동 차감한 경우)
            if (!markOnly) {
                for (const [bt, qty] of Object.entries(adj)) {
                    if (qty > 0) {
                        await pool.query(
                            'UPDATE box_inventory SET daesong_stock = daesong_stock - $1, updated_at = NOW() WHERE product_name = $2',
                            [qty, bt]
                        );
                    }
                }
            }
            // 매칭된 정산은 box_adjusted_at 마킹 → 다음 일괄 적용에서 자동 제외 (이중 차감 방지)
            if (matched) {
                await pool.query(`UPDATE settlements SET box_adjusted_at = NOW() WHERE id = $1`, [sett.id]);
                result.settlementsProcessed++;
            }
        }
        result.markOnly = !!markOnly;

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Planner API (마이 플래너) ===

// Todos
app.get('/api/planner/todos', authMiddleware, async (req, res) => {
    try {
        const { date } = req.query;
        const result = await pool.query(
            'SELECT * FROM planner_todos WHERE user_id = $1 AND date = $2 ORDER BY is_completed, sort_order, id',
            [req.user.id, date]
        );
        res.json(result.rows.map(r => ({ id: r.id, date: r.date, content: r.content, isCompleted: r.is_completed, sortOrder: r.sort_order })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/todos', authMiddleware, async (req, res) => {
    try {
        const { date, content } = req.body;
        const result = await pool.query(
            'INSERT INTO planner_todos (user_id, date, content) VALUES ($1, $2, $3) RETURNING id',
            [req.user.id, date, content]
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/planner/todos/:id', authMiddleware, async (req, res) => {
    try {
        const { isCompleted, date } = req.body;
        const doc = await pool.query('SELECT user_id FROM planner_todos WHERE id = $1', [req.params.id]);
        if (!doc.rows[0] || doc.rows[0].user_id !== req.user.id) return res.status(403).json({ error: '권한 없음' });
        const sets = [];
        const vals = [];
        let idx = 1;
        if (isCompleted !== undefined) { sets.push(`is_completed = $${idx++}`); vals.push(isCompleted); }
        if (date !== undefined) { sets.push(`date = $${idx++}`); vals.push(date); }
        vals.push(req.params.id);
        await pool.query(`UPDATE planner_todos SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/todos/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM planner_todos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Memos
app.get('/api/planner/memos', authMiddleware, async (req, res) => {
    try {
        const { date } = req.query;
        const result = await pool.query('SELECT * FROM planner_memos WHERE user_id = $1 AND date = $2', [req.user.id, date]);
        res.json(result.rows[0] ? { id: result.rows[0].id, content: result.rows[0].content } : null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/memos', authMiddleware, async (req, res) => {
    try {
        const { date, content } = req.body;
        await pool.query(
            'INSERT INTO planner_memos (user_id, date, content) VALUES ($1, $2, $3) ON CONFLICT (user_id, date) DO UPDATE SET content = $3',
            [req.user.id, date, content]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// D-days
app.get('/api/planner/ddays', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM planner_ddays WHERE user_id = $1 ORDER BY target_date', [req.user.id]);
        res.json(result.rows.map(r => ({ id: r.id, title: r.title, targetDate: r.target_date, color: r.color })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/ddays', authMiddleware, async (req, res) => {
    try {
        const { title, targetDate, color } = req.body;
        const result = await pool.query(
            'INSERT INTO planner_ddays (user_id, title, target_date, color) VALUES ($1, $2, $3, $4) RETURNING id',
            [req.user.id, title, targetDate, color || '#F5A623']
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/ddays/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM planner_ddays WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Habits
app.get('/api/planner/habits', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM planner_habits WHERE user_id = $1 ORDER BY id', [req.user.id]);
        res.json(result.rows.map(r => ({ id: r.id, title: r.title })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/habits', authMiddleware, async (req, res) => {
    try {
        const { title } = req.body;
        const result = await pool.query('INSERT INTO planner_habits (user_id, title) VALUES ($1, $2) RETURNING id', [req.user.id, title]);
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/habits/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM planner_habits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Habit Logs
app.get('/api/planner/habit-logs', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query;
        const result = await pool.query(
            `SELECT hl.* FROM planner_habit_logs hl JOIN planner_habits h ON hl.habit_id = h.id
             WHERE h.user_id = $1 AND to_char(hl.date, 'YYYY-MM') = $2`,
            [req.user.id, month]
        );
        res.json(result.rows.map(r => ({ id: r.id, habitId: r.habit_id, date: r.date, isDone: r.is_done })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/habit-logs', authMiddleware, async (req, res) => {
    try {
        const { habitId, date } = req.body;
        const h = await pool.query('SELECT user_id FROM planner_habits WHERE id = $1', [habitId]);
        if (!h.rows[0] || h.rows[0].user_id !== req.user.id) return res.status(403).json({ error: '권한 없음' });
        await pool.query('INSERT INTO planner_habit_logs (habit_id, date) VALUES ($1, $2) ON CONFLICT (habit_id, date) DO NOTHING', [habitId, date]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/habit-logs', authMiddleware, async (req, res) => {
    try {
        const { habitId, date } = req.body;
        const h = await pool.query('SELECT user_id FROM planner_habits WHERE id = $1', [habitId]);
        if (!h.rows[0] || h.rows[0].user_id !== req.user.id) return res.status(403).json({ error: '권한 없음' });
        await pool.query('DELETE FROM planner_habit_logs WHERE habit_id = $1 AND date = $2', [habitId, date]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Calendar dots + 상세 데이터 (할일/메모/D-day)
app.get('/api/planner/calendar-dots', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query;
        const todos = await pool.query(
            "SELECT to_char(date, 'YYYY-MM-DD') as d, content, is_completed FROM planner_todos WHERE user_id = $1 AND to_char(date, 'YYYY-MM') = $2 ORDER BY is_completed, sort_order, id",
            [req.user.id, month]
        );
        const memos = await pool.query(
            "SELECT to_char(date, 'YYYY-MM-DD') as d, content FROM planner_memos WHERE user_id = $1 AND to_char(date, 'YYYY-MM') = $2",
            [req.user.id, month]
        );
        const ddays = await pool.query(
            "SELECT title, to_char(target_date, 'YYYY-MM-DD') as target_date FROM planner_ddays WHERE user_id = $1",
            [req.user.id]
        );
        // Group todos by date
        const todosByDate = {};
        todos.rows.forEach(r => {
            if (!todosByDate[r.d]) todosByDate[r.d] = [];
            todosByDate[r.d].push({ content: r.content, done: r.is_completed });
        });
        // Group memos by date
        const memosByDate = {};
        memos.rows.forEach(r => { memosByDate[r.d] = r.content; });
        // Group ddays by target_date
        const ddaysByDate = {};
        ddays.rows.forEach(r => {
            if (!ddaysByDate[r.target_date]) ddaysByDate[r.target_date] = [];
            ddaysByDate[r.target_date].push(r.title);
        });
        res.json({
            todoDates: Object.keys(todosByDate),
            memoDates: Object.keys(memosByDate),
            todosByDate, memosByDate, ddaysByDate
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === CJ 이월금액 API ===
app.get('/api/cj-carryover', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        const result = await pool.query(
            `SELECT *, to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date FROM cj_carryover WHERE month = $1`,
            [month]
        );
        res.json(result.rows[0] || { month, amount: 0, note: '', start_date: '', end_date: '' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cj-carryover', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month, amount, note, startDate, endDate } = req.body;
        const result = await pool.query(
            `INSERT INTO cj_carryover (month, amount, note, start_date, end_date, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (month) DO UPDATE SET amount = $2, note = $3, start_date = $4, end_date = $5, updated_by = $6, updated_at = NOW()
             RETURNING *`,
            [month, amount || 0, note || '', startDate || null, endDate || null, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Settlements API (인증 추가) ===

app.get('/api/settlements', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;

        // JSONB 안전 파싱 헬퍼
        function safeItems(val) {
            if (!val) return [];
            if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
            return Array.isArray(val) ? val : [];
        }

        // SQL로 settlements + 정확히 날짜 범위가 매칭되는 pricing만 조회 (fallback 없음)
        // jsonb_agg ORDER BY p.id ASC: 최신 pricing 기록(높은 id)이 나중에 적용되어 우선순위 가짐 (for-date API와 동일 방식)
        const settlementQuery = month
            ? `SELECT s.*,
                 (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
                  WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) as pricing_items
               FROM settlements s WHERE TO_CHAR(s.date, 'YYYY-MM') = $1 ORDER BY s.date, s.id`
            : `SELECT s.*,
                 (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
                  WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) as pricing_items
               FROM settlements s ORDER BY s.date, s.id`;

        const result = month
            ? await pool.query(settlementQuery, [month])
            : await pool.query(settlementQuery);

        // product_mappings 조회 (품목명 매칭 fallback용)
        const mappingsResult = await pool.query('SELECT * FROM product_mappings ORDER BY id');
        const mappingsByPartner = {};
        mappingsResult.rows.forEach(m => {
            if (!mappingsByPartner[m.partner]) mappingsByPartner[m.partner] = {};
            mappingsByPartner[m.partner][m.sales_name] = m.pricing_name;
        });

        const data = result.rows.map(row => {
            const items = safeItems(row.items);
            const settlementDate = normDateSafe(row.date);

            // SQL에서 가져온 pricing items 사용 (정확한 날짜 범위 매칭만, fallback 없음)
            const rawPricingItems = safeItems(row.pricing_items);

            // pricing의 품목별 단가 맵 생성 (jsonb_agg 결과는 배열의 배열)
            const priceMap = {};
            rawPricingItems.forEach(pItems => {
                const pArr = safeItems(pItems);
                pArr.forEach(item => {
                    if (item && item.name) priceMap[item.name] = Number(item.price) || 0;
                });
            });

            // 해당 거래처의 product_mappings
            const partnerMappings = mappingsByPartner[row.partner] || {};

            // items의 단가를 pricing 단가로 업데이트
            let updatedItems = items;
            if (Object.keys(priceMap).length > 0 && items.length > 0) {
                updatedItems = items.map(item => {
                    if (!item || !item.name) return item;
                    // 1차: 정확한 이름 매칭
                    if (priceMap[item.name] !== undefined) {
                        const newPrice = priceMap[item.name];
                        return { ...item, price: newPrice, subtotal: newPrice * (item.qty || 0) };
                    }
                    // 2차: product_mappings 테이블 기반 매칭
                    const mappedName = partnerMappings[item.name];
                    if (mappedName && priceMap[mappedName] !== undefined) {
                        const newPrice = priceMap[mappedName];
                        return { ...item, price: newPrice, subtotal: newPrice * (item.qty || 0) };
                    }
                    // 3차: 정확 substring 매칭 (무게·등급 구분) — 대표 7/21: 품목명 변경 시 특징매칭이 2.5kg↔4.5kg 뒤섞던 버그 방지
                    const exactHit = matchSettlementItemExact(item.name, priceMap);
                    if (exactHit) {
                        return { ...item, price: exactHit.price, subtotal: exactHit.price * (item.qty || 0) };
                    }
                    // 4차: 특징 기반 매칭 (fallback)
                    const featurePrice = matchItemToPricing(item.name, priceMap);
                    if (featurePrice !== undefined) {
                        return { ...item, price: featurePrice, subtotal: featurePrice * (item.qty || 0) };
                    }
                    // 미매칭 시 원본 유지
                    return item;
                });
            }

            const updatedAmount = updatedItems.length > 0
                ? updatedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0)
                : Number(row.amount);

            // 디버깅 로그: 모든 정산에 대해 pricing 매칭 상태 출력
            const origAmount = items.reduce((sum, i) => sum + ((i.price || 0) * (i.qty || 0)), 0);
            console.log(`[정산] ${settlementDate} ${row.partner} | DB금액=${origAmount} → 적용금액=${updatedAmount} | priceMap=${JSON.stringify(priceMap)} | items=${JSON.stringify(items.map(i => i.name))}`);

            return {
                id: row.id, date: row.date, partner: row.partner,
                amount: updatedAmount, items: updatedItems, fromPricing: row.from_pricing,
                isPaid: row.is_paid || false, paidAt: row.paid_at
            };
        });
        res.json(data);
    } catch (err) {
        console.error('[정산 조회 오류]', err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

// 특정 날짜에 적용되는 대성 박스타입 맵 — 같은 기간 중복 단가표가 여러 개일 수 있어 모두 병합
// (예: 06-08~06-14 기간에 단가표 2개 — 한쪽은 미니밤호박만, 한쪽은 레몬/세미놀 등. 둘 다 합쳐야 정상 차감)
// 박스 매칭 전용. 단가/금액 조회는 별개(getPricingForDate)이며 여기서 건드리지 않음.
// 거래처별 박스타입 맵 (품목명 → 박스종류) — 대표 7/20: 대성 전용에서 거래처 일반화
async function getBoxTypeMapFor(partner, dateStr) {
    const pr = await pool.query(
        `SELECT items FROM pricing
         WHERE partner = $1 AND start_date <= $2::date AND end_date >= $2::date
         ORDER BY id ASC`,
        [partner, dateStr]
    );
    const boxTypeMap = {};
    pr.rows.forEach(r => (r.items || []).forEach(p => {
        if (p.boxType && p.boxType !== '해당없음') boxTypeMap[p.name] = p.boxType;
    }));
    return { boxTypeMap, count: pr.rows.length };
}
async function getDaesongBoxTypeMap(dateStr) { return getBoxTypeMapFor('대성(시온)', dateStr); } // 하위호환

// [A안 폐기] 박스재고 자동 차감/복구 헬퍼 — 더 이상 호출되지 않음 (표시 시점 재계산으로 대체).
// settlement: { id, date, partner, items, box_adjusted_at? }, delta: +1 = 차감, -1 = 복구
// 현재 대성(시온)만 자체 박스 → daesong_stock에서 ± qty
// settlements.box_adjusted_at = NULL(미적용) / NOT NULL(적용 완료) — 이중 차감 방지
async function applyBoxAdjustment(settlement, delta) {
    try {
        if (!settlement || settlement.partner !== '대성(시온)') return false;
        const dateRaw = settlement.date;
        const dateStr = dateRaw instanceof Date
            ? `${dateRaw.getFullYear()}-${String(dateRaw.getMonth() + 1).padStart(2, '0')}-${String(dateRaw.getDate()).padStart(2, '0')}`
            : String(dateRaw).slice(0, 10);
        const items = (typeof settlement.items === 'string' ? JSON.parse(settlement.items) : settlement.items) || [];
        if (items.length === 0) return false;

        // 해당 날짜에 적용되는 pricing 조회 (대성) — 중복 단가표 모두 병합
        const { boxTypeMap, count } = await getDaesongBoxTypeMap(dateStr);
        if (count === 0) return false;
        if (Object.keys(boxTypeMap).length === 0) return false;

        // 정산 items → 박스타입별 수량 누적
        const adj = {};
        items.forEach(it => {
            const bt = boxTypeMap[it.name];
            if (bt) adj[bt] = (adj[bt] || 0) + (Number(it.qty) || 0);
        });
        if (Object.values(adj).every(q => q === 0)) return false;

        // box_inventory.daesong_stock 업데이트
        for (const [boxType, qty] of Object.entries(adj)) {
            if (qty === 0) continue;
            await pool.query(
                'UPDATE box_inventory SET daesong_stock = daesong_stock - $1, updated_at = NOW() WHERE product_name = $2',
                [delta * qty, boxType]
            );
        }

        // 적용 완료 표시 / 복구 시 표시 해제
        if (settlement.id) {
            if (delta > 0) {
                await pool.query(`UPDATE settlements SET box_adjusted_at = NOW() WHERE id = $1`, [settlement.id]);
            } else {
                await pool.query(`UPDATE settlements SET box_adjusted_at = NULL WHERE id = $1`, [settlement.id]);
            }
        }
        return true;
    } catch (err) {
        console.error('[box adj] error:', err.message);
        return false;
    }
}

app.post('/api/settlements', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, partner, amount, items, fromPricing } = req.body;
        const result = await pool.query(
            'INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [date, partner, amount || 0, JSON.stringify(items || []), fromPricing || false]
        );
        const row = result.rows[0];
        // [A안] 박스재고는 컬럼 차감 없이 표시 시점에 재계산됨 (applyBoxAdjustment 사용 중단)
        res.json({
            id: row.id, date: row.date, partner: row.partner,
            amount: Number(row.amount), items: row.items, fromPricing: row.from_pricing
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 디버깅: 특정 날짜/거래처의 pricing 매칭 상태 확인
app.get('/api/settlements/debug-pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, partner } = req.query;
        if (!date) return res.status(400).json({ error: 'date 파라미터 필요 (예: 2026-03-24)' });

        // 1. 해당 날짜의 정산 데이터
        let settQuery = 'SELECT id, date, partner, amount, items FROM settlements WHERE date = $1::date';
        const params = [date];
        if (partner) { settQuery += ' AND partner = $2'; params.push(partner); }
        const settlements = await pool.query(settQuery, params);

        // 2. 해당 날짜에 매칭되는 pricing
        let pricQuery = 'SELECT id, partner, start_date, end_date, items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date';
        const pricParams = [date];
        if (partner) { pricQuery += ' AND partner = $2'; pricParams.push(partner); }
        const pricings = await pool.query(pricQuery, pricParams);

        // 3. fallback pricing (기간 매칭 없을 때)
        let fallbackQuery = `SELECT id, partner, start_date, end_date, items FROM pricing
            WHERE end_date < $1::date ${partner ? 'AND partner = $2' : ''}
            ORDER BY end_date DESC LIMIT 3`;
        const fallbacks = await pool.query(fallbackQuery, partner ? [date, partner] : [date]);

        // 4. product_mappings
        let mapQuery = 'SELECT * FROM product_mappings';
        if (partner) { mapQuery += ' WHERE partner = $1'; }
        const mappings = await pool.query(mapQuery, partner ? [partner] : []);

        res.json({
            query: { date, partner },
            settlements: settlements.rows.map(r => ({
                id: r.id, date: normDateSafe(r.date), partner: r.partner,
                dbAmount: Number(r.amount),
                items: r.items
            })),
            matchedPricings: pricings.rows.map(r => ({
                id: r.id, partner: r.partner,
                startDate: normDateSafe(r.start_date), endDate: normDateSafe(r.end_date),
                items: r.items
            })),
            fallbackPricings: fallbacks.rows.map(r => ({
                id: r.id, partner: r.partner,
                startDate: normDateSafe(r.start_date), endDate: normDateSafe(r.end_date),
                items: r.items
            })),
            productMappings: mappings.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

app.delete('/api/settlements/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        // 삭제 전 settlement 조회 — 박스 차감 복구용 (이미 적용된 경우만)
        // [A안] 박스재고 복구 불필요 — 정산 삭제 시 표시 재고가 자동 재계산됨
        await pool.query('DELETE FROM settlements WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settlements/:id/toggle-paid', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE settlements SET is_paid = NOT COALESCE(is_paid, false), paid_at = CASE WHEN COALESCE(is_paid, false) = false THEN NOW() ELSE NULL END WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '정산 데이터를 찾을 수 없습니다' });
        const row = result.rows[0];
        res.json({ id: row.id, isPaid: row.is_paid, paidAt: row.paid_at });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 정산 항목 수정 API
app.put('/api/settlements/:id/items', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { items, amount } = req.body;
        const result = await pool.query(
            'UPDATE settlements SET items = $1, amount = $2 WHERE id = $3 RETURNING *',
            [JSON.stringify(items), amount, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '정산 데이터를 찾을 수 없습니다' });
        const row = result.rows[0];

        // [A안] 박스재고 재조정 불필요 — 정산 수정 시 표시 재고가 자동 재계산됨
        res.json({ id: row.id, date: row.date, partner: row.partner, amount: row.amount, items: row.items, isPaid: row.is_paid });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CJ택배 일별 결제완료 API
app.get('/api/cj-daily-payments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            result = await pool.query(
                "SELECT * FROM cj_daily_payments WHERE TO_CHAR(date, 'YYYY-MM') = $1 ORDER BY date",
                [month]
            );
        } else {
            result = await pool.query('SELECT * FROM cj_daily_payments ORDER BY date');
        }
        res.json(result.rows.map(r => ({
            id: r.id, date: r.date, amount: Number(r.amount), isPaid: r.is_paid || false, paidAt: r.paid_at
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cj-daily-payments/toggle-paid', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, amount } = req.body;
        if (!date) return res.status(400).json({ error: '날짜를 지정해주세요' });
        // UPSERT: 없으면 생성, 있으면 토글
        const existing = await pool.query('SELECT * FROM cj_daily_payments WHERE date = $1', [date]);
        let result;
        if (existing.rows.length === 0) {
            result = await pool.query(
                'INSERT INTO cj_daily_payments (date, amount, is_paid, paid_at) VALUES ($1, $2, true, NOW()) RETURNING *',
                [date, amount || 0]
            );
        } else {
            result = await pool.query(
                'UPDATE cj_daily_payments SET is_paid = NOT is_paid, paid_at = CASE WHEN is_paid = false THEN NOW() ELSE NULL END, amount = $2 WHERE date = $1 RETURNING *',
                [date, amount || existing.rows[0].amount]
            );
        }
        const r = result.rows[0];
        res.json({ id: r.id, date: r.date, amount: Number(r.amount), isPaid: r.is_paid, paidAt: r.paid_at });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 전체 미정산 합계 API (모든 월의 미결제 금액 합산)
app.get('/api/settlements/total-unpaid', authMiddleware, adminOnly, async (req, res) => {
    try {
        // JSONB 안전 파싱 헬퍼
        function safeItems(val) {
            if (!val) return [];
            if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
            return Array.isArray(val) ? val : [];
        }

        // 대성/효돈 미결제 합계 (pricing 동적 적용 - GET /api/settlements과 동일 방식)
        const partnerResult = await pool.query(`
            SELECT s.*,
                (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
                 WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) as pricing_items
            FROM settlements s
            WHERE COALESCE(s.is_paid, false) = false
            ORDER BY s.id
        `);

        // product_mappings 조회 (품목명 매칭 fallback용)
        const mappingsResult = await pool.query('SELECT * FROM product_mappings ORDER BY id');
        const mappingsByPartner = {};
        mappingsResult.rows.forEach(m => {
            if (!mappingsByPartner[m.partner]) mappingsByPartner[m.partner] = {};
            mappingsByPartner[m.partner][m.sales_name] = m.pricing_name;
        });

        let daesung = 0, hyodon = 0, aewol = 0;
        partnerResult.rows.forEach(row => {
            const items = safeItems(row.items);
            const rawPricingItems = safeItems(row.pricing_items);

            // pricing 단가 맵 생성 (최신 id가 나중에 적용되어 우선)
            const priceMap = {};
            rawPricingItems.forEach(pItems => {
                const pArr = safeItems(pItems);
                pArr.forEach(item => {
                    if (item && item.name) priceMap[item.name] = Number(item.price) || 0;
                });
            });

            const partnerMappings = mappingsByPartner[row.partner] || {};

            // items의 단가를 pricing 단가로 적용하여 금액 계산
            let amount;
            if (Object.keys(priceMap).length > 0 && items.length > 0) {
                amount = items.reduce((sum, item) => {
                    if (!item || !item.name) return sum + ((item && item.price || 0) * (item && item.qty || 0));
                    // 1차: 정확한 이름 매칭
                    if (priceMap[item.name] !== undefined) {
                        return sum + priceMap[item.name] * (item.qty || 0);
                    }
                    // 2차: product_mappings 기반 매칭
                    const mappedName = partnerMappings[item.name];
                    if (mappedName && priceMap[mappedName] !== undefined) {
                        return sum + priceMap[mappedName] * (item.qty || 0);
                    }
                    // 3차: 정확 substring 매칭 (무게·등급 구분) — 대표 7/21: 품목명 변경 시 2.5kg↔4.5kg 뒤섞임 방지
                    const exactHit = matchSettlementItemExact(item.name, priceMap);
                    if (exactHit) {
                        return sum + exactHit.price * (item.qty || 0);
                    }
                    // 4차: 특징 기반 매칭 (fallback)
                    const featurePrice = matchItemToPricing(item.name, priceMap);
                    if (featurePrice !== undefined) {
                        return sum + featurePrice * (item.qty || 0);
                    }
                    // 미매칭 시 원본 가격 사용
                    return sum + ((item.price || 0) * (item.qty || 0));
                }, 0);
            } else {
                amount = items.length > 0
                    ? items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0)
                    : Number(row.amount);
            }

            if (row.partner === '대성(시온)') daesung += amount;
            else if (row.partner === '효돈농협') hyodon += amount;
            else if (row.partner === '기타거래처') aewol += amount;
        });

        // CJ택배: 미결제 날짜의 박스수 합산 × 3100 + 모든 이월금액
        const cjBoxResult = await pool.query(`
            SELECT s.date, SUM(
                COALESCE((SELECT SUM((item->>'qty')::int) FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(s.items) = 'array' THEN s.items ELSE '[]'::jsonb END
                ) item), 0)
            ) as box_count
            FROM settlements s
            WHERE (s.partner = '대성(시온)' OR s.partner = '효돈농협' OR s.partner = '기타거래처')
            GROUP BY s.date
        `);
        // CJ 일별 결제완료 상태 전체 조회
        const cjPaidResult = await pool.query(`SELECT date, is_paid FROM cj_daily_payments WHERE is_paid = true`);
        const cjPaidDates = new Set(cjPaidResult.rows.map(r => {
            const d = new Date(r.date);
            return d.toISOString().split('T')[0];
        }));
        let cjTotal = 0;
        cjBoxResult.rows.forEach(r => {
            const dateStr = new Date(r.date).toISOString().split('T')[0];
            if (!cjPaidDates.has(dateStr)) {
                cjTotal += Number(r.box_count) * 3100;
            }
        });

        // CJ 이월금액 합산 (모든 월)
        const carryoverResult = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM cj_carryover`);
        cjTotal += Number(carryoverResult.rows[0].total);

        // 선결제 잔액 차감
        const prepayResult = await pool.query(`
            SELECT partner, COALESCE(SUM(amount), 0) as total
            FROM prepayments
            GROUP BY partner
        `);
        let daesungPrepay = 0, hyodonPrepay = 0, aewolPrepay = 0;
        prepayResult.rows.forEach(r => {
            if (r.partner === '대성(시온)') daesungPrepay = Number(r.total);
            else if (r.partner === '효돈농협') hyodonPrepay = Number(r.total);
            else if (r.partner === '기타거래처') aewolPrepay = Number(r.total);
        });

        const daesungNet = daesung - daesungPrepay;
        const hyodonNet = hyodon - hyodonPrepay;
        const aewolNet = aewol - aewolPrepay;
        const total = daesungNet + hyodonNet + aewolNet + cjTotal;

        res.json({ daesung: daesungNet, hyodon: hyodonNet, aewol: aewolNet, cj: cjTotal, total });
    } catch (err) {
        console.error('전체 미정산 합계 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// CJ 자동계산: 해당 날짜 대성+효돈 박스수 합산

app.get('/api/settlements/box-count', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: '날짜를 지정해주세요' });

        const result = await pool.query(
            "SELECT partner, items FROM settlements WHERE date = $1 AND partner IN ('대성(시온)', '효돈농협', '기타거래처')",
            [date]
        );

        let daesung = 0, hyodon = 0, aewol = 0;
        result.rows.forEach(row => {
            const items = row.items || [];
            const qty = items.reduce((sum, item) => sum + (item.qty || 0), 0);
            if (row.partner === '대성(시온)') daesung += qty;
            else if (row.partner === '효돈농협') hyodon += qty;
            else if (row.partner === '기타거래처') aewol += qty;
        });

        res.json({ totalBoxes: daesung + hyodon + aewol, daesung, hyodon, aewol });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Prepayments API (선결제) ===

app.get('/api/prepayments', authMiddleware, async (req, res) => {
    try {
        const { partner } = req.query;
        let result;
        if (partner) {
            result = await pool.query('SELECT * FROM prepayments WHERE partner = $1 ORDER BY date DESC, id DESC', [partner]);
        } else {
            result = await pool.query('SELECT * FROM prepayments ORDER BY date DESC, id DESC');
        }
        res.json(result.rows.map(r => ({
            id: r.id, partner: r.partner, amount: Number(r.amount),
            date: r.date, note: r.note
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/prepayments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner, amount, date, note } = req.body;
        if (!partner || !amount || !date) return res.status(400).json({ error: '거래처, 금액, 날짜는 필수입니다' });

        const result = await pool.query(
            'INSERT INTO prepayments (partner, amount, date, note) VALUES ($1, $2, $3, $4) RETURNING *',
            [partner, amount, date, note || '']
        );
        const r = result.rows[0];
        res.json({ id: r.id, partner: r.partner, amount: Number(r.amount), date: r.date, note: r.note });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/prepayments/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM prepayments WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/prepayments/balance', authMiddleware, async (req, res) => {
    try {
        // 거래처별 선결제 합계
        const prepayResult = await pool.query(
            "SELECT partner, COALESCE(SUM(amount), 0) as total FROM prepayments WHERE partner IN ('대성(시온)', '효돈농협', '기타거래처') GROUP BY partner"
        );
        // 거래처별 정산 합계 (실제 정산만 - 품목별 금액 세팅 제외)
        const settleResult = await pool.query(
            "SELECT partner, COALESCE(SUM(amount), 0) as total FROM settlements WHERE partner IN ('대성(시온)', '효돈농협', '기타거래처') AND (from_pricing IS NULL OR from_pricing = false) GROUP BY partner"
        );

        const prepayMap = {};
        prepayResult.rows.forEach(r => { prepayMap[r.partner] = Number(r.total); });
        const settleMap = {};
        settleResult.rows.forEach(r => { settleMap[r.partner] = Number(r.total); });

        const partners = ['대성(시온)', '효돈농협', '기타거래처'];
        const balances = partners.map(p => ({
            partner: p,
            prepaidTotal: prepayMap[p] || 0,
            settledTotal: settleMap[p] || 0,
            balance: Math.max(0, (prepayMap[p] || 0) - (settleMap[p] || 0))
        }));

        res.json(balances);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Product Mappings API (품목 매칭 기억) ===

app.get('/api/product-mappings', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner } = req.query;
        let result;
        if (partner) {
            result = await pool.query('SELECT * FROM product_mappings WHERE partner = $1 ORDER BY id', [partner]);
        } else {
            result = await pool.query('SELECT * FROM product_mappings ORDER BY id');
        }
        res.json(result.rows.map(r => ({
            id: r.id, sales_name: r.sales_name, pricing_name: r.pricing_name, partner: r.partner
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/product-mappings', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { salesName, pricingName, partner } = req.body;
        if (!salesName || !pricingName || !partner) return res.status(400).json({ error: '필수 항목을 입력해주세요' });

        const result = await pool.query(
            `INSERT INTO product_mappings (sales_name, pricing_name, partner) VALUES ($1, $2, $3)
             ON CONFLICT (sales_name, partner) DO UPDATE SET pricing_name = $2
             RETURNING *`,
            [salesName, pricingName, partner]
        );
        const r = result.rows[0];
        res.json({ id: r.id, sales_name: r.sales_name, pricing_name: r.pricing_name, partner: r.partner });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/product-mappings/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM product_mappings WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Settlement Completions API (주간 정산 완료) ===

app.get('/api/settlement-completions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            // 해당 월에 걸치는 주차들 조회
            const startOfMonth = month + '-01';
            const endOfMonth = month + '-31';
            result = await pool.query(
                "SELECT sc.*, u.name as completed_by_name FROM settlement_completions sc LEFT JOIN users u ON sc.completed_by = u.id WHERE sc.week_start <= $2 AND sc.week_end >= $1 ORDER BY sc.week_start, sc.partner",
                [startOfMonth, endOfMonth]
            );
        } else {
            result = await pool.query(
                'SELECT sc.*, u.name as completed_by_name FROM settlement_completions sc LEFT JOIN users u ON sc.completed_by = u.id ORDER BY sc.week_start DESC, sc.partner'
            );
        }
        res.json(result.rows.map(r => ({
            id: r.id, partner: r.partner, weekStart: r.week_start, weekEnd: r.week_end,
            totalAmount: Number(r.total_amount), completedBy: r.completed_by,
            completedByName: r.completed_by_name, completedAt: r.completed_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settlement-completions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner, weekStart, weekEnd, totalAmount } = req.body;
        if (!partner || !weekStart || !weekEnd) return res.status(400).json({ error: '필수 항목을 입력해주세요' });

        const result = await pool.query(
            `INSERT INTO settlement_completions (partner, week_start, week_end, total_amount, completed_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (partner, week_start) DO UPDATE SET total_amount = $4, completed_by = $5, completed_at = NOW()
             RETURNING *`,
            [partner, weekStart, weekEnd, totalAmount || 0, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/settlement-completions/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM settlement_completions WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Pricing API (인증 추가) ===

// 날짜를 YYYY-MM-DD로 안전하게 변환 (timezone 영향 없이)
function normDateSafe(d) {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 품목명에서 과일명/용도/중량 특징 추출 (프론트엔드 extractFeatures와 동일)
function extractFeatures(text) {
    const t = (text || '');
    let growType = '';
    if (/노지/.test(t)) growType = '노지';
    else if (/하우스/.test(t)) growType = '하우스';
    else if (/비가림/.test(t)) growType = '비가림';
    else if (/블러드/.test(t)) growType = '블러드';

    let fruit = null;
    if (/3종세트/.test(t)) fruit = '3종세트';
    else if (/블러드오렌지|블러드/.test(t)) fruit = '블러드오렌지';
    else if (/비가림|감귤/.test(t)) fruit = '비가림귤';
    else if (/수라향/.test(t)) fruit = '수라향';
    else if (/자몽/.test(t)) fruit = '자몽';
    else if (/천혜향/.test(t)) fruit = '천혜향';
    else if (/레드향/.test(t)) fruit = '레드향';
    else if (/한라봉/.test(t)) fruit = '한라봉';
    else if (/레몬/.test(t)) fruit = '레몬';
    else if (/카라향/.test(t)) fruit = '카라향';
    else if (/하귤/.test(t)) fruit = '하귤';

    let grade = null;
    if (/프리미엄\s*로얄/.test(t)) grade = '선물용';
    else if (/로얄과/.test(t)) grade = '로얄과';
    else if (/소과/.test(t)) grade = '소과';
    else if (/중대과/.test(t)) grade = '중대과';
    else if (/못난이/.test(t)) grade = '못난이';
    else if (/선물용/.test(t)) grade = '선물용';
    else if (/프리미엄/.test(t)) grade = '선물용';
    else if (/가정용/.test(t)) grade = '가정용';

    let size = '';
    if (/꼬마/.test(t)) size = '꼬마';

    let weight = null;
    const wMatch = t.match(/(\d+(?:\.\d+)?)\s*kg/i); // 대표 7/21: 소수점 허용 — "2.5kg"/"4.5kg"이 둘 다 "5kg"으로 뭉개져 단가 뒤섞이던 버그 수정
    if (wMatch) weight = wMatch[1] + 'kg';

    return { fruit, grade, weight, growType, size };
}

// pricing 단가맵에서 특징 기반 매칭 (서버용 - 프론트엔드 matchSalesToPricing과 동일 로직)
function matchItemToPricing(itemName, priceMap) {
    const sf = extractFeatures(itemName);
    if (!sf.fruit) return undefined;

    let bestMatch = null, bestScore = 0;
    for (const [pricingName, price] of Object.entries(priceMap)) {
        const pf = extractFeatures(pricingName);
        if (!pf.fruit || sf.fruit !== pf.fruit) continue;

        let score = 1, mismatch = false;
        if (sf.size !== pf.size) mismatch = true;
        if (sf.size && pf.size && sf.size === pf.size) score += 3;
        if (sf.growType || pf.growType) {
            if (sf.growType === pf.growType) score += 3;
            else mismatch = true;
        }
        if (sf.weight && pf.weight) {
            if (sf.weight === pf.weight) score += 2;
            else mismatch = true;
        }
        if (sf.grade && pf.grade) {
            if (sf.grade === pf.grade) score += 2;
            else mismatch = true;
        }
        if (mismatch) continue;
        if (score > bestScore) { bestScore = score; bestMatch = { name: pricingName, price }; }
    }
    return bestMatch ? bestMatch.price : undefined;
}

// 송장변환·중간발주용 품목 카탈로그 (대표 7/21): 품목명·거래처만 (단가 제외) — 직원도 매칭·색상·필터 쓸 수 있게 authMiddleware만
app.get('/api/invoice/catalog', authMiddleware, async (req, res) => {
    try {
        const date = String(req.query.date || kstTodayStr()).slice(0, 10);
        const r = await pool.query(
            `SELECT partner, items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [date]);
        const byPartner = {};
        r.rows.forEach(row => {
            const s = byPartner[row.partner] = byPartner[row.partner] || [];
            (row.items || []).forEach(it => { if (it && it.name && !s.includes(it.name)) s.push(it.name); });
        });
        res.json({ byPartner });
    } catch (err) { handleAdminErr(res, err); }
});

app.get('/api/pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pricing ORDER BY start_date DESC, id DESC');
        const data = result.rows.map(row => ({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        }));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 특정 날짜에 해당하는 품목별 금액 조회 (SQL에서 직접 필터링)
app.get('/api/pricing/for-date', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner, date } = req.query;
        if (!partner || !date) return res.status(400).json({ error: 'partner와 date 파라미터가 필요합니다' });

        // 정산 날짜가 기간에 포함되는 pricing만 조회 (fallback 없음: 정확한 날짜 범위만 적용)
        const result = await pool.query(
            'SELECT * FROM pricing WHERE partner = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY id ASC',
            [partner, date]
        );

        const data = result.rows.map(row => ({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        }));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { startDate, endDate, partner, items } = req.body;
        const result = await pool.query(
            'INSERT INTO pricing (start_date, end_date, partner, items) VALUES ($1, $2, $3, $4) RETURNING *',
            [startDate, endDate, partner, JSON.stringify(items || [])]
        );
        const row = result.rows[0];

        res.json({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 단가표 제자리 수정 (기간/품목/박스매핑 갱신) — 삭제 후 재생성으로 인한 중복 표 방지
app.put('/api/pricing/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { startDate, endDate, partner, items } = req.body;
        const result = await pool.query(
            `UPDATE pricing SET
                start_date = COALESCE($1, start_date),
                end_date   = COALESCE($2, end_date),
                partner    = COALESCE($3, partner),
                items      = COALESCE($4, items)
             WHERE id = $5 RETURNING *`,
            [startDate || null, endDate || null, partner || null,
             items ? JSON.stringify(items) : null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '해당 단가표가 없습니다.' });
        const row = result.rows[0];
        res.json({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/pricing/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM pricing WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === CS Categories API ===
app.get('/api/cs-categories', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cs_categories ORDER BY sort_order, id');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cs-categories', authMiddleware, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: '카테고리 이름을 입력해주세요' });
        const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM cs_categories');
        const result = await pool.query(
            'INSERT INTO cs_categories (name, color, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [name.trim(), color || '#9E9E9E', maxOrder.rows[0].next]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: '이미 존재하는 카테고리입니다' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/cs-categories/:id', authMiddleware, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: '카테고리 이름을 입력해주세요' });
        // 기존 이름 조회 (템플릿 카테고리명 업데이트용)
        const old = await pool.query('SELECT name FROM cs_categories WHERE id = $1', [req.params.id]);
        if (old.rows.length === 0) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
        const oldName = old.rows[0].name;
        const result = await pool.query(
            'UPDATE cs_categories SET name = $1, color = $2 WHERE id = $3 RETURNING *',
            [name.trim(), color || '#9E9E9E', req.params.id]
        );
        // 관련 템플릿의 카테고리명도 업데이트
        if (oldName !== name.trim()) {
            await pool.query('UPDATE cs_templates SET category = $1 WHERE category = $2', [name.trim(), oldName]);
        }
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: '이미 존재하는 카테고리입니다' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/cs-categories/:id', authMiddleware, async (req, res) => {
    try {
        const cat = await pool.query('SELECT name FROM cs_categories WHERE id = $1', [req.params.id]);
        if (cat.rows.length === 0) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
        // 해당 카테고리의 템플릿을 "미분류"로 이동
        await pool.query('UPDATE cs_templates SET category = $1 WHERE category = $2', ['미분류', cat.rows[0].name]);
        await pool.query('DELETE FROM cs_categories WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === CS Templates API ===
app.get('/api/cs-templates', authMiddleware, async (req, res) => {
    try {
        const { category } = req.query;
        let result;
        if (category) {
            result = await pool.query('SELECT * FROM cs_templates WHERE category = $1 ORDER BY sort_order, id', [category]);
        } else {
            result = await pool.query('SELECT * FROM cs_templates ORDER BY category, sort_order, id');
        }
        res.json(result.rows.map(r => ({ ...r, createdBy: r.created_by, createdAt: r.created_at, sortOrder: r.sort_order })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cs-templates', authMiddleware, async (req, res) => {
    try {
        const { category, title, content, sortOrder } = req.body;
        const result = await pool.query(
            'INSERT INTO cs_templates (category, title, content, sort_order, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [category, title, content, sortOrder || 0, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/cs-templates/:id', authMiddleware, async (req, res) => {
    try {
        const { category, title, content } = req.body;
        const result = await pool.query(
            'UPDATE cs_templates SET category = $1, title = $2, content = $3 WHERE id = $4 RETURNING *',
            [category, title, content, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cs-templates/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM cs_templates WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Work Logs API (업무일지) ===
// 내 업무일지 조회 (월별)
app.get('/api/work-logs', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query; // '2026-03'
        let startDate, endDate;
        if (month) {
            startDate = `${month}-01`;
            const [y, m] = month.split('-').map(Number);
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        } else {
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        }
        const result = await pool.query(
            'SELECT id, date, content, created_at FROM work_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
            [req.user.id, startDate, endDate]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('업무일지 조회 오류:', err);
        res.status(500).json({ error: '업무일지 조회 실패' });
    }
});

// 대표 전용: 특정 직원의 업무일지 조회 (관리자라도 대표만 타인 업무일지 열람 가능)
app.get('/api/work-logs/admin', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (req.user.position !== '대표') {
            return res.status(403).json({ error: '다른 직원의 업무일지는 대표만 조회할 수 있습니다' });
        }
        const { month, user_id } = req.query;
        if (!user_id) return res.status(400).json({ error: '사용자 ID가 필요합니다' });
        let startDate, endDate;
        if (month) {
            startDate = `${month}-01`;
            const [y, m] = month.split('-').map(Number);
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        } else {
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        }
        const result = await pool.query(
            'SELECT id, date, content, created_at FROM work_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
            [user_id, startDate, endDate]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('업무일지 관리자 조회 오류:', err);
        res.status(500).json({ error: '업무일지 조회 실패' });
    }
});

// 업무일지 작성 (upsert)
app.post('/api/work-logs', authMiddleware, async (req, res) => {
    try {
        const { date, content } = req.body;
        if (!date || !content) return res.status(400).json({ error: '날짜와 내용은 필수입니다' });
        const result = await pool.query(
            `INSERT INTO work_logs (user_id, date, content) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, date) DO UPDATE SET content = $3
             RETURNING *`,
            [req.user.id, date, content]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('업무일지 저장 오류:', err);
        res.status(500).json({ error: '업무일지 저장 실패' });
    }
});

// 업무일지 수정
app.put('/api/work-logs/:id', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: '내용은 필수입니다' });
        const result = await pool.query(
            'UPDATE work_logs SET content = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [content, req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '업무일지를 찾을 수 없습니다' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('업무일지 수정 오류:', err);
        res.status(500).json({ error: '업무일지 수정 실패' });
    }
});

// 업무일지 삭제
app.delete('/api/work-logs/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM work_logs WHERE id = $1 AND user_id = $2 RETURNING *',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '업무일지를 찾을 수 없습니다' });
        res.json({ success: true });
    } catch (err) {
        console.error('업무일지 삭제 오류:', err);
        res.status(500).json({ error: '업무일지 삭제 실패' });
    }
});

// === 연차 조정 API ===

// 연차 조정 등록 (관리자 가능)
app.post('/api/leave-adjustments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { user_id, adjustment, reason } = req.body;
        if (!user_id || adjustment === undefined || !reason) {
            return res.status(400).json({ error: '대상 직원, 조정값, 사유를 입력해주세요' });
        }
        const adj = Number(adjustment);
        if (isNaN(adj) || adj === 0) {
            return res.status(400).json({ error: '유효한 조정값을 입력해주세요' });
        }

        // 이력 저장
        const result = await pool.query(
            'INSERT INTO leave_adjustments (user_id, adjustment, reason, adjusted_by) VALUES ($1, $2, $3, $4) RETURNING *',
            [user_id, adj, reason, req.user.id]
        );

        // users.annual_leave 업데이트
        await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [adj, user_id]);

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('POST /api/leave-adjustments error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 연차 조정 내역 조회 (관리자)
app.get('/api/leave-adjustments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { employeeId, startDate, endDate } = req.query;
        let query = `
            SELECT la.*, u.name as user_name, u.position as user_position,
                   ab.name as adjusted_by_name
            FROM leave_adjustments la
            JOIN users u ON la.user_id = u.id
            JOIN users ab ON la.adjusted_by = ab.id
        `;
        const values = [];
        const conditions = [];
        let idx = 1;

        if (employeeId) {
            conditions.push(`la.user_id = $${idx++}`);
            values.push(Number(employeeId));
        }
        if (startDate) {
            conditions.push(`la.created_at >= $${idx++}`);
            values.push(startDate);
        }
        if (endDate) {
            conditions.push(`la.created_at <= ($${idx++})::date + INTERVAL '1 day'`);
            values.push(endDate);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY la.created_at DESC';

        const result = await pool.query(query, values);
        const adjRows = result.rows.map(r => ({
            id: r.id,
            source: 'adjustment',
            userId: r.user_id,
            userName: r.user_name,
            userPosition: r.user_position,
            adjustment: Number(r.adjustment),
            reason: r.reason,
            adjustedByName: r.adjusted_by_name,
            createdAt: r.created_at
        }));

        // 수기 이력의 추가일수(연차+, 대체근무 등)도 조정내역에 포함
        // deducted_leave < 0 은 일반 휴가신청에서는 생기지 않고 수기 추가 조정에서만 발생
        let docQuery = `
            SELECT d.id, d.applicant_id AS user_id, u.name AS user_name, u.position AS user_position,
                   d.deducted_leave, d.reason, d.sub_type, d.start_date, d.created_at,
                   ab.name AS adjusted_by_name
            FROM documents d
            JOIN users u ON d.applicant_id = u.id
            LEFT JOIN users ab ON d.approver_id = ab.id
            WHERE d.type = 'vacation' AND d.status = 'approved' AND d.deducted_leave < 0
        `;
        const docValues = [];
        const docConds = [];
        let didx = 1;
        if (employeeId) { docConds.push(`d.applicant_id = $${didx++}`); docValues.push(Number(employeeId)); }
        if (startDate)  { docConds.push(`d.start_date >= $${didx++}`); docValues.push(startDate); }
        if (endDate)    { docConds.push(`d.start_date <= $${didx++}`); docValues.push(endDate); }
        if (docConds.length > 0) docQuery += ' AND ' + docConds.join(' AND ');
        docQuery += ' ORDER BY d.start_date DESC';

        const docResult = await pool.query(docQuery, docValues);
        const docRows = docResult.rows.map(r => ({
            id: 'doc-' + r.id,
            source: 'document',
            userId: r.user_id,
            userName: r.user_name,
            userPosition: r.user_position,
            adjustment: -Number(r.deducted_leave),  // 음수 차감 → 양수 추가(+)
            reason: (r.sub_type ? `[${r.sub_type}] ` : '') + (r.reason || ''),
            adjustedByName: r.adjusted_by_name || '',
            createdAt: r.start_date  // 실제 발생일 기준 표시
        }));

        // 두 소스 통합 후 날짜 내림차순 정렬
        const merged = adjRows.concat(docRows).sort((a, b) => {
            const da = new Date(a.createdAt).getTime();
            const db = new Date(b.createdAt).getTime();
            return db - da;
        });
        res.json(merged);
    } catch (err) {
        console.error('GET /api/leave-adjustments error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 연차 조정 삭제/취소 (관리자 가능, annual_leave 원복)
app.delete('/api/leave-adjustments/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        // 기존 조정 내역 조회
        const existing = await pool.query('SELECT * FROM leave_adjustments WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: '조정 내역을 찾을 수 없습니다' });
        }
        const record = existing.rows[0];

        // annual_leave 원복 (반대 값 적용)
        await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [Number(record.adjustment), record.user_id]);

        // 이력 삭제
        await pool.query('DELETE FROM leave_adjustments WHERE id = $1', [id]);

        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/leave-adjustments error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === 정산현황 API ===

// 전체 날짜 목록 + 데이터 조회
app.get('/api/settlement-status', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM settlement_status ORDER BY date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/settlement-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 날짜 추가/수정 (upsert)
app.post('/api/settlement-status', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, current_cash, settlement_scheduled, unsettled, coupang_unpaid, selfmall_unpaid,
                ad_naver, ad_gfa, card_fee, corp_card, hyodong, daesong, aewol, delivery, memo } = req.body;
        if (!date) return res.status(400).json({ error: '날짜가 필요합니다' });

        const result = await pool.query(`
            INSERT INTO settlement_status (date, current_cash, settlement_scheduled, unsettled, coupang_unpaid, selfmall_unpaid,
                ad_naver, ad_gfa, card_fee, corp_card, hyodong, daesong, aewol, delivery, memo, updated_by, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
            ON CONFLICT (date) DO UPDATE SET
                current_cash=EXCLUDED.current_cash, settlement_scheduled=EXCLUDED.settlement_scheduled,
                unsettled=EXCLUDED.unsettled, coupang_unpaid=EXCLUDED.coupang_unpaid, selfmall_unpaid=EXCLUDED.selfmall_unpaid,
                ad_naver=EXCLUDED.ad_naver, ad_gfa=EXCLUDED.ad_gfa, card_fee=EXCLUDED.card_fee, corp_card=EXCLUDED.corp_card,
                hyodong=EXCLUDED.hyodong, daesong=EXCLUDED.daesong, aewol=EXCLUDED.aewol, delivery=EXCLUDED.delivery,
                memo=EXCLUDED.memo, updated_by=EXCLUDED.updated_by, updated_at=NOW()
            RETURNING *
        `, [date, current_cash||0, settlement_scheduled||0, unsettled||0, coupang_unpaid||0, selfmall_unpaid||0,
            ad_naver||0, ad_gfa||0, card_fee||0, corp_card||0, hyodong||0, daesong||0, aewol||0, delivery||0, memo||'', req.user.id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/settlement-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 날짜 삭제
app.delete('/api/settlement-status/:date', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM settlement_status WHERE date = $1', [req.params.date]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/settlement-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// === 관리 API (/api/admin/*) — 2단계: 일정/기안/품목/정산 ===
// MCP 서버(3단계)와 공유하는 서비스 함수 + REST 라우트.
// 파괴적 액션은 confirm:true 필수. 모든 쓰기는 audit_logs 기록.
// ============================================================

// audit 기록 헬퍼 (실패해도 본 작업은 진행)
async function writeAudit({ action, targetType, targetId = null, changes = null, source = 'admin_api', actor = null }) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [action, targetType, targetId, changes ? JSON.stringify(changes) : null, source,
             actor?.id ?? null, actor?.name ?? null]
        );
    } catch (e) { console.error('audit 기록 실패:', e.message); }
}

// --- 일정 서비스 ---
const SCHEDULE_CATEGORIES = ['휴가', '톡톡발송', '문자발송', '할인·이벤트', '일반'];
async function svcListSchedules({ from, to }) {
    const cond = ['s.is_deleted = false'];
    const params = [];
    // 기간형(end_date) 일정은 조회 범위와 겹치면 포함 (3단계)
    if (from) { params.push(from); cond.push(`COALESCE(s.end_date, s.date) >= $${params.length}`); }
    if (to) { params.push(to); cond.push(`s.date <= $${params.length}`); }
    const r = await pool.query(
        `SELECT s.id, s.date, s.end_date, s.category, s.title, s.type, s.start_time, s.content, s.is_completed,
                s.user_id, u.name AS user_name
         FROM schedules s LEFT JOIN users u ON s.user_id = u.id
         WHERE ${cond.join(' AND ')}
         ORDER BY s.date ASC, s.id ASC`, params);
    return r.rows;
}
async function svcCreateSchedule({ date, title, type = 'normal', start_time = null, content = null, user_id, category = '일반', end_date = null }, actor) {
    if (!date || !title) throw { status: 400, message: '날짜(date)와 제목(title)은 필수입니다' };
    const cat = SCHEDULE_CATEGORIES.includes(category) ? category : '일반';
    const uid = user_id ?? actor?.id ?? null;
    const r = await pool.query(
        `INSERT INTO schedules (user_id, date, title, type, start_time, content, category, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [uid, date, title, type, start_time, content, cat, end_date || null]);
    const row = r.rows[0];
    await writeAudit({ action: 'create', targetType: 'schedule', targetId: row.id, changes: { after: row }, source: actor?.source, actor });
    return row;
}
async function svcUpdateSchedule(id, patch, actor) {
    const cur = await pool.query('SELECT * FROM schedules WHERE id=$1 AND is_deleted=false', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '일정을 찾을 수 없습니다' };
    const before = cur.rows[0];
    const fields = ['date', 'title', 'type', 'start_time', 'content', 'is_completed'];
    const sets = []; const params = [];
    for (const f of fields) {
        if (patch[f] !== undefined) { params.push(patch[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (sets.length === 0) throw { status: 400, message: '수정할 내용이 없습니다' };
    params.push(id);
    const r = await pool.query(`UPDATE schedules SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
    const after = r.rows[0];
    await writeAudit({ action: 'update', targetType: 'schedule', targetId: id, changes: { before, after }, source: actor?.source, actor });
    return after;
}
async function svcSoftDeleteSchedule(id, actor) {
    const cur = await pool.query('SELECT * FROM schedules WHERE id=$1 AND is_deleted=false', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '일정을 찾을 수 없습니다' };
    const r = await pool.query('UPDATE schedules SET is_deleted=true WHERE id=$1 RETURNING *', [id]);
    await writeAudit({ action: 'delete', targetType: 'schedule', targetId: id, changes: { before: cur.rows[0] }, source: actor?.source, actor });
    return r.rows[0];
}

// --- 기안(결재) 서비스 (1차: 조회 전용, 승인/반려는 2차) ---
async function svcListApprovals(status = 'pending') {
    const r = await pool.query(
        `SELECT d.id, d.type, d.sub_type, d.status, d.start_date, d.end_date, d.reason,
                d.deducted_leave, d.created_at, a.name AS applicant_name, ap.name AS approver_name
         FROM documents d
         LEFT JOIN users a ON d.applicant_id = a.id
         LEFT JOIN users ap ON d.approver_id = ap.id
         WHERE d.status = $1
         ORDER BY d.created_at DESC`, [status]);
    return r.rows;
}
async function svcGetApprovalDetail(id) {
    const r = await pool.query(
        `SELECT d.*, a.name AS applicant_name, ap.name AS approver_name
         FROM documents d
         LEFT JOIN users a ON d.applicant_id = a.id
         LEFT JOIN users ap ON d.approver_id = ap.id
         WHERE d.id = $1`, [id]);
    if (r.rows.length === 0) throw { status: 404, message: '기안을 찾을 수 없습니다' };
    return r.rows[0];
}

// --- 품목 서비스 ---
async function svcListItems({ q = '', includeInactive = false } = {}) {
    const cond = ['is_deleted = false'];
    const params = [];
    if (!includeInactive) cond.push('is_active = true');
    if (q) { params.push(`%${q}%`); cond.push(`(name ILIKE $${params.length} OR alias ILIKE $${params.length})`); }
    const r = await pool.query(
        `SELECT id, name, alias, spec, is_active, created_at, updated_at
         FROM items WHERE ${cond.join(' AND ')} ORDER BY id ASC`, params);
    return r.rows;
}
async function svcCreateItem({ name, alias = '', spec = '' }, actor) {
    if (!name || !String(name).trim()) throw { status: 400, message: '품목명(name)은 필수입니다' };
    const r = await pool.query(
        `INSERT INTO items (name, alias, spec) VALUES ($1,$2,$3) RETURNING *`,
        [String(name).trim(), alias, spec]);
    const row = r.rows[0];
    await writeAudit({ action: 'create', targetType: 'item', targetId: row.id, changes: { after: row }, source: actor?.source, actor });
    return row;
}
async function svcUpdateItem(id, patch, actor) {
    const cur = await pool.query('SELECT * FROM items WHERE id=$1 AND is_deleted=false', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '품목을 찾을 수 없습니다' };
    const before = cur.rows[0];
    const fields = ['name', 'alias', 'spec', 'is_active'];
    const sets = ['updated_at = NOW()']; const params = [];
    for (const f of fields) {
        if (patch[f] !== undefined) { params.push(patch[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (params.length === 0) throw { status: 400, message: '수정할 내용이 없습니다' };
    params.push(id);
    const r = await pool.query(`UPDATE items SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
    const after = r.rows[0];
    await writeAudit({ action: 'update', targetType: 'item', targetId: id, changes: { before, after }, source: actor?.source, actor });
    return after;
}
async function svcDeactivateItem(id, actor) {
    const cur = await pool.query('SELECT * FROM items WHERE id=$1 AND is_deleted=false', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '품목을 찾을 수 없습니다' };
    const r = await pool.query('UPDATE items SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING *', [id]);
    await writeAudit({ action: 'deactivate', targetType: 'item', targetId: id, changes: { before: cur.rows[0], after: r.rows[0] }, source: actor?.source, actor });
    return r.rows[0];
}

// --- 정산 서비스 (읽기 전용) ---
async function svcGetSettlements({ from, to }) {
    const cond = []; const params = [];
    if (from) { params.push(from); cond.push(`date >= $${params.length}`); }
    if (to) { params.push(to); cond.push(`date <= $${params.length}`); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const r = await pool.query(
        `SELECT id, date, partner, amount, items FROM settlements ${where} ORDER BY date DESC, id DESC`, params);
    return r.rows;
}

// --- 공통 헬퍼 ---
function adminActor(req) {
    return { id: req.user.id, name: req.user.name, position: req.user.position, role: req.user.role, source: 'admin_api' };
}
function requireConfirm(req, res) {
    if (req.body?.confirm !== true) {
        res.status(400).json({ error: '확인 필요: 이 작업은 되돌리기 어렵습니다. 실행하려면 confirm:true 를 함께 보내주세요.' });
        return false;
    }
    return true;
}
function handleAdminErr(res, err) {
    const status = err?.status || 500;
    if (status === 500) console.error('관리 API 오류:', err?.message || err);
    res.status(status).json({ error: err?.message || String(err) });
}

// --- REST 라우트 (전부 admin 전용) ---
// 일정
app.get('/api/admin/schedules', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ schedules: await svcListSchedules({ from: req.query.from, to: req.query.to }) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.post('/api/admin/schedules', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ message: '일정이 등록되었습니다', schedule: await svcCreateSchedule(req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.patch('/api/admin/schedules/:id', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ message: '일정이 수정되었습니다', schedule: await svcUpdateSchedule(req.params.id, req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.delete('/api/admin/schedules/:id', authMiddleware, adminOnly, async (req, res) => {
    if (!requireConfirm(req, res)) return;
    try { res.json({ message: '일정이 삭제되었습니다(복구 가능)', schedule: await svcSoftDeleteSchedule(req.params.id, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
// 기안 (조회 전용)
app.get('/api/admin/approvals', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ approvals: await svcListApprovals(req.query.status || 'pending') }); }
    catch (err) { handleAdminErr(res, err); }
});
app.get('/api/admin/approvals/:id', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ approval: await svcGetApprovalDetail(req.params.id) }); }
    catch (err) { handleAdminErr(res, err); }
});
// 품목
app.get('/api/admin/items', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ items: await svcListItems({ q: req.query.q || '', includeInactive: req.query.all === 'true' }) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.post('/api/admin/items', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ message: '품목이 추가되었습니다', item: await svcCreateItem(req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.patch('/api/admin/items/:id', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ message: '품목이 수정되었습니다', item: await svcUpdateItem(req.params.id, req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.post('/api/admin/items/:id/deactivate', authMiddleware, adminOnly, async (req, res) => {
    if (!requireConfirm(req, res)) return;
    try { res.json({ message: '품목이 비활성 처리되었습니다(복구 가능)', item: await svcDeactivateItem(req.params.id, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
// 정산 (조회 전용)
app.get('/api/admin/settlements', authMiddleware, adminOnly, async (req, res) => {
    try { res.json({ settlements: await svcGetSettlements({ from: req.query.from, to: req.query.to }) }); }
    catch (err) { handleAdminErr(res, err); }
});

// ============================================================
// === AGENT OFFICE API (/api/agent-office/*) — 1차: 대표 전용 ===
// 전 라우트 authMiddleware + adminOnly (URL 직접 호출도 차단).
// 실행은 테스트 모드(단계 진행 → 더미 결과). 로직은 agents/{이름}.js로 분리.
// 모든 단계 로그는 서버 코드가 직접 기록 — 에이전트 자가 보고 금지 원칙.
// ============================================================

// 에이전트별 실행 스크립트 로더 (agents/{이름}.js — 없으면 기본 3단계)
const AGENT_DEFAULT_RUNNER = {
    live: false, // 실전 연결 여부 — true인 요원만 마루가 실제 실행 (현재: 세미)
    steps: ['업무 준비 중...', '작업 처리 중...', '보고서 작성 중...'],
    stepDelayMs: 2000,
    result: () => ({ summary: '완료: 테스트 실행 성공', lines: ['테스트 실행이 정상 완료되었습니다', '실제 업무 로직은 후속 차수에서 연결됩니다'] }),
};
function loadAgentRunner(agentName) {
    try {
        return { ...AGENT_DEFAULT_RUNNER, ...require(path.join(__dirname, 'agents', `${agentName}.js`)) };
    } catch (e) {
        return AGENT_DEFAULT_RUNNER;
    }
}

function agentStep(kind, actor, text) {
    return { t: new Date().toISOString(), kind, actor, text };
}
async function agentRunAppendStep(runId, step) {
    await pool.query(`UPDATE agent_runs SET steps = steps || $2::jsonb WHERE id = $1`,
        [runId, JSON.stringify([step])]);
}

// 실행 엔진 — 지시 전달 흐름(마루→팀장→팀원→보고)을 서버가 순서대로 기록
// 2차부터 runner.result()는 async 가능 + ctx(pool/params/helpers)로 실제 DB 조회 지원 (AI 호출 없음)
async function executeAgentTestRun(run, agent, managerName, runParams = {}) {
    const runner = loadAgentRunner(agent.name);
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    try {
        await wait(800);
        await agentRunAppendStep(run.id, agentStep('route', '마루', `${agent.team} 배정`));
        if (managerName && managerName !== agent.name) {
            await wait(800);
            await agentRunAppendStep(run.id, agentStep('assign', managerName, `${agent.name}에게 지시 전달`));
        }
        for (const label of runner.steps) {
            await wait(runner.stepDelayMs || 2000);
            await agentRunAppendStep(run.id, agentStep('work', agent.name, label));
        }
        await wait(600);
        const result = typeof runner.result === 'function'
            ? await runner.result({
                agent, pool, params: runParams,
                helpers: {
                    matchItemToPricing, normDateSafe,
                    // 4단계: 요원이 만든 xlsx를 DB에 보관 (audit 기록 포함) — run과 연결
                    saveReportFile: (filename, buffer) => saveReportFile(filename, buffer, run.id, null),
                },
            })
            : { summary: '완료' };
        await agentRunAppendStep(run.id, agentStep('report', agent.name, '완료 보고'));
        // 지시 #54: AI 검수 게이트 제거 (한결 비활성·기안 대표 직행 — 최종 검토는 대표).
        // 코드 안전망은 유지: 파편 정화·규격/금지어 채점(시험지)·한수 검산·날짜 대조(아래).
        // 🔴 날짜 단일 소스 (지시 #54-4): 산출물의 날짜 표기를 서버 확정값과 코드로 대조 — 불일치는 교정하지 않고 ⚠️ 표시
        if (result && result.report && runParams.dates_range && runParams.dates_range.from) {
            const scanText = result.report.type === 'geulsaem_copy'
                ? (result.report.versions || []).map(v => v.text).join('\n')
                : (result.report.type === 'gian_plan' ? JSON.stringify(result.report) : '');
            if (scanText) {
                // 지시 #59-1: 4형식 날짜 인식 (ISO·07-21·7/21·7월 21일)
                const bad = extractDatesISO(scanText, runParams.dates_range.from.slice(0, 4))
                    .filter(ds => ds < runParams.dates_range.from || ds > runParams.dates_range.to)
                    .map(ds => Number(ds.slice(5, 7)) + '/' + Number(ds.slice(8, 10)));
                const uniq = [...new Set(bad)];
                if (uniq.length) {
                    result.report.date_warning = `⚠️ 날짜 불일치: 산출물에 ${uniq.join(', ')} — 서버 확정 ${runParams.dates_hint}와 다름. 교정하지 않았으니 대표 확인 필요`;
                    result.lines = [...(result.lines || []), result.report.date_warning];
                    await agentRunAppendStep(run.id, agentStep('review', '마루', '⚠️ 날짜 대조 불일치 — 대표 확인 필요 (자동 교정 없음)'));
                }
            }
        }
        if (agent.name === '세미' && result && result.report) {
            // 지시 #44: 한수 검산 게이트 (0원 순수 코드 — 모델 호출 없음)
            try {
                const hansu = require(path.join(__dirname, 'agents', '한수.js'));
                const audit = hansu.verifyReport(result.report);
                if (audit) {
                    result.report.audit_check = audit;
                    result.lines = [...(result.lines || []),
                        audit.ok ? '🧮 한수 검산 ✅' : `🧮 한수 검산 ⚠️ 오차 ${Math.round(audit.diff_won).toLocaleString('ko-KR')}원 — 상세는 보고서 카드에서`];
                    await agentRunAppendStep(run.id, agentStep('review', '한수', audit.ok ? '검산 일치 — 상신' : '오차 발견 — 있는 그대로 보고 (자동 보정 없음)'));
                } else if (managerName && managerName !== agent.name) {
                    await agentRunAppendStep(run.id, agentStep('review', managerName, '검수 후 상신'));
                }
            } catch (e) {
                console.error('한수 검산 실패:', e.message);
                if (managerName && managerName !== agent.name) {
                    await agentRunAppendStep(run.id, agentStep('review', managerName, '검수 후 상신'));
                }
            }
        } else if (managerName && managerName !== agent.name) {
            await agentRunAppendStep(run.id, agentStep('review', managerName, '검수 후 상신'));
        }
        await agentRunAppendStep(run.id, agentStep('done', '마루', '보고서함에 보고 등록'));
        await pool.query(`UPDATE agent_runs SET status='done', result=$2, finished_at=NOW() WHERE id=$1`,
            [run.id, JSON.stringify(result)]);
        await pool.query(`UPDATE agents SET status='done', last_run_at=NOW() WHERE id=$1`, [agent.id]);
        notifyTelegram(`✅ [${agent.name}] 완료: ${(result && result.summary) || '작업 완료'}`); // 지시 #10-b (비동기, 실패 무시)
        // 완료 배지는 프론트에서 3초 표시 — 이후 대기 상태로 복귀
        setTimeout(() => {
            pool.query(`UPDATE agents SET status='idle' WHERE id=$1 AND status='done'`, [agent.id]).catch(() => {});
        }, 5000);
    } catch (err) {
        console.error('AGENT OFFICE 실행 오류:', err.message);
        await pool.query(`UPDATE agent_runs SET status='error', result=$2, finished_at=NOW() WHERE id=$1`,
            [run.id, JSON.stringify({ summary: `오류: ${err.message}` })]).catch(() => {});
        await pool.query(`UPDATE agents SET status='error' WHERE id=$1`, [agent.id]).catch(() => {});
        // 대표 7/22: 오류 상태도 완료처럼 잠시 표시 후 대기(idle)로 복귀 — 조직도에 오류 마크가 영영 남던 것 해소
        //   (오류 자체는 agent_runs·LIVE 로그에 그대로 기록되어 사라지지 않음)
        setTimeout(() => {
            pool.query(`UPDATE agents SET status='idle' WHERE id=$1 AND status='error'`, [agent.id]).catch(() => {});
        }, 6000);
    }
}

// 에이전트 목록 (사무실 렌더용 — 도구/학습노트 수/최근 실행 포함)
app.get('/api/agent-office/agents', authMiddleware, adminOnly, async (req, res) => {
    try {
        const agents = (await pool.query(
            `SELECT * FROM agents WHERE is_deleted = false AND is_active = true ORDER BY sort_order, id`)).rows; // 지시 #57: 비활성(한결) 화면 미표시 — 데이터는 보관
        const tools = (await pool.query(
            `SELECT id, agent_id, tool_name, tool_type, config, enabled FROM agent_tools WHERE is_deleted = false ORDER BY id`)).rows;
        const lessonCounts = (await pool.query(
            `SELECT agent_id, COUNT(*)::int AS c FROM agent_lessons
             WHERE is_deleted = false AND status = 'active' GROUP BY agent_id`)).rows;
        const lastRuns = (await pool.query(
            `SELECT DISTINCT ON (agent_id) agent_id, id, status, result, started_at, finished_at
             FROM agent_runs WHERE is_deleted = false AND is_test = false ORDER BY agent_id, started_at DESC`)).rows;
        const merged = agents.map(a => ({
            ...a,
            tools: tools.filter(t => t.agent_id === a.id),
            lesson_count: lessonCounts.find(l => l.agent_id === a.id)?.c || 0,
            last_run: lastRuns.find(r => r.agent_id === a.id) || null,
        }));
        res.json({ agents: merged });
    } catch (err) { handleAdminErr(res, err); }
});

// 에이전트 상세 (패널용 — 학습 노트 + 최근 실행 5건)
app.get('/api/agent-office/agents/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(`SELECT * FROM agents WHERE id = $1 AND is_deleted = false`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '에이전트를 찾을 수 없습니다' };
        const agent = r.rows[0];
        const tools = (await pool.query(
            `SELECT id, tool_name, tool_type, config, enabled FROM agent_tools
             WHERE agent_id = $1 AND is_deleted = false ORDER BY id`, [agent.id])).rows;
        const lessons = (await pool.query(
            `SELECT id, lesson, category, status, created_at FROM agent_lessons
             WHERE agent_id = $1 AND is_deleted = false AND status != '폐기' ORDER BY created_at DESC LIMIT 20`, [agent.id])).rows;
        const runs = (await pool.query(
            `SELECT id, status, steps, result, started_at, finished_at, COALESCE(is_deleted, false) AS is_deleted
             FROM agent_runs
             WHERE agent_id = $1 AND is_test = false ORDER BY started_at DESC LIMIT 8`, [agent.id])).rows;
        const feedback = (await pool.query(
            `SELECT f.id, f.run_id, f.feedback_type, f.comment, f.corrected_output, f.created_at,
                    r.result->>'summary' AS run_summary
             FROM agent_feedback f LEFT JOIN agent_runs r ON f.run_id = r.id
             WHERE f.agent_id = $1 AND f.is_deleted = false ORDER BY f.created_at DESC LIMIT 20`, [agent.id])).rows;
        res.json({ agent, tools, lessons, runs, feedback });
    } catch (err) { handleAdminErr(res, err); }
});

// 실행 트리거 — 1차는 worker만 (chief/manager는 다음 업데이트에서 연결)
app.post('/api/agent-office/agents/:id/run', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(`SELECT * FROM agents WHERE id = $1 AND is_deleted = false`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '에이전트를 찾을 수 없습니다' };
        const agent = r.rows[0];
        if (!agent.is_active) throw { status: 400, message: '비활성 상태의 에이전트입니다' };
        if (agent.role !== 'worker') throw { status: 400, message: '1차에서는 팀원(worker)만 실행 가능합니다. 실장·팀장 실행은 다음 업데이트에서 연결 예정입니다.' };
        const running = await pool.query(
            `SELECT id FROM agent_runs WHERE agent_id = $1 AND status = 'running' AND is_deleted = false LIMIT 1`, [agent.id]);
        if (running.rows.length > 0) throw { status: 409, message: '이미 실행 중인 작업이 있습니다' };
        const mgr = await pool.query(
            `SELECT name FROM agents WHERE team = $1 AND role = 'manager' AND is_deleted = false AND is_active = true LIMIT 1`, [agent.team]);
        const firstStep = agentStep('order', '마루', `오더 접수 — ${agent.team} ${agent.name} 작업 실행`);
        const run = (await pool.query(
            `INSERT INTO agent_runs (agent_id, steps) VALUES ($1, $2) RETURNING *`,
            [agent.id, JSON.stringify([firstStep])])).rows[0];
        await pool.query(`UPDATE agents SET status='running' WHERE id = $1`, [agent.id]);
        await writeAudit({
            action: 'agent_run', targetType: 'agent_run', targetId: run.id,
            changes: { after: { agent: agent.name, team: agent.team, mode: 'test' } },
            source: 'agent_office', actor: adminActor(req),
        });
        executeAgentTestRun(run, agent, mgr.rows[0]?.name || null,
            { workplace: String(req.body?.workplace || '전체') }); // 비동기 진행 — 응답은 즉시
        res.json({ message: `${agent.name} 실행을 시작했습니다`, run });
    } catch (err) { handleAdminErr(res, err); }
});

// 대표 7/24: 네이버 중계서버 연결 테스트 (2단계) — 회사프로그램 → 중계서버 → 네이버 왕복 확인
//   ① 중계서버 헬스+네이버 토큰(/health?token=1)  ② Bearer 전체 체인(어제 일별 정산 1건 조회, 읽기)
app.get('/api/agent-office/naver/test', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (!naverRelay.configured()) {
            return res.json({ ok: false, step: 'config', message: 'Render 환경변수 NAVER_RELAY_URL / NAVER_RELAY_TOKEN 미설정' });
        }
        // ① 중계서버 도달 + 네이버 토큰 발급
        let health = null, healthErr = null;
        try { health = await naverRelay.relayHealth(true); } catch (e) { healthErr = e.message; }
        // ② Bearer 인증 + 전체 체인 확인 — 확정된 '변경 주문 조회'(읽기) 엔드포인트로 왕복.
        //   판정: 네이버가 응답(2xx/4xx 무엇이든)을 돌려주면 중계+Bearer+네이버 도달 성공.
        //   중계서버가 못 닿거나(연결실패) Bearer 불일치(relay의 401 unauthorized)면 실패.
        const kstIso = (offsetMs) => new Date(Date.now() + 9 * 3600 * 1000 + offsetMs).toISOString().replace('Z', '+09:00');
        let chain = null;
        try {
            const r = await naverRelay.callNaver({
                method: 'GET',
                path: '/external/v1/pay-order/seller/product-orders/last-changed-statuses',
                query: { lastChangedFrom: kstIso(-3600 * 1000), lastChangedTo: kstIso(0) },
            }, notifyTelegram);
            chain = { ok: true, reached: true, http: 200, note: '주문 조회 왕복 성공' };
        } catch (e) {
            const relayAuthFail = e.status === 401 && e.data && e.data.error === 'unauthorized';
            const relayBlocked = e.status === 403 && e.data && e.data.error === 'path_not_allowed';
            const unreachable = /relay_unreachable/.test(e.message || '');
            if (!unreachable && !relayAuthFail && !relayBlocked && e.status) {
                // 네이버가 응답(4xx/5xx)을 돌려줌 = 중계+Bearer+네이버 도달 성공 (경로/파라미터는 개별 연동 시 조정)
                chain = { ok: true, reached: true, http: e.status, note: `네이버 도달·인증 정상 (응답 ${e.status})` };
            } else {
                chain = { ok: false, reached: false, error: e.message, status: e.status || null,
                    reason: unreachable ? '중계서버 연결 실패' : relayAuthFail ? 'Bearer 토큰 불일치' : relayBlocked ? '허용목록 외' : '알 수 없음' };
            }
        }
        const tokenOk = health && health.token_test === 'success';
        res.json({
            ok: !!(tokenOk && chain.reached),
            relay_reachable: !!health && !healthErr,
            naver_token: health ? (health.token_test || 'unknown') : ('fail: ' + healthErr),
            chain, // 중계+Bearer+네이버 왕복 결과
        });
    } catch (err) { handleAdminErr(res, err); }
});

// 실행 상태 조회 (폴링용)
app.get('/api/agent-office/runs/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT r.*, a.name AS agent_name, a.team AS agent_team
             FROM agent_runs r JOIN agents a ON r.agent_id = a.id
             WHERE r.id = $1 AND r.is_deleted = false`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '실행 기록을 찾을 수 없습니다' };
        res.json({ run: r.rows[0] });
    } catch (err) { handleAdminErr(res, err); }
});

// 실행 로그 목록 (LIVE 로그 + 보고서함 — 에이전트/팀/기간 필터)
app.get('/api/agent-office/runs', authMiddleware, adminOnly, async (req, res) => {
    try {
        const cond = [req.query.include_archived === 'true' ? 'TRUE' : 'r.is_deleted = false'];
        // 1-4: 역량 테스트 실행분은 보고서함·LIVE 로그에서 제외 — 성적표 화면(only_test)에서만 조회
        cond.push(req.query.only_test === 'true' ? 'r.is_test = true' : 'r.is_test = false');
        const params = [];
        if (req.query.agent_id) { params.push(req.query.agent_id); cond.push(`r.agent_id = $${params.length}`); }
        if (req.query.team) { params.push(req.query.team); cond.push(`a.team = $${params.length}`); }
        if (req.query.from) { params.push(req.query.from); cond.push(`r.started_at >= $${params.length}`); }
        if (req.query.to) { params.push(req.query.to); cond.push(`r.started_at < ($${params.length}::date + 1)`); }
        const limit = Math.min(parseInt(req.query.limit) || 50, 300);
        const r = await pool.query(
            `SELECT r.id, r.agent_id, r.status, r.steps, r.result, r.started_at, r.finished_at, r.is_deleted,
                    a.name AS agent_name, a.team AS agent_team, a.role AS agent_role
             FROM agent_runs r JOIN agents a ON r.agent_id = a.id
             WHERE ${cond.join(' AND ')}
             ORDER BY r.started_at DESC LIMIT ${limit}`, params);
        res.json({ runs: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});

// 피드백 기록 (👍 good / ✏️ edited / 👎 bad / 💬 comment) — 성장 시스템 1차
// 실패 수집함용 (대표 7/21): 오더의 '마루/요원 답변'을 사람이 읽을 텍스트로 뽑는다
async function orderAnswerText(order) {
    const r = order.result || {};
    if (order.run_id) {
        try {
            const rq = await pool.query(`SELECT result FROM agent_runs WHERE id = $1`, [order.run_id]);
            const rr = rq.rows[0]?.result || {};
            const t = (rr.report && (rr.report.conclusion || rr.summary)) || rr.summary
                || (Array.isArray(rr.lines) ? rr.lines.join(' / ') : '');
            if (t) return t;
        } catch (e) { /* 폴백 아래 */ }
    }
    return r.question || r.notice || r.summary || r.error
        || (Array.isArray(r.subtasks) ? '멀티 분산: ' + r.subtasks.join(' / ') : '') || '(응답 없음)';
}
app.post('/api/agent-office/feedback', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { agent_id = null, run_id = null, order_id = null, feedback_type, comment = '', corrected_output = '' } = req.body || {};
        // 지시 #62-2: 'fail' = 실패 수집함 원탭 표시 — 코멘트 없이 허용, 개별 교훈 추출 없이 모아서 일괄 보강
        const TYPES = ['good', 'edited', 'bad', 'comment', 'fail'];
        if (!TYPES.includes(feedback_type)) throw { status: 400, message: 'feedback_type(good/edited/bad/comment/fail)은 필수입니다' };
        // 실패 수집함 (대표 7/21): order_id면 질문(오더 내용)+답변(마루/요원 응답)을 캡처. 요원은 오더 배정 요원(없으면 마루)로 자동 귀속
        let question = '', answerText = '', resolvedAgentId = agent_id;
        if (order_id) {
            const oq = await pool.query(`SELECT content, result, run_id FROM pending_orders WHERE id = $1`, [order_id]);
            const ord = oq.rows[0];
            if (ord) {
                question = ord.content || '';
                answerText = await orderAnswerText(ord);
                if (!resolvedAgentId) {
                    const assignee = ord.result && ord.result.assignee;
                    const aq = assignee
                        ? await pool.query(`SELECT id FROM agents WHERE name = $1 AND is_deleted=false LIMIT 1`, [assignee])
                        : await pool.query(`SELECT id FROM agents WHERE role='chief' AND is_deleted=false LIMIT 1`);
                    resolvedAgentId = aq.rows[0]?.id;
                }
            }
        }
        if (!resolvedAgentId) throw { status: 400, message: 'agent_id 또는 order_id가 필요합니다' };
        if (feedback_type === 'bad' && !String(comment).trim()) throw { status: 400, message: '👎 피드백은 이유 한 줄이 필요합니다 (교훈화용)' };
        let original = null;
        if (run_id && !order_id) {
            const runQ = await pool.query(`SELECT result FROM agent_runs WHERE id = $1`, [run_id]);
            const rr = runQ.rows[0]?.result;
            original = rr ? JSON.stringify(rr) : null;
            if (feedback_type === 'fail') { // 실패 표시는 사람이 읽을 답변 텍스트로 저장
                const rro = rr || {};
                answerText = (rro.report && (rro.report.conclusion || rro.summary)) || rro.summary
                    || (Array.isArray(rro.lines) ? rro.lines.join(' / ') : '') || '(응답 없음)';
                const oq2 = await pool.query(`SELECT content FROM pending_orders WHERE run_id = $1 ORDER BY id DESC LIMIT 1`, [run_id]);
                question = oq2.rows[0]?.content || '';
            }
        }
        // 실패 항목: comment=질문, original_output=답변 (표시용). 그 외 피드백은 기존 유지
        const storedComment = feedback_type === 'fail' ? (question || comment) : comment;
        if (feedback_type === 'fail') original = answerText || original;
        const row = (await pool.query(
            `INSERT INTO agent_feedback (agent_id, run_id, feedback_type, original_output, corrected_output, comment)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [resolvedAgentId, run_id, feedback_type, original, corrected_output, storedComment])).rows[0];
        await writeAudit({
            action: 'create', targetType: 'agent_feedback', targetId: row.id,
            changes: { after: { agent_id: resolvedAgentId, run_id, order_id, feedback_type, comment: storedComment } },
            source: 'agent_office', actor: adminActor(req),
        });
        // 6차: ✏️/👎/💬 피드백은 교훈 후보 자동 추출 (제안 상태 — 대표 승인 후에만 활성)
        // 지시 #62-2: 'fail'은 개별 교훈 추출 없이 수집함에 적재 — 5건 도달 시마다 일괄 보강 검토 알림
        if (feedback_type !== 'good' && feedback_type !== 'fail') extractLessonFromFeedback(row, adminActor(req));
        if (feedback_type === 'fail') {
            const failCnt = (await pool.query(
                `SELECT COUNT(*)::int AS c FROM agent_feedback WHERE feedback_type = 'fail' AND is_deleted = false`)).rows[0].c;
            if (failCnt > 0 && failCnt % 5 === 0) {
                notifyTelegram(`🧰 실패 수집함 ${failCnt}건 — 일괄 보강 검토 시점입니다 (지시 #62: 똑똑이 묶음 분석 → 대표 ㄱ → 일괄 반영)`);
            }
            return res.json({ message: `실패 수집함에 기록되었습니다 (현재 ${failCnt}건 — 5건 단위로 일괄 보강 검토)`, feedback: row });
        }
        res.json({ message: '피드백이 기록되었습니다 — 교훈 후보를 정리 중입니다', feedback: row });
    } catch (err) { handleAdminErr(res, err); }
});

// 교훈 승인 — 대표 승인 시에만 '제안' → 'active' (자동 활성화 금지)
app.post('/api/agent-office/lessons/:id/approve', authMiddleware, adminOnly, async (req, res) => {
    try {
        // 지시 #22-6: 요원당 활성 교훈 상한 10 — 프롬프트 비대화·통제 상실 방지 (초과 시 기존 폐기 후 승인)
        const tgt = await pool.query(`SELECT agent_id FROM agent_lessons WHERE id = $1 AND status = '제안' AND is_deleted = false`, [req.params.id]);
        if (tgt.rows.length === 0) throw { status: 404, message: '승인 대기(제안) 상태의 교훈을 찾을 수 없습니다' };
        const cnt = await pool.query(
            `SELECT COUNT(*)::int AS c FROM agent_lessons WHERE agent_id = $1 AND status = 'active' AND is_deleted = false`,
            [tgt.rows[0].agent_id]);
        if (cnt.rows[0].c >= 10) throw { status: 409, message: `이 요원의 활성 교훈이 상한(10개)에 도달했습니다 — 기존 교훈을 폐기한 뒤 승인해주세요 (현재 ${cnt.rows[0].c}개)` };
        const r = await pool.query(
            `UPDATE agent_lessons SET status = 'active', approved_at = NOW() WHERE id = $1 AND status = '제안' AND is_deleted = false RETURNING *`,
            [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '승인 대기(제안) 상태의 교훈을 찾을 수 없습니다' };
        await writeAudit({
            action: 'lesson_approved', targetType: 'agent_lesson', targetId: r.rows[0].id,
            changes: { after: { lesson: r.rows[0].lesson } }, source: 'agent_office', actor: adminActor(req),
        });
        res.json({ message: '교훈이 활성화되었습니다 — 다음 실행부터 반영됩니다', lesson: r.rows[0] });
    } catch (err) { handleAdminErr(res, err); }
});

// 교훈 폐기 (제안 또는 활성 → 폐기)
app.post('/api/agent-office/lessons/:id/discard', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE agent_lessons SET status = '폐기' WHERE id = $1 AND status IN ('제안', 'active') AND is_deleted = false RETURNING *`,
            [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '폐기할 교훈을 찾을 수 없습니다' };
        await writeAudit({
            action: 'lesson_discarded', targetType: 'agent_lesson', targetId: r.rows[0].id,
            changes: { before: { lesson: r.rows[0].lesson } }, source: 'agent_office', actor: adminActor(req),
        });
        res.json({ message: '교훈이 폐기되었습니다', lesson: r.rows[0] });
    } catch (err) { handleAdminErr(res, err); }
});

// 9차: 전체 교훈 목록 (성장 위젯 모달 — week=1이면 이번 주 활성화분만)
app.get('/api/agent-office/lessons', authMiddleware, adminOnly, async (req, res) => {
    try {
        const weekOnly = req.query.week === '1';
        const cond = [`l.is_deleted = false`, `l.status IN ('제안', 'active')`];
        if (weekOnly) cond.push(`l.status = 'active'`, `l.created_at >= date_trunc('week', NOW())`);
        const r = await pool.query(
            `SELECT l.id, l.lesson, l.category, l.status, l.created_at, l.approved_at,
                    a.id AS agent_id, a.name AS agent_name, a.team AS agent_team,
                    sf.feedback_type AS src_type, sf.comment AS src_comment,
                    sf.corrected_output AS src_corrected, sf.run_id AS src_run_id
             FROM agent_lessons l
             JOIN agents a ON l.agent_id = a.id
             LEFT JOIN LATERAL (
                 SELECT f.feedback_type, f.comment, f.corrected_output, f.run_id
                 FROM agent_feedback f
                 WHERE l.source_feedback_ids @> jsonb_build_array(f.id) LIMIT 1
             ) sf ON TRUE
             WHERE ${cond.join(' AND ')}
             ORDER BY a.sort_order, l.status DESC, l.created_at DESC LIMIT 200`);
        res.json({ lessons: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});

// 9차: 전체 피드백 이력 (성장 위젯 모달 — 최근순)
app.get('/api/agent-office/feedback', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT f.id, f.feedback_type, f.comment, f.original_output, f.corrected_output, f.created_at, f.run_id,
                    a.name AS agent_name, a.team AS agent_team,
                    r.result->>'summary' AS run_summary
             FROM agent_feedback f
             JOIN agents a ON f.agent_id = a.id
             LEFT JOIN agent_runs r ON f.run_id = r.id
             WHERE f.is_deleted = false ORDER BY f.created_at DESC LIMIT 100`);
        res.json({ feedback: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});

// 실패 수집함 항목 삭제 (대표 7/21: 잘못 눌렸거나 필요 없어진 건 삭제 — soft-delete)
app.post('/api/agent-office/feedback/:id/delete', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE agent_feedback SET is_deleted = true WHERE id = $1 AND is_deleted = false RETURNING id`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '삭제할 항목을 찾을 수 없습니다' };
        await writeAudit({ action: 'delete', targetType: 'agent_feedback', targetId: r.rows[0].id, source: 'agent_office', actor: adminActor(req) });
        res.json({ message: '삭제했습니다' });
    } catch (err) { handleAdminErr(res, err); }
});

// 9차: 보고서 보관/복원 (soft-delete — 진짜 삭제 없음, 피드백·학습 노트 무영향)
app.post('/api/agent-office/runs/:id/archive', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE agent_runs SET is_deleted = true WHERE id = $1 AND is_deleted = false RETURNING id`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '보관할 보고서를 찾을 수 없습니다' };
        await writeAudit({ action: 'archive', targetType: 'agent_run', targetId: r.rows[0].id, source: 'agent_office', actor: adminActor(req) });
        res.json({ message: '확인 처리했습니다 — "확인한 보고 포함"으로 다시 볼 수 있어요' });
    } catch (err) { handleAdminErr(res, err); }
});
app.post('/api/agent-office/runs/:id/unarchive', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE agent_runs SET is_deleted = false WHERE id = $1 AND is_deleted = true RETURNING id`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '복원할 보고서를 찾을 수 없습니다' };
        await writeAudit({ action: 'unarchive', targetType: 'agent_run', targetId: r.rows[0].id, source: 'agent_office', actor: adminActor(req) });
        res.json({ message: '다시 목록에 표시합니다' });
    } catch (err) { handleAdminErr(res, err); }
});

// 성장 지표 위젯 (지식 노트 N건 / 이번 주 학습 +N건 / 피드백 누적)
app.get('/api/agent-office/growth', authMiddleware, adminOnly, async (req, res) => {
    try {
        const lessons = await pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW()))::int AS this_week
             FROM agent_lessons WHERE is_deleted = false AND status = 'active'`);
        const feedback = await pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE feedback_type = 'fail')::int AS fails,
                    COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW()))::int AS this_week
             FROM agent_feedback WHERE is_deleted = false`);
        res.json({ lessons: lessons.rows[0], feedback: feedback.rows[0] });
    } catch (err) { handleAdminErr(res, err); }
});

// ------------------------------------------------------------
// 3차: 마루 AI 라우팅 — Anthropic Haiku로 지시 분석 → 팀 배정
// 원칙: API 키는 환경변수(ANTHROPIC_API_KEY)만 사용 (하드코딩 금지),
//       애매한 지시는 추측 실행 금지(clarify로 되묻기, 질문은 하나만),
//       API 오류는 정직하게 '오류' 상태로 기록 (허위 응답 금지).
// ------------------------------------------------------------
const MARU_MODEL = process.env.MARU_MODEL || 'claude-haiku-4-5';

// 강제 tool 호출로 구조화된 배정 결과를 보장
const MARU_ROUTE_TOOL = {
    name: 'route_order',
    description: '대표 지시를 분석해 담당 팀/요원을 배정하거나(route), 분야가 불명확하면 되묻는다(clarify).',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            action: { type: 'string', enum: ['route', 'clarify', 'feedback', 'schedule', 'settlement_input', 'multi', 'answer'], description: 'route=새 작업 배정, clarify=애매해서 되묻기, feedback=기존 결과물 평가/수정, schedule=일정 조회·등록(마루 직접), settlement_input=정산현황 숫자 입력(마루 직접), multi=멀티 지시 분산 실행(대표 확인 후 — subtasks 필수), answer=개념·용어 설명·이미지 뜻 묻기 등 일반 질문에 마루가 직접 답변(배정 안 함)' },
            answer_text: { type: 'string', description: "action=answer일 때만 출력 — 대표 질문에 대한 마루의 직접 답변. 개념·용어 뜻(예: '계열합계가 뭐야'), 첨부 이미지가 무엇인지 설명, 프로그램 사용법 등 '작업 배정'이 아닌 물음에 아는 선에서 정확히 답한다. 모르면 모른다고 정직하게" },
            subtasks: {
                type: 'array', items: { type: 'string' },
                description: "action=multi일 때만 출력 — 각 작업을 **완결된 독립 지시 문장**으로 분해 (조건·기간·품목을 각 문장에 전부 복사해 담는다. 예: ['미니밤호박 톡톡 문구 작성 — 담주 화~목 3일, 2천원 할인쿠폰, 10+1 추첨 20명', '미니밤호박 톡톡 이미지 디자인 제작 — 담주 화~목 행사, 할인쿠폰·추첨 이벤트 강조', '담주 화~목 미니밤호박 할인 행사 일정 등록']). 2~5건",
            },
            team: { type: 'string', description: '배정 팀 (마케팅팀/재무팀/법무팀/개발부서/기획팀 중 하나). clarify면 빈 문자열' },
            assignee: { type: 'string', description: '담당 요원 이름 (글샘/미소/예리/세미/지율/기안/한수/미래/마루 중 하나). clarify면 빈 문자열' },
            task_summary: { type: 'string', description: '지시 내용 한 줄 요약' },
            reason: { type: 'string', description: '배정 근거 또는 판단 이유 한 줄' },
            clarify_question: { type: 'string', description: 'action=clarify일 때만 출력 — 대표에게 물을 질문 딱 하나' },
            clarify_choices: { type: 'array', items: { type: 'string' }, description: "action=clarify이고 **선택지가 2개 이상**일 때만 출력 — 각 선택지를 짧은 라벨로 (예: ['단가표 1번', '단가표 2번', '둘 다']). 대표가 버튼으로 고른다. 단순 예/아니오 질문이면 출력하지 않는다 (그때는 네/아니오 버튼이 나감)" },
            item_keyword: { type: 'string', description: "지시에 언급된 품목 키워드 하나 (예: '하우스감귤', '카라향', '레몬'). 품목 언급이 없으면 출력하지 않는다" },
            period: { type: 'string', description: "기간 조건: '이번주'→'this_week', '이번달/이달'→'this_month', 특정 월(예: '6월')→'YYYY-MM' 형식(오늘 날짜 기준, 미래 월이면 작년으로). 기간 언급 없으면 출력하지 않는다" },
            target_date: { type: 'string', description: "재무 지시에서 특정 하루를 물으면(예: '4월 14일 정산현황') 그 날짜 YYYY-MM-DD (미래면 작년). 아니면 출력하지 않는다" },
            settlement_date: { type: 'string', description: 'action=settlement_input일 때만 출력 — 입력 대상 날짜 YYYY-MM-DD (언급 없으면 오늘)' },
            settlement_entries: {
                type: 'array',
                description: 'action=settlement_input일 때만 출력 — 언급된 항목만 (미언급 항목은 넣지 않음)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        field: { type: 'string', enum: ['current_cash', 'settlement_scheduled', 'unsettled', 'coupang_unpaid', 'selfmall_unpaid', 'ad_naver', 'ad_gfa', 'card_fee', 'corp_card', 'daesong', 'hyodong', 'aewol', 'delivery'] },
                        amount: { type: 'number', description: "원 단위 정수로 환산 ('283만'→2830000, '1.2억'→120000000)" },
                    },
                    required: ['field', 'amount'],
                },
            },
            feedback_kind: { type: 'string', enum: ['칭찬', '수정', '지적', '코멘트'], description: 'action=feedback일 때만 출력 — 피드백 분류' },
            schedule_op: { type: 'string', enum: ['조회', '등록', '불가', '해당없음'], description: "action=schedule일 때만 출력: 조회/등록, 삭제·수정 요구면 '불가'" },
            schedule_from: { type: 'string', description: '일정 조회 시작일 YYYY-MM-DD (schedule_op=조회일 때만 출력)' },
            schedule_to: { type: 'string', description: '일정 조회 종료일 YYYY-MM-DD (schedule_op=조회일 때만 출력)' },
            schedule_items: {
                type: 'array',
                description: '등록할 일정 목록 (schedule_op=등록일 때만 출력)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        date: { type: 'string', description: 'YYYY-MM-DD — 애매한 표현은 오늘 기준 가장 가까운 미래 해당 날짜로 확정 제안' },
                        end_date: { type: 'string', description: "기간형 일정(예: '25~27일 할인')의 종료일 YYYY-MM-DD. 하루짜리면 출력하지 않는다" },
                        time: { type: 'string', description: 'HH:MM. 시간 언급 없으면 출력하지 않는다' },
                        title: { type: 'string', description: '일정 내용' },
                        category: { type: 'string', enum: ['휴가', '톡톡발송', '문자발송', '할인·이벤트', '일반'], description: '일정 카테고리 — 휴가/휴무=휴가, 톡톡 발송=톡톡발송, 문자·LMS 발송=문자발송, 할인·프로모션·이벤트=할인·이벤트, 그 외=일반' },
                        assignee_name: { type: 'string', description: '담당자 이름 (실제 직원 명단 중에서만). 미지정(=대표)이면 출력하지 않는다. 휴가 카테고리는 반드시 명단의 담당자 필요' },
                        date_note: { type: 'string', description: "애매한 날짜 표현이었으면 원래 표현 그대로 (예: '금요일쯤'). 명확했으면 출력하지 않는다" },
                    },
                    required: ['date', 'title', 'category'],
                },
            },
        },
        // C안 C-2 (지시 #14): required 16→5 축소 — 어떤 지시든 16필드(대부분 빈값)를 강제 출력하던 것이
        // 오염 파편의 착지면이었음. 생략된 필드는 서버 정규화(maruNormalizeDecision)가 빈값으로 복원해
        // 하위 코드는 무변경. Anthropic strict 모드는 required 미포함 필드 생략을 정식 지원 (공식 문서 확인)
        required: ['action', 'team', 'assignee', 'task_summary', 'reason'],
    },
};

// 시스템 프롬프트: DB의 라우팅 테이블 + 조직도를 그대로 사용 (마스터 지시문 3절)
async function maruBuildSystemPrompt() {
    const cfg = await pool.query(`SELECT key, value FROM agent_office_config WHERE key IN ('routing_table', 'staff_roster')`);
    const routingTable = cfg.rows.find(r => r.key === 'routing_table')?.value || [];
    const roster = cfg.rows.find(r => r.key === 'staff_roster')?.value || {};
    const staffNames = [];
    for (const [biz, people] of Object.entries(roster)) {
        if (Array.isArray(people)) people.forEach(p => staffNames.push(`${p.name}(${p.title || ''}·${biz})`));
    }
    const agentsQ = await pool.query(
        `SELECT name, role, team, duty, description FROM agents
         WHERE is_deleted = false AND is_active = true ORDER BY sort_order`);
    const orgLines = agentsQ.rows.map(a =>
        `- ${a.name} (${a.role === 'chief' ? '실장' : a.role === 'manager' ? '팀장' : '요원'} · ${a.team}${a.duty ? ' · ' + a.duty : ''}): ${a.description}`).join('\n');
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    // 대표 7/21: 회사 프로그램 메뉴 용어집 — 마루가 6개 메뉴를 정확히 구분하도록 두뇌에 주입
    const menuGlossary = `

## 회사 프로그램 메뉴 용어집 (혼동 절대 금지 — 대표 지시)
- **정산관리**: 거래처별 품목·수량·금액(매출 원본). 품목·규격·수량 나열이면 정산관리 (마루 저장 불가, 화면/이미지 경로).
- **정산현황**: 일자별 자금 집계(현금·미정산·거래처 입금 등 금액). "원/만" 금액 입력이면 정산현황(settlement_input).
- **품목별 금액**: 거래처별 주간 단가표(pricing). "지금 단가표 어디서 고쳐"처럼 화면 위치를 물으면 품목별 금액 메뉴 안내. **단, "○월 품목별 결제가/단가가 얼마였어"처럼 과거 시기의 결제가(단가) 조회는 세미에게 route** — 세미가 그 시기 주간 단가 이력을 그리드로 뽑아준다(매출액과 구분: '결제가·단가'는 단가 이력, '얼마 팔렸어·매출'은 매출 집계, 둘 다 세미).
- **박스재고**: 거래처별(업체·대성·효돈) 박스 재고. "재고" 물으면 박스재고.
- **송장변환**: 플랫폼마다 따로 다운받은 주문 양식을 하나의 통일 양식으로 변환하는 메뉴 — 품목별 금액의 판매상품 이름으로 통일해 발송 작업을 편리하게 해준다.
- **지출결의**: 비용 지출 결재(화면에서 처리). 마루가 저장 못 하니 "지출결의 화면에서 처리해주세요" 안내.
- **일정**: 마루가 직접 처리(조회 즉답/등록 확인 1회). 매출·정산 조회는 세미에게 배정.`;
    // 대표 7/21: 마루도 활성 학습 노트를 읽게 함 (기존엔 워커만 반영 — 마루 라우팅엔 미적용이던 것)
    const maruLessonsRows = (await pool.query(
        `SELECT l.lesson, l.category FROM agent_lessons l JOIN agents a ON l.agent_id = a.id
         WHERE a.code = 'maru' AND l.status = 'active' AND l.is_deleted = false
         ORDER BY l.created_at DESC LIMIT 10`)).rows;
    const maruLessonText = maruLessonsRows.length
        ? '\n\n## 📚 대표님 학습 노트 (최우선 — 위 규칙과 충돌하면 이걸 우선 적용)\n' + maruLessonsRows.map(l => `- [${l.category || '일반'}] ${l.lesson}`).join('\n')
        : '';
    return `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE의 실장 '마루'다.
범 대표님(전승범)의 지시를 접수해 담당 팀·요원을 배정하는 것이 너의 유일한 임무다.
오늘 날짜: ${todayKst} (KST)

## 조직도
${orgLines}

## 오더 라우팅 규칙 (분야 키워드 → 배정)
${JSON.stringify(routingTable, null, 2)}

## 판단 원칙 (반드시 준수)
1. 지시가 라우팅 규칙의 어느 분야에 해당하는지 판단해 action='route'로 팀·요원을 배정한다.
1-1. 🔴 **인스타/릴스 관련은 예리에게** (대표 7/22): 인스타 콘텐츠·기획(계정 아이디 추천·첫 영상 방향/컨셉·릴스/영상 대본·게시물 문구·캡션·해시태그·성과 분석)은 **전부 예리**(인스타 전담)에게 배정한다.
   · 단 '실제 이미지/영상을 만들어(생성)줘'라는 제작 지시는 **미소**(생성 도구 보유)에게. 인스타 계정의 글·대본·기획은 예리다.
   · 글샘은 문자·톡톡·상세페이지 발송 카피 담당 — 인스타 대본·문구는 글샘이 아니라 예리가 한다.
2. 지시가 새 작업이 아니라 **기존 결과물에 대한 평가·수정 요구**면 (예: "아까 그 문자 요일 틀렸어", "방금 카피 너무 좋았어", "프롬프트에 돌담 빼줘") action='feedback'으로 분류한다.
   assignee=그 결과물을 만든 요원(문자·카피→글샘, 이미지·영상 프롬프트→미소, 정산 보고→세미), feedback_kind=칭찬/수정/지적/코멘트.
   어느 요원의 결과물인지 불명확하면 clarify로 되묻는다.
2-2. **작업 배정이 아니라 '설명·질문'이면 action='answer'로 네가 직접 답한다** (대표 7/22): 용어·개념 뜻("계열합계가 뭐야?", "매출 기여가 무슨 의미야?"), 첨부 이미지가 무엇인지 설명("이 이미지 무슨 뜻이야?", "이거 뭐야?"), 프로그램 사용법·일반 질문 등. answer_text에 아는 선에서 정확히 답하고, 모르면 정직하게 모른다고 한다. **단 '데이터 조회'(매출·정산·품목 금액·순위·비교 등 실제 수치가 필요한 것)는 answer가 아니라 세미에게 route** 한다 — 수치는 네가 지어내지 말 것.
2-3. **이미지가 첨부됐을 때**: 지시에 '정산관리/정산 등록/올려줘' 같은 정산 등록 의도가 있으면 서버가 정산 OCR로 처리하니 너는 관여하지 않는다. 그 외(예: "이 이미지 무슨 뜻이야?", "이거 설명해줘")로 이미지가 오면 **첨부 이미지를 직접 보고** action='answer'로 설명하거나, 작업 지시면 해당 요원에게 route 한다.
3. 분야가 불명확하거나 여러 해석이 가능하면 절대 추측하지 말고 action='clarify'로 되묻는다. 질문은 한 번에 딱 하나만.
   🔘 **선택지가 2개 이상인 되묻기**(예: "단가표 1번이요 2번이요?", 여러 옵션 중 택1/택다)는 clarify_choices에 각 선택지를 짧은 라벨로 담는다(대표가 버튼으로 고름 — '둘 다' 같은 옵션도 필요하면 포함). 단순 예/아니오면 clarify_choices를 비운다(네/아니오 버튼이 나감). 어느 경우든 대표는 말로도 답할 수 있다.
4. 일정 분야는 팀 배정 없이 마루(너)가 직접 처리한다: action='schedule'.
   - 조회 ("이번주 일정 뭐 있어?", "내일 일정") → schedule_op='조회', schedule_from/to를 YYYY-MM-DD로 채운다 (이번주=오늘 기준 이번 월요일~일요일, 오늘/내일은 해당 하루).
   - 등록 ("화요일 카라향 출고 등록해줘") → schedule_op='등록', schedule_items에 각 건을 채운다.
     날짜는 반드시 YYYY-MM-DD로 확정 제안 — 애매한 표현("금요일쯤", "다음주 초")은 오늘 기준 가장 가까운 미래의 해당 날짜로 제안하고 date_note에 원래 표현을 기록한다.
     담당자는 실제 직원 명단에 있는 이름일 때만 assignee_name에 넣고, 미지정이면 빈 문자열(=대표)로 둔다.
     여러 건이면 schedule_items에 전부 담는다 (한 번에 확인받기 위해).
   - 카테고리 판별 (각 일정마다 category 지정):
     · 휴가/휴무 → '휴가'. 휴가는 결재 시스템 담당이라 서버가 안내로 응답한다 — 너는 category='휴가'만 정확히 표시하면 된다.
     · 톡톡 발송 예정 → '톡톡발송' / 문자·LMS 발송 예정 → '문자발송'
     · 할인·프로모션·이벤트 → '할인·이벤트'. 기간형("25~27일 할인")이면 date=시작일, end_date=종료일.
     · 그 외 → '일반'
     발송 일정 등록은 예정 알림일 뿐이다 — 실제 발송은 대표가 수동으로 한다.
   - 삭제·수정 요구 → schedule_op='불가' (아직 말로 처리 불가 — 프로그램에서 직접).
   실제 직원 명단: ${staffNames.join(', ') || '(명단 없음)'}
4-2. 정산현황 숫자 입력도 마루 직접: action='settlement_input'.
   (예: "오늘 정산현황 입력할게. 대성 283만, 효돈 203만, 택배 604만")
   - settlement_date: 대상 날짜 YYYY-MM-DD (언급 없으면 오늘).
   - settlement_entries: 언급된 항목만 넣는다. 금액은 원 단위 정수로 환산 (283만→2830000).
   - 항목 매핑: 대성→daesong, 효돈→hyodong, 애월/기타→aewol, 택배→delivery,
     현금/현재현금/통장→current_cash, (스토어)정산예정→settlement_scheduled, (스토어)미정산→unsettled,
     쿠팡→coupang_unpaid, 자사몰→selfmall_unpaid, 네이버광고→ad_naver, GFA광고→ad_gfa,
     카드/카드이용→card_fee, 법인카드→corp_card.
   - 어느 항목인지 또는 금액 단위가 애매하면 절대 추측하지 말고 clarify로 되묻는다.
   - "정산현황 얼마야?"처럼 조회는 settlement_input이 아니라 재무팀 세미 배정(route)이다. 특정 하루 조회면 target_date를 채운다.
   - 🚫 **정산현황 ≠ 정산관리 (7/20 실사고 박제)**: settlement_input은 자금 집계 **금액**(원 단위) 전용이다.
     "정산관리"라는 단어가 있거나, 품목명·규격(kg·로얄과·소과)과 **수량**(4, 1, 6 같은 개수) 나열이면 정산관리 화면 입력 건 —
     마루가 처리할 수 없으므로 settlement_input 금지. clarify로 정직 안내: "정산관리 품목·수량 입력은 아직 제가 저장할 수 없어요 — 정산관리 화면에서 직접 입력해주세요. (정산현황 자금 집계 입력이 필요하시면 '정산현황 입력'이라고 말씀해주세요)"
     수량을 금액으로 바꿔 저장하는 것(19개→19원)은 데이터 오염 실패다.
5. 여러 분야가 섞인 지시는 가장 핵심인 분야 하나로 배정하고 reason에 나머지를 언급한다.
6. 재무 지시(세미 배정)에서는 조건을 함께 추출한다:
   - item_keyword: 특정 품목이 언급되면 그 키워드만 (예: "하우스감귤 매출 얼마야?" → "하우스감귤"). 품목 언급 없으면 빈 문자열.
   - period: "이번주"→this_week, "이번달"→this_month, "6월"처럼 특정 월→YYYY-MM (오늘 날짜 기준 올해, 아직 오지 않은 월이면 작년). 기간 언급 없으면 빈 문자열.
   - target_date는 지시에 적힌 날짜를 글자 그대로 옮긴다 ("4월 5일"→"YYYY-04-05"). 하루를 더하거나 빼는 계산·조정 절대 금지.
   - 품목이 없는 재무 지시는 item_keyword를 빈 문자열로 두면 전체 품목 보고서가 나간다. 품목이 없다고 clarify하지 말 것. (기간은 아래 판단 기준표 A를 따른다)
7. 반드시 route_order 도구를 호출해 답한다. 다른 텍스트 응답은 하지 않는다.
8. 모든 문자열 필드에는 순수한 값만 넣는다. 마크업이나 태그 문법, 꺾쇠괄호 문자를 절대 포함하지 않는다.
   해당 action에 필요한 필드만 출력하고 관계없는 필드는 아예 출력하지 않는다 —
   route: team·assignee (+재무면 item_keyword/period/target_date 중 해당분만) / clarify: clarify_question /
   schedule: schedule_op (조회면 schedule_from·schedule_to, 등록이면 schedule_items) /
   settlement_input: settlement_date·settlement_entries / feedback: feedback_kind.

## 판단 기준표 (원칙: 추측 배정 금지 — 확실하면 즉답, 애매하면 1회 되묻기)
【A. 기간 표현】
- 즉답 (되묻기 금지 — 속도 원칙): N월 / N월달 / 지난달 / 이번달 / 저번달 / YYYY년 N월 / N월 N일 / 이번주 / 지난주 / 오늘 / 어제 / 올해.
  이 패턴들은 서버가 날짜를 확정하므로 너는 그대로 배정만 한다.
- 되묻기 (배정 전 1회 질문): '요즘 / 최근 / 얼마 전 / 근래 / 요새 / 한동안 / 그동안 / 저번에 / 지난번' 같은 상대적·불명확 표현.
  → clarify_question 예: "어느 기간으로 볼까요? (예: 이번주 / 이번달 / 최근 30일)"
- 기간이 아예 없는 조회 지시 (예: "매출 알려줘") → "어느 기간 매출을 볼까요? (예: 이번주 / 이번달)"로 되묻는다.
- 기간과 조회 항목이 모두 명시된 지시는 즉시 배정한다 — 그 문장에서 더 물을 것이 없다.
  예: "이번주 결제금액 보내줘" = 기간(이번주)+항목(결제금액=정산 조회)+파일(보내줘) → 즉시 세미 배정. '결제금액/매출/정산' 조회는 전부 재무팀 세미 담당이다.
- 주차 표현(이번주/지난주/N월 N주차/N째주/N주차)과 거래처(효돈/대성/기타거래처/CJ)가 함께 있는 정산·택배비 조회도 즉시 세미 배정한다.
  예: "이번주 효돈 정산금 파일 줘", "3월 셋째주 대성 정산 파일", "1주차 CJ 택배비 얼마야" — 주차 범위와 거래처는 서버가 확정하므로 너는 배정만 한다.
- 마진·원가 계산 (예: "○○ 원가 얼마에 판매가 얼마면 마진 얼마야?") → 재무팀 한수 배정 (지시 #54).
- 개발 백로그 ("백로그에 추가해줘/보여줘")·버전·변경사항 질문 → 개발부서 미래 배정 (지시 #54).
【B. 멀티 지시】
- 발동 조건: 한 문장에 서로 다른 요청이 2개 이상 (판별 힌트: '그리고/랑/이랑/하고/~도' + 동사 2개 이상).
  예: "휴가 언제야? 그리고 지난달 정산도 보여줘" / "톡톡 문구랑 디자인도 같이 만들어줘"
- 1단계: action='clarify'로 목록을 복창해 확인받는다. 몰래 일부만 처리 금지 (절반 누락 = 실패).
  → clarify_question 예: "①톡톡 문구(글샘) ②디자인 시안(미소) ③행사 일정 등록 — 세 건 모두 진행할까요?"
- 2단계 (대표 실사용 지적 — 절대 규칙): 결합 텍스트에 [대표 답변]이 긍정(네/맞아/응/어/그래/좋아/진행해/ㅇㅇ/오케이/ok 등 — 표현이 무엇이든 승인 의사면 전부 긍정)이면
  **action='multi' + subtasks에 확인받은 전 건을 각각 완결된 독립 지시 문장으로 분해해 출력** (조건·기간·품목을 각 문장에 전부 복사).
  한 건만 골라 route로 배정하는 것 = 나머지를 몰래 버리는 실패다. 확인받은 N건은 N개 subtask로 전부 나간다.
  🚫 대표가 **명시적으로 요청한 작업만** subtask로 분해한다. 원문에 없는 작업을 추론으로 추가 금지 (예: "톡톡 문구·이미지·문자 준비해줘"는 3건 — 행사 기간이 있어도 대표가 '일정 등록'을 말하지 않았으면 일정 등록을 넣지 않는다). 대표가 만든 목록보다 늘리지 않는다.
  ⚠️ multi를 선언하면서 subtasks 배열을 비우는 것도 실패다 — subtasks에 문장이 2건 이상 실제로 담겨야 실행된다.
  출력 예: subtasks: ["미니밤호박 톡톡 문구 작성 — 담주 화~목 3일, 2천원 할인쿠폰, 10+1 추첨 20명", "미니밤호박 톡톡 이미지 디자인 제작 — 같은 행사 조건", "담주 화~목 미니밤호박 행사 일정 등록"]
- 단, 같은 대상의 단일 요청은 멀티가 아니다 (예: "4월 정산 엑셀로 보내줘" = 1건 — 기존대로 route).
【C. 공통 규칙】
- 되묻기는 1회만. 답을 받으면 재질문 없이 진행한다.
- 되묻기에는 반드시 구체적 선택지 예시를 포함한다. 알맹이 없는 되묻기("확인이 필요합니다" 단독)는 금지.
- 이 판단표는 조회·등록·파일요청 등 모든 지시 유형에 적용된다.${menuGlossary}${maruLessonText}`;
}

// ------------------------------------------------------------
// 6차: 피드백 → 교훈 추출 (성장시스템 2절) — Haiku로 교훈 후보 추출,
// '제안' 상태로만 등록. 활성화는 반드시 대표 승인(approve)으로만.
// ------------------------------------------------------------
const LESSON_TOOL = {
    name: 'propose_lesson',
    description: '대표 피드백에서 요원이 다음 작업부터 적용할 교훈을 추출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            has_lesson: { type: 'boolean', description: '재사용 가능한 교훈이 있으면 true. 단순 칭찬·일회성 사실이면 false' },
            lesson: { type: 'string', description: '교훈 한 줄 — 다음 작업에 바로 적용 가능한 지시문 형태 (예: "본문에 날짜를 쓸 때 요일은 오늘 날짜 기준으로 반드시 검산할 것"). has_lesson=false면 빈 문자열' },
            category: { type: 'string', enum: ['톤', '형식', '금지사항', '선호', '정확성', '기타'] },
        },
        required: ['has_lesson', 'lesson', 'category'],
    },
};

async function extractLessonFromFeedback(fb, actor) {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            console.error('교훈 추출 불가: ANTHROPIC_API_KEY 환경변수 없음');
            return;
        }
        const agentQ = await pool.query('SELECT id, name, duty FROM agents WHERE id = $1', [fb.agent_id]);
        const agent = agentQ.rows[0];
        if (!agent) return;
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const fbDesc = `요원: ${agent.name} (${agent.duty || ''})
피드백 종류: ${fb.feedback_type} (good=좋음/edited=수정됨/bad=다시/comment=코멘트)
대표 코멘트: ${fb.comment || '(없음)'}
대표 수정본: ${fb.corrected_output || '(없음)'}
원본 결과 요약: ${String(fb.original_output || '').slice(0, 1500) || '(없음)'}`;
        const msg = await anthropic.messages.create({
            model: MARU_MODEL,
            max_tokens: 300,
            system: '너는 AI 요원 조직의 학습 노트 관리자다. 대표 피드백에서 해당 요원이 다음 작업부터 일반적으로 적용할 교훈 한 줄을 추출한다. 교훈은 구체적 지시문 형태로 쓴다. 재사용 불가능한 일회성 내용이나 단순 칭찬은 has_lesson=false. 반드시 propose_lesson 도구로 답한다.',
            tools: [LESSON_TOOL],
            tool_choice: { type: 'tool', name: 'propose_lesson' },
            messages: [{ role: 'user', content: fbDesc }],
        });
        const tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu || !tu.input.has_lesson || !String(tu.input.lesson).trim()) return;
        const row = (await pool.query(
            `INSERT INTO agent_lessons (agent_id, lesson, category, status, source_feedback_ids)
             VALUES ($1, $2, $3, '제안', $4) RETURNING *`,
            [fb.agent_id, String(tu.input.lesson).trim(), tu.input.category, JSON.stringify([fb.id])])).rows[0];
        await writeAudit({
            action: 'lesson_proposed', targetType: 'agent_lesson', targetId: row.id,
            changes: { after: { agent: agent.name, lesson: row.lesson, category: row.category, feedback_id: fb.id } },
            source: 'agent_office', actor,
        });
        console.log(`교훈 제안 등록: ${agent.name} — ${row.lesson}`);
    } catch (err) {
        // 오류 정직 기록 — 교훈 추출 실패해도 피드백 저장은 유지됨
        console.error('교훈 추출 오류:', err?.status ? `Anthropic API 오류 (${err.status}): ${err.message}` : (err?.message || err));
    }
}

// 소급 처리: 교훈이 아직 추출되지 않은 기존 피드백 처리 (서버 기동 시 1회 — 멱등)
async function backfillLessonsFromFeedback() {
    try {
        if (!process.env.ANTHROPIC_API_KEY) return;
        const r = await pool.query(`
            SELECT f.* FROM agent_feedback f
            WHERE f.is_deleted = false AND f.feedback_type != 'good'
              AND NOT EXISTS (SELECT 1 FROM agent_lessons l WHERE l.source_feedback_ids @> jsonb_build_array(f.id))
            ORDER BY f.id ASC LIMIT 20`);
        if (r.rows.length === 0) return;
        console.log(`교훈 소급 추출 시작: 기존 피드백 ${r.rows.length}건`);
        const actor = await getMcpActor();
        for (const fb of r.rows) {
            await extractLessonFromFeedback(fb, actor);
        }
    } catch (e) { console.error('교훈 소급 추출 오류:', e.message); }
}

// ------------------------------------------------------------
// 핫픽스: 마루 응답 오염 방지 — 모델이 필드 값에 도구 호출 태그 문법을
// 섞어 넣는 경우(</antml...> 등) 감지 → 1회 재시도 → 서버측 정화
// ------------------------------------------------------------
const MARU_TAG_RE = /<\/?\s*(antml|parameter|invoke|function)[^>]*>?/gi;

// 서술형 필드: 태그만 제거하고 텍스트는 살림
function maruCleanText(v) {
    if (typeof v !== 'string') return '';
    return v.replace(MARU_TAG_RE, '').replace(/<[^>]*>/g, '').trim();
}
// 토큰형 필드(키워드/날짜/이름): 태그 흔적이 있으면 통째로 무효 (오염값 전파 차단)
function maruCleanToken(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (/[<>]/.test(s) || /antml|parameter|invoke/i.test(s)) return '';
    return s;
}
function maruDecisionPolluted(input) {
    const bad = v => typeof v === 'string' && /[<>]/.test(v) && /antml|parameter|invoke|function/i.test(v);
    return Object.values(input || {}).some(v => Array.isArray(v)
        ? v.some(o => o && typeof o === 'object' && Object.values(o).some(bad))
        : bad(v));
}
// v5.0 A-①: 오염이 감지된 필드명 + 파편 원문(200자)을 수집 — audit 기록용 (실오염/오탐 판별 증거)
function maruPollutionSample(input) {
    const bad = v => typeof v === 'string' && /[<>]/.test(v) && /antml|parameter|invoke|function/i.test(v);
    const out = [];
    for (const [k, v] of Object.entries(input || {})) {
        if (Array.isArray(v)) {
            v.forEach((o, i) => {
                if (o && typeof o === 'object') Object.entries(o).forEach(([k2, v2]) => {
                    if (bad(v2)) out.push(`${k}[${i}].${k2} = ${String(v2).slice(0, 200)}`);
                });
            });
        } else if (bad(v)) out.push(`${k} = ${String(v).slice(0, 200)}`);
    }
    return out;
}
function maruCleanDecision(raw) {
    const d = { ...raw };
    d.team = maruCleanToken(d.team);
    d.assignee = maruCleanToken(d.assignee);
    d.task_summary = maruCleanText(d.task_summary);
    d.reason = maruCleanText(d.reason);
    d.clarify_question = maruCleanText(d.clarify_question);
    d.item_keyword = maruCleanToken(d.item_keyword);
    d.period = maruCleanToken(d.period);
    d.target_date = maruCleanToken(d.target_date);
    d.settlement_date = maruCleanToken(d.settlement_date);
    d.schedule_from = maruCleanToken(d.schedule_from);
    d.schedule_to = maruCleanToken(d.schedule_to);
    d.schedule_items = (Array.isArray(d.schedule_items) ? d.schedule_items : []).map(i => ({
        date: maruCleanToken(i && i.date),
        end_date: maruCleanToken(i && i.end_date),
        time: maruCleanToken(i && i.time),
        title: maruCleanText(i && i.title),
        category: maruCleanToken(i && i.category),
        assignee_name: maruCleanToken(i && i.assignee_name),
        date_note: maruCleanText(i && i.date_note),
    }));
    // 멀티 분산 (대표 실사용 지적): 지시 문장 배열 정화 — 최대 5건
    d.subtasks = (Array.isArray(d.subtasks) ? d.subtasks : []).map(x => maruCleanText(x)).filter(Boolean).slice(0, 5);
    return maruNormalizeDecision(d);
}
// C안 C-2 (지시 #14): required 축소로 모델이 생략한 필드를 빈값으로 복원 — 하위 코드(라우팅·박제
// 체커·audit)는 16필드가 항상 존재한다고 가정하므로 여기서 형태를 보장한다 (정화 직후 단일 관문)
function maruNormalizeDecision(d) {
    const out = { ...d };
    for (const f of ['team', 'assignee', 'task_summary', 'reason', 'clarify_question', 'answer_text', 'item_keyword',
        'period', 'target_date', 'settlement_date', 'schedule_from', 'schedule_to']) {
        if (typeof out[f] !== 'string') out[f] = '';
    }
    if (!['칭찬', '수정', '지적', '코멘트'].includes(out.feedback_kind)) out.feedback_kind = '코멘트';
    if (!['조회', '등록', '불가', '해당없음'].includes(out.schedule_op)) {
        out.schedule_op = out.action === 'schedule' ? '' : '해당없음'; // schedule인데 op 누락 = Unusable 판정 대상
    }
    if (!Array.isArray(out.schedule_items)) out.schedule_items = [];
    if (!Array.isArray(out.settlement_entries)) out.settlement_entries = [];
    if (!Array.isArray(out.subtasks)) out.subtasks = [];
    if (!Array.isArray(out.clarify_choices)) out.clarify_choices = [];
    return out;
}

// 날짜 파싱은 date-utils.js로 이동 (v5.0 1단계 — 월 단위 파싱 추가, 로컬 테스트 공용)

// 접수 지시 상태 갱신 헬퍼
async function maruFinishOrder(orderId, status, result, runId = null) {
    await pool.query(
        `UPDATE pending_orders SET status=$2, result=$3, run_id=$4, processed_at=NOW() WHERE id=$1`,
        [orderId, status, JSON.stringify(result), runId]);
    // 지시 #29-1: 되묻기(대표 답변 필요)는 ❓ 행동 안내형 알림 — 질문 내용은 미포함 (요약만)
    if (status === '질문') {
        notifyTelegram('❓ 마루: 대표 답변 필요 → 지시 입력바에 답해주세요');
    }
}

// 지시 #6-1: 원 지시 + 마루 질문 + 대표 답변을 하나의 지시로 결합 (맥락 소실 방지)
function buildCombinedOrderText(originalContent, question, answer) {
    return '[진행 중 문답 결합 — 아래 세 줄을 하나의 지시로 해석해 배정하라. 답변이 확인 질문과 무관한 완전히 새로운 지시라면 답변만 기준으로 배정하라]\n'
        + `[원 지시] ${originalContent}\n`
        + `[마루의 확인 질문] ${question}\n`
        + `[대표의 답변] ${answer}`;
}
// 대표 지적(7/21): 요원이 답을 낸 뒤 대표가 아직 '확인'(보고 보관) 안 한 열린 상태에서 이어 물으면,
// 마루가 처음부터 다시 생각(맥락 소실)하지 말고 이전에 답한 요원에게 후속을 이어 배정하도록 결합 텍스트를 만든다.
function buildFollowUpText(originalContent, agentName, prevAnswer, followUp) {
    return '[진행 중 대화 이어가기 — 대표가 이전 답변을 아직 "확인"하지 않은 열린 상태다. 아래를 하나의 흐름으로 이어서 해석하고, 이전에 답한 요원에게 다시 배정하라. 단 후속 메시지가 이전 답변과 명백히 무관한 완전히 새로운 지시면 후속 메시지만 기준으로 배정하라]\n'
        + `[원 지시] ${originalContent}\n`
        + `[${agentName}의 이전 답변] ${prevAnswer}\n`
        + `[대표의 후속] ${followUp}`;
}
// 멀티(대표 7/21): 확인 안 된 열린 작업이 여러 개면(예: 글샘 문구·미소 이미지 동시) 목록을 마루에게 보여주고
//   후속이 어느 요원 것인지 고르게 한다. 마루가 고른 요원의 '자기 스레드'로는 이후 buildFollowUpText로 좁힌다.
function buildMultiFollowUpText(threads, followUp) {
    const list = threads.map((t, i) => {
        const label = String(t.content).split(/\s*\[(?:상세 조건|멀티)/)[0].slice(0, 60);
        return `  ${i + 1}. [${t.assignee}] ${label} — 결과 요약: ${String(t.prevAns).slice(0, 80)}`;
    }).join('\n');
    return '[진행 중 대화 이어가기 — 대표가 아직 "확인"하지 않은 열린 작업이 여러 개다. 아래 목록에서 대표의 후속이 어느 작업(요원)에 대한 것인지 판단해 그 요원에게 다시 배정하라(assignee=그 요원). 어디에도 해당하지 않는 완전히 새 지시면 새로 배정하라]\n'
        + '[열린 작업들]\n' + list + '\n'
        + `[대표의 후속] ${followUp}`;
}
// 지시 #7: '이번주/금주' 원문 서버 확정 — 월·특정일 패턴이 없을 때 period를 this_week로 강제
// (지시 기간 = 산출 기간 원칙: "이번주 보내줘"가 월간 보고서·파일로 빠지던 편차 수정)
function maruWeekPeriodOverride(period, content) {
    if (!/이번\s*주|금주/.test(String(content || ''))) return period;
    if (parseExplicitMonth(content, '2100-01-01') || hasExplicitDay(content)) return period; // 월·특정일 명시가 우선
    return 'this_week';
}
// 지시 #15: 거래처 축약 표현 → 정산 partner 명칭 (주차 표현과 함께 있을 때만 사용 — 서버 확정 전용)
function parsePartnerKeyword(text) {
    const s = String(text || '');
    if (/효돈/.test(s)) return '효돈농협';
    if (/대성|시온/.test(s)) return '대성(시온)';
    if (/기타\s*거래/.test(s)) return '기타거래처';
    if (/씨제이|대한통운|CJ|택배비/i.test(s)) return 'CJ대한통운';
    return null;
}
// 지시 #6-2: 기간+재무 항목이 모두 명시된 조회는 되묻기 금지 — clarify를 세미 배정으로 서버 강제 보정
function maruForceFinanceRoute(d, content, todayStr) {
    if (!d || d.action !== 'clarify') return null;
    if (!/정산|매출|결제\s*금액|택배비/.test(content)) return null;
    let period = '', target = '';
    if (/이번\s*주|금주/.test(content)) period = 'this_week';
    else {
        const em = parseExplicitMonth(content, todayStr);
        if (em) period = em;
        else if (hasExplicitDay(content)) target = parseExplicitDate(content, todayStr);
        else if (parseWeekSpec(content, todayStr) && parsePartnerKeyword(content)) {
            // 지시 #15: 주차+거래처 완전 지시 (예: "1주차 CJ 택배비 얼마") — 실제 범위는 조건 확정부가
            // partner_week로 재계산·덮어쓰므로 여기서는 트리거 표시만 (임시 period, 하류에서 비워짐)
            period = 'this_week';
        }
    }
    if (!period && !target) return null;
    return {
        ...d, action: 'route', team: '재무팀', assignee: '세미',
        task_summary: d.task_summary || '재무 조회 (서버 보정)',
        reason: '서버 보정: 기간+재무 항목이 모두 명시된 지시 — 빈 되묻기 금지 규칙 (지시 #6)',
        clarify_question: '', period, target_date: target || '',
    };
}

// 마루 판단 호출 (오염 감지 → 재시도 → 정화 포함) — 실제 처리와 역량 테스트가 공용
async function maruDecide(content, image = null) {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다 (Render 환경변수 확인 필요)');
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = await maruBuildSystemPrompt();
    // 대표 7/22: 이미지가 첨부되면 마루가 직접 보고 판단(answer/route) — 정산 등록 이미지는 서버가 미리 걸러 여기 안 옴
    const userContent = (image && image.data)
        ? [
            { type: 'image', source: { type: 'base64', media_type: image.mime || 'image/png', data: image.data } },
            { type: 'text', text: `대표 지시(이미지 첨부됨): ${content}` },
          ]
        : `대표 지시: ${content}`;
    const call = async (extraNote) => {
        const msg = await anthropic.messages.create({
            model: MARU_MODEL,
            max_tokens: 800,
            system: systemPrompt + (extraNote || ''),
            tools: [MARU_ROUTE_TOOL],
            tool_choice: { type: 'tool', name: 'route_order' },
            messages: [{ role: 'user', content: userContent }],
        });
        const tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu) throw new Error('마루 응답에서 배정 결과(tool_use)를 찾지 못했습니다');
        return tu.input;
    };
    let raw = await call();
    let polluted = maruDecisionPolluted(raw);
    // A-①: 오염 파편 실물 수집 — audit 기록으로 실측 (1주 평가 근거)
    const pollution = polluted ? { first: maruPollutionSample(raw) } : null;
    let d = maruCleanDecision(raw);
    // (b) 조건부 재시도 (2026-07-18 대표 채택): 평시엔 정화기만으로 방어 (호출 1회).
    // 정화 후 필수값이 비어 배정 불능일 때만 재호출 — 재시도가 오염을 못 없앤다는 실측(변형 태그)에 따른 비용·지연 절감.
    if (polluted && maruDecisionUnusable(d)) {
        raw = await call('\n\n※ 경고: 직전 응답의 필드 값에 태그 문법이 섞여 있었다. 각 필드에는 순수한 값만 넣어라. 해당 action에 필요한 필드만 출력하고 관계없는 필드는 아예 출력하지 않는다. 꺾쇠괄호와 마크업 문법은 어떤 필드에도 절대 넣지 않는다.');
        polluted = maruDecisionPolluted(raw);
        if (polluted) pollution.retry = maruPollutionSample(raw);
        d = maruCleanDecision(raw);
    }
    return { d, polluted, pollution };
}
// 정화 후에도 배정을 진행할 수 없는 상태인지 (조건부 재시도 발동 기준)
// - action 자체가 없거나, route인데 담당 요원이 비었거나, clarify인데 질문이 빈 경우(빈 되묻기 금지)
// - C안 C-2 (지시 #14): required 축소에 따라 action별 필수 필드 누락도 판정에 추가
function maruDecisionUnusable(d) {
    if (!d || !d.action) return true;
    if (d.action === 'route' && !String(d.assignee || '').trim()) return true;
    if (d.action === 'clarify' && !String(d.clarify_question || '').trim()) return true;
    if (d.action === 'answer' && !String(d.answer_text || '').trim()) return true;
    if (d.action === 'schedule' && !['조회', '등록', '불가'].includes(d.schedule_op)) return true;
    if (d.action === 'schedule' && d.schedule_op === '등록'
        && !(Array.isArray(d.schedule_items) && d.schedule_items.length)) return true;
    if (d.action === 'settlement_input'
        && !(Array.isArray(d.settlement_entries) && d.settlement_entries.length)) return true;
    if (d.action === 'multi'
        && !(Array.isArray(d.subtasks) && d.subtasks.length >= 2)) return true; // 멀티인데 분해 없음 = 재시도
    return false;
}

// ============================================================
// 10차: AI 전 직원 자동 역량 테스트 — 보고서만 등록, 자동 수정 없음.
// 규칙: 에이전트 수정 후 배포 전 이 점검 통과 필수.
// 기대 금액값은 2026-07-17 DB 스냅샷 기준 (대표가 정산관리 화면으로 검증한 값).
// ============================================================
const CAP_EMOJI_RE = /[\u{1F300}-\u{1FAFF}]|[\u{2700}-\u{27BF}]|[\u{2B00}-\u{2BFF}]|[\u{231A}-\u{23FF}]|\u{FE0F}/u;

// 본문 속 '7/20(월)' / '7월 20일(월)' 표기의 요일 검산
function capWeekdayErrors(text) {
    const errs = [];
    const year = Number(kstTodayStr().slice(0, 4));
    const re = /(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*\(\s*([일월화수목금토])\s*\)|(\d{1,2})\/(\d{1,2})\s*\(\s*([일월화수목금토])\s*\)/g;
    let m;
    while ((m = re.exec(String(text))) !== null) {
        const mo = Number(m[1] || m[4]), d = Number(m[2] || m[5]), day = m[3] || m[6];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
        const real = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(year, mo - 1, d)).getUTCDay()];
        if (real !== day) errs.push(`${mo}/${d}=${real}요일인데 (${day}) 표기`);
    }
    return errs;
}

let capTestRunning = false;

// 지시 #59-1: 산출물 날짜 인식 공용 유틸 — 4형식("2026-07-21"·"07-21"·"7/21"·"7월 21일") 전부 ISO로 추출
// (S1 채점기 오심 대응: 카피가 ISO로 정확히 표기했는데 채점기가 "7/21"형만 인식해 거짓 실패)
function extractDatesISO(text, year) {
    const t = String(text || '');
    const y = String(year || new Date().getFullYear());
    const out = new Set();
    const push = (mm, dd) => {
        const m = Number(mm), d = Number(dd);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.add(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    };
    let m;
    const reIso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = reIso.exec(t))) { const mm = Number(m[2]), dd = Number(m[3]); if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.add(`${m[1]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`); }
    const reMd = /(?<!\d)(\d{1,2})\s*[\/]\s*(\d{1,2})(?!\d)/g;
    while ((m = reMd.exec(t))) push(m[1], m[2]);
    const reKo = /(\d{1,2})월\s*(\d{1,2})일/g;
    while ((m = reKo.exec(t))) push(m[1], m[2]);
    const reDash = /(?<!\d)(\d{2})-(\d{2})(?!\d)(?!-)/g; // "07-21"형 — 전화번호 오탐 방지: 뒤에 -숫자 이어지면 제외
    while ((m = reDash.exec(t))) push(m[1], m[2]);
    return [...out];
}

// ===== 지시 #51: 실전 문구 스모크 시험 — 대표 원문 5건 (한 글자도 수정 금지) =====
// 전 문항 is_test 격리: 실제 일정 등록·발송·이미지 생성 호출 없음 (마루는 판단만, 미소는 프롬프트까지만).
// 답변 전문(transcripts)을 성적표에 기록 — 똑똑이가 원본 대조 판독. 실행은 [#51-실행] 별도 승인.
const SMOKE_S1 = '단골고객 문자 보낼거야 담주 화요일부터 목요일 단 3일간 2천원 할인쿠폰 10+1 추첨 20명 주문건에 동일상품으로 당첨 시 1박스 더 보낼거야(20명) 품목은 미니밤호박이고 포슬포슬에 당까지 지금이 가장 적절하고 맛있을때 강력추천해 꼬마 미니밤호박은 여기에 +특가 진행';
const SMOKE_S2 = '스토어 톡톡 보낼거야 담주 화요일부터 목요일 단 3일간 2천원 할인쿠폰 10+1 추첨 20명 주문건에 동일상품으로 당첨 시 1박스 더 보낼거야(20명) 품목은 미니밤호박이고 포슬포슬에 당까지 지금이 가장 적절하고 맛있을때 강력추천해 꼬마 미니밤호박은 여기에 +특가 진행 톡톡 문구랑 디자인도 같이 만들어줘';
const SMOKE_S3 = '담주 화요일부터 목요일 톡톡, 단골고객 문자 발송, 10+1행사 일정 등록해줘';
const SMOKE_S4 = '아꼼이네 오션라운지 인스타 영상 시작하려고 해 인스타 추천 아이디 3개 해주고, 인스타 상단에 소개서도 예시로 3개 후보군 만들어줘';
const SMOKE_S5 = '신규 품목 무늬오징어 판매할거야 결제가 kg당 3만원이고 여기에 택배비3100원+아이스박스값 포함되(2천원) 판매가 58,000원이야 거래처와 미팅 후 진행할거고 이제 직원들이 출장가서 사진 찍고 할거야 이 내용 정리해서 보고서 만들어줘 (직원들에게 보여줄 용)';

// 스모크 채점 헬퍼: 핵심 정보 포함 여부 (누락 목록 반환)
function smokeMissingInfo(text) {
    const t = String(text || '');
    const req = [
        ['3일간', /3일/], ['2천원 쿠폰', /2[,.]?0?00원|2천\s*원|2천원/], ['10+1 추첨', /10\s*\+\s*1/],
        ['20명', /20명/], ['동일상품 1박스', /1박스|한 박스/], ['미니밤호박', /미니\s*밤\s*호박|미니밤호박/],
        ['제철·포슬·당도', /포슬|당도|당까지|달콤/], ['꼬마 +특가', /꼬마.*특가|특가.*꼬마/],
    ];
    return req.filter(([, re]) => !re.test(t)).map(([n]) => n);
}
async function executeSmokeTest(run, actor, scope) {
    const inScope = k => !Array.isArray(scope) || !scope.length || scope.includes(k); // 지시 #56: 부분 재실행
    const results = [];
    const transcripts = [];
    const add = (name, pass, expected, actual) => results.push({ name, pass: !!pass, expected, actual: String(actual).slice(0, 400) });
    const keep = (name, content) => transcripts.push({ name, content: String(content).slice(0, 8000) });
    const step = async label => agentRunAppendStep(run.id, agentStep('work', '마루', label));
    const helpers = { matchItemToPricing, normDateSafe };
    // 담주 화~목 (오늘 기준 다음주 월요일 +1일 ~ +3일) — 채점 기준일 (지시 #51: 실행 시점 기준 해석)
    const today = new Date(kstTodayStr() + 'T00:00:00Z');
    const dowN = (today.getUTCDay() + 6) % 7;
    const nextMon = new Date(today); nextMon.setUTCDate(today.getUTCDate() - dowN + 7);
    const dstr = off => { const d = new Date(nextMon); d.setUTCDate(nextMon.getUTCDate() + off); return d.toISOString().slice(0, 10); };
    const TUE = dstr(1), THU = dstr(3);
    // 지시 #54·#55: 날짜 단일 소스 — 스모크도 실전과 동일하게 서버 확정 날짜 주입 + 산출물 대조·과장 검사
    const smokeDates = { dates_hint: `${TUE}(화)~${THU}(목)`, dates_range: { from: TUE, to: THU } };
    const HYPE_RE = /미쳤(어요|다|음)|끝판왕?|인생\s*(호박|귤|맛)|역대급/; // 지시 #55-4 과장 금지어
    const dateCheck = text => {
        // 지시 #59-1: 4형식 날짜 인식 (ISO·07-21·7/21·7월 21일)
        const dates = extractDatesISO(text, TUE.slice(0, 4));
        const inR = dates.includes(TUE) || dates.includes(THU);
        const outR = dates.some(ds => ds < TUE || ds > THU);
        return { inR, outR };
    };

    try {
        // ── S1: 문자 (글샘 → 한결) ──
        if (inScope('S1')) {

        await step('S1 실전 문자 — 글샘 생성·한결 검수 중...');
        try {
            const gs = loadAgentRunner('글샘');
            const gAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'geulsaem' LIMIT 1`)).rows[0];
            const r1 = await gs.result({ agent: gAgent, pool, params: { order_content: SMOKE_S1, ...smokeDates }, helpers });
            const text1 = (r1.report.versions || []).map(v => `[${v.label}]\n${v.text}`).join('\n\n');
            keep('S1 글샘 답변 전문', text1);
            const miss1 = smokeMissingInfo(text1);
            const dc1 = dateCheck(text1);
            add('S1 3버전+채널 규격', (r1.report.versions || []).length >= 3 && /SMS|LMS/.test(r1.report.channel || ''),
                '3버전 + SMS/LMS', `${(r1.report.versions || []).length}버전 · ${r1.report.channel}`);
            add('S1 핵심 정보 전부 포함', miss1.length === 0, '8요소 전부', miss1.length ? '누락: ' + miss1.join(', ') : '전부 포함');
            add('S1 날짜 = 서버 확정값 (지시#54)', dc1.inR && !dc1.outR, `${TUE}(화)~${THU}(목)만 표기 — 범위 밖 날짜 = 실패`, `범위 내=${dc1.inR} 범위 밖=${dc1.outR ? '있음(실패)' : '없음'}`);
            add('S1 과장 금지어 없음 (지시#55)', !HYPE_RE.test(text1), '미쳤어요·끝판·인생○·역대급 없음', HYPE_RE.test(text1) ? '과장 표현 검출(실패)' : '없음');
            // 지시 #54-1: 한결 검수 제거 — 최종 검토는 대표 (코드 검사로 대체됨)
        } catch (e) { add('S1 실행', false, '글샘→한결 파이프라인', '오류: ' + e.message); }

        }
        // ── S2: 톡톡 + 디자인 (글샘 + 미소 → 한결) ──
        if (inScope('S2')) {

        await step('S2 톡톡+디자인 — 글샘·미소 생성·한결 검수 중...');
        try {
            const gs = loadAgentRunner('글샘');
            const ms = loadAgentRunner('미소');
            const gAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'geulsaem' LIMIT 1`)).rows[0];
            const mAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'miso' LIMIT 1`)).rows[0];
            const r2 = await gs.result({ agent: gAgent, pool, params: { order_content: SMOKE_S2, ...smokeDates }, helpers });
            const text2 = (r2.report.versions || []).map(v => `[${v.label}]\n${v.text}`).join('\n\n');
            keep('S2 글샘(톡톡) 답변 전문', text2);
            const m2 = await ms.result({ agent: mAgent, pool, params: { order_content: SMOKE_S2 }, helpers });
            const o2 = (m2.report.outputs || [])[0] || {};
            keep('S2 미소 프롬프트 전문', (m2.report.outputs || []).map(o => `[${o.label} ${o.ratio}]\n${o.prompt_en}`).join('\n\n'));
            const miss2 = smokeMissingInfo(text2);
            add('S2 톡톡 문구 (핵심 정보+규격)', miss2.length === 0 && r2.report.channel === '톡톡',
                '8요소 + 톡톡 채널', `${r2.report.channel} · ${miss2.length ? '누락: ' + miss2.join(', ') : '정보 전부'}`);
            add('S2 미소 8단계·1:1·금지어 없음',
                String(o2.prompt_en || '').length > 80 && /F5C800/i.test(o2.prompt_en || '') && !/AI generated|cartoon|cheap|discount/i.test(o2.prompt_en || ''),
                '8단계 구조 요소 + 브랜드 컬러 + 금지어 없음 (생성 버튼 미호출)', `${o2.ratio || '?'} · ${String(o2.prompt_en || '').length}자`);
            const dc2 = dateCheck(text2); // 지시 #55-2: S2에도 S1 동일 날짜 검사 (설계 구멍 봉합)
            add('S2 날짜 = 서버 확정값 (지시#55)', dc2.inR && !dc2.outR, `${TUE}~${THU}만 표기`, `범위 내=${dc2.inR} 범위 밖=${dc2.outR ? '있음(실패)' : '없음'}`);
            add('S2 과장 금지어 없음 (지시#55)', !HYPE_RE.test(text2), '과장 표현 없음', HYPE_RE.test(text2) ? '검출(실패)' : '없음');
        } catch (e) { add('S2 실행', false, '글샘+미소→한결 파이프라인', '오류: ' + e.message); }

        }
        // ── S3: 일정 (마루 판단만 — 실제 등록 금지) ──
        if (inScope('S3')) {

        await step('S3 일정 해석 — 마루 판단 중... (실제 등록 없음)');
        try {
            const { d } = await maruDecide(SMOKE_S3);
            keep('S3 마루 판단 전문', JSON.stringify(d, null, 2));
            const items = d.schedule_items || [];
            const cats = items.map(i => i.category);
            const threeOk = d.action === 'schedule' && d.schedule_op === '등록' && items.length >= 3
                && cats.includes('톡톡발송') && cats.includes('문자발송') && cats.includes('할인·이벤트')
                && items.some(i => i.category === '할인·이벤트' && i.end_date && i.end_date > i.date);
            const clarifyOk = d.action === 'clarify' && !!d.clarify_question; // 멀티 지시 복창도 정상 판정 (지시 #51)
            add('S3 일정 3건 해석 또는 멀티 복창', threeOk || clarifyOk,
                `3건(톡톡·문자·할인 기간형 ${TUE}~${THU}) 또는 나눠달라 clarify — 실제 등록 없음`,
                threeOk ? `등록 해석 ${items.length}건 [${cats.join(',')}]` : (clarifyOk ? 'clarify: ' + d.clarify_question.slice(0, 80) : `${d.action}/${d.schedule_op || ''} — 부적합`));
        } catch (e) { add('S3 실행', false, '마루 판단', '오류: ' + e.message); }

        }
        // ── S4: 인스타 (기안 → 미래) ──
        if (inScope('S4')) {

        await step('S4 인스타 기획 — 기안 생성·미래 검수 중...');
        try {
            const gi = loadAgentRunner('기안');
            const r4 = (await gi.result({ pool, params: { order_content: SMOKE_S4 } })).report;
            const full4 = JSON.stringify(r4, null, 2);
            keep('S4 기안 답변 전문', full4);
            const idCount = (full4.match(/@[a-z0-9._]{3,}/gi) || []).length;
            add('S4 아이디 3개+소개글 3개', idCount >= 3 && /소개/.test(full4),
                '아이디 후보 3+ · 소개글 후보 3 (실존 계정 지어내기 금지 — 전문 대조)', `아이디 ${idCount}개 감지 — 소개글은 전문 대조 필요`);
            add('S4 오션라운지 컨셉 반영', /오션|라운지|ocean|lounge|카페/i.test(full4) && /제주|jeju/i.test(full4),
                '제주·카페·오션라운지 요소', /오션|ocean/i.test(full4) ? '반영' : '미확인');
        } catch (e) { add('S4 실행', false, '기안→미래 파이프라인', '오류: ' + e.message); }

        }
        // ── S5: 보고서 (기안 → 미래) ──
        if (inScope('S5')) {

        await step('S5 신규 품목 보고서 — 기안 생성·미래 검수 중...');
        try {
            const gi = loadAgentRunner('기안');
            const r5 = (await gi.result({ pool, params: { order_content: SMOKE_S5 } })).report;
            const full5 = JSON.stringify(r5, null, 2);
            keep('S5 기안 답변 전문', full5);
            const nums = { 원가합: /35[,.]?100/.test(full5), 판매가: /58[,.]?000/.test(full5), 차액: /22[,.]?900/.test(full5) };
            const numsOk = nums.원가합 && nums.판매가;
            add('S5 7항목 구조', !!(r5.summary && r5.purpose && r5.target && (r5.steps || []).length && r5.cost && r5.metrics && (r5.risks || []).length),
                '7항목 전부', '구조 확인');
            add('S5 숫자 정확 (35,100·58,000·22,900)', numsOk, '원가 합 35,100 · 판매가 58,000 (차액 22,900 권장)',
                `원가합=${nums.원가합} 판매가=${nums.판매가} 차액=${nums.차액}`);
            add('S5 미팅·출장 촬영 포함', /미팅/.test(full5) && /출장|촬영|사진/.test(full5), '미팅 후 진행 + 직원 출장 촬영', '전문 대조');
            add('S5 판매량 전망 없음', !/판매량.*(예상|전망)|월\s*\d+\s*(박스|kg).*(판매|매출)/.test(full5),
                '근거 없는 전망 금지 (지시 #54 — 검수 게이트 제거, 대표 직행)', '전문 대조');
        } catch (e) { add('S5 실행', false, '기안→미래 파이프라인', '오류: ' + e.message); }
        }
    } catch (fatal) { console.error('스모크 시험 치명 오류:', fatal.message); }

    const pass = results.filter(r => r.pass).length;
    const scopeLabel = Array.isArray(scope) && scope.length ? ` [${scope.join('·')} 부분 재실행]` : '';
    const summaryText = `🧪 실전 스모크: ${pass}/${results.length} 통과${scopeLabel} (지시 #51 — 판독은 똑똑이·판정은 대표)`;
    const result = {
        summary: summaryText,
        lines: results.map(r => `${r.pass ? '✅' : '⚠️'} ${r.name}`),
        report: {
            type: 'smoke_test', smoke: true, instruction_ref: '#51',
            ran_at: new Date().toISOString(),
            sections: [{ agent: '실전 스모크', pass, total: results.length, results }],
            transcripts, // 답변 전문 — 똑똑이 원본 대조 판독용
            note: '전 문항 is_test 격리 — 실제 일정 등록·발송·이미지 생성 없음. ⚠️는 자동 실패가 아니라 전문 대조 필요 표시 포함',
        },
    };
    await pool.query(`UPDATE agent_runs SET status='done', result=$2, finished_at=NOW() WHERE id=$1`,
        [run.id, JSON.stringify(result)]);
    await writeAudit({
        action: 'smoke_test', targetType: 'agent_run', targetId: run.id,
        changes: { after: { pass, total: results.length } }, source: 'agent_office', actor,
    });
    notifyTelegram(`🧪 실전 스모크 결과: ${pass}/${results.length} — 성적표에서 전문 판독`);
    return result;
}
async function svcStartSmokeTest(actor, scope) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
    if (capTestRunning) throw new Error('점검이 이미 진행 중입니다 — 완료 후 다시 실행해주세요');
    const maru = (await pool.query(`SELECT * FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0];
    if (!maru) throw new Error('마루 에이전트를 찾을 수 없습니다');
    const firstStep = agentStep('order', '마루', '🧪 실전 스모크 시작 — 대표 원문 5건 (지시 #51, 실등록·발송·생성 없음)');
    const run = (await pool.query(
        `INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, TRUE) RETURNING *`,
        [maru.id, JSON.stringify([firstStep])])).rows[0];
    capTestRunning = true;
    executeSmokeTest(run, actor, scope)
        .catch(err => {
            console.error('스모크 시험 오류:', err.message);
            return pool.query(`UPDATE agent_runs SET status='error', result=$2, finished_at=NOW() WHERE id=$1`,
                [run.id, JSON.stringify({ summary: `오류: ${err.message}` })]);
        })
        .finally(() => { capTestRunning = false; });
    return run;
}

async function executeCapabilityTest(run, actor) {
    const t0 = Date.now();
    const results = { '마루': [], '고난도': [], '세미': [], '글샘': [], '미소': [] };
    const artifacts = [];
    // 버킷 미초기화로 전체 점검이 중단되지 않게 방어 (11:28/11:31 반쪽 실행 사고 재발 방지)
    const add = (agent, name, pass, expected, actual, note) =>
        (results[agent] = results[agent] || []).push({ name, pass: !!pass, expected: String(expected), actual: String(actual ?? ''), note: note || '' });
    const step = (text) => agentRunAppendStep(run.id, agentStep('work', '마루', text));
    try {
        // ===== 마루 라우팅 (Haiku 실호출) =====
        await step('마루 라우팅 점검 중... (13문항)');
        const rc = [
            { name: '문자→글샘', q: '카라향 마감 임박 문자 만들어줘', exp: 'route/글샘', check: d => d.action === 'route' && d.assignee === '글샘' },
            { name: '이미지→미소', q: '감귤 인스타 이미지 시안 프롬프트 뽑아줘', exp: 'route/미소', check: d => d.action === 'route' && d.assignee === '미소' },
            { name: '정산→세미', q: '이번달 정산 얼마야?', exp: 'route/세미', check: d => d.action === 'route' && d.assignee === '세미' },
            { name: '일정 조회→마루 직접', q: '이번주 일정 뭐 있어?', exp: 'schedule/조회+날짜범위', check: d => d.action === 'schedule' && d.schedule_op === '조회' && /^\d{4}-\d{2}-\d{2}$/.test(d.schedule_from) },
            { name: '다음주 일정→마루 직접', q: '다음주 일정 알려줘', exp: 'schedule/조회', check: d => d.action === 'schedule' && d.schedule_op === '조회' },
            { name: '애매한 지시→되묻기', q: '그거 처리해줘', exp: 'clarify+질문 1개', check: d => d.action === 'clarify' && !!d.clarify_question },
            { name: '피드백 문장→피드백 분류', q: '아까 글샘이 만든 문자 좋았어', exp: 'feedback/글샘', check: d => d.action === 'feedback' && d.assignee === '글샘' },
            { name: '정산 입력 파싱 (283만→2,830,000)', q: '오늘 정산현황 입력할게. 대성 283만', exp: 'settlement_input/daesong=2830000', check: d => d.action === 'settlement_input' && (d.settlement_entries || []).some(e => e.field === 'daesong' && Number(e.amount) === 2830000) },
            { name: '일정 삭제→불가 안내', q: '어제 일정 지워줘', exp: 'schedule/불가', check: d => d.action === 'schedule' && d.schedule_op === '불가' },
            { name: '월 단위 매출 → 세미 배정 (v5.0 사고 박제)', q: '4월달 매출현황 보고해줘', exp: 'route/세미', check: d => d.action === 'route' && d.assignee === '세미' },
            { name: '휴가 의도 → 결재 안내 전환 (지시#2)', q: '다음주 금요일 민주 휴가 등록해줘', exp: "category='휴가' 정확 표시 → 서버가 결재 시스템 안내 (일정 등록 실행 = 실패)",
              check: d => d.action === 'schedule' && d.schedule_op === '등록' && (d.schedule_items || []).some(i => i.category === '휴가') },
            { name: '톡톡발송 카테고리 (3단계)', q: '토요일 톡톡으로 하우스감귤 홍보 나가는거 일정 잡아줘', exp: 'schedule/등록 + 톡톡발송',
              check: d => d.action === 'schedule' && d.schedule_op === '등록' && (d.schedule_items || []).some(i => i.category === '톡톡발송') },
            { name: '기간형 할인 일정 (3단계)', q: '25일부터 27일까지 하우스감귤 오픈 할인 일정 등록해줘', exp: 'schedule/등록 + 할인·이벤트 + end_date',
              check: d => d.action === 'schedule' && d.schedule_op === '등록' && (d.schedule_items || []).some(i => i.category === '할인·이벤트' && /^\d{4}-\d{2}-\d{2}$/.test(i.end_date || '')) },
            { name: '기간+항목 완전 지시 즉답 (지시#6 사고 박제)', q: '이번주 결제금액 보내줘', exp: 'route/세미 + this_week (되묻기 = 실패)',
              check: d => d.action === 'route' && d.assignee === '세미' && d.period === 'this_week' },
            { name: '기간 비교 지시 → 세미 도달 (4.5단계)', q: '4월 5월 매출 비교해줘', exp: '세미 배정 — 모델 직접 또는 서버 재무 보정 경유 (실전 기준 채점)',
              check: d => (d.action === 'route' && d.assignee === '세미') || !!maruForceFinanceRoute(d, '4월 5월 매출 비교해줘', kstTodayStr()) },
            { name: '주차×거래처 → 세미 도달 (지시#15)', q: '이번주 효돈 정산금 파일 줘', exp: '세미 배정 — 모델 직접 또는 서버 재무 보정 경유 (실전 기준 채점)',
              check: d => (d.action === 'route' && d.assignee === '세미') || !!maruForceFinanceRoute(d, '이번주 효돈 정산금 파일 줘', kstTodayStr()) },
        ];
        for (const c of rc) {
            try {
                const { d, polluted } = await maruDecide(c.q);
                const actual = `${d.action}/${d.assignee || d.schedule_op || ''}${polluted ? ' (오염 감지)' : ''}`;
                add('마루', c.name, c.check(d) && !maruDecisionPolluted(d), c.exp, actual, c.q);
            } catch (e) { add('마루', c.name, false, c.exp, '오류: ' + e.message, c.q); }
        }
        {
            const q = '4월 14일 정산현황 얼마야?';
            const explicit = parseExplicitDate(q, kstTodayStr());
            add('마루', '특정일 날짜 서버 파싱', explicit === '2026-04-14', '2026-04-14', explicit || '(파싱 실패)', q);
        }
        {
            // v5.0 1단계: 월 단위 서버 파싱 박제 (2025-04 오해석 사고 재발 방지 — 회귀 검출용)
            const today = kstTodayStr();
            const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
            const ymOf = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
            const mcs = [
                ['월 단위 파싱: "4월달 매출현황" (사고 재현)', '4월달 매출현황', ymOf(4 <= mo ? y : y - 1, 4)],
                ['월 단위 파싱: "지난달 정산"', '지난달 정산 알려줘', mo === 1 ? ymOf(y - 1, 12) : ymOf(y, mo - 1)],
                ['월 단위 파싱: "9월 매출" (미래 월=작년)', '9월 매출 얼마였지', ymOf(9 <= mo ? y : y - 1, 9)],
                ['월 단위 파싱: "2025년 4월" (명시 연도 존중)', '2025년 4월 매출 보고', '2025-04'],
                ['특정일 우선: "4월 14일"은 월 파싱 안 함', '4월 14일 정산현황', ''],
            ];
            for (const [name, q, exp] of mcs) {
                const act = parseExplicitMonth(q, today);
                add('마루', name, act === exp, exp || '(빈값=특정일 담당)', act || '(빈값)', q);
            }
        }
        {
            // 지시 #2-2: 기간 표현 서버 파싱 박제 — 같은 입력 = 같은 결과 (16:06/16:08 재현성 사고 재발 방지)
            const today = kstTodayStr();
            const rr = q => { const r = parseExplicitRange(q, today, { future: true }); return r ? `${r.from}~${r.to}` : '(파싱 실패)'; };
            const q0 = '7월 25일부터 27일까지 하우스감귤 오픈 할인 일정 등록해줘';
            const outs = [rr(q0), rr(q0), rr(q0)];
            const shapeOk = /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(outs[0]);
            add('마루', '기간 파싱 반복 동일성 ×3 (지시#2 사고 재현)',
                shapeOk && outs.every(o => o === outs[0]) && outs[0].slice(0, 10) <= outs[0].slice(11),
                '3회 동일 + 시작≤종료', outs.join(' | '), q0);
            const short1 = rr('25~27일 하우스감귤 할인');
            add('마루', '기간 파싱 축약형 ("25~27일")', short1 === outs[0], '정식 표현과 동일 해석', `${short1} vs ${outs[0]}`);
        }
        {
            // 지시 #6 박제: 서버 보정·문답 결합 (코드 검증 — 0원)
            const fd = maruForceFinanceRoute(
                { action: 'clarify', team: '', assignee: '마루', task_summary: '', reason: '', clarify_question: '어떤 항목을 말씀하시는 건가요?' },
                '이번주 결제금액 보내줘', kstTodayStr());
            add('마루', '재무 즉답 서버 보정 (지시#6)', !!fd && fd.action === 'route' && fd.assignee === '세미' && fd.period === 'this_week',
                'clarify → route/세미/this_week 강제', fd ? `${fd.action}/${fd.assignee} period=${fd.period}` : '(보정 안 됨)', '이번주 결제금액 보내줘');
            const ct = buildCombinedOrderText('이번주 결제금액 보내줘', '어떤 항목을 말씀하시는 건가요?', '전체 매출 정산');
            add('마루', '문답 결합 텍스트 (지시#6)', ct.includes('이번주 결제금액 보내줘') && ct.includes('어떤 항목') && ct.includes('전체 매출 정산'),
                '원 지시+질문+답변 모두 포함', ct.includes('이번주') ? '3요소 포함' : '누락', '결합 재라우팅');
            // 지시 #7 박제: 지시 기간 = 산출 기간 ('이번주' 서버 확정, 월간 편차 재발 방지)
            const w1 = maruWeekPeriodOverride('', '이번주 결제금액 보내줘');
            const w2 = maruWeekPeriodOverride('2026-04', '4월 정산 엑셀로 뽑아줘');
            const w3 = maruWeekPeriodOverride('', '4월달 매출현황');
            add('마루', '이번주 기간 서버 확정 (지시#7)', w1 === 'this_week' && w2 === '2026-04' && w3 === '',
                "이번주→this_week / 월 지시엔 무개입", `이번주=${w1} 4월기존=${w2} 4월무기간=${w3}`, '이번주 결제금액 보내줘');
            // 4.5단계 박제: 비교 기간 서버 확정
            const cp = parseComparePeriods('4월 5월 매출 비교해줘', kstTodayStr());
            add('마루', '비교 기간 서버 확정 (4.5단계)', !!cp && cp.a.endsWith('-04') && cp.b.endsWith('-05'),
                '4월 vs 5월 (2026-04 vs 2026-05)', cp ? `${cp.a} vs ${cp.b}` : '(추출 실패)', '4월 5월 매출 비교해줘');
            // 지시 #15 박제: 주차·거래처 서버 확정 (화면 주간표와 동일 경계 — 기준 이원화 금지)
            const pw1 = parseWeekSpec('7월 2주차 대성 정산', kstTodayStr());
            const pw2 = parseWeekSpec('3월 셋째주 대성 정산 파일 줘', kstTodayStr());
            const pw3 = parseWeekSpec('3주 동안 진행한 이벤트', kstTodayStr());
            add('마루', '주차 파싱 서버 확정 (지시#15)',
                !!pw1 && pw1.from === '2026-07-06' && !!pw2 && pw2.from === '2026-03-09' && pw3 === null,
                '7월2주차=07-06 시작 / 3월셋째주=03-09 시작 / "3주 동안"은 미발동',
                `${pw1 ? pw1.from : 'null'} / ${pw2 ? pw2.from : 'null'} / ${pw3 === null ? '미발동' : '오발동'}`, '7월 2주차 대성 정산');
            const pk = [parsePartnerKeyword('이번주 효돈 정산금'), parsePartnerKeyword('저번주 대성 정산현황'), parsePartnerKeyword('1주차 CJ 택배비')];
            add('마루', '거래처 축약 매칭 (지시#15)',
                pk[0] === '효돈농협' && pk[1] === '대성(시온)' && pk[2] === 'CJ대한통운',
                '효돈→효돈농협 / 대성→대성(시온) / CJ→CJ대한통운', pk.join(' / '), '이번주 효돈 정산금');
            const fw = maruForceFinanceRoute(
                { action: 'clarify', team: '', assignee: '마루', task_summary: '', reason: '', clarify_question: '어느 기간인가요?' },
                '1주차 CJ 택배비 얼마야', kstTodayStr());
            add('마루', '주차+거래처 완전 지시 보정 (지시#15)', !!fw && fw.action === 'route' && fw.assignee === '세미',
                'clarify → route/세미 강제 (빈 되묻기 금지)', fw ? `${fw.action}/${fw.assignee}` : '(보정 안 됨)', '1주차 CJ 택배비 얼마야');
            // 지시 #17 박제: 파일/즉답 의도 분기 — "파일 줘"가 즉답으로만 빠진 스모크 사고 재현
            const wf = [WANT_FILE_RE.test('이번주 효돈 정산금 파일 줘'), WANT_FILE_RE.test('4월 정산 엑셀로 뽑아줘'), WANT_FILE_RE.test('지난주 대성 정산현황 얼마야')];
            add('마루', '파일/즉답 의도 분기 (지시#17 스모크 박제)', wf[0] === true && wf[1] === true && wf[2] === false,
                '"파일 줘"·"엑셀로"=파일 / "얼마야"=즉답만', `파일줘=${wf[0]} 엑셀로=${wf[1]} 얼마야=${wf[2]}`, '이번주 효돈 정산금 파일 줘');
            // 지시 #26·#27 박제: 미소 생성 승인 게이트 — 무승인 호출 차단 (비용 승인제 코드 레벨 검증)
            let gateBlocked = false;
            try { assertMediaApproval(null); } catch (e) { gateBlocked = /승인 없음/.test(e.message); }
            let gateBlocked2 = false;
            try { assertMediaApproval({ approved: false, actor: { id: 1 }, run_id: 1 }); } catch (e) { gateBlocked2 = true; }
            const mo = MEDIA_OPTIONS;
            const pricingOk = mo['이미지']['기본'].model === 'gemini-3.1-flash-image' && mo['이미지']['고급'].model === 'gemini-3-pro-image'
                && mo['영상']['기본'].model === 'veo-3.1-fast-generate-preview' && mo['영상']['고급'].model === 'veo-3.1-generate-preview'
                && mo['이미지']['기본'].krw === 92 && mo['영상']['기본'].krw === 1100;
            add('미소', '생성 승인 게이트 차단 (지시#26·#27)', gateBlocked && gateBlocked2 && pricingOk,
                '무승인·미승인 호출 모두 차단 + 대표 선택 모델·단가 무결',
                `무승인=${gateBlocked ? '차단' : '통과(문제)'} 미승인=${gateBlocked2 ? '차단' : '통과(문제)'} 가격표=${pricingOk ? '무결' : '불일치'}`);
            // 지시 #39 박제: 글샘 제목 파편 정화 — run #60 실사례(태그+versions JSON 원문 유입) 재현
            const gsClean = loadAgentRunner('글샘').cleanTitleField;
            const frag = '</antml_parameter>\n<parameter name="versions">[\n  {\n    "label": "안정형",\n    "text": "카피 본문..."';
            const tf = [gsClean(frag), gsClean('카라향 마감 임박!'), gsClean('')];
            add('글샘', '제목 파편 정화 (지시#39 화면 노출 사고 박제)',
                tf[0] === '' && tf[1] === '카라향 마감 임박!' && tf[2] === '',
                '파편=생략(빈 값) / 정상 제목=유지 / 빈 값=빈 값',
                `파편→'${tf[0]}' 정상→'${tf[1]}'`, 'run #60 제목 필드 재현');
            // v5.1.1 (지시 #28-2) 박제: run_capability_test 도구 등록·게이트 구조 검증
            // (실호출 검증은 점검 중첩·재귀가 되므로 배제 — 똑똑이 첫 호출 = 실검증, audit mcp_run_test로 사후 감사)
            const rct = MCP_TOOLS.find(t => t.name === 'run_capability_test');
            const execTools = MCP_TOOLS.filter(t => /run_|create_|update_|add_|register_/.test(t.name)).map(t => t.name);
            // 지시 #51: run_smoke_test 허용 목록 추가 (운영규칙 개정 — 실행 도구 2종)
            const onlyAllowedExec = execTools.every(n => ['run_capability_test', 'run_smoke_test', 'create_schedule', 'update_schedule', 'add_item', 'update_item', 'register_instruction'].includes(n));
            add('마루', 'MCP 실행 도구 게이트 (v5.1.1 박제)',
                !!rct && typeof rct.handler === 'function' && /승인.*ㄱ|ㄱ.*승인/.test(rct.description) && /mcp_run_test/.test(rct.description) && onlyAllowedExec && typeof svcStartCapabilityTest === 'function',
                'run_capability_test 등록 + 승인 규칙·audit 명시 + 허용 외 실행 도구 없음',
                `등록=${!!rct} 규칙 명시=${rct ? /승인/.test(rct.description) : false} 허용 외 실행 도구=${onlyAllowedExec ? '없음' : '존재(문제)'}`);
        }

        // ===== v5.0 고난도 실전 문항 (대표 출제 — 2026-07-18) =====
        // 채점 기준: "못 하는 걸 못 한다고 정직하게 말하는 것"도 통과. 멋대로 추측 실행하면 실패.
        // 하이쿠 vs 소넷 승급 효과를 이 섹션에서 특히 비교 (별도 집계).
        await step('고난도 실전 점검 중... (7문항 + 날짜 검증 1)');
        {
            const today = kstTodayStr();
            const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
            const ymOf = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
            const curYm = ymOf(y, mo);
            const prevYm = mo === 1 ? ymOf(y - 1, 12) : ymOf(y, mo - 1);
            const per = d => String(d.period || '').trim();
            const hc = [
                { name: '① 복합 조건 (두 품목 비교)', q: '4월에 하우스감귤이랑 미니밤호박 중에 뭐가 더 많이 팔렸어?',
                  exp: 'clarify(정직 안내) 또는 세미 4월 전체 조회 — 한 품목만 몰래 고르면 실패',
                  check: d => d.action === 'clarify'
                      || (d.action === 'route' && d.assignee === '세미' && !String(d.item_keyword || '').trim()) },
                { name: '② 멀티 지시 (조회 2건 한 문장)', q: '다음 달 민주 휴가 언제 언제 있어? 그리고 지난달 정산도 보여줘',
                  exp: 'clarify — 한 건씩 나눠달라 안내 (절반만 몰래 처리하면 실패)',
                  check: d => d.action === 'clarify' && !!d.clarify_question },
                { name: '③-a 모호한 기간 ("요즘")', q: '요즘 뭐가 잘 나가?',
                  exp: 'clarify 또는 세미 이번달/이번주 기준 명시 — 아무 기간 추측 금지',
                  check: d => d.action === 'clarify'
                      || (d.action === 'route' && d.assignee === '세미' && ['this_month', 'this_week', curYm].includes(per(d))) },
                { name: '③-b 순위 정리 ("저번 달 기여 품목")', q: '저번 달 매출 중 제일 기여한 품목이 어떤건지 정리해서 보내줘',
                  exp: `세미/지난달(${prevYm}) 또는 clarify — 기간 오해석은 실패`,
                  check: d => d.action === 'clarify'
                      || (d.action === 'route' && d.assignee === '세미' && per(d) === prevYm) },
                { name: '④ 존재하지 않는 날짜 (4월 31일)', q: '4월 31일 정산 얼마야?',
                  exp: 'clarify 또는 날짜 무보정 전달(서버 가드가 안내) — 4/30·5/1로 몰래 바꾸면 실패',
                  check: d => {
                      if (d.action === 'clarify') return true;
                      const td = String(d.target_date || '').trim();
                      return d.action === 'route' && d.assignee === '세미' && (td === '' || td.endsWith('-04-31'));
                  } },
                { name: '⑤ 범위 밖 (날씨)', q: '내일 날씨 어때?',
                  exp: 'clarify — 처리 불가 정직 안내 (엉뚱한 배정 금지)',
                  check: d => d.action === 'clarify' },
                { name: '⑥ 맥락 참조 ("그럼 5월은?")', q: '그럼 5월은?',
                  exp: 'clarify — 전체 문장으로 다시 안내 (미지원 맥락 추측 배정 금지)',
                  check: d => d.action === 'clarify' },
            ];
            for (const c of hc) {
                try {
                    const { d, polluted } = await maruDecide(c.q);
                    const actual = `${d.action}/${d.assignee || d.schedule_op || ''}`
                        + `${per(d) ? ' period=' + per(d) : ''}${String(d.target_date || '').trim() ? ' date=' + d.target_date : ''}`
                        + `${String(d.item_keyword || '').trim() ? ' 품목=' + d.item_keyword : ''}${polluted ? ' (오염 감지)' : ''}`;
                    add('고난도', c.name, c.check(d) && !maruDecisionPolluted(d), c.exp, actual, c.q);
                } catch (e) { add('고난도', c.name, false, c.exp, '오류: ' + e.message, c.q); }
            }
            // 서버 가드 단위 검증 (0원): 존재하지 않는 날짜 판별
            add('고난도', '④-보조 서버 날짜 검증 (2026-04-31=무효)',
                isValidDateStr('2026-04-30') === true && isValidDateStr('2026-04-31') === false,
                '4-30 유효 / 4-31 무효', `4-30=${isValidDateStr('2026-04-30')} / 4-31=${isValidDateStr('2026-04-31')}`);
        }

        // ===== 세미 (코드 실행 — DB 계산값 대조) =====
        await step('세미 정산 점검 중... (10문항 — DB 대조)');
        const semiAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'semi' LIMIT 1`)).rows[0];
        const semiRunner = loadAgentRunner('세미');
        const helpers = { matchItemToPricing, normDateSafe };
        // 지시 #18: 파일 첨부 경로 검증용 목(mock) — is_test 격리 원칙에 따라 DB에 저장하지 않고
        // xlsx 생성·첨부 호출 자체만 검증 (file_id=-1). 실전 저장 경로(saveReportFile)는 live 헬퍼 소관
        let _testXlsx = null;
        const semiTestHelpers = {
            ...helpers,
            saveReportFile: async (fname, buf) => { _testXlsx = { fname, size: (buf && buf.length) || 0 }; return -1; },
        };
        const callSemi = (p) => semiRunner.result({ agent: semiAgent, pool, params: { workplace: '전체', ...p }, helpers: semiTestHelpers });
        const sc = [
            { name: '4/14 일별 정산 (연속1)', p: { target_date: '2026-04-14' }, exp: '11,191,500원',
              check: r => r.report?.type === 'semi_day' && Math.abs((r.report.settlements?.total || 0) - 11191500) < 10,
              act: r => Math.round(r.report?.settlements?.total || 0).toLocaleString('ko-KR') + '원' },
            { name: '4/5 일별 정산', p: { target_date: '2026-04-05' }, exp: '10,563,900원',
              check: r => Math.abs((r.report?.settlements?.total || 0) - 10563900) < 10,
              act: r => Math.round(r.report?.settlements?.total || 0).toLocaleString('ko-KR') + '원' },
            { name: '4/4 기록없음 + 4/5 안내', p: { target_date: '2026-04-04' }, exp: '기록 없음 + 가장 가까운 4/5',
              check: r => r.report?.settlements?.has === false && /4\/5/.test(String(r.summary)), act: r => r.summary },
            { name: '4/14 재확인 (연속2·직전 답 재사용 검출)', p: { target_date: '2026-04-14' }, exp: '11,191,500원 (연속1과 동일해야)',
              check: r => Math.abs((r.report?.settlements?.total || 0) - 11191500) < 10,
              act: r => Math.round(r.report?.settlements?.total || 0).toLocaleString('ko-KR') + '원' },
            { name: '4/5 재확인 (연속3·직전 답 재사용 검출)', p: { target_date: '2026-04-05' }, exp: '10,563,900원',
              check: r => Math.abs((r.report?.settlements?.total || 0) - 10563900) < 10,
              act: r => Math.round(r.report?.settlements?.total || 0).toLocaleString('ko-KR') + '원' },
            { name: '이번달 정산 (총결제 공식 검산)', p: {}, exp: '상품+택배+이월=총결제 일치',
              check: r => { const m = r.report?.month; return r.report?.type === 'semi_settlement' && m && Math.abs(m.payment_total - (m.product_total + m.cj_fee + m.cj_carryover)) < 1; },
              act: r => r.summary },
            // 지시 #19: 진행 중이던 7월(15,779,500·박제 시점값) → 완결된 6월로 교체. 기대값 산출 근거:
            // 정산 원본 독립 합산(6월 전 건 × 가격표 재계산, 하우스감귤~/하귤 제외) = 493개/14,771,000원
            // — 세미 실경로 교차 검증 일치 (2026-07-19). 검증 의도(계열 토큰 매칭 + 하귤 제외) 유지
            { name: '하우스귤 6월 (계열 매칭·하귤 제외 — 지시#19 확정 기간)', p: { item_keyword: '하우스귤', period: '2026-06' }, exp: '493개 / 14,771,000원 · 하귤 미포함',
              check: r => Math.abs((r.report?.product_total || 0) - 14771000) < 10 && (r.report?.items || []).every(i => !i.name.includes('하귤')),
              act: r => Math.round(r.report?.product_total || 0).toLocaleString('ko-KR') + '원' },
            { name: '없는 품목 (바나나) 정직 안내', p: { item_keyword: '바나나' }, exp: '찾을 수 없음 + 등록 품목 목록',
              check: r => r.report?.no_match === true && Array.isArray(r.report?.available_items), act: r => r.summary },
            { name: '4.5 기간 비교 4월vs5월 (지시#8 박제)', p: { compare: { a: '2026-04', b: '2026-05' } }, exp: 'A 총결제 306,076,600 / B 상품 144,129,000',
              check: r => r.report?.type === 'semi_compare' && r.report.a?.payment_total === 306076600 && r.report.b?.product_total === 144129000,
              act: r => `A ${Math.round(r.report?.a?.payment_total || 0).toLocaleString('ko-KR')} / B상품 ${Math.round(r.report?.b?.product_total || 0).toLocaleString('ko-KR')}` },
            { name: '4.5 품목 순위 4월 1위 (재계산 확정값)', p: { period: '2026-04', rank: { all: false, topN: 10 } }, exp: '카라향 가정용 - 5kg(40과 전후) · 4,164개 · 73,640,000원',
              check: r => r.report?.type === 'semi_rank' && r.report.rows?.[0]?.name === '카라향 가정용 - 5kg(40과 전후)' && r.report.rows[0].qty === 4164 && r.report.rows[0].amount === 73640000,
              act: r => `${r.report?.rows?.[0]?.name || '?'} · ${(r.report?.rows?.[0]?.qty || 0).toLocaleString('ko-KR')}개 · ${Math.round(r.report?.rows?.[0]?.amount || 0).toLocaleString('ko-KR')}원` },
            // 지시 #15 박제: 주차×거래처 — 지시 #19 규칙: 박제는 완결된 확정 주차만 (진행 중 주 금지)
            // 지시 #19: 진행 중이던 3주차(2,033,000·박제 시점값) → 완결된 2주차×효돈으로 교체 (기존 문항과
            // 다른 조합). 기대값 산출 근거: 정산 원본 독립 합산(7/6~7/12 효돈 6건 × 가격표 재계산) =
            // 11,865,000원 — 세미 실경로 교차 검증 일치 (2026-07-19)
            { name: '#15 7월 2주차 효돈 (지시#19 확정 주차)', p: { partner_week: { partner: '효돈농협', from: '2026-07-06', to: '2026-07-12', label: '7월 2주차' } },
              exp: '11,865,000원 · 6건', check: r => r.report?.type === 'semi_partner_week' && r.report.total === 11865000 && r.report.count === 6,
              act: r => Math.round(r.report?.total || 0).toLocaleString('ko-KR') + '원 · ' + (r.report?.count || 0) + '건' },
            { name: '#15 7월 2주차 대성 (화면 실측)', p: { partner_week: { partner: '대성(시온)', from: '2026-07-06', to: '2026-07-12', label: '7월 2주차' } },
              exp: '6,347,400원', check: r => r.report?.type === 'semi_partner_week' && r.report.total === 6347400,
              act: r => Math.round(r.report?.total || 0).toLocaleString('ko-KR') + '원' },
            { name: '#15 7월 2주차 기타거래처 (화면 실측)', p: { partner_week: { partner: '기타거래처', from: '2026-07-06', to: '2026-07-12', label: '7월 2주차' } },
              exp: '1,916,000원', check: r => r.report?.type === 'semi_partner_week' && r.report.total === 1916000,
              act: r => Math.round(r.report?.total || 0).toLocaleString('ko-KR') + '원' },
            { name: '#15 7월 1주차 CJ 택배비 (파일 없음 정직)', p: { partner_week: { partner: 'CJ대한통운', from: '2026-06-29', to: '2026-07-05', label: '7월 1주차' }, want_file: true },
              exp: '2,951,200원 + 파일 없음 안내', check: r => r.report?.type === 'semi_partner_week' && r.report.cj === true && r.report.total === 2951200 && !!r.report.no_file,
              act: r => `${Math.round(r.report?.total || 0).toLocaleString('ko-KR')}원 ${r.report?.no_file ? '(파일 없음 안내)' : '(안내 누락)'}` },
            // 지시 #18 박제: 주차×거래처 + 파일 의도 → xlsx 생성·첨부 경로 실행 검증 (스모크 재현 케이스)
            { name: '#18 주차×거래처 파일 첨부 (스모크 박제)', p: { partner_week: { partner: '대성(시온)', from: '2026-07-06', to: '2026-07-12', label: '7월 2주차' }, want_file: true },
              exp: '6,347,400원 + 대성(시온)_결제금액_...xlsx 생성·첨부',
              check: r => r.report?.type === 'semi_partner_week' && r.report.total === 6347400 && r.report.file_id === -1
                  && !!_testXlsx && _testXlsx.fname === '대성(시온)_결제금액_2026-07-06~2026-07-12.xlsx' && _testXlsx.size > 3000,
              act: r => `${Math.round(r.report?.total || 0).toLocaleString('ko-KR')}원 · ${_testXlsx ? `${_testXlsx.fname} (${_testXlsx.size}B)` : '(파일 미생성)'}` },
        ];
        for (const c of sc) {
            try { const r = await callSemi(c.p); add('세미', c.name, c.check(r), c.exp, c.act(r)); }
            catch (e) { add('세미', c.name, false, c.exp, '오류: ' + e.message); }
        }

        // ===== 글샘 (Sonnet 실생성 — 규격 검사) =====
        await step('글샘 카피 점검 중... (2문항 — Sonnet 생성, 1~2분 소요)');
        const gAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'geulsaem' LIMIT 1`)).rows[0];
        const gRunner = loadAgentRunner('글샘');
        const gc = [
            { name: '마감 LMS (정보 완비)', wantMissing: false,
              q: '카라향 5kg 마감 임박 LMS 만들어줘 — 가격 39,900원, 이번주 일요일 마감, 200박스 한정, 링크 https://smartstore.naver.com/akkome' },
            { name: '마감 문자 (정보 부족 → 자리표시)', wantMissing: true, q: '레몬 마감 문자 하나 뽑아줘' },
        ];
        for (const c of gc) {
            try {
                const r = await gRunner.result({ agent: gAgent, pool, params: { order_content: c.q }, helpers });
                const rep = r.report;
                const text = (rep.versions || []).map(v => v.text).join('\n\n');
                const checks = [];
                if (rep.channel !== '톡톡') {
                    checks.push(['(광고) 첫줄', (rep.versions || []).every(v => String(v.text).trim().startsWith('(광고)제주아꼼이네입니다^^'))]);
                    checks.push(['이모지 0개', !CAP_EMOJI_RE.test(text)]);
                    checks.push(['★ 박스 강조', text.includes('★')]);
                    checks.push(['VIP 블록', text.includes('VIP 전용 혜택 안내')]);
                    checks.push(['수신거부 안내', /수신/.test(text)]);
                }
                const wd = capWeekdayErrors(text);
                checks.push(['요일 정확', wd.length === 0]);
                checks.push([c.wantMissing ? '자리표시+채울목록' : '완비 정보 반영',
                    c.wantMissing ? ((rep.missing_fields || []).length > 0 && text.includes('[')) : text.includes('39,900')]);
                const failed = checks.filter(x => !x[1]).map(x => x[0]);
                add('글샘', c.name, failed.length === 0, '규격 전체 통과',
                    failed.length ? '위반: ' + failed.join(', ') + (wd.length ? ' — ' + wd.join('; ') : '') : '통과 (' + rep.channel + ')', c.q);
                artifacts.push({ agent: '글샘', title: `${c.name} — ${rep.channel}${rep.title ? ' · 제목안 "' + rep.title + '"' : ''}`,
                    text: (rep.versions || []).map(v => `[${v.label}]\n${v.text}`).join('\n\n────────────\n\n') });
            } catch (e) { add('글샘', c.name, false, '규격 전체 통과', '오류: ' + e.message, c.q); }
        }

        // ===== 미소 (Sonnet 실생성 — 규격 검사) =====
        await step('미소 프롬프트 점검 중... (2문항)');
        const mAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'miso' LIMIT 1`)).rows[0];
        const mRunner = loadAgentRunner('미소');
        const mc = [
            { name: '이미지 프롬프트', media: '이미지', q: '카라향 선물세트 인스타 이미지 프롬프트 만들어줘 — 돌담 배경' },
            { name: '릴스 영상 프롬프트', media: '영상', q: '하우스감귤 릴스 영상 프롬프트 만들어줘' },
        ];
        for (const c of mc) {
            try {
                const r = await mRunner.result({ agent: mAgent, pool, params: { order_content: c.q }, helpers });
                const outs = r.report?.outputs || [];
                const o = outs[0] || {};
                const checks = [
                    ['media=' + c.media, o.media === c.media],
                    ['영문 프롬프트 충분', String(o.prompt_en || '').length > 80],
                    ['브랜드 컬러 #F5C800', /F5C800/i.test(o.prompt_en || '')],
                    ['한글 해석', String(o.prompt_ko || '').length > 10],
                    ['비율 유효', /^(1:1|9:16|16:9|4:5)$/.test(String(o.ratio || '').trim())],
                    ['금지어 없음', !/AI generated|cartoon|cheap|discount/i.test(o.prompt_en || '')],
                ];
                const failed = checks.filter(x => !x[1]).map(x => x[0]);
                add('미소', c.name, failed.length === 0, '규격 전체 통과', failed.length ? '위반: ' + failed.join(', ') : '통과 (' + (o.ratio || '') + ')', c.q);
                artifacts.push({ agent: '미소', title: `${c.name} — ${o.media || ''} ${o.ratio || ''} · ${o.usage || ''}`,
                    text: outs.map(x => `[${x.label} · ${x.media} ${x.ratio}]\n${x.prompt_en}\n\n🇰🇷 ${x.prompt_ko}`).join('\n\n────────────\n\n') });
            } catch (e) { add('미소', c.name, false, '규격 전체 통과', '오류: ' + e.message, c.q); }
        }

        // 지시 #54-4 박제: 날짜 단일 소스 — 서버 확정값 주입 시 카피 날짜 일치 (S1 7/22 오류 재현 방지)
        await step('글샘 날짜 단일 소스 점검 중... (1문항)');
        try {
            const dr = { from: '2026-07-21', to: '2026-07-23' };
            const rD = await gRunner.result({ agent: gAgent, pool, params: {
                order_content: '미니밤호박 행사 안내 문자 만들어줘 — 행사 기간을 본문에 꼭 넣어줘',
                dates_hint: '2026-07-21(화)~2026-07-23(목)', dates_range: dr,
            }, helpers });
            const tD = (rD.report.versions || []).map(v => v.text).join('\n');
            // 지시 #59-1: 4형식 날짜 인식 (ISO·07-21·7/21·7월 21일)
            const dISO = extractDatesISO(tD, '2026');
            const inRange = dISO.includes(dr.from) || dISO.includes(dr.to);
            const outRange = dISO.some(ds => ds < dr.from || ds > dr.to);
            const hype = /미쳤(어요|다|음)|끝판왕?|인생\s*(호박|귤|맛)|역대급/.test(tD); // 지시 #55-4 과장 금지어
            add('글샘', '날짜 단일 소스 준수 (지시#54 S1 사고 박제)', inRange && !outRange && !hype,
                '확정 날짜(7/21~7/23)만 표기 + 범위 밖 날짜 없음 + 과장 금지어 없음',
                `범위 내=${inRange} 범위 밖=${outRange ? '있음(실패)' : '없음'} 과장=${hype ? '있음(실패)' : '없음'}`, '미니밤호박 행사 안내 (확정 날짜 주입)');
        } catch (e) { add('글샘', '날짜 단일 소스 준수 (지시#54 S1 사고 박제)', false, '확정 날짜만 표기', '오류: ' + e.message); }

        // 지시 #54-1: 한결 AI 검수 2문항 제거 — 최종 검토는 대표. 코드 안전망(규격·금지어·파편·핵심 정보)은 글샘·미소·스모크 문항이 유지

        // ===== 지시 #49: 신규 5명 문항 (지율 3 · 한수 2 · 미래 2 · 예리 2 · 기안 1) =====
        await step('지율 노무 자문 점검 중... (3문항 — Sonnet)');
        const jiyulRunner = loadAgentRunner('지율');
        const callJiyul = async q => (await jiyulRunner.result({ pool, params: { order_content: q } })).report;
        try {
            const j1 = await callJiyul('오션라운지 알바 주휴수당 줘야 해?');
            const all1 = [j1.conclusion, j1.legal_basis, j1.calculation].join(' ');
            // 지시 #50-1: 채점기 오심 수정 — "면제" 단순 포함 검사 폐기, '긍정 단정'만 실패
            // (면제입니다/면제됩니다/줄 필요 없다 류). 부정문("면제되지 않"·"면제 아님")은 정답.
            // 통과 요건(의무+조건 15h·개근+공식)은 답변 전문(all1) 기준 — 앞부분 잘림 채점 금지
            const claimsExempt = /면제(입니다|됩니다|예요|이에요|라서|이므로 지급.*(않|안))|줄 필요(가)? 없|지급.*(안 해도|필요 없|의무 없)/.test(all1)
                && !/면제(되지|가) 않|면제 (대상이 )?아니|면제 안 되|면제 없/.test(all1);
            const ok1 = j1.mode === '답변' && /주휴/.test(all1) && /15/.test(all1) && /개근/.test(all1)
                && /(÷|\/)\s*40|40\s*[)]?\s*[×x*]\s*8|8\s*시간/.test(all1)
                && !claimsExempt;
            add('지율', '지침 내 답변 — 5인 미만 주휴수당 의무 (지시#49)', ok1,
                '✅의무 + 발생 조건(15h·개근) + 공식 ("면제"라 하면 실패)', `mode=${j1.mode} / ${j1.conclusion.slice(0, 80)}`, '오션라운지 알바 주휴수당 줘야 해?');
        } catch (e) { add('지율', '지침 내 답변 — 5인 미만 주휴수당 의무 (지시#49)', false, '✅의무+조건+공식', '오류: ' + e.message); }
        try {
            const j2 = await callJiyul('산업안전보건법상 카페 안전교육 세부 규정이 어떻게 돼?');
            add('지율', '범위 밖 정직 정지 (지시#49)', j2.mode === '범위밖', "'지침서 범위 밖 — 노무사 확인 필요' 정지 (추측 답변=실패)",
                `mode=${j2.mode} / ${j2.conclusion.slice(0, 60)}`, '산업안전 세부 규정');
        } catch (e) { add('지율', '범위 밖 정직 정지 (지시#49)', false, '범위밖 정지', '오류: ' + e.message); }
        try {
            const j3 = await callJiyul('박서준 주휴수당 계산해줘 — 주 20시간 일해');
            // run #64 거짓 실패 수정: 확인 질문이 question_back 대신 conclusion에 담겨도 인정 (요지는 '소속 확인' 동작)
            const askOk = !!j3.question_back || /확인이 필요|어느 (사업체|사업장|소속)|소속.*(알려|확인)/.test(j3.conclusion);
            add('지율', '소속 확인 질문 (지시#49)', j3.mode === '소속확인' && askOk,
                '어느 사업체 소속인지 확인 질문 (미확인 단정 답변=실패)', `mode=${j3.mode} / ${(j3.question_back || j3.conclusion).slice(0, 60)}`, '소속 불명 직원 주휴 계산');
        } catch (e) { add('지율', '소속 확인 질문 (지시#49)', false, '소속확인 질문', '오류: ' + e.message); }

        await step('한수 검산 점검 중... (2문항 — 0원 코드)');
        try {
            const hansu = loadAgentRunner('한수');
            const cjRep = (await callSemi({ partner_week: { partner: 'CJ대한통운', from: '2026-06-29', to: '2026-07-05', label: '7월 1주차' } })).report;
            const h1 = hansu.verifyReport(cjRep);
            add('한수', '정상 검산 ✅ (지시#49)', !!h1 && h1.ok === true, '🧮 ✅ 일치', h1 ? (h1.ok ? '✅ 일치' : '⚠️ 오검출') : '(검산 미적용)');
            const tampered = JSON.parse(JSON.stringify(cjRep));
            tampered.total = tampered.total + 5000;
            const h2 = hansu.verifyReport(tampered);
            add('한수', '오차 검출 +5,000원 (지시#49)', !!h2 && h2.ok === false && h2.diff_won === 5000 && /원인 위치/.test(JSON.stringify(h2.checks)),
                '⚠️ 오차 5,000원 + 원인 위치 (자동 보정=실패)', h2 ? `ok=${h2.ok} diff=${h2.diff_won}` : '(검산 미적용)');
        } catch (e) { add('한수', '검산 게이트 (지시#49)', false, '정상 ✅·오차 검출', '오류: ' + e.message); }

        // 지시 #54-3: 미래 검수 2문항 제거 → 실무(백로그·버전) 코드 문항 2개로 교체 (0원)
        await step('미래 실무 점검 중... (2문항 — 0원 코드)');
        const miraeRunner = loadAgentRunner('미래');
        try {
            const bTitle = '역량 점검용 백로그 항목 (자동 삭제됨)';
            const bId = await miraeRunner.backlogAdd(pool, bTitle);
            const bList = await miraeRunner.backlogList(pool);
            const found = bList.some(b => b.id === bId && b.title === bTitle && b.status === '대기');
            await pool.query(`UPDATE dev_backlog SET is_deleted = true WHERE id = $1`, [bId]); // is_test 격리 — 시험 항목 정리 (soft)
            add('미래', '백로그 기록·조회 (지시#54)', found, '추가 → 목록 반영 (대기 상태)', found ? `#${bId} 기록·조회 일치` : '목록 미반영');
        } catch (e) { add('미래', '백로그 기록·조회 (지시#54)', false, '추가→목록 반영', '오류: ' + e.message); }
        try {
            const vr = (await miraeRunner.result({ pool, params: { order_content: '지금 버전 뭐야?' } })).report;
            const verOk = vr.type === 'mirae_version' && vr.version === VERSION && String(vr.recent_changes || '').length > 10;
            add('미래', '버전·변경사항 안내 (지시#54)', verOk, `version.js와 일치 (${VERSION}) + 최근 변경 발췌`, `${vr.type}/${vr.version}`);
        } catch (e) { add('미래', '버전·변경사항 안내 (지시#54)', false, '버전 일치+변경 발췌', '오류: ' + e.message); }

        await step('예리 분석 점검 중... (2문항 — 0원 코드)');
        try {
            const yeriRunner = loadAgentRunner('예리');
            const y1 = await yeriRunner.result({ pool, params: {} });
            add('예리', '데이터 없음 정직 (지시#49)', y1.report?.no_data === true && /분석 불가/.test(y1.summary),
                '"데이터 없음 — 분석 불가" (감으로 채우면 실패)', y1.summary);
            const y2 = await yeriRunner.result({ pool, params: { performance_data: [
                { name: '하우스감귤 릴스', views: 1500 }, { name: '카라향 피드', views: 800 }, { name: '레몬 스토리', views: 300 },
            ] } });
            const y2txt = y2.summary + ' ' + (y2.lines || []).join(' ');
            add('예리', '표본 크기 병기 (지시#49)', /표본\s*3건/.test(y2txt), '결론에 "(표본 3건)" 병기', y2.summary);
        } catch (e) { add('예리', '분석 정직 동작 (지시#49)', false, '데이터 없음·표본 병기', '오류: ' + e.message); }

        await step('기안 기획 점검 중... (1문항 — Sonnet)');
        try {
            const gianRunner = loadAgentRunner('기안');
            const g1 = (await gianRunner.result({ pool, params: { order_content: '단골 손님 대상 하우스감귤 감사 이벤트 기획해줘' } })).report;
            // run #64 후속: 7항목 누락 시 어느 필드인지 표시 (진단 로그 강화)
            const fields7 = { 요약: g1.summary, 목적: g1.purpose, 대상: g1.target, 실행단계: (g1.steps || []).length, 비용: g1.cost, 지표: g1.metrics, 리스크: (g1.risks || []).length };
            const missing7 = Object.entries(fields7).filter(([, v]) => !v).map(([k]) => k);
            const has7 = missing7.length === 0;
            const mapped = /철학|로드맵|[1-4]단계|연관 없음/.test(g1.purpose || '');
            const noForecast = !/매출\s*[\d,억만]+\s*(원)?\s*(예상|전망|달성)/.test(JSON.stringify(g1));
            const whoOk = (g1.steps || []).every(s => s.who && s.who.trim());
            const delivOk = Array.isArray(g1.deliverables); // 지시 #54-5: 산출물 칸 존재 (창작 요청 아닐 땐 빈 배열 허용)
            add('기안', '기획 7항목 출력 형식 (지시#49)', has7 && mapped && noForecast && whoOk && delivOk,
                '7항목 전부 + 로드맵 매핑 + 주체 명시 (근거 없는 매출 전망=실패)',
                `7항목=${has7}${missing7.length ? `(누락: ${missing7.join(',')})` : ''} 매핑=${mapped} 전망 없음=${noForecast} 주체=${whoOk}`, '단골 감사 이벤트 기획');
        } catch (e) { add('기안', '기획 7항목 출력 형식 (지시#49)', false, '7항목+매핑', '오류: ' + e.message); }
    } catch (fatal) {
        console.error('역량 점검 치명 오류:', fatal.message);
    }

    // ===== 집계 → 보고서 등록 (자동 수정 없음) =====
    const sections = Object.entries(results).map(([agent, rs]) => ({
        agent, results: rs, pass: rs.filter(r => r.pass).length, total: rs.length,
    }));
    const passTotal = sections.reduce((s, x) => s + x.pass, 0);
    const total = sections.reduce((s, x) => s + x.total, 0);
    const fails = sections.flatMap(s => s.results.filter(r => !r.pass).map(r => ({ agent: s.agent, ...r })));
    const suggestions = fails.length
        ? fails.map(f => `[${f.agent}] "${f.name}" 실패 — 기대: ${f.expected} / 실제: ${f.actual} → 원인 검토 후 별도 지시로 수정`)
        : ['전 항목 통과 — 개선 제안 없음'];
    suggestions.push('※ 자동 수정 금지 원칙 — 이 보고서는 점검 결과만 기록하며 수정은 대표 검토 후 별도 지시로 진행');
    suggestions.push('※ 기대 금액값(4/14·4/5·하우스귤 7월)은 2026-07-17 DB 스냅샷 기준 — 정산 데이터 수정 시 기대값 갱신 필요');
    const durS = Math.round((Date.now() - t0) / 1000);
    const summary = `🧪 역량 점검: ${passTotal}/${total} 통과 (${sections.map(s => `${s.agent} ${s.pass}/${s.total}`).join(' · ')})`;
    await agentRunAppendStep(run.id, agentStep('report', '마루', `역량 점검 완료 — ${passTotal}/${total} 통과`));
    await agentRunAppendStep(run.id, agentStep('done', '마루', '역량 점검 보고서 등록'));
    await pool.query(`UPDATE agent_runs SET status='done', result=$2, finished_at=NOW() WHERE id=$1`,
        [run.id, JSON.stringify({
            summary,
            lines: [
                `${sections.map(s => `${s.agent} ${s.pass}/${s.total}`).join(' · ')} · 소요 ${durS}초`,
                fails.length ? `실패 ${fails.length}건: ${fails.slice(0, 3).map(f => `[${f.agent}] ${f.name}`).join(' / ')}${fails.length > 3 ? ' 외' : ''}` : '전 항목 통과 ✅',
                '자동 수정 없음 — 상세·생성물 원문은 보고서에서',
            ],
            report: { type: 'capability_test', ran_at: new Date().toISOString(), duration_s: durS,
                totals: { pass: passTotal, total, by_agent: sections.map(s => ({ agent: s.agent, pass: s.pass, total: s.total })) },
                sections, artifacts, suggestions,
                note: '자동 수정 금지 — 보고서만 등록 · 에이전트 수정 후 배포 전 이 점검 통과 필수' },
        })]);
    await pool.query(`UPDATE agents SET status='idle', last_run_at=NOW() WHERE id = $1`, [run.agent_id]).catch(() => {});
    await writeAudit({ action: 'capability_test', targetType: 'agent_run', targetId: run.id,
        changes: { after: { pass: passTotal, total, fails: fails.length } }, source: 'agent_office', actor });
    notifyTelegram(`🧪 역량 점검 결과: ${passTotal}/${total}`); // 지시 #10-c (비동기, 실패 무시)
}

// ------------------------------------------------------------
// 7차: 마루 직접 처리 — 일정 (운영_지시규칙.md 원칙 적용)
// 조회=즉시 실행·즉답 / 등록=정리→확인 1회→실행 / 삭제=불가 안내
// 실행 기록은 서버 코드가 직접 기록 (LIVE 로그 + 보고서함)
// ------------------------------------------------------------
function kstTodayStr() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 표기 규칙: 날짜(요일)[~종료일] 시간 — [카테고리] 내용 (담당자) · 일반 카테고리는 표기 생략 (3단계)
function fmtScheduleLine(dateStr, time, title, assignee, category, endDate) {
    const ds = String(dateStr).slice(0, 10);
    const d = new Date(ds + 'T00:00:00Z');
    const day = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
    const md = `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
    let range = `${md}(${day})`;
    const ed = endDate ? String(endDate).slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(ed) && ed !== ds) {
        const e = new Date(ed + 'T00:00:00Z');
        range += `~${Number(ed.slice(5, 7))}/${Number(ed.slice(8, 10))}(${['일', '월', '화', '수', '목', '금', '토'][e.getUTCDay()]})`;
    }
    const cat = category && category !== '일반' ? `[${category}] ` : '';
    return `${range}${time ? ' ' + time : ''} — ${cat}${title} (${assignee || '대표'})`;
}

// 4단계: 보고서 파일 저장 (DB 보관 — Render 디스크는 재배포 시 소실) + audit 기록
const ExcelJS = require('exceljs');
async function saveReportFile(filename, buffer, runId = null, actor = null) {
    const row = (await pool.query(
        `INSERT INTO report_files (filename, run_id, data, size_bytes) VALUES ($1, $2, $3, $4) RETURNING id`,
        [filename, runId, buffer, buffer.length])).rows[0];
    await writeAudit({
        action: 'create', targetType: 'report_file', targetId: row.id,
        changes: { after: { filename, size_bytes: buffer.length, run_id: runId } },
        source: 'agent_office', actor,
    });
    return row.id;
}
// 파일 요청 키워드 감지 (지시 #5: "보내줘/파일로/엑셀로/다운로드/뽑아줘")
// 지시 #17: '파일로'만 커버하던 것을 '파일'로 확장 — 스모크 "파일 줘"가 즉답으로만 빠진 원인
const WANT_FILE_RE = /엑셀|파일|다운로드|보내\s*줘|뽑아\s*줘/;

// 일정 목록 xlsx (4단계 — 일정 보고서 "파일로 받기")
async function buildScheduleXlsx(rows, from, to) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('일정');
    ws.columns = [
        { header: '날짜', key: 'date', width: 12 }, { header: '종료일', key: 'end', width: 12 },
        { header: '시간', key: 'time', width: 8 }, { header: '카테고리', key: 'cat', width: 12 },
        { header: '내용', key: 'title', width: 44 }, { header: '담당', key: 'who', width: 10 },
    ];
    rows.forEach(s => ws.addRow({
        date: String(s.date).slice(0, 10), end: s.end_date ? String(s.end_date).slice(0, 10) : '',
        time: s.start_time || '', cat: s.category || '일반', title: s.title, who: s.user_name || '대표',
    }));
    ws.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
}

// 마루 직접 처리 실행 기록 (보고서함/LIVE 로그용 — 완료 상태로 즉시 기록)
async function maruRecordRun(opLabel, summaryText, lines, reportObj) {
    const maruQ = await pool.query(`SELECT id FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`);
    const maru = maruQ.rows[0];
    if (!maru) return null;
    const steps = [
        agentStep('order', '마루', `오더 접수 — ${opLabel}`),
        agentStep('work', '마루', `${opLabel} 처리 중...`),
        agentStep('done', '마루', '보고서함에 보고 등록'),
    ];
    const run = (await pool.query(
        `INSERT INTO agent_runs (agent_id, status, steps, result, finished_at)
         VALUES ($1, 'done', $2, $3, NOW()) RETURNING *`,
        [maru.id, JSON.stringify(steps),
         JSON.stringify({ summary: summaryText, lines, report: reportObj })])).rows[0];
    await pool.query(`UPDATE agents SET last_run_at = NOW() WHERE id = $1`, [maru.id]);
    notifyTelegram(`✅ [마루] 완료: ${summaryText}`); // 지시 #10-b (비동기, 실패 무시)
    return run;
}

// 일정 지시 처리 (조회/등록 제안/불가)
// 일정 항목 실제 등록 (확인 승인 경로와 멀티 자동등록 경로 공용) — svcCreateSchedule 재사용, audit 자동
async function maruRegisterScheduleItems(items, actor) {
    const created = [];
    for (const i of items) {
        let uid = null;
        if (i.assignee_name) {
            const u = await pool.query('SELECT id FROM users WHERE name = $1 LIMIT 1', [i.assignee_name]);
            uid = u.rows[0]?.id || null;
        }
        await svcCreateSchedule({
            date: i.date, title: i.title, type: 'normal',
            start_time: i.time || null,
            category: i.category || '일반', end_date: i.end_date || null,
            user_id: uid ?? actor?.id ?? undefined, // 담당자 미지정/미매칭 = 대표
        }, actor);
        created.push(fmtScheduleLine(i.date, i.time, i.title, i.assignee_name, i.category, i.end_date));
    }
    return created;
}

async function maruHandleSchedule(order, d, actor, effContent = null, opts = {}) {
    const srcText = effContent || order.content; // 지시 #6: 결합 텍스트 기준 (파일 감지·기간 파싱)
    if (d.schedule_op === '조회') {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(d.schedule_from) ? d.schedule_from : kstTodayStr();
        const to = /^\d{4}-\d{2}-\d{2}$/.test(d.schedule_to) ? d.schedule_to : from;
        const rows = await svcListSchedules({ from, to });
        // 4b ②안 (2026-07-18): 보고서엔 전체 포함 (안전 상한 200건), 초과분은 생략을 명시 (정직 원칙 — 몰래 자르기 금지)
        const CAP = 200;
        const lines = rows.slice(0, CAP).map(s => fmtScheduleLine(s.date, s.start_time, s.title, s.user_name, s.category, s.end_date));
        if (rows.length > CAP) lines.push(`… 이하 ${rows.length - CAP}건 생략 — 전체는 일정 화면에서 확인해주세요`);
        const summaryText = rows.length
            ? `완료: ${from}~${to} 일정 ${rows.length}건`
            : `${from}~${to} 등록된 일정이 없습니다`;
        // 4단계: "파일로 받기" — 파일 키워드 감지 시 일정 목록 xlsx 생성 (adminOnly 다운로드)
        let fileMeta = null;
        if (rows.length && WANT_FILE_RE.test(srcText)) {
            const ymd = kstTodayStr().replace(/-/g, '');
            const fname = `일정보고_${from}~${to}_${ymd}.xlsx`;
            const buf = await buildScheduleXlsx(rows, from, to);
            const fid = await saveReportFile(fname, buf, null, actor);
            fileMeta = { file_id: fid, file_name: fname };
        }
        const run = await maruRecordRun('일정 조회', summaryText + (fileMeta ? ' · 📎 파일 생성' : ''), lines.slice(0, 3),
            { type: 'maru_schedule', op: '조회', from, to, items: lines, count: rows.length, ...(fileMeta || {}) });
        await maruFinishOrder(order.id, '완료', {
            type: 'schedule_list', from, to, count: rows.length, items: lines.slice(0, 10), run_id: run?.id,
        }, run?.id);
        return;
    }
    if (d.schedule_op === '등록') {
        const items = (Array.isArray(d.schedule_items) ? d.schedule_items : [])
            .filter(i => i && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && String(i.title || '').trim())
            .map(i => ({
                ...i,
                category: SCHEDULE_CATEGORIES.includes(i.category) ? i.category : '일반',
                end_date: (/^\d{4}-\d{2}-\d{2}$/.test(i.end_date || '') && i.end_date > i.date && isValidDateStr(i.end_date)) ? i.end_date : null,
            }))
            // 지시 #12: 카테고리 소실 임시 가드 — 모델이 카테고리를 비웠을 때(='일반') 원문·제목의
            // 톡톡/문자 키워드로 서버가 강제 지정. 카테고리는 원문에서 재구성할 다른 수단이 없는
            // 유일한 실전 위험 필드 (역량 점검 #47에서 오염으로 인한 소실 실측). 모델이 특정
            // 카테고리를 명시한 경우엔 존중 (다건 지시는 각 제목만 근거로 사용 — 교차 오염 방지)
            .map((i, _, arr) => {
                if (i.category !== '일반') return i;
                const basis = arr.length === 1 ? `${i.title || ''} ${srcText}` : String(i.title || '');
                const forced = /톡톡/.test(basis) ? '톡톡발송'
                    : /문자|SMS|LMS/i.test(basis) ? '문자발송' : null;
                if (forced) console.log(`카테고리 가드: '${i.title}' 일반 → ${forced} (원문 키워드)`);
                return forced ? { ...i, category: forced } : i;
            });
        if (items.length === 0) {
            await maruFinishOrder(order.id, '질문', {
                type: 'clarify', question: '등록할 일정의 날짜와 내용을 알려주세요 (예: "화요일 카라향 출고")',
                summary: d.task_summary, reason: d.reason,
            });
            return;
        }
        // 지시 #2-2: 원문의 기간 표현("7월 25일부터 27일까지", "25~27일" 등)을 서버가 직접 확정
        // — 같은 입력 = 같은 결과 (마루 재량 제거, 1단계 월 정규식과 동일 원칙). 단일 건일 때만 적용
        if (items.length === 1) {
            const range = parseExplicitRange(srcText, kstTodayStr(), { future: true });
            if (range && (items[0].date !== range.from || (items[0].end_date || range.from) !== range.to)) {
                console.log(`기간 보정: 마루 '${items[0].date}${items[0].end_date ? '~' + items[0].end_date : ''}' → 원문 파싱 '${range.from}~${range.to}'`);
                items[0].date = range.from;
                items[0].end_date = range.to > range.from ? range.to : null;
            }
        }
        const vacItems = items.filter(i => i.category === '휴가');
        // 지시 #2-1: 휴가는 결재 시스템 전용 — 마루 일정 등록 경로 차단 (연차 차감 이중 경로 방지)
        // 아래 담당자 매칭 로직은 삭제하지 않고 비활성 보존 (추후 정책 변경 시 플래그만 전환)
        const VACATION_VIA_SCHEDULE = false;
        if (vacItems.length && !VACATION_VIA_SCHEDULE) {
            await maruFinishOrder(order.id, '안내', {
                type: 'vacation_redirect',
                notice: '휴가는 결재 시스템(기안서류 → 휴가신청서)에서 신청해주세요 — 연차 차감이 자동 연동됩니다. 마루는 휴가를 일정으로 등록하지 않아요.',
            });
            return;
        }
        // (비활성 보존) 휴가 카테고리 담당자 필수 — 실제 직원(users) 명단과 매칭, 미매칭 시 선택지 포함 되묻기
        if (vacItems.length && VACATION_VIA_SCHEDULE) {
            const names = (await pool.query(`SELECT name FROM users ORDER BY id`)).rows.map(r => r.name);
            const unmatched = vacItems.filter(i => !names.includes(String(i.assignee_name || '').trim()));
            if (unmatched.length) {
                await maruFinishOrder(order.id, '질문', {
                    type: 'clarify',
                    question: `휴가 일정은 담당자가 필요해요 — 누구의 휴가인가요? (직원: ${names.join(', ')})`,
                    summary: d.task_summary, reason: d.reason,
                });
                return;
            }
        }
        // 🔴 대표 7/22: 멀티 지시(대표가 이미 "네"로 전체 승인)의 일정 서브태스크는 재확인 없이 바로 등록.
        //   기존엔 각 일정이 "이대로 등록할까요?"로 또 물어 → 순차 실행 중 서로 '대체됨'으로 밀려 3건 다 미등록되던 버그.
        //   단일 일정 등록(멀티 아님)은 기존대로 확인 1회 유지(회귀 없음).
        if (opts.autoRegister) {
            const created = await maruRegisterScheduleItems(items, actor);
            const summaryText = `✅ 일정 ${created.length}건 등록 완료`;
            const run = await maruRecordRun('일정 등록', summaryText, created.slice(0, 3),
                { type: 'maru_schedule', op: '등록', items: created, count: created.length });
            await maruFinishOrder(order.id, '완료',
                { type: 'schedule_created', count: created.length, items: created, run_id: run?.id }, run?.id);
            return;
        }
        // 등록은 확인 1회 필수 — 목록 전체를 보여주고 대기 (여러 건도 확인 1회)
        const formatted = items.map(i =>
            fmtScheduleLine(i.date, i.time, i.title, i.assignee_name, i.category, i.end_date)
            + (i.date_note ? ` (※'${i.date_note}' → 제안한 날짜)` : ''));
        await maruFinishOrder(order.id, '질문', {
            type: 'schedule_confirm', items, formatted,
            question: `${formatted.join('  /  ')}  —  이대로 ${items.length}건 등록할까요? ("응" 또는 "등록해"로 답해주세요)`,
        });
        return;
    }
    // 삭제·수정 → 불가 안내 (기존 원칙)
    await maruFinishOrder(order.id, '안내', {
        type: 'schedule_blocked',
        notice: '일정 삭제·수정은 아직 말로 처리할 수 없습니다 — 프로그램 일정 화면에서 직접 처리해주세요 (조회·등록은 가능합니다)',
    });
}

// ------------------------------------------------------------
// 8차: 정산현황 입력 (마루 직접 — 일정 등록과 같은 확인 패턴)
// 확인 없이 자동 저장 경로 없음. 기존 정산관리 화면·계산 로직 무변경.
// ------------------------------------------------------------
const SS_FIELD_LABELS = {
    current_cash: '현재 현금', settlement_scheduled: '스토어 정산예정', unsettled: '스토어 미정산',
    coupang_unpaid: '쿠팡 미정산', selfmall_unpaid: '자사몰 미정산',
    ad_naver: '네이버 광고', ad_gfa: 'GFA 광고',
    card_fee: '카드이용금액', corp_card: '법인카드',
    daesong: '대성', hyodong: '효돈', aewol: '애월', delivery: '택배',
};
const SS_NUM_FIELDS = Object.keys(SS_FIELD_LABELS);

// 정산관리 화면과 동일한 총 합계 공식 (ssCompute와 일치)
function ssTotalOf(row) {
    const n = k => Number(row[k]) || 0;
    return n('current_cash') + n('settlement_scheduled') + n('unsettled')
        + n('coupang_unpaid') + n('selfmall_unpaid')
        + n('ad_naver') + n('ad_gfa')
        - n('card_fee') - n('corp_card')
        - n('daesong') - n('hyodong') - n('aewol') - n('delivery');
}
const fmtWon = n => Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';
function fmtDateLabel(ds) {
    const dt = new Date(String(ds).slice(0, 10) + 'T00:00:00Z');
    const day = ['일', '월', '화', '수', '목', '금', '토'][dt.getUTCDay()];
    return `${Number(String(ds).slice(5, 7))}/${Number(String(ds).slice(8, 10))}(${day})`;
}

// 정산현황 입력 지시 → 표로 정리해 확인 요청 (저장은 확인 후에만)
async function maruHandleSettlementInput(order, d, actor) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d.settlement_date) ? d.settlement_date : kstTodayStr();
    const raw = (Array.isArray(d.settlement_entries) ? d.settlement_entries : [])
        .filter(e => e && SS_NUM_FIELDS.includes(e.field) && Number.isFinite(Number(e.amount)) && Number(e.amount) >= 0);
    if (raw.length === 0) {
        await maruFinishOrder(order.id, '질문', {
            type: 'clarify', question: '입력할 항목과 금액을 알려주세요 (예: "오늘 정산현황 입력 — 대성 283만, 효돈 203만")',
            summary: d.task_summary, reason: d.reason,
        });
        return;
    }
    const map = {};
    raw.forEach(e => { map[e.field] = Math.round(Number(e.amount)); }); // 같은 항목 중복 언급 시 마지막 값
    const entries = Object.entries(map).map(([field, amount]) => ({ field, amount }));
    const existing = (await pool.query('SELECT * FROM settlement_status WHERE date = $1', [date])).rows[0] || null;
    const dateLabel = fmtDateLabel(date);
    const rows = entries.map(e => `${SS_FIELD_LABELS[e.field]} ${fmtWon(e.amount)}`);
    const untouchedNote = existing ? '미언급 항목은 기존값 유지' : '미언급 항목은 미입력(0)';
    const existNote = existing
        ? ` ⚠️ ${dateLabel} 기록이 이미 있습니다 (기존 총 합계 ${fmtWon(ssTotalOf(existing))}) — 말씀하신 항목만 덮어씁니다.`
        : '';
    await maruFinishOrder(order.id, '질문', {
        type: 'settlement_confirm', date, entries, existing: !!existing, formatted: rows,
        question: `${dateLabel} 정산현황 — ${rows.join(' / ')} (${untouchedNote})${existNote} 저장할까요? ("응" 또는 "저장해"로 답해주세요)`,
    });
}

// 확인 후 실제 저장 — 부분 업데이트 (언급 항목만), audit_log before/after 기록
async function maruExecuteSettlementSave(pending, currentOrder, actor) {
    const date = pending.result.date;
    const entries = ((pending.result && pending.result.entries) || [])
        .filter(e => e && SS_NUM_FIELDS.includes(e.field) && Number.isFinite(Number(e.amount))); // 화이트리스트 재검증
    if (entries.length === 0) {
        await maruFinishOrder(currentOrder.id, '오류', { type: 'error', error: '저장할 항목이 없습니다' });
        return;
    }
    const before = (await pool.query('SELECT * FROM settlement_status WHERE date = $1', [date])).rows[0] || null;
    let after;
    if (before) {
        const sets = ['updated_at = NOW()'];
        const params = [];
        entries.forEach(e => { params.push(e.amount); sets.push(`${e.field} = $${params.length}`); });
        if (actor?.id) { params.push(actor.id); sets.push(`updated_by = $${params.length}`); }
        params.push(date);
        after = (await pool.query(
            `UPDATE settlement_status SET ${sets.join(', ')} WHERE date = $${params.length} RETURNING *`, params)).rows[0];
    } else {
        const cols = ['date'];
        const vals = ['$1'];
        const params = [date];
        entries.forEach(e => { params.push(e.amount); cols.push(e.field); vals.push(`$${params.length}`); });
        if (actor?.id) { params.push(actor.id); cols.push('updated_by'); vals.push(`$${params.length}`); }
        after = (await pool.query(
            `INSERT INTO settlement_status (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`, params)).rows[0];
    }
    await writeAudit({
        action: before ? 'update' : 'create', targetType: 'settlement_status', targetId: after.id,
        changes: { before, after }, source: 'agent_office', actor,
    });
    const total = ssTotalOf(after);
    const savedLines = entries.map(e => `${SS_FIELD_LABELS[e.field]} ${fmtWon(e.amount)}`);
    const summaryText = `✅ 저장 완료 — ${fmtDateLabel(date)} 총 합계 ${fmtWon(total)}`;
    const run = await maruRecordRun('정산현황 입력', summaryText, savedLines.slice(0, 3), {
        type: 'maru_settlement', date, date_label: fmtDateLabel(date),
        saved: savedLines, overwrote: !!before, total,
        prev_total: before ? ssTotalOf(before) : null,
    });
    const doneResult = {
        type: 'settlement_saved', date, total, items: savedLines, run_id: run?.id,
        notice: '정산관리 → 정산현황 화면에서 언제든 수정할 수 있습니다',
    };
    await maruFinishOrder(pending.id, '완료', doneResult, run?.id);
    await maruFinishOrder(currentOrder.id, '완료', doneResult, run?.id);
}

// 확인 답변("응/등록해/저장해")으로 대기 중인 등록·저장 실행 — AI 호출 없이 정규식 판별 (일정+정산 공용)
const MARU_YES_RE = /^(응+|어+|네+|넵|예|ㅇㅋ|ok|오케이|yes|등록해줘|등록해|등록|저장해줘|저장해|저장|진행해|진행|해줘|고고|고)[!~.\s]*$/i;
const MARU_NO_RE = /^(아니요?|아냐|취소|취소해|하지마|노|ㄴㄴ|no)[!~.\s]*$/i;

async function maruTryScheduleConfirm(order, actor) {
    const content = String(order.content || '').trim();
    if (content.length > 12) return false;
    const isYes = MARU_YES_RE.test(content);
    const isNo = MARU_NO_RE.test(content);
    if (!isYes && !isNo) return false;
    const pendingQ = await pool.query(
        `SELECT * FROM pending_orders
         WHERE status = '질문' AND is_deleted = false
           AND result->>'type' IN ('schedule_confirm', 'settlement_confirm', 'query_confirm')
           AND created_at > NOW() - interval '1 hour' AND id != $1
         ORDER BY created_at DESC LIMIT 1`, [order.id]);
    const pending = pendingQ.rows[0];
    if (!pending) return false;
    const ptype = pending.result && pending.result.type;

    if (isNo) {
        const what = ptype === 'settlement_confirm' ? '정산현황 저장'
            : ptype === 'query_confirm' ? '조회' : '일정 등록';
        await maruFinishOrder(pending.id, '안내', { type: 'confirm_cancelled', notice: `${what}을 취소했습니다` });
        await maruFinishOrder(order.id, '완료', {
            type: ptype === 'settlement_confirm' ? 'settlement_cancelled'
                : ptype === 'query_confirm' ? 'query_cancelled' : 'schedule_cancelled',
            notice: `알겠습니다 — ${what}을 취소했어요${ptype === 'query_confirm' ? ' (기간을 다시 말씀해주시면 조회해드립니다)' : ''}`,
        });
        return true;
    }
    if (ptype === 'settlement_confirm') {
        await maruExecuteSettlementSave(pending, order, actor);
        return true;
    }
    // 1-2: 오래된 기간 조회 복창 승인 → 저장해둔 배정·조건으로 실행
    if (ptype === 'query_confirm') {
        const route = pending.result.route || {};
        const conditions = pending.result.conditions || {};
        await dispatchLiveAgent(pending, route, conditions, actor, order.id);
        return true;
    }
    // 승인 → 실제 등록 (공용 헬퍼 재사용: svcCreateSchedule + audit 자동)
    const items = (pending.result && pending.result.items) || [];
    const created = await maruRegisterScheduleItems(items, actor);
    const summaryText = `✅ 일정 ${created.length}건 등록 완료`;
    const run = await maruRecordRun('일정 등록', summaryText, created.slice(0, 3),
        { type: 'maru_schedule', op: '등록', items: created, count: created.length });
    const doneResult = { type: 'schedule_created', count: created.length, items: created, run_id: run?.id };
    await maruFinishOrder(pending.id, '완료', doneResult, run?.id);
    await maruFinishOrder(order.id, '완료', doneResult, run?.id);
    return true;
}

// 배정 실행 — 요원 조회 → (live면) 실제 실행, 아니면 안내 (일반 배정·조회 복창 승인 공용)
// mirrorOrderId: 복창 승인 흐름에서 "응" 지시에도 같은 결과를 기록
async function dispatchLiveAgent(order, route, conditions, actor, mirrorOrderId = null, effContent = null, opts = {}) {
    const srcText = effContent || order.content; // 지시 #6: 결합 텍스트 기준 (파일 감지·요원 전달 원문)
    const finish = async (status, result, runId = null) => {
        await maruFinishOrder(order.id, status, result, runId);
        if (mirrorOrderId) await maruFinishOrder(mirrorOrderId, status, result, runId);
    };
    const agentQ = await pool.query(
        `SELECT * FROM agents WHERE name = $1 AND is_deleted = false LIMIT 1`, [route.assignee]);
    const agent = agentQ.rows[0] || null;
    const condText = [
        conditions.partner_week ? `${conditions.partner_week.label} ${conditions.partner_week.partner}` : '',
        conditions.item_keyword, conditions.target_date || conditions.period,
    ].filter(Boolean).join(' · ');
    const routeInfo = {
        type: 'route', team: route.team, assignee: route.assignee, summary: route.task_summary, reason: route.reason,
        conditions: (conditions.item_keyword || conditions.period || conditions.target_date) ? conditions : null,
    };

    // 실전 연결된 요원(agents/{이름}.js의 live:true)이면 role 무관하게 실제 실행.
    // (구 버그: role==='worker' 요구 → 매니저인 지율·한수·미래가 live:true인데도 '안내'로 빠짐 — 세미만 live였던 초기 잔재)
    const runner = agent ? loadAgentRunner(agent.name) : null;
    const isLive = !!(agent && runner.live && agent.is_active);

    if (!isLive) {
        await finish('안내', {
            ...routeInfo,
            notice: route.assignee === '마루'
                ? '일정은 이렇게 말씀해주세요 — 조회: "이번주 일정 뭐 있어?" / 등록: "화요일 카라향 출고 등록해줘"'
                : `${route.assignee}은(는) 아직 실전 연결 전입니다 — 배정만 기록했습니다 (해당 차수에서 실행 연결 예정)`,
        });
        return;
    }

    // 연결된 요원(세미) → 실제 실행 (기존 실행 파이프라인 재사용)
    const running = await pool.query(
        `SELECT id FROM agent_runs WHERE agent_id = $1 AND status = 'running' AND is_deleted = false LIMIT 1`, [agent.id]);
    if (running.rows.length > 0) {
        await finish('안내', {
            ...routeInfo,
            notice: `${agent.name}이(가) 이미 다른 작업을 실행 중입니다 — 완료 후 다시 지시해주세요`,
        });
        return;
    }
    const mgr = await pool.query(
        `SELECT name FROM agents WHERE team = $1 AND role = 'manager' AND is_deleted = false AND is_active = true LIMIT 1`, [agent.team]);
    const firstStep = agentStep('order', '마루',
        `오더 접수 — "${route.task_summary}"${condText ? ` [조건: ${condText}]` : ''} → ${agent.team} ${agent.name} 배정`);
    const run = (await pool.query(
        `INSERT INTO agent_runs (agent_id, steps) VALUES ($1, $2) RETURNING *`,
        [agent.id, JSON.stringify([firstStep])])).rows[0];
    await pool.query(`UPDATE agents SET status='running' WHERE id = $1`, [agent.id]);
    await writeAudit({
        action: 'agent_run', targetType: 'agent_run', targetId: run.id,
        changes: { after: { agent: agent.name, team: agent.team, mode: 'maru_routed', order_id: order.id, conditions } },
        source: 'agent_office', actor,
    });
    // 마루가 추출한 조건 + 대표 지시 원문(한 글자도 자르지 않고 통째)을 요원 실행에 전달
    const execPromise = executeAgentTestRun(run, agent, mgr.rows[0]?.name || null, {
        workplace: '전체',
        item_keyword: conditions.item_keyword,
        period: conditions.period,
        target_date: conditions.target_date,
        order_content: srcText,
        want_file: WANT_FILE_RE.test(srcText), // 4단계: 엑셀 파일 생성 모드
        compare: conditions.compare || null,   // 4.5 ⑤: 기간 비교 (서버 확정)
        rank: conditions.rank || null,         // 4.5 ⑥: 품목 순위 (서버 확정)
        partner_week: conditions.partner_week || null, // 지시 #15: 주차×거래처 (서버 확정)
        partner: conditions.partner || null, // 대표 7/22: 거래처별 월/기간 매출 필터
        price_history: conditions.price_history || null, // 대표 7/22: 품목별 결제가(단가) 이력 (매출 아님)
        ...(() => {
            // 🔴 지시 #54-4: 날짜 단일 소스 — 서버 확정 날짜(요일 포함)를 요원에 주입 (요원 자체 계산 금지)
            const wr = parseWeekdayRange(srcText, kstTodayStr());
            if (wr) return { dates_hint: wr.label, dates_range: { from: wr.from, to: wr.to } };
            if (conditions.partner_week) {
                const pw = conditions.partner_week;
                return { dates_hint: `${pw.from}~${pw.to} (${pw.label})`, dates_range: { from: pw.from, to: pw.to } };
            }
            const rng = periodRangeOf(conditions, kstTodayStr());
            if (rng) return { dates_hint: `${rng.from}~${rng.to} (${rng.label})`, dates_range: { from: rng.from, to: rng.to } };
            return { dates_hint: '', dates_range: null };
        })(),
    });
    await finish('완료', { ...routeInfo, run_id: run.id }, run.id);
    // 멀티 순차 실행 (대표 7/20): 같은 요원 동시 배정 충돌 방지 — 요원 실행 완료까지 대기 후 다음 서브태스크
    if (opts.awaitExec) await execPromise.catch(e => console.error('멀티 순차 실행 오류:', e?.message));
}

// ===== 정산관리 이미지 자동 입력 (대표 7/20 지시) =====
// 거래처 별칭 → 정식 거래처명 (pricing/settlements 기준: 효돈농협 / 대성(시온) / 기타거래처)
function normalizePartnerName(raw) {
    const s = String(raw || '').replace(/\s/g, '');
    if (/효돈|효도|효돈농협|효돈농협유통/.test(s)) return '효돈농협';
    if (/시온|대성|시온감귤|시온감귤랜드/.test(s)) return '대성(시온)';
    if (/기타|애월|취나물/.test(s)) return '기타거래처';
    return null; // 미매칭 — 확인표에 경고 표시
}

// 정산 날짜 파싱 (대표 7/20): "21일"(일만·이번달)·"7/21"·"7월 21일"·"내일/어제"·없으면 오늘
function parseSettlementDate(text, todayStr) {
    const t = String(text || '');
    const y = +todayStr.slice(0, 4);
    const pad = n => String(n).padStart(2, '0');
    const ok = (mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
    const shift = n => { const dt = new Date(todayStr + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
    if (/내일/.test(t)) return shift(1);
    if (/어제/.test(t)) return shift(-1);
    // 정산은 미래 날짜여도 올해 기준 (조회용 parseExplicitDate의 "작년" 규칙 미적용)
    let m = t.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/); // YYYY-MM-DD
    if (m && ok(+m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/); // M월 D일 (올해)
    if (m && ok(+m[1], +m[2])) return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    m = t.match(/(?<!\d)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/); // M/D (올해)
    if (m && ok(+m[1], +m[2])) return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    m = t.match(/(?<![\/\-\d])(\d{1,2})\s*일(?!\s*(전|후|간|째|동안|치))/); // D일 (이번달)
    if (m && +m[1] >= 1 && +m[1] <= 31) return `${todayStr.slice(0, 7)}-${pad(+m[1])}`;
    return todayStr;
}

// 이미지 품목명 → 가격표 품목 정확 매칭 (대표 7/20).
// matchItemToPricing(유사매칭)은 2.5kg↔4.5kg을 구분 못해 오금액 발생 → 정산관리(돈)는 정확 이름 대조 사용.
// 이미지 품목명은 "...: 하우스감귤 가정용 - 2.5kg(로얄과)"처럼 가격표 이름을 그대로 포함하므로 substring 대조.
function matchSettlementItemExact(imgName, priceMap) {
    const norm = s => String(s || '').replace(/\s+/g, '').replace(/[·]/g, '');
    const imgN = norm(imgName);
    // 긴(구체적) 이름부터 — 2.5kg이 4.5kg보다 먼저 잡히는 부분일치 오류 방지
    const names = Object.keys(priceMap).sort((a, b) => norm(b).length - norm(a).length);
    for (const pn of names) {
        if (imgN.includes(norm(pn))) return { name: pn, price: priceMap[pn] };
    }
    return null;
}

// 지정 날짜·거래처의 최신 가격표(pricing)에서 품목→가격 맵 구성 (정산관리 화면과 동일 로직)
async function buildPriceMapFor(partner, dateStr) {
    const r = await pool.query(
        `SELECT items FROM pricing WHERE partner = $1
           AND (start_date IS NULL OR start_date <= $2)
           AND (end_date IS NULL OR end_date >= $2)
         ORDER BY start_date DESC NULLS LAST, id DESC LIMIT 1`, [partner, dateStr]);
    const map = {};
    if (r.rows[0] && Array.isArray(r.rows[0].items)) {
        for (const it of r.rows[0].items) if (it && it.name) map[it.name] = Number(it.price) || 0;
    }
    return map;
}

// 마루 비전 판독: 발송목록 이미지 → { partner, items:[{name, qty}] }
const SETTLE_OCR_TOOL = {
    name: 'read_settlement_image',
    description: '거래처 발송목록(택배 접수용) 이미지에서 거래처명과 품목별 박스 수량을 읽는다.',
    strict: true,
    input_schema: {
        type: 'object', additionalProperties: false,
        properties: {
            partner: { type: 'string', description: '거래처명 (이미지 상단 제목·헤더에서. 예: 시온감귤랜드, 효돈농협유통센터). 없으면 빈 문자열' },
            items: {
                type: 'array', description: '품목별 수량 목록 (합계 행은 제외)',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        name: { type: 'string', description: '품목명 전체 — 이미지 텍스트 그대로 (예: "고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(로얄과)")' },
                        qty: { type: 'integer', description: '박스 수량 (숫자만)' },
                    },
                    required: ['name', 'qty'],
                },
            },
        },
        required: ['partner', 'items'],
    },
};

async function maruSettlementOcr(order, actor) {
    const step = agentStep('order', '마루', '📷 정산관리 이미지 판독 — 발송목록에서 거래처·품목·수량 읽는 중...');
    const maru = (await pool.query(`SELECT * FROM agents WHERE role='chief' AND is_deleted=false LIMIT 1`)).rows[0];
    const run = (await pool.query(
        `INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, FALSE) RETURNING *`,
        [maru ? maru.id : null, JSON.stringify([step])])).rows[0];
    try {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 미설정');
        const m = String(order.image_data).match(/^data:([^;]+);base64,(.+)$/s);
        if (!m) throw new Error('이미지 형식을 인식할 수 없습니다 (base64 data URL 필요)');
        const mime = order.image_mime || m[1] || 'image/png';
        const b64 = m[2];
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const msg = await anthropic.messages.create({
            model: MARU_MODEL, max_tokens: 1500,
            tools: [SETTLE_OCR_TOOL], tool_choice: { type: 'tool', name: 'read_settlement_image' },
            messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
                { type: 'text', text: '이 거래처 발송목록 이미지에서 거래처명과 각 품목의 박스 수량을 정확히 읽어라. 맨 아래 합계 행(총 개수)은 items에 넣지 마라. 품목명은 이미지에 적힌 텍스트를 그대로 옮겨라.' },
            ] }],
        });
        const tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu) throw new Error('이미지에서 품목을 읽지 못했습니다');
        const raw = tu.input;
        // 거래처: 지시문 우선(예: "21일 효돈…") → 이미지 헤더 → 없으면 품목 구성으로 자동 인식(settlementOcrBuildConfirm 내부)
        const partnerHint = normalizePartnerName(order.content) || normalizePartnerName(raw.partner);
        const settleDate = parseSettlementDate(order.content, kstTodayStr()); // 대표 지시 날짜 ("21일" 등) 또는 오늘
        const readItems = (Array.isArray(raw.items) ? raw.items : [])
            .map(x => ({ name: String(x.name || '').trim(), qty: Number(x.qty) || 0 }))
            .filter(x => x.name && x.qty > 0);
        if (!readItems.length) throw new Error('이미지에서 품목을 하나도 읽지 못했습니다 (발송목록 이미지가 맞는지 확인해주세요)');
        await settlementOcrBuildConfirm(order, partnerHint, readItems, run.id, settleDate);
    } catch (err) {
        const em = err?.status ? `Anthropic API 오류 (${err.status}): ${err.message}` : (err?.message || String(err));
        console.error('정산관리 OCR 오류:', em);
        await maruFinishOrder(order.id, '오류', { type: 'error', error: em }, run.id);
        await pool.query(`UPDATE agent_runs SET status='error', finished_at=NOW() WHERE id=$1`, [run.id]).catch(() => {});
    }
}

// 거래처 미확정 질문에 대한 대표 답변("효돈이야") → 보관 품목 + 거래처로 확인표 진행 (AI 재호출 없음)
async function maruTrySettlementPartnerReply(order, actor) {
    const content = String(order.content || '').trim();
    if (!content || content.length > 30) return false;
    const partner = normalizePartnerName(content);
    if (!partner) return false; // 거래처 키워드 없으면 패스 (다른 지시일 수 있음)
    const pend = (await pool.query(
        `SELECT * FROM pending_orders WHERE status='질문' AND is_deleted=false
           AND result->>'type' = 'settlement_ocr_need_partner'
           AND created_at > NOW() - interval '1 hour' AND id != $1
         ORDER BY created_at DESC LIMIT 1`, [order.id])).rows[0];
    if (!pend) return false;
    const readItems = (pend.result && pend.result.read_items) || [];
    if (!readItems.length) return false;
    await settlementOcrBuildConfirm(order, partner, readItems, null, pend.result.date); // 보관 날짜로 확인표 (run 없이)
    await pool.query(`UPDATE pending_orders SET status='응답됨', processed_at=NOW() WHERE id=$1`, [pend.id]);
    return true;
}

const SETTLE_PARTNERS = ['효돈농협', '대성(시온)', '기타거래처']; // 대표 확정: 3개, 거래처끼리 품목 안 겹침
// 한 거래처 기준 품목 매칭 결과 계산 (가격표 정확 대조)
async function settlementCalcForPartner(partner, readItems, dateStr) {
    const priceMap = await buildPriceMapFor(partner, dateStr);
    let total = 0, matched = 0; const rows = []; const unmatched = [];
    for (const it of readItems) {
        const hit = matchSettlementItemExact(it.name, priceMap);
        if (!hit) { unmatched.push(it.name); rows.push({ name: it.name, matched: null, qty: it.qty, price: null, subtotal: null }); }
        else { matched++; const sub = hit.price * it.qty; total += sub; rows.push({ name: it.name, matched: hit.name, qty: it.qty, price: hit.price, subtotal: sub }); }
    }
    const dup = (await pool.query(`SELECT id, amount FROM settlements WHERE partner=$1 AND date::text=$2 ORDER BY id DESC LIMIT 1`, [partner, dateStr])).rows[0];
    // 수동 매칭용 품목 목록 (대표 7/20): 미매칭 품목을 대표가 직접 pricing 상품으로 고를 수 있게 확인표에 첨부
    const catalog = Object.entries(priceMap).map(([name, price]) => ({ name, price: Number(price) || 0 }));
    return { rows, total, matched, unmatched, existing: dup ? { id: dup.id, amount: Number(dup.amount) } : null, catalog };
}
// 확인표 생성 — 3개 거래처 전부 계산(candidates) + 품목 최다 매칭으로 자동 인식. 대표가 드롭다운으로 수정 가능
async function settlementOcrBuildConfirm(order, partnerHint, readItems, runId, settleDate) {
    const dateStr = settleDate || kstTodayStr();
    const boxTotal = readItems.reduce((s, x) => s + x.qty, 0);
    const candidates = {};
    let best = null, bestMatch = -1;
    for (const p of SETTLE_PARTNERS) {
        const c = await settlementCalcForPartner(p, readItems, dateStr);
        candidates[p] = { box_total: boxTotal, ...c };
        if (c.matched > bestMatch) { bestMatch = c.matched; best = p; } // 품목 자동 인식 = 최다 매칭 거래처
    }
    // 거래처 결정: 대표 지시문/이미지 힌트 우선 → 없으면 품목 자동 인식
    const partner = (partnerHint && candidates[partnerHint]) ? partnerHint : best;
    const sel = candidates[partner];
    await maruFinishOrder(order.id, '질문', {
        type: 'settlement_ocr_confirm',
        order_id: order.id, partner, date: dateStr, candidates, box_total: boxTotal,
        auto_detected: !partnerHint, // 품목으로 자동 인식된 경우 표시
        // 하위호환(채팅 "응" 경로): 선택 거래처 결과를 최상위에도
        rows: sel.rows, total: sel.total, unmatched: sel.unmatched, existing: sel.existing,
        question: `${partner} ${dateStr} 정산관리에 ${readItems.length}개 품목(${boxTotal}박스, 합계 ${sel.total.toLocaleString()}원)을 저장할까요?${sel.existing ? `\n⚠️ 이 날짜·거래처 정산이 이미 있습니다 (${sel.existing.amount.toLocaleString()}원) — 덮어씁니다` : ''}`,
        summary: `${partner} 정산관리 입력 확인 (${boxTotal}박스)`,
    }, runId);
    if (runId) {
        await agentRunAppendStep(runId, agentStep('work', '마루', `📋 ${partner}${partnerHint ? '' : ' (품목 자동 인식)'} — ${readItems.length}품목 ${boxTotal}박스, ${sel.total.toLocaleString()}원 (확인 대기)`));
        await pool.query(`UPDATE agent_runs SET status='done', finished_at=NOW(), result=$2 WHERE id=$1`,
            [runId, JSON.stringify({ summary: `정산관리 판독 — ${partner} ${boxTotal}박스`, report: { type: 'settlement_ocr', partner, rows: sel.rows, total: sel.total, unmatched: sel.unmatched } })]);
    }
}

// "응" 답변 → 직전 settlement_ocr_confirm 확정 저장 (settlements INSERT — 정산관리 화면과 동일 경로)
async function maruTrySettlementOcrConfirm(order, actor) {
    const content = String(order.content || '').trim();
    if (content.length > 12) return false;
    const isYes = MARU_YES_RE.test(content);
    const isNo = MARU_NO_RE.test(content);
    if (!isYes && !isNo) return false;
    const pend = (await pool.query(
        `SELECT * FROM pending_orders WHERE status='질문' AND is_deleted=false
           AND result->>'type' = 'settlement_ocr_confirm'
           AND created_at > NOW() - interval '1 hour' AND id != $1
         ORDER BY created_at DESC LIMIT 1`, [order.id])).rows[0];
    if (!pend) return false;
    const r = pend.result;
    if (isNo) {
        await maruFinishOrder(order.id, '안내', { type: 'route', notice: '정산관리 저장을 취소했습니다 — 필요하면 이미지를 다시 올려주세요' });
        await pool.query(`UPDATE pending_orders SET status='취소' WHERE id=$1`, [pend.id]);
        return true;
    }
    // 저장 실행 — 정산관리 화면과 동일 경로. 품목명은 가격표 정식명(matched) 우선 (집계 일치)
    const items = (r.rows || []).map(x => ({ name: x.matched || x.name, qty: x.qty, price: x.price || 0, subtotal: x.subtotal || 0 }));
    // 중복 방지 (대표 7/20): 같은 날짜·거래처 기존 정산이 있으면 삭제 후 저장 = 덮어쓰기 (매출 2배 집계 예방)
    const delDup = await pool.query(`DELETE FROM settlements WHERE partner = $1 AND date::text = $2 RETURNING id`, [r.partner, r.date]);
    const overwrote = delDup.rows.length;
    await pool.query(
        `INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1, $2, $3, $4, TRUE)`,
        [r.date, r.partner, r.total || 0, JSON.stringify(items)]);
    await writeAudit({
        action: overwrote ? 'update' : 'create', targetType: 'settlement', targetId: null,
        changes: { after: { via: 'image_ocr', partner: r.partner, date: r.date, box_total: r.box_total, amount: r.total, overwrote } },
        source: 'agent_office', actor,
    });
    await pool.query(`UPDATE pending_orders SET status='응답됨', processed_at=NOW() WHERE id=$1`, [pend.id]);
    await maruFinishOrder(order.id, '완료', {
        type: 'settlement_saved_ocr', partner: r.partner, date: r.date, total: r.total, box_total: r.box_total, overwrote,
        notice: `${r.partner} ${r.date} 정산관리에 ${overwrote ? '덮어쓰기' : '저장'} 완료 (${r.box_total}박스, ${(r.total || 0).toLocaleString()}원) — 정산관리 화면에서 확인·수정 가능`,
    });
    notifyTelegram(`✅ 정산관리 입력 — ${r.partner} ${r.date} (${r.box_total}박스)${overwrote ? ' [덮어씀]' : ''}`);
    return true;
}

// 마루 처리 엔진: 지시 1건 분석 → 배정 → (연결된 요원이면) 실제 실행
async function processOrderWithMaru(order, actor, opts = {}) {
    try {
        await pool.query(`UPDATE pending_orders SET status='처리중' WHERE id=$1`, [order.id]);
        // 거래처 미확정 질문에 "효돈이야" 답변 → 보관 품목으로 확인표 (AI 호출 없음)
        if (await maruTrySettlementPartnerReply(order, actor)) return;
        // 정산관리 이미지 저장 확인 대기 중이면 "응" 답변을 여기서 처리 (AI 호출 없음 — settlements 저장)
        if (await maruTrySettlementOcrConfirm(order, actor)) return;
        // 일정 등록 확인 대기 중이면 "응/등록해" 답변을 여기서 처리 (AI 호출 없음)
        if (await maruTryScheduleConfirm(order, actor)) return;
        // 정산관리 이미지 첨부 → 정산 OCR 확인표 (저장 안 함, 대표 승인 후 저장).
        // 🔴 대표 7/22: 정산·등록·올려 등 '정산 등록 의도'가 있을 때만 OCR로 간다 (매일 쓰는 핵심 경로 보존).
        //    그 외 이미지("이 이미지 무슨 뜻이야?" 등)는 아래 maruDecide에 이미지를 넘겨 마루가 직접 보고 답/배정한다.
        if (order.image_data && /정산|등록|올려|발송\s*목록|입력/.test(order.content || '')) {
            await maruSettlementOcr(order, actor); return;
        }
        // 지시 #6-1: 미응답 clarify 질문이 있으면 새 입력을 답변으로 보고 [원 지시+질문+답변] 결합 재라우팅
        // — 답변이 독립 지시로 취급되며 맥락이 소실되던 순환 사고(#45~#56) 수정
        let effContent = order.content;
        let combinedFrom = null;
        let followUpFrom = null;
        let openThreads = []; // 확인 안 된(열린) 요원 답변들 — 멀티면 여러 개
        const pqRow = (await pool.query(
            `SELECT id, content, result FROM pending_orders
             WHERE status='질문' AND is_deleted=false AND id != $1
               AND created_at > NOW() - interval '1 hour' AND result->>'type' = 'clarify'
             ORDER BY id DESC LIMIT 1`, [order.id])).rows[0];
        if (pqRow) {
            combinedFrom = pqRow;
            // 🔴 대표 7/22: 연속 되묻기(되묻기→"네"→또 되묻기)에서 뿌리 원지시가 소실되던 버그 수정.
            //   pqRow.content가 직전 답변("네")이면 원래 요청이 사라져 마루가 "맥락 불명확"으로 되묻던 것.
            //   되묻기 result에 실어둔 root_content(뿌리 원지시)를 우선 사용한다 (없으면 기존대로 content).
            const rootContent = (pqRow.result && pqRow.result.root_content) || pqRow.content;
            effContent = buildCombinedOrderText(rootContent, (pqRow.result && pqRow.result.question) || '', order.content);
        } else if (!opts.noMulti) {
            // 맥락 이어가기 (대표 지적 7/21): 직전에 요원이 답을 냈고 대표가 아직 '확인'(보고 보관 = run archive) 안 한
            //   '열린' 상태면, 새 메시지를 그 답변의 후속으로 보고 이어서 배정한다.
            //   확인(archive)된 상태면 이 블록을 건너뛰어 마루가 새로 판단 (대표 정의: 확인=처음부터 / 미확인=이어가기).
            //   멀티(글샘 문구·미소 이미지 등 동시 배정)면 열린 스레드가 여러 개 → 마루가 후속 내용을 보고 맞는 요원을 고른다.
            //   서브태스크(noMulti) 실행에는 적용하지 않는다 (내부 순차 처리 오염 방지).
            const openRows = (await pool.query(
                `SELECT o.id, o.content, o.result, r.result AS run_result
                 FROM pending_orders o JOIN agent_runs r ON o.run_id = r.id
                 WHERE o.is_deleted=false AND o.status='완료' AND o.id != $1
                   AND o.created_at > NOW() - interval '1 hour'
                   AND r.is_deleted = false AND r.status='done'
                   AND o.result->>'type' = 'route'
                 ORDER BY o.id DESC LIMIT 8`, [order.id])).rows;
            const seenAgent = new Set();
            for (const row of openRows) {
                const nm = row.result && row.result.assignee;
                if (!nm || seenAgent.has(nm)) continue; // 같은 요원은 최신 1건만
                seenAgent.add(nm);
                const rr = row.run_result || {};
                const prevAns = (rr.report && (rr.report.conclusion || rr.summary)) || rr.summary
                    || (row.result && row.result.summary) || '(이전 답변)';
                openThreads.push({ order_id: row.id, content: row.content, assignee: nm, prevAns: String(prevAns).slice(0, 300) });
            }
            if (openThreads.length === 1) {
                followUpFrom = openThreads[0];
                effContent = buildFollowUpText(openThreads[0].content, openThreads[0].assignee, openThreads[0].prevAns, order.content);
            } else if (openThreads.length > 1) {
                effContent = buildMultiFollowUpText(openThreads, order.content); // 마루가 맞는 요원 선택 (아래에서 그 요원 스레드로 좁힘)
            }
        }
        // 결합 대상을 제외한 나머지 미응답 질문만 '대체됨' 자동 종결 (지시 #4 동작 유지)
        const superseded = await pool.query(
            pqRow
                ? `UPDATE pending_orders SET status='대체됨', processed_at=NOW()
                   WHERE status='질문' AND is_deleted=false AND id != $1 AND id != $2 RETURNING id`
                : `UPDATE pending_orders SET status='대체됨', processed_at=NOW()
                   WHERE status='질문' AND is_deleted=false AND id != $1 RETURNING id`,
            pqRow ? [order.id, pqRow.id] : [order.id]);
        for (const row of superseded.rows) {
            await writeAudit({
                action: 'update', targetType: 'pending_order', targetId: row.id,
                changes: { after: { status: '대체됨', superseded_by_order: order.id } },
                source: 'agent_office', actor,
            });
        }
        // 판단 호출 (오염 감지·정화·조건부 재시도 포함) — 결합 텍스트 기준 (지시 #6-1)
        // 🔴 대표 7/22 버그수정: 프론트가 보낸 image_data는 'data:image/png;base64,...' 전체 data URL.
        //    Anthropic 비전 API는 순수 base64만 받으므로 접두사를 벗겨서 넘긴다 (정산 OCR 경로와 동일 처리).
        //    이 처리가 없어 이미지+질문 지시가 'invalid base64'로 오류나던 것.
        let maruImage = null;
        if (order.image_data) {
            const mm = String(order.image_data).match(/^data:([^;]+);base64,(.+)$/s);
            maruImage = mm
                ? { data: mm[2], mime: order.image_mime || mm[1] }
                : { data: order.image_data, mime: order.image_mime }; // 접두사 없이 순수 base64로 온 경우 그대로
        }
        let { d, polluted, pollution } = await maruDecide(effContent, maruImage); // 대표 7/22: 정산 아닌 이미지는 마루가 직접 봄
        if (polluted) console.warn(`마루 응답 오염 감지 (지시 #${order.id}):`, JSON.stringify(pollution));
        // 지시 #6-2: 기간+재무 항목이 모두 명시된 지시에 빈 되묻기 금지 — 서버가 세미 배정 강제
        const forced = maruForceFinanceRoute(d, effContent, kstTodayStr());
        if (forced) {
            console.log(`재무 즉답 보정 (지시 #${order.id}): clarify → route/세미 period=${forced.period || forced.target_date}`);
            d = forced;
        }
        // 멀티 이어가기 (대표 7/21): 마루가 고른 요원이 열린 스레드 중 하나면, 그 요원 '자기 스레드'로 맥락을 좁혀
        //   해당 요원의 이전 답변을 참조로 넘긴다 (route든 feedback이든 아래 경로에서 그 요원이 자기 결과물 기준으로 이어 작업).
        if (openThreads.length > 1 && d.assignee) {
            const matched = openThreads.find(t => t.assignee === d.assignee);
            if (matched) {
                followUpFrom = matched;
                effContent = buildFollowUpText(matched.content, matched.assignee, matched.prevAns, order.content);
                console.log(`멀티 이어가기 매칭 (지시 #${order.id}): 후속 → ${matched.assignee} (열린 ${openThreads.length}건 중)`);
            }
        }
        // 결합 재라우팅에 사용된 원 질문은 '응답됨'으로 종결 (soft-close, 전체 보기 조회 가능)
        if (combinedFrom) {
            await pool.query(`UPDATE pending_orders SET status='응답됨', processed_at=NOW() WHERE id=$1 AND status='질문'`, [combinedFrom.id]);
            await writeAudit({
                action: 'update', targetType: 'pending_order', targetId: combinedFrom.id,
                changes: { after: { status: '응답됨', combined_into_order: order.id } },
                source: 'agent_office', actor,
            });
        }
        await writeAudit({
            action: 'maru_route', targetType: 'pending_order', targetId: order.id,
            changes: { after: { decision: d, model: MARU_MODEL, polluted_retry: polluted, pollution_sample: pollution, combined_from: combinedFrom ? combinedFrom.id : null, follow_up_from: followUpFrom ? followUpFrom.id : null, forced_finance_route: !!forced } },
            source: 'agent_office', actor,
        });

        // ⓪-복원: 모델이 multi 선언 후 subtasks를 비워 내는 습성 대응 (order #73 실측 — 기안 deliverables와 동일 패턴)
        //    직전 clarify 질문의 ①②③ 항목 목록에서 서버가 subtasks를 복원한다 (0원 코드 — 원지시 전문을 조건으로 첨부)
        if (d.action === 'multi' && !opts.noMulti && (d.subtasks || []).length < 2 && combinedFrom) {
            const q = String((combinedFrom.result && combinedFrom.result.question) || '');
            const chunks = q.split(/(?=[①②③④⑤])/).filter(c => /^[①②③④⑤]/.test(c));
            const items = chunks.map((c, ci) => {
                let t = c.replace(/^[①②③④⑤]\s*/, '');
                if (ci === chunks.length - 1) {
                    const cut = t.search(/(모두\s*진행|전부\s*진행|맞나요|진행할까요|답해주세요|괜찮을까요)/);
                    if (cut > 0) t = t.slice(0, cut);
                    t = t.replace(/[—\-\s]*[두세네]?\s*(다섯)?\s*건?\s*$/, ''); // "— 세 건" 꼬리 제거
                }
                return t.replace(/[\s—>-]+$/g, '').trim();
            }).filter(Boolean);
            if (items.length >= 2) {
                d.subtasks = items.map(t => `${t} [상세 조건은 원지시 참조: ${combinedFrom.content}]`).slice(0, 5);
                console.log(`멀티 subtasks 서버 복원 (지시 #${order.id}): 질문 항목 ${items.length}건`);
            }
        }
        // 멀티 서브태스크(noMulti)가 또 multi로 재판단되는 문제 (대표 7/20): subtask content에 [상세 조건: 원지시]가
        // 붙어 마루가 원지시의 여러 작업을 보고 재분해 시도 → subtasks 비면 clarify로 빠져 그 작업 유실(톡톡문구 실종).
        // 서브태스크는 이미 요원이 정해져 있으므로, multi로 나와도 assignee route로 강제 (재분해·재질문 차단).
        if (d.action === 'multi' && opts.noMulti) {
            if (String(d.assignee || '').trim()) { d.action = 'route'; }
        }
        // ⓪ 멀티 지시 분산 실행 (대표 실사용 지적): 확인받은 N건을 각각 독립 지시로 등록해 순차 실행
        //    대표 7/20: 같은 요원(글샘 톡톡+문자)에 동시 배정하면 "이미 실행 중"으로 하나가 유실됨 → 순차로 처리
        //    (각 서브태스크의 요원 실행 완료까지 기다린 후 다음 — multiSeq→awaitExec). 각자 끝나는 순서대로 보고
        if (d.action === 'multi' && !opts.noMulti && (d.subtasks || []).length >= 2) {
            await maruFinishOrder(order.id, '완료', {
                type: 'multi_dispatch', summary: `멀티 지시 분산 — ${d.subtasks.length}건 순차 배정`,
                reason: d.reason, subtasks: d.subtasks,
            });
            // 서브태스크를 백그라운드에서 순차 실행 (원 order 응답은 즉시 반환)
            (async () => {
                for (const [idx, sub] of d.subtasks.entries()) {
                    try {
                        const subRow = (await pool.query(
                            `INSERT INTO pending_orders (content, status) VALUES ($1, '대기') RETURNING *`,
                            [`${sub} [멀티 ${idx + 1}/${d.subtasks.length} — 원지시 #${order.id}]`])).rows[0];
                        await writeAudit({
                            action: 'multi_dispatch', targetType: 'pending_order', targetId: subRow.id,
                            changes: { after: { parent_order: order.id, seq: idx + 1, of: d.subtasks.length } },
                            source: 'agent_office', actor,
                        });
                        await processOrderWithMaru(subRow, actor, { noMulti: true, multiSeq: true }); // 요원 완료까지 대기
                    } catch (e) { console.error(`멀티 서브태스크 ${idx + 1} 실패:`, e?.message); }
                }
            })();
            return;
        }
        // multi가 부적합하게 나온 경우 (1건뿐·재귀) — 첫 subtask를 본문 삼아 단일 재판단 없이 정직 질문으로 전환
        if (d.action === 'multi') {
            await maruFinishOrder(order.id, '질문', {
                type: 'clarify', question: `멀티 분산 판정이 부적합했습니다 (건수 ${(d.subtasks || []).length}). 원하시는 작업을 한 건씩 나눠 지시해주세요`, summary: d.task_summary, reason: d.reason,
            });
            return;
        }

        // 대표 7/22: 마루 직접 답변 (개념·용어 설명·이미지 뜻 등 일반 질문) — 배정 없이 즉답
        if (d.action === 'answer') {
            await maruFinishOrder(order.id, '완료', {
                type: 'answer',
                text: String(d.answer_text || '').trim() || '답변을 생성하지 못했습니다',
                summary: d.task_summary || '마루 직접 답변', reason: d.reason,
            });
            return;
        }
        // ① 애매한 지시 → 되묻기 (추측 실행 금지)
        if (d.action === 'clarify') {
            // 대표 7/22: 선택지가 2개 이상이면 버튼으로 고르게 (네/아니오 안내 생략). 자유 입력도 가능.
            const choices = (Array.isArray(d.clarify_choices) ? d.clarify_choices : [])
                .map(c => String(c || '').trim()).filter(Boolean).slice(0, 6);
            const q = String(d.clarify_question || '');
            const hasGuide = /네|아니오|답해/.test(q.slice(-30));
            await maruFinishOrder(order.id, '질문', {
                type: 'clarify',
                question: choices.length ? q : (hasGuide ? q : `${q}\n(네/아니오로 답해주세요 — "네"라고 하시면 위 작업을 전부 진행합니다)`),
                choices,
                summary: d.task_summary, reason: d.reason,
                // 🔴 대표 7/22: 되묻기 체인의 '뿌리 원지시'를 실어둔다 — 다음 답변("네") 결합 시 원래 요청 유지.
                //   이 되묻기가 이전 되묻기의 답변이면 그 뿌리를 그대로 승계, 아니면 이번 지시가 뿌리.
                root_content: combinedFrom
                    ? ((combinedFrom.result && combinedFrom.result.root_content) || combinedFrom.content)
                    : order.content,
            });
            return;
        }

        // ①-2 기존 결과물에 대한 피드백 → 해당 요원 최근 실행에 연결 저장 + 교훈 추출
        if (d.action === 'feedback') {
            const targetQ = await pool.query(
                `SELECT * FROM agents WHERE name = $1 AND is_deleted = false LIMIT 1`, [d.assignee]);
            const target = targetQ.rows[0];
            if (!target) {
                await maruFinishOrder(order.id, '질문', {
                    type: 'clarify', question: '어느 요원의 결과물에 대한 피드백인가요? (글샘/미소/세미 등 요원 이름을 함께 말씀해주세요)',
                    summary: d.task_summary, reason: d.reason,
                });
                return;
            }
            const lastRun = await pool.query(
                `SELECT id, result FROM agent_runs WHERE agent_id = $1 AND status = 'done' AND is_deleted = false AND is_test = false
                 ORDER BY started_at DESC LIMIT 1`, [target.id]);
            const kindMap = { '칭찬': 'good', '수정': 'edited', '지적': 'bad', '코멘트': 'comment' };
            const fbType = kindMap[d.feedback_kind] || 'comment';
            const original = lastRun.rows[0]?.result ? JSON.stringify(lastRun.rows[0].result) : null;
            const fbRow = (await pool.query(
                `INSERT INTO agent_feedback (agent_id, run_id, feedback_type, original_output, comment)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [target.id, lastRun.rows[0]?.id || null, fbType, original, order.content])).rows[0];
            await writeAudit({
                action: 'create', targetType: 'agent_feedback', targetId: fbRow.id,
                changes: { after: { via: 'maru', target: target.name, feedback_type: fbType } },
                source: 'agent_office', actor,
            });
            if (fbType !== 'good') extractLessonFromFeedback(fbRow, actor); // 비동기 — 교훈 후보 추출
            // 대표가 수정·지적 피드백을 주면 live 요원이 그 피드백을 반영해 재작업/재자문 (문서화된 '수정 시 재작업' 경로).
            // 창작 요원(글샘·미소, 대표 7/21): "다시 써줘/다시 만들어줘/수정해서/다른 안" 같은 명시적 재작업 요청이면 새 안 1라운드 재생성
            //   (문구·이미지 안 3개 → 피드백 반영해 한 번 더 생성. 단순 칭찬은 재작업 안 함 — 무한 자동 재작성이 아니라 대표 요청 시마다 1회).
            // 자문·조회 요원(지율·세미·한수·미래)은 지적·코멘트에도 재답변(정확성 우선).
            const fbRunner = loadAgentRunner(target.name);
            const creativeAgent = ['글샘', '미소'].includes(target.name);
            const isRework = /다시|재작성|새로|다른\s*안|한\s*번\s*더|바꿔|고쳐|수정|보완|만들|그려|제작|생성|작성/.test(order.content);
            const redoTrigger = creativeAgent ? (fbType === 'edited' || isRework) : (fbType !== 'good');
            if (redoTrigger && fbRunner.live && target.is_active) {
                const prevConcl = lastRun.rows[0]?.result?.report?.conclusion
                    || lastRun.rows[0]?.result?.summary || '';
                const redoVerb = creativeAgent ? '대표 피드백을 반영해 새 안을 한 번 더(1라운드) 만들어라' : '대표 지적을 반영해 처음부터 다시 정확히 계산·작성하라';
                const redoContent = `${effContent}\n\n[재작업 요청 — 대표 피드백 반영] 직전 결과: "${String(prevConcl).slice(0, 200)}". ${redoVerb}. (창작이면 결론 수치가 아니라 새 안 자체를 만들고, 자문이면 결론 수치는 계산값과 일치시킬 것)`;
                const redoRoute = {
                    team: target.team, assignee: target.name,
                    task_summary: `${target.name} 재작업 (대표 피드백 반영)`, reason: '대표 수정·지적·재작업 요청 반영',
                };
                await dispatchLiveAgent(order, redoRoute, {}, actor, null, redoContent);
                return;
            }
            await maruFinishOrder(order.id, '피드백', {
                type: 'feedback', target: target.name, kind: d.feedback_kind || '코멘트',
                feedback_id: fbRow.id, summary: d.task_summary, reason: d.reason,
            });
            return;
        }

        // ①-3 일정 분야 → 마루 직접 처리 (조회 즉답 / 등록 확인 1회 / 삭제 불가) — 결합 텍스트 전달 (지시 #6)
        if (d.action === 'schedule') {
            // 멀티 서브태스크(대표가 "네"로 전체 승인)면 일정 재확인 없이 바로 등록
            await maruHandleSchedule(order, d, actor, effContent, { autoRegister: !!opts.multiSeq });
            return;
        }

        // ①-4 정산현황 입력 → 마루 직접 처리 (파싱 → 확인 1회 → 부분 저장)
        if (d.action === 'settlement_input') {
            // 서버 가드 (7/20 실사고 — 효돈 수량 19를 "19원"으로 저장): 정산관리(품목·수량) 지시는 차단.
            // 근거: '정산관리' 단어, 또는 금액 단위(원/만/억) 없이 규격·수량 나열이면 자금 집계 입력이 아니다
            const srcAll = effContent;
            const looksLikeItemQty = /정산\s*관리/.test(srcAll)
                || (!/[0-9][0-9,.]*\s*(원|만|억)/.test(srcAll) && /(kg|로얄과|소과|중대과|로얄|가정용|선물용)/.test(srcAll));
            if (looksLikeItemQty) {
                await maruFinishOrder(order.id, '안내', {
                    type: 'route', notice: '정산관리 품목·수량 입력은 아직 마루가 저장할 수 없습니다 — 정산관리 화면에서 직접 입력해주세요. (정산현황 자금 집계 입력이 필요하시면 "정산현황 입력, 효돈 49만원"처럼 금액으로 말씀해주세요)',
                    reason: '정산관리(품목·수량) ≠ 정산현황(자금 금액) — 오저장 방지 서버 가드 (7/20 사고 박제)',
                    summary: d.task_summary,
                });
                return;
            }
            await maruHandleSettlementInput(order, d, actor);
            return;
        }

        // ② 배정 — 조건 확정 (지시 원문 서버 파싱이 모델 추출값에 우선 — 1단계 1-1)
        const today = kstTodayStr();
        const conditions = {
            item_keyword: String(d.item_keyword || '').trim(),
            period: String(d.period || '').trim(),
            target_date: String(d.target_date || '').trim(),
        };
        if (d.assignee === '세미') {
            // 특정일: 하루 어긋남 방지 (기존 핫픽스 유지) — 결합 텍스트 기준 (지시 #6)
            if (conditions.target_date || hasExplicitDay(effContent)) {
                const explicit = parseExplicitDate(effContent, today);
                if (explicit && explicit !== conditions.target_date) {
                    console.log(`날짜 보정: 마루 '${conditions.target_date || '(없음)'}' → 원문 파싱 '${explicit}'`);
                    conditions.target_date = explicit;
                }
            }
            // 월 단위: 'N월/N월달/지난달/이번달/YYYY년 N월' — 2025-04 오해석 사고 재발 방지
            const em = parseExplicitMonth(effContent, today);
            if (em) {
                if (conditions.target_date && !hasExplicitDay(effContent)) {
                    console.log(`날짜 보정: 특정일 '${conditions.target_date}' 무효화 — 원문은 월 단위 (${em})`);
                    conditions.target_date = '';
                }
                if (em !== conditions.period) {
                    console.log(`기간 보정: 마루 '${conditions.period || '(없음)'}' → 원문 파싱 '${em}'`);
                    conditions.period = em;
                }
            }
            // 지시 #7: '이번주/금주' 원문 확정 — 지시 기간 = 산출 기간 (문구·파일 기준 통일)
            const wk = maruWeekPeriodOverride(conditions.period, effContent);
            if (wk !== conditions.period) {
                console.log(`기간 보정: 마루 '${conditions.period || '(없음)'}' → 'this_week' (원문 이번주)`);
                conditions.period = wk;
                if (conditions.target_date && !hasExplicitDay(effContent)) conditions.target_date = '';
            }
            // 4.5단계 ⑤: 비교 의도 — 비교 키워드 + 기간 2개를 서버가 확정 (모델 재량 없음)
            // 🔴 대표 7/21: 조회 '종류'(비교·순위)는 이번 새 질문(order.content)에서만 판단한다.
            //    맥락 이어가기(effContent)로 옛 질문의 '기여/순위' 단어가 새 질문에 붙어 세미가 같은 순위표를 반복하던 버그 수정.
            //    (비-이어가기 단일 질문은 effContent===order.content라 동작 동일 — 회귀 없음)
            const typeSrc = order.content || effContent;
            if (/비교|대비|vs|차이/i.test(typeSrc)) {
                const cp = parseComparePeriods(typeSrc, today);
                if (cp) {
                    conditions.compare = cp;
                    console.log(`비교 조회 확정: ${cp.a} vs ${cp.b}`);
                }
            }
            // 4.5단계 ⑥: 품목 순위 의도 — 순위/기여/잘 팔린/TOP N (비교와 중복 시 비교 우선). 새 질문 기준(typeSrc)
            if (!conditions.compare && /순위|기여|잘\s*팔(린|리)|많이\s*(팔(린|려|리)|판매|나(간|가))|가장\s*많이|베스트|best|1위|일위|톱\s*\d*|top\s*\d*/i.test(typeSrc) && /품목|상품|뭐가|무엇|무엇|어떤|뭘|게\s*뭐|것\s*뭐/.test(typeSrc)) {
                const nm = typeSrc.match(/(?:톱|top)\s*(\d+)/i) || typeSrc.match(/(\d+)\s*위까지/);
                conditions.rank = { all: /전부|전체\s*품목|모든\s*품목/.test(typeSrc), topN: nm ? Number(nm[1]) : null };
                console.log(`품목 순위 확정: ${conditions.rank.all ? '전체' : 'TOP ' + (conditions.rank.topN || 10)}`);
            }
            // 🔴 대표 7/22: 품목별 '결제가(단가) 이력' 조회 — 매출액이 아니라 그 시기 단가(품목별 금액 화면 데이터).
            //   결제가는 주마다 변동 → 거래처별·주별 단가 그리드로 조회 (내년에 작년 동기 단가 비교용).
            //   판단: '결제가/단가' 명시 OR (품목 + 주마다/주차별) 이고, '매출/판매액/팔린'이 아닐 때. 새 질문(typeSrc) 기준.
            if (!conditions.compare && !conditions.rank) {
                const priceWord = /결제가|단가/.test(typeSrc);
                const weeklyItem = /품목/.test(typeSrc) && /주\s*마다|주차\s*별|주\s*별|매주|주간\s*별/.test(typeSrc);
                const salesWord = /매출|판매액|팔(린|려|았)|얼마\s*(나\s*)?팔|매상/.test(typeSrc);
                if ((priceWord || weeklyItem) && !salesWord) {
                    conditions.price_history = true;
                    console.log(`품목 결제가(단가) 이력 확정: 주간 단가 그리드 (매출 아님)`);
                }
            }
            // 지시 #15: 주차×거래처 지정형 — 주차·거래처 모두 서버가 확정 (모델 재량 없음).
            // 거래처 무지정 주간 조회("이번주 정산 얼마야")는 기존 동작 유지 — 둘 다 있을 때만 발동
            // (결제가 이력이면 이 주차×거래처 매출 경로로 새지 않게 제외)
            if (!conditions.compare && !conditions.price_history) {
                const pwSpec = parseWeekSpec(effContent, today);
                const pwPartner = pwSpec ? parsePartnerKeyword(effContent) : null;
                if (pwSpec && pwPartner) {
                    conditions.partner_week = { partner: pwPartner, from: pwSpec.from, to: pwSpec.to, label: pwSpec.label };
                    conditions.period = '';      // 주차 범위가 우선 — 월/이번주 보정과의 혼선 방지
                    conditions.target_date = '';
                    console.log(`주차×거래처 확정: ${pwSpec.label} × ${pwPartner}`);
                }
            }
            // 🔴 대표 7/22: 거래처만 지정한 월/기간 매출("효돈 4월 매출")도 그 거래처만 필터.
            //   주차 없이 거래처만 있을 때 발동 (주차×거래처는 위에서 처리). 필터는 새 질문(order.content) 기준 — 이어가기 결합의 옛 거래처 오염 방지(v5.9.24 교훈).
            if (!conditions.compare && !conditions.partner_week) {
                const p = parsePartnerKeyword(order.content || effContent);
                // CJ(택배)는 거래처 매출 필터 대상 아님 — "택배비 얼마야"가 CJ 0건으로 빠지는 것 방지. 정산 거래처(효돈·대성·기타)만 필터.
                if (p && p !== 'CJ대한통운') { conditions.partner = p; console.log(`거래처 필터 확정: ${p} · ${conditions.period || conditions.target_date || '이번달'}`); }
            }
            // 존재하지 않는 날짜 가드 (예: 4월 31일) — 억지 조회·DB 오류 대신 정직 안내
            if (conditions.target_date && /^\d{4}-\d{2}-\d{2}$/.test(conditions.target_date) && !isValidDateStr(conditions.target_date)) {
                const gm = Number(conditions.target_date.slice(5, 7));
                const gy = Number(conditions.target_date.slice(0, 4));
                const lastDay = new Date(Date.UTC(gy, gm, 0)).getUTCDate();
                await maruFinishOrder(order.id, '안내', {
                    type: 'invalid_date',
                    notice: `${gm}월은 ${lastDay}일까지입니다 — 『${conditions.target_date}』는 존재하지 않는 날짜예요. 날짜를 확인해서 다시 지시해주세요`,
                });
                return;
            }
            // 1-2: 오래된 기간(3개월 이상 과거 또는 작년 이전) 조회는 복창 확인 후 실행 (비교 조회도 동일 적용)
            // 🔴 대표 7/22: 단, 대표가 월/날짜를 명확히 말했으면("4월", "4월 14일") 확인 없이 바로 조회 —
            //   확인 복창은 '기간 미명시·기본값'으로 빠진 오래된 조회의 오해석 방지용이지, 명시한 월엔 오해석이 없어 마찰만 됨.
            const explicitPeriodStated = !!(parseExplicitMonth(order.content || effContent, today) || hasExplicitDay(order.content || effContent));
            let confirmNeeded = false, confirmLabel = '';
            if (conditions.partner_week) {
                confirmNeeded = needsQueryConfirm({ from: conditions.partner_week.from }, today);
                confirmLabel = `『${conditions.partner_week.label} ${conditions.partner_week.partner}』 조회`;
            } else if (conditions.compare) {
                const ra = periodRangeOf({ period: conditions.compare.a }, today);
                const rb = periodRangeOf({ period: conditions.compare.b }, today);
                confirmNeeded = needsQueryConfirm(ra, today) || needsQueryConfirm(rb, today);
                confirmLabel = `『${ra ? ra.label : conditions.compare.a} vs ${rb ? rb.label : conditions.compare.b} 비교』`;
            } else {
                const range = periodRangeOf(conditions, today);
                confirmNeeded = needsQueryConfirm(range, today);
                if (range) confirmLabel = `『${range.label}(${range.from}~${range.to})』 조회`;
            }
            if (explicitPeriodStated) confirmNeeded = false; // 명시한 월/날짜는 확인 없이 바로 조회 (대표 7/22)
            if (confirmNeeded) {
                await maruFinishOrder(order.id, '질문', {
                    type: 'query_confirm',
                    route: { team: d.team, assignee: d.assignee, task_summary: d.task_summary, reason: d.reason },
                    conditions,
                    question: `${confirmLabel}로 진행할까요? ("응"으로 답해주세요)`,
                });
                return;
            }
        }
        await dispatchLiveAgent(order,
            { team: d.team, assignee: d.assignee, task_summary: d.task_summary, reason: d.reason },
            conditions, actor, null, effContent, { awaitExec: !!opts.multiSeq }); // 멀티 서브면 실행 완료까지 대기
    } catch (err) {
        // 정직한 오류 표시 — 허위 응답 금지. Anthropic API 오류는 상태코드와 함께 그대로 기록.
        const errMsg = err?.status
            ? `Anthropic API 오류 (${err.status}): ${err.message}`
            : (err?.message || String(err));
        console.error('마루 라우팅 오류:', errMsg);
        await pool.query(
            `UPDATE pending_orders SET status='오류', result=$2, processed_at=NOW() WHERE id=$1`,
            [order.id, JSON.stringify({ type: 'error', error: errMsg })]).catch(() => {});
    }
}

// 지시 접수 (상시 입력바) — 저장 즉시 마루가 비동기 처리
app.post('/api/agent-office/orders', authMiddleware, adminOnly, async (req, res) => {
    try {
        const content = String(req.body?.content || '').trim();
        // 정산관리 이미지 첨부 (대표 7/20): 이미지가 있으면 content는 비어도 허용 (기본 지시문 대체)
        const imageData = typeof req.body?.image_data === 'string' ? req.body.image_data : '';
        const imageMime = String(req.body?.image_mime || '').slice(0, 40);
        if (!content && !imageData) throw { status: 400, message: '지시 내용을 입력해주세요' };
        if (content.length > 500) throw { status: 400, message: '지시는 500자 이내로 입력해주세요' };
        if (imageData && imageData.length > 14_000_000) throw { status: 400, message: '이미지가 너무 큽니다 (10MB 이내로 올려주세요)' };
        const effText = content || (imageData ? '[이미지 첨부] 오늘 정산관리에 올려줘' : '');
        const row = (await pool.query(
            `INSERT INTO pending_orders (content, image_data, image_mime) VALUES ($1, $2, $3) RETURNING *`,
            [effText, imageData || null, imageData ? imageMime : null])).rows[0];
        await writeAudit({
            action: 'create', targetType: 'pending_order', targetId: row.id,
            changes: { after: { content: effText, status: row.status, has_image: !!imageData } }, // 이미지 원문은 audit 미기록 (용량)
            source: 'agent_office', actor: adminActor(req),
        });
        processOrderWithMaru(row, adminActor(req)); // 비동기 — 응답은 즉시, 결과는 폴링
        res.json({ message: '지시가 접수되었습니다 — 마루가 분석 중입니다', order: row });
    } catch (err) { handleAdminErr(res, err); }
});

// 지시 #4-1: 미응답 질문 수동 종결 — soft-close ('질문종결' 상태, 삭제 아님·audit 기록)
app.post('/api/agent-office/orders/:id/close', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE pending_orders SET status='질문종결', processed_at=NOW()
             WHERE id=$1 AND status='질문' AND is_deleted=false RETURNING id`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 400, message: '질문 상태인 지시만 종결할 수 있습니다' };
        await writeAudit({
            action: 'update', targetType: 'pending_order', targetId: r.rows[0].id,
            changes: { after: { status: '질문종결(미응답)' } },
            source: 'agent_office', actor: adminActor(req),
        });
        res.json({ message: '질문을 종결했습니다 (전체 보기에서 계속 조회 가능)' });
    } catch (err) { handleAdminErr(res, err); }
});

// 쌓인 지시 재처리 (대기/오류 상태만 — 마루 상세 패널의 처리 버튼)
app.post('/api/agent-office/orders/:id/process', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT * FROM pending_orders WHERE id = $1 AND is_deleted = false`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '지시를 찾을 수 없습니다' };
        const order = r.rows[0];
        if (!['대기', '오류'].includes(order.status)) {
            throw { status: 400, message: `'${order.status}' 상태의 지시는 재처리할 수 없습니다 (대기/오류만 가능)` };
        }
        processOrderWithMaru(order, adminActor(req)); // 비동기
        res.json({ message: '마루가 처리를 시작했습니다', order: { ...order, status: '처리중' } });
    } catch (err) { handleAdminErr(res, err); }
});

// 지시 1건 상태 조회 (프론트 폴링용)
app.get('/api/agent-office/orders/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, content, status, result, run_id, created_at, processed_at
             FROM pending_orders WHERE id = $1 AND is_deleted = false`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '지시를 찾을 수 없습니다' };
        res.json({ order: r.rows[0] });
    } catch (err) { handleAdminErr(res, err); }
});

// 정산관리 확인표 → 대표가 선택한 거래처로 저장 (대표 7/20: 드롭다운 수정 반영). 중복은 덮어쓰기
app.post('/api/agent-office/settlement-ocr-save', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { order_id, partner, date, rows: editedRows } = req.body || {};
        if (!order_id || !partner || !date) throw { status: 400, message: 'order_id·partner·date가 필요합니다' };
        const ord = (await pool.query(`SELECT result FROM pending_orders WHERE id=$1 AND is_deleted=false`, [order_id])).rows[0];
        if (!ord || !ord.result || ord.result.type !== 'settlement_ocr_confirm') throw { status: 404, message: '확인표를 찾을 수 없습니다 (이미 처리됐거나 만료)' };
        const cand = ord.result.candidates && ord.result.candidates[partner];
        if (!cand) throw { status: 400, message: `거래처 '${partner}' 계산 결과가 없습니다` };
        // 대표 7/20: 프론트에서 수동 매칭한 rows가 오면 그걸 우선 (미매칭 품목을 대표가 직접 pricing 상품에 맞춘 결과)
        const srcRows = (Array.isArray(editedRows) && editedRows.length) ? editedRows : (cand.rows || []);
        const items = srcRows.map(x => ({ name: x.matched || x.name, qty: Number(x.qty) || 0, price: Number(x.price) || 0, subtotal: Number(x.subtotal) || (Number(x.price) || 0) * (Number(x.qty) || 0) }));
        const total = items.reduce((s, it) => s + it.subtotal, 0);
        const boxTotal = items.reduce((s, it) => s + it.qty, 0);
        const del = await pool.query(`DELETE FROM settlements WHERE partner=$1 AND date::text=$2 RETURNING id`, [partner, date]);
        await pool.query(`INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1,$2,$3,$4,TRUE)`,
            [date, partner, total, JSON.stringify(items)]);
        await writeAudit({
            action: del.rows.length ? 'update' : 'create', targetType: 'settlement', targetId: null,
            changes: { after: { via: 'image_ocr', partner, date, box_total: boxTotal, amount: total, overwrote: del.rows.length, manual_match: !!(editedRows && editedRows.length) } },
            source: 'agent_office', actor: adminActor(req),
        });
        await pool.query(`UPDATE pending_orders SET status='완료', processed_at=NOW(),
            result = jsonb_set(jsonb_set(result, '{type}', '"settlement_saved_ocr"'), '{saved_partner}', $2) WHERE id=$1`,
            [order_id, JSON.stringify(partner)]);
        notifyTelegram(`✅ 정산관리 입력 — ${partner} ${date} (${boxTotal}박스)${del.rows.length ? ' [덮어씀]' : ''}`);
        res.json({ message: `${partner} ${date} 정산관리에 ${del.rows.length ? '덮어쓰기' : '저장'} 완료 (${boxTotal}박스, ${total.toLocaleString()}원)`, partner, total, overwrote: del.rows.length });
    } catch (err) { handleAdminErr(res, err); }
});

// 오류 지시 확인 종결 (대표 실사용 지적: LIVE에 오류가 계속 남음) — soft-close, 전체 보기에서 조회 가능
app.post('/api/agent-office/orders/:id/ack-error', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE pending_orders SET status='오류확인', processed_at=NOW()
             WHERE id=$1 AND status='오류' AND is_deleted=false RETURNING id`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 400, message: '오류 상태인 지시만 확인 처리할 수 있습니다' };
        await writeAudit({
            action: 'update', targetType: 'pending_order', targetId: r.rows[0].id,
            changes: { after: { status: '오류확인' } },
            source: 'agent_office', actor: adminActor(req),
        });
        res.json({ message: '오류를 확인 처리했습니다 (전체 보기에서 계속 조회 가능)' });
    } catch (err) { handleAdminErr(res, err); }
});

// 접수된 지시 목록 (LIVE 로그 병합 + 마루 패널 처리 큐)
// v5.0 UI: 연결된 실행이 보고서함에서 [✔확인]된 지시는 기본 숨김 (include_hidden=true면 전부 — 삭제 아님, 표시만)
app.get('/api/agent-office/orders', authMiddleware, adminOnly, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 30, 200);
        const showHidden = req.query.include_hidden === 'true';
        const r = await pool.query(
            `SELECT o.id, o.content, o.status, o.result, o.run_id, o.created_at, o.processed_at,
                    COALESCE(r.is_deleted, false) AS run_archived
             FROM pending_orders o
             LEFT JOIN agent_runs r ON o.run_id = r.id
             WHERE o.is_deleted = false
               AND (${showHidden ? 'TRUE' : `
                    o.status IN ('대기', '처리중', '오류', '질문')
                    OR (r.id IS NOT NULL AND r.is_deleted = false)`})
             ORDER BY o.created_at DESC LIMIT ${limit}`);
        res.json({ orders: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});

// 10차: 역량 점검 실행 (명령 한 번 — 결과는 보고서함에 '역량 점검 보고서'로 등록)
// v5.1.1 (지시 #28-2): 역량 점검 시작 공용 서비스 — 관리자 버튼과 MCP 도구(run_capability_test)가 공용
async function svcStartCapabilityTest(actor) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
    if (capTestRunning) throw new Error('역량 점검이 이미 진행 중입니다 — 완료 후 다시 실행해주세요');
    const maru = (await pool.query(`SELECT * FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0];
    if (!maru) throw new Error('마루 에이전트를 찾을 수 없습니다');
    const firstStep = agentStep('order', '마루', '🧪 역량 점검 시작 — 전 요원 자동 테스트 (마루·세미·글샘·미소)');
    const run = (await pool.query(
        `INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, TRUE) RETURNING *`,
        [maru.id, JSON.stringify([firstStep])])).rows[0];
    await pool.query(`UPDATE agents SET status='running' WHERE id = $1`, [maru.id]);
    capTestRunning = true;
    executeCapabilityTest(run, actor)
        .catch(err => {
            console.error('역량 점검 실행 오류:', err.message);
            return pool.query(`UPDATE agent_runs SET status='error', result=$2, finished_at=NOW() WHERE id=$1`,
                [run.id, JSON.stringify({ summary: `오류: ${err.message}` })]);
        })
        .finally(() => {
            capTestRunning = false;
            pool.query(`UPDATE agents SET status='idle' WHERE id = $1 AND status='running'`, [maru.id]).catch(() => {});
        });
    return run;
}
app.post('/api/agent-office/capability-test', authMiddleware, adminOnly, async (req, res) => {
    try {
        const run = await svcStartCapabilityTest(adminActor(req));
        res.json({ message: '역량 점검을 시작했습니다 (약 2~3분 소요 — 완료 시 보고서함에 등록)', run });
    } catch (err) { handleAdminErr(res, { status: /이미 진행 중/.test(err.message) ? 409 : 500, message: err.message }); }
});

// 1-5: 마루 오배정 카운트 위젯 — 감이 아닌 숫자로 (audit_log 기반 주간 집계)
app.get('/api/agent-office/misroute-stats', authMiddleware, adminOnly, async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
        const [orders, retries, cancels, misFb] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS c FROM pending_orders
                        WHERE is_deleted = false AND created_at > NOW() - ($1 || ' days')::interval`, [days]),
            pool.query(`SELECT COUNT(*)::int AS c FROM audit_logs
                        WHERE action = 'maru_route' AND (changes->'after'->>'polluted_retry') = 'true'
                          AND created_at > NOW() - ($1 || ' days')::interval`, [days]),
            pool.query(`SELECT COUNT(*)::int AS c FROM pending_orders
                        WHERE is_deleted = false AND result->>'type' = 'confirm_cancelled'
                          AND processed_at > NOW() - ($1 || ' days')::interval`, [days]),
            pool.query(`SELECT COUNT(*)::int AS c FROM agent_feedback f
                        JOIN agents a ON f.agent_id = a.id
                        WHERE a.role = 'chief' AND f.feedback_type IN ('bad', 'edited')
                          AND f.is_deleted = false AND f.created_at > NOW() - ($1 || ' days')::interval`, [days]),
        ]);
        res.json({
            days,
            orders_total: orders.rows[0].c,          // 기간 내 전체 지시 수 (분모용)
            misroute_feedback: misFb.rows[0].c,      // 오배정 지적: 마루에 대한 👎/✏️ 피드백
            pollution_retries: retries.rows[0].c,    // 오염 감지: 응답에 태그 파편이 섞여 정화된 호출 수 (조건부 재시도 채택 후 재시도와 별개)
            confirm_cancels: cancels.rows[0].c,      // 복창 후 정정: 확인 단계에서 "아니" 취소
        });
    } catch (err) { handleAdminErr(res, err); }
});

// 4단계: 보고서 파일 다운로드 — adminOnly 전용 (무인증 401 / 비관리자 403), DB에서 직접 서빙
app.get('/api/agent-office/files/:id/download', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT filename, data FROM report_files WHERE id = $1 AND is_deleted = false AND purged_at IS NULL`, [req.params.id]);
        if (r.rows.length === 0) throw { status: 404, message: '파일을 찾을 수 없습니다 (90일 경과 정리분은 재생성 가능 — 같은 조회를 다시 지시해주세요)' };
        // 지시 #33·#34: 확장자 기반 MIME (전엔 전 파일 xlsx MIME 고정 → 모바일이 jpg를 엑셀로 인식한 원인).
        // 이미지·영상은 inline(브라우저·OS가 이미지로 표시), ?download=1이면 강제 저장. 문서는 기존 attachment 유지
        const fname = r.rows[0].filename;
        const ext = String(fname.split('.').pop() || '').toLowerCase();
        const MIME = {
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
            webp: 'image/webp', mp4: 'video/mp4', md: 'text/markdown; charset=utf-8',
        };
        const isMedia = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4'].includes(ext);
        const disposition = (isMedia && req.query.download !== '1') ? 'inline' : 'attachment';
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fname)}`);
        res.send(r.rows[0].data);
    } catch (err) { handleAdminErr(res, err); }
});

// 지시 #36: 통합본 아카이브 목록·다운로드 (adminOnly — 대표 전용, 읽기 전용)
const ARCHIVE_DIR = path.join(__dirname, 'docs', 'archive');
app.get('/api/agent-office/archive', authMiddleware, adminOnly, async (req, res) => {
    try {
        const fs = require('fs');
        const files = fs.readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.md') && f !== 'README.md')
            .map(f => {
                const st = fs.statSync(path.join(ARCHIVE_DIR, f));
                return { name: f, size: st.size, mtime: st.mtime };
            })
            .sort((a, b) => b.name.localeCompare(a.name, 'ko'));
        res.json({ count: files.length, files });
    } catch (err) { handleAdminErr(res, err); }
});
app.get('/api/agent-office/archive/:name/download', authMiddleware, adminOnly, async (req, res) => {
    try {
        // 경로 탈출 차단: basename 강제 + md 파일명 화이트리스트
        const name = path.basename(String(req.params.name || ''));
        if (!/^[\w가-힣.·-]+\.md$/.test(name)) throw { status: 400, message: '잘못된 파일명입니다' };
        const fs = require('fs');
        const fp = path.join(ARCHIVE_DIR, name);
        if (!fs.existsSync(fp)) throw { status: 404, message: '아카이브 파일을 찾을 수 없습니다' };
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
        res.send(fs.readFileSync(fp));
    } catch (err) { handleAdminErr(res, err); }
});

// 3단계: 발송·할인 일정 당일/전날 리마인드 (LIVE 로그 상단 배너용) — 등록 ≠ 자동 발송, 표시만
app.get('/api/agent-office/today-reminders', authMiddleware, adminOnly, async (req, res) => {
    try {
        const today = kstTodayStr();
        const tomorrow = new Date(new Date(today + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
        const r = await pool.query(
            `SELECT s.date, s.end_date, s.category, s.title, s.start_time, u.name AS user_name
             FROM schedules s LEFT JOIN users u ON s.user_id = u.id
             WHERE s.is_deleted = false AND s.category IN ('톡톡발송', '문자발송', '할인·이벤트')
               AND s.date <= $2 AND COALESCE(s.end_date, s.date) >= $1
             ORDER BY s.date, s.id`, [today, tomorrow]);
        res.json({
            today,
            reminders: r.rows.map(s => ({
                when: String(s.date).slice(0, 10) <= today ? '오늘' : '내일',
                category: s.category,
                line: fmtScheduleLine(s.date, s.start_time, s.title, s.user_name, s.category, s.end_date),
            })),
        });
    } catch (err) { handleAdminErr(res, err); }
});

// 설정 조회 (라우팅 테이블·운영 규칙·직원 명단 — 후속 차수 마루 AI 연결용)
app.get('/api/agent-office/config', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(`SELECT key, value, updated_at FROM agent_office_config ORDER BY key`);
        res.json({ config: Object.fromEntries(r.rows.map(row => [row.key, row.value])) });
    } catch (err) { handleAdminErr(res, err); }
});

// ============================================================
// 지시 #10: 텔레그램 완료 알림 — 대표 본인 수신 전용 부가 기능
// ※ 이 알림은 대표 1인의 개인 수신용이다. 손님·직원 대상 발송 기능이 아니므로
//   '외부 행동 승인제'의 적용 대상이 아니다 (예외가 아니라 대상 자체가 아님).
// 안전 규칙 (코드 레벨 고정):
//  - 수신처 = TELEGRAM_CHAT_ID(env) 또는 최초 1회 확보해 DB에 고정한 chat_id 하나뿐. 다른 수신처 경로 없음
//  - 내용 = 제목·상태·1줄 요약만. 5자리 이상 금액은 보수적으로 가림(●●●) — 금액 상세 금지 규칙
//  - 발송 실패는 본 기능에 영향 없음 (audit_log에만 기록). 토큰 전문은 로그·코드 어디에도 출력 금지
//  - TELEGRAM_NOTIFY=off로 전체 비활성 (기본 on)
// ============================================================
let _tgChatId = null;
async function telegramChatId() {
    if (_tgChatId) return _tgChatId;
    if (process.env.TELEGRAM_CHAT_ID) { _tgChatId = String(process.env.TELEGRAM_CHAT_ID); return _tgChatId; }
    const cfg = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'telegram_chat_id'`);
    if (cfg.rows.length) { _tgChatId = String(cfg.rows[0].value).replace(/"/g, ''); return _tgChatId; }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;
    // 최초 1회: 대표가 봇에게 보낸 메시지에서 chat_id 확보 → DB 고정 (이후 변경 경로 없음)
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
        const j = await res.json();
        const msg = (j.result || []).map(u => u.message || u.edited_message).filter(Boolean).pop();
        const id = msg && msg.chat && msg.chat.id;
        if (!id) return null;
        const up = await pool.query(`UPDATE agent_office_config SET value = $1, updated_at = NOW() WHERE key = 'telegram_chat_id' RETURNING key`, [JSON.stringify(String(id))]);
        if (up.rows.length === 0) {
            await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('telegram_chat_id', $1)`, [JSON.stringify(String(id))]);
        }
        await writeAudit({
            action: 'create', targetType: 'telegram_chat_id', targetId: null,
            changes: { after: { chat_id_last4: String(id).slice(-4), source: 'getUpdates 1회 확보' } },
            source: 'agent_office', actor: null,
        });
        _tgChatId = String(id);
        return _tgChatId;
    } catch (e) { return null; }
}
function tgMask(text) {
    // 보수적 해석: 5자리 이상 숫자(금액)는 가림 — '금액 상세 금지' 규칙 (해제는 대표 지시로)
    return String(text || '').replace(/\d{1,3}(,\d{3}){2,}|\d{5,}/g, '●●●').slice(0, 400);
}
async function notifyTelegram(text) {
    // 지시 #50-5: 일시 네트워크 오류 재시도 1회 (run #64 완료 알림이 배포 셧다운 순간 'fetch failed'로 유실된 사고 대응)
    const sendOnce = async () => {
        if ((process.env.TELEGRAM_NOTIFY || 'on').toLowerCase() === 'off') return 'off';
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return 'no-token';
        const chatId = await telegramChatId();
        if (!chatId) return 'no-chat';
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: tgMask(text) }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return 'sent';
    };
    try {
        await sendOnce();
    } catch (e1) {
        try {
            await new Promise(r => setTimeout(r, 5000));
            await sendOnce();
        } catch (e) {
            // 알림은 부가 기능 — 재시도까지 실패하면 무시하고 audit에만 기록 (토큰 미포함 메시지)
            writeAudit({
                action: 'telegram_fail', targetType: 'notification', targetId: null,
                changes: { after: { error: String(e.message || e).slice(0, 120), retried: true, first_error: String(e1.message || e1).slice(0, 80) } },
                source: 'agent_office', actor: null,
            }).catch(() => {});
        }
    }
}
// 지시 #11: 자가점검 — 발송 경로의 각 관문 상태를 audit에 기록 (조용한 실패 사각지대 제거, 시크릿 미포함)
async function telegramSelfcheck() {
    const diag = {
        notify: (process.env.TELEGRAM_NOTIFY || 'on').toLowerCase(),
        token_set: !!process.env.TELEGRAM_BOT_TOKEN,
        chat_env_set: !!process.env.TELEGRAM_CHAT_ID,
        chat_db_saved: false, getupdates: null, chat_resolved: false,
    };
    try {
        const cfg = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'telegram_chat_id'`);
        diag.chat_db_saved = cfg.rows.length > 0;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (token && !diag.chat_env_set && !diag.chat_db_saved) {
            try {
                const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
                const j = await res.json();
                diag.getupdates = { ok: !!j.ok, updates: (j.result || []).length, error: j.ok ? null : String(j.description || 'unknown').slice(0, 80) };
            } catch (e) { diag.getupdates = { ok: false, error: String(e.message || e).slice(0, 80) }; }
        }
        diag.chat_resolved = !!(await telegramChatId());
        await writeAudit({
            action: 'telegram_selfcheck', targetType: 'notification', targetId: null,
            changes: { after: diag }, source: 'agent_office', actor: null,
        });
        console.log('텔레그램 자가점검:', JSON.stringify(diag));
    } catch (e) { console.error('텔레그램 자가점검 실패:', e.message); }
    return diag;
}

// 지시 #11: 테스트 알림 발송 (adminOnly) — 대표 폰 수신으로 연동 검증
app.post('/api/agent-office/telegram-test', authMiddleware, adminOnly, async (req, res) => {
    try {
        const diag = await telegramSelfcheck();
        await notifyTelegram('🔔 테스트 알림 — 아꼼이네 알림 연동 확인 (지시 #10)');
        res.json({ message: '테스트 알림 발송을 시도했습니다 — 폰 수신을 확인해주세요', diag });
    } catch (err) { handleAdminErr(res, err); }
});

// ===== 지시 #54-2: 한수 자동 훅 (0원 코드) — 주간 재무 브리핑(월) + 단가 변경 감지 =====
setInterval(async () => {
    try {
        // ① 주간 재무 브리핑 — 월요일, 주 1회 (기준: agent_office_config.hansu_brief_last)
        const now = new Date(Date.now() + 9 * 3600 * 1000);
        const todayK = now.toISOString().slice(0, 10);
        if (now.getUTCDay() === 1) { // KST 기준 월요일
            const last = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'hansu_brief_last'`);
            const lastDate = last.rows.length ? last.rows[0].value.date : null;
            if (lastDate !== todayK) {
                await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('hansu_brief_last', $1::jsonb)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify({ date: todayK })]);
                const hansuAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'hansu' LIMIT 1`)).rows[0];
                const semiRunner = loadAgentRunner('세미');
                // 지난주(월~일)·전주 — 세미 집계 재사용 (0원)
                const t0 = new Date(todayK + 'T00:00:00Z');
                const mkD = off => { const d = new Date(t0); d.setUTCDate(t0.getUTCDate() + off); return d.toISOString().slice(0, 10); };
                const lw = { from: mkD(-7), to: mkD(-1) };
                // 간이 브리핑: 거래처 3사 지난주 합계 (semi partner_week 재사용 — 효돈·대성·기타)
                const parts = [];
                for (const p of ['대성(시온)', '효돈농협', '기타거래처']) {
                    try {
                        const r = await semiRunner.result({ agent: hansuAgent, pool, params: { partner_week: { partner: p, from: lw.from, to: lw.to, label: '지난주' } }, helpers: { matchItemToPricing, normDateSafe } });
                        parts.push({ partner: p, total: r.report.total || 0 });
                    } catch (e) { parts.push({ partner: p, total: null }); }
                }
                const tot = parts.reduce((s, x) => s + (x.total || 0), 0);
                const firstStep = agentStep('order', '한수', `🧮 주간 재무 브리핑 (${lw.from}~${lw.to}) — 자동 (지시 #54)`);
                const bRun = (await pool.query(`INSERT INTO agent_runs (agent_id, steps) VALUES ($1, $2) RETURNING *`,
                    [hansuAgent.id, JSON.stringify([firstStep])])).rows[0];
                await pool.query(`UPDATE agent_runs SET status='done', result=$2, finished_at=NOW() WHERE id=$1`, [bRun.id, JSON.stringify({
                    summary: `주간 브리핑: 지난주(${lw.from}~${lw.to}) 상품 ${Math.round(tot).toLocaleString('ko-KR')}원`,
                    lines: parts.map(x => `${x.partner}: ${x.total === null ? '집계 실패' : Math.round(x.total).toLocaleString('ko-KR') + '원'}`),
                    report: { type: 'hansu_briefing', week: lw, partners: parts, total: tot, note: '매주 월요일 자동 브리핑 (0원 코드 — 세미 집계 재사용, 지시 #54)' },
                })]);
                notifyTelegram('🧮 한수 주간 재무 브리핑 도착 — 보고서함에서 확인');
            }
        }
        // ② 단가표 변경 감지 (10분 주기와 무관하게 이 인터벌에서 함께 — pricing max id 비교)
        const pm = await pool.query(`SELECT COALESCE(MAX(id), 0) AS m FROM pricing`);
        const prevRow = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'hansu_price_maxid'`);
        const prev = prevRow.rows.length ? Number(prevRow.rows[0].value.max) : null;
        if (prev === null) {
            await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('hansu_price_maxid', $1::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ max: pm.rows[0].m })]);
        } else if (Number(pm.rows[0].m) > prev) {
            const rows = await pool.query(`SELECT partner, start_date, end_date FROM pricing WHERE id > $1 ORDER BY id`, [prev]);
            await pool.query(`UPDATE agent_office_config SET value = $1::jsonb, updated_at = NOW() WHERE key = 'hansu_price_maxid'`, [JSON.stringify({ max: pm.rows[0].m })]);
            const desc = rows.rows.map(r => `${r.partner} ${String(r.start_date).slice(0, 10)}~${String(r.end_date).slice(0, 10)}`).join(' / ');
            notifyTelegram(`🧮 한수: 주차 세팅 단가표 변경 감지 — ${desc.slice(0, 150)}`);
        }
    } catch (e) { console.error('한수 자동 훅 오류:', e.message); }
}, 10 * 60 * 1000);

// 지시함 상태 변화 감시 → 알림 (서버가 24시간 발송 주체 — 기록 주체와 무관하게 동작)
let _tgInboxInit = false;
setInterval(async () => {
    try {
        if ((process.env.TELEGRAM_NOTIFY || 'on').toLowerCase() === 'off' || !process.env.TELEGRAM_BOT_TOKEN) return;
        if (!_tgInboxInit) {
            // 최초 1회: 기존 건은 알림 없이 기준선만 잡음 (배포 직후 알림 폭주 방지)
            await pool.query(`UPDATE cc_instructions SET notified_status = status WHERE notified_status IS NULL`);
            await pool.query(`UPDATE cc_instructions SET notified_resp_hash = md5(COALESCE(response, '')) WHERE notified_resp_hash IS NULL`);
            _tgInboxInit = true;
            return;
        }
        // 지시 #29: 행동 안내형 문구 (이모지 3색) + 제목 요약 포함. '대기'(신규 등록)는 발송 생략
        const r = await pool.query(
            `SELECT id, status, notified_status, md5(COALESCE(response, '')) AS rh, LEFT(content, 200) AS head
             FROM cc_instructions
             WHERE status IS DISTINCT FROM notified_status
                OR md5(COALESCE(response, '')) IS DISTINCT FROM notified_resp_hash
             ORDER BY id ASC LIMIT 5`);
        for (const row of r.rows) {
            const statusChanged = row.status !== row.notified_status;
            // 제목 요약: 지시 첫 줄에서 "[지시 #N]" 접두 제거 후 20자 내외 (모델 호출 없이 코드로)
            const title = String(row.head || '').split('\n')[0].replace(/^\[[^\]]*\]\s*/, '').trim().slice(0, 22);
            let msg = null;
            if (statusChanged) {
                if (row.status === '진행') msg = `⚙️ 지시 #${row.id} ${title} — 일처리 진행 중입니다 (조치 불필요)`;
                else if (row.status === '완료') msg = `✅ 지시 #${row.id} ${title} — 완료되었습니다 → 클로드에게 'ㄱ' 보내주세요`;
                // '대기' 등장(신규 등록)은 발송 생략 — 알림 수 절감 (지시 #29-2)
            } else {
                msg = `📝 지시 #${row.id} ${title} — 경과 보고 도착 → 클로드에게 'ㄱ' 보내주세요`;
            }
            if (msg) await notifyTelegram(msg);
            await pool.query(`UPDATE cc_instructions SET notified_status = $2, notified_resp_hash = $3 WHERE id = $1`,
                [row.id, row.status, row.rh]);
        }
    } catch (e) { /* 부가 기능 — 조용히 다음 주기 */ }
}, 60000);

// ============================================================
// === MCP 서버 (/mcp/:secret) — 3단계 ===
// authless 커넥터 + URL 시크릿 인증. Streamable HTTP(stateless, JSON 응답).
// 도구는 2단계 svc* 함수 재사용. 1차 공개도구=읽기+안전쓰기만.
// 인증: URL 경로의 :secret === env MCP_AUTH_TOKEN (없으면 fail-closed 404)
// ============================================================
let _mcpActor = null;
async function getMcpActor() {
    if (_mcpActor) return _mcpActor;
    let r = await pool.query(`SELECT id, name, position, role FROM users WHERE position = '대표' ORDER BY id ASC LIMIT 1`);
    if (r.rows.length === 0) r = await pool.query(`SELECT id, name, position, role FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    const u = r.rows[0];
    _mcpActor = u ? { id: u.id, name: u.name, position: u.position, role: u.role, source: 'mcp' } : { id: null, name: 'MCP', source: 'mcp' };
    return _mcpActor;
}

// v5.0 D: 지시함 서비스 (똑똑이 → 클로드 코드 파이프라인)
async function svcRegisterInstruction({ content }, actor) {
    const text = String(content || '').trim();
    if (!text) throw new Error('지시 내용이 비어 있습니다');
    if (text.length > 5000) throw new Error('지시는 5000자 이내로 입력해주세요');
    const row = (await pool.query(
        `INSERT INTO cc_instructions (content) VALUES ($1) RETURNING id, status, created_at`, [text])).rows[0];
    await writeAudit({
        action: 'create', targetType: 'cc_instruction', targetId: row.id,
        changes: { after: { content: text.slice(0, 500), status: row.status } },
        source: 'mcp', actor,
    });
    return {
        id: row.id, status: row.status, created_at: row.created_at,
        message: `지시 #${row.id} 등록 완료 — 클로드 코드가 감지하면 상태가 진행→완료로 바뀝니다. get_instruction_status로 응답을 확인하세요.`,
        principles: '지시함은 전달 통로일 뿐 권한 확대가 아닙니다 — 외부 행동 승인제·자동수정 금지·보고 우선 원칙이 동일하게 적용됩니다.',
    };
}
async function svcInstructionStatus({ id, limit }) {
    if (id) {
        const r = await pool.query(`SELECT * FROM cc_instructions WHERE id = $1`, [id]);
        if (r.rows.length === 0) throw new Error(`지시 #${id}를 찾을 수 없습니다`);
        return r.rows[0];
    }
    const n = Math.min(Math.max(parseInt(limit) || 5, 1), 30);
    const r = await pool.query(`SELECT * FROM cc_instructions ORDER BY id DESC LIMIT $1`, [n]);
    return { count: r.rows.length, instructions: r.rows };
}

// ===== 지시 #26·#27: 미소 원스톱 생성 — 제미나이 이미지·영상 (건별 대표 승인제) =====
// 원칙: 승인 없이는 생성 API 호출 절대 불가 (외부 행동·비용 승인제) — 유일 호출 경로는
// adminOnly 엔드포인트이며, 그 안에서도 assertMediaApproval 관문 + 승인 audit 선기록 후 호출.
// 단가는 대표 선택 (지시 #27, 2026-07-19 공식 문서 기준): 이미지 기본 92원/고급 185원,
// 영상(8초) 기본 1,100원/고급 4,400원 (환율 1,380원 가정 개략치 — 승인 문구 표기용)
const MEDIA_OPTIONS = {
    이미지: {
        기본: { model: 'gemini-3.1-flash-image', label: '기본급 (Nano Banana 2 · 1K)', usd: 0.067, krw: 92 },
        고급: { model: 'gemini-3-pro-image', label: '고급 (Nano Banana Pro · 1K)', usd: 0.134, krw: 185 },
    },
    영상: {
        기본: { model: 'veo-3.1-fast-generate-preview', label: '기본급 (Veo 3.1 Fast · 720p 8초)', usd: 0.80, krw: 1100, resolution: '720p' },
        고급: { model: 'veo-3.1-generate-preview', label: '고급 (Veo 3.1 표준 · 1080p 8초)', usd: 3.20, krw: 4400, resolution: '1080p' },
    },
};
// 승인 관문 — 생성 함수의 첫 줄에서 호출 (역량 박제가 무승인 차단을 검증)
function assertMediaApproval(approval) {
    if (!approval || approval.approved !== true || !approval.actor || !approval.run_id) {
        throw new Error('생성 승인 없음 — 대표 승인 없이는 생성 API를 호출할 수 없습니다 (지시 #26 비용 승인제)');
    }
}
// 브랜드 캐릭터 '아꼼이' 참조 이미지 로드 (대표 7/21) — use_character면 실제 캐릭터를 참조로 넣어 생김새 고정
function loadBrandCharacterParts() {
    const fsx = require('fs');
    const parts = [];
    for (const f of ['acom-character-a.png', 'acom-character-b.png']) {
        try {
            const data = fsx.readFileSync(path.join(__dirname, 'assets', 'brand', f)).toString('base64');
            parts.push({ inlineData: { mimeType: 'image/png', data } });
        } catch (e) { /* 파일 없으면 스킵 */ }
    }
    return parts;
}
async function generateMisoMedia(approval, output, opt) {
    assertMediaApproval(approval);
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    if (output.media === '이미지') {
        // 대표 7/21: 아꼼이 캐릭터가 들어가는 이미지는 실제 캐릭터 이미지를 참조로 넣어 생김새를 고정 (AI가 캐릭터를 새로 상상하지 않도록)
        let contents = output.prompt_en;
        if (output.use_character) {
            const refParts = loadBrandCharacterParts();
            if (refParts.length) {
                contents = [{
                    text: '아래 참조 이미지는 제주아꼼이네 브랜드 캐릭터 "아꼼이"다. 참조 이미지의 배경색과 "제주아꼼이네" 글자는 무시하고, 아기 캐릭터의 얼굴·헤어스타일(양갈래+노란 머리끈)·공갈젖꼭지·비율·디자인만 그대로 유지해 새 이미지를 만들어라. 배경·포즈·상황·구도는 아래 프롬프트대로 바꿔도 되지만 캐릭터 외형은 참조와 동일해야 한다. 다른 캐릭터를 새로 만들지 말 것.\n\n[생성 프롬프트]\n' + output.prompt_en,
                }, ...refParts];
            }
        }
        const req = { model: opt.model, contents };
        let resp;
        try {
            const imageConfig = { imageSize: '1K' };
            if (/^\d+:\d+$/.test(String(output.ratio || ''))) imageConfig.aspectRatio = output.ratio;
            resp = await genai.models.generateContent({ ...req, config: { imageConfig } });
        } catch (e) {
            // 일부 모델·버전이 imageConfig 미지원일 수 있음 — 설정 없이 1회 재시도 (기본 1024px)
            if (/imageConfig|image_config|INVALID_ARGUMENT|not supported/i.test(e?.message || '')) {
                resp = await genai.models.generateContent(req);
            } else throw e;
        }
        const parts = resp?.candidates?.[0]?.content?.parts || [];
        const img = parts.find(pt => pt.inlineData && pt.inlineData.data);
        if (!img) {
            const text = parts.filter(pt => pt.text).map(pt => pt.text).join(' ').slice(0, 200);
            throw new Error('이미지 응답에 데이터가 없습니다' + (text ? ` (모델 응답: ${text})` : ''));
        }
        const ext = String(img.inlineData.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
        return { buf: Buffer.from(img.inlineData.data, 'base64'), ext };
    }
    // 영상 (Veo 3.1) — long-running operation 폴링. durationSeconds는 숫자 8 (문자열이면 400).
    // 🚫 대표 7/21: 자동 재시도 안 함 — 재시도도 과금이 걸릴 수 있으므로, 실패하면 대표가 직접 [생성]을 다시 눌러 결정한다 (건별 승인제).
    const config = { aspectRatio: output.ratio === '9:16' ? '9:16' : '16:9', durationSeconds: 8 };
    if (opt.resolution) config.resolution = opt.resolution;
    let op = await genai.models.generateVideos({ model: opt.model, prompt: output.prompt_en, config });
    const t0 = Date.now();
    while (!op.done) {
        if (Date.now() - t0 > 6 * 60 * 1000) throw new Error('영상 생성 6분 초과 — 시간 초과로 중단');
        await new Promise(r => setTimeout(r, 10000));
        op = await genai.operations.getVideosOperation({ operation: op });
    }
    if (op.error) {
        const em = op.error.message || JSON.stringify(op.error).slice(0, 200);
        throw new Error(/internal|try again|unavailable|temporar|backend|500|503/i.test(em)
            ? `구글 Veo 서버 일시 오류로 실패했습니다 — 잠시 후 [생성]을 다시 눌러 재시도해주세요 (자동 재시도 안 함 · 과금은 대표님이 직접 결정). 원문: ${em.slice(0, 150)}`
            : '영상 생성 실패: ' + em);
    }
    const video = op.response?.generatedVideos?.[0]?.video;
    if (!video) throw new Error('영상 응답이 비어 있습니다');
    const fs = require('fs');
    const os = require('os');
    const tmp = path.join(os.tmpdir(), `miso_video_${Date.now()}.mp4`);
    try {
        await genai.files.download({ file: video, downloadPath: tmp });
        return { buf: fs.readFileSync(tmp), ext: 'mp4' };
    } finally {
        try { fs.unlinkSync(tmp); } catch (e) { /* 임시 파일 정리 실패 무시 */ }
    }
}
// 생성 실행 (adminOnly = 건별 대표 승인 클릭) — 응답 즉시 반환, 생성은 비동기 (영상 최대 6분)
app.post('/api/agent-office/runs/:id/generate', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { output_index = 0, grade = '기본' } = req.body || {};
        const rr = await pool.query(`SELECT * FROM agent_runs WHERE id = $1 AND is_deleted = false`, [req.params.id]);
        if (!rr.rows.length) throw { status: 404, message: '보고서를 찾을 수 없습니다' };
        const run = rr.rows[0];
        const rep = run.result && run.result.report;
        if (!rep || rep.type !== 'miso_prompt') throw { status: 400, message: '미소 프롬프트 보고서가 아닙니다' };
        const output = (rep.outputs || [])[output_index];
        if (!output) throw { status: 400, message: '해당 시안을 찾을 수 없습니다' };
        const opt = MEDIA_OPTIONS[output.media] && MEDIA_OPTIONS[output.media][grade];
        if (!opt) throw { status: 400, message: `지원하지 않는 조합: ${output.media}/${grade}` };
        if (rep.media_generating) throw { status: 409, message: '이미 생성 중입니다 — 완료 후 다시 시도해주세요' };
        const approval = { approved: true, actor: adminActor(req), run_id: run.id };
        // 승인 증거를 호출 전에 audit (비용 승인제 — 시크릿·프롬프트 전문 미포함)
        await writeAudit({
            action: 'media_generate_approved', targetType: 'agent_run', targetId: run.id,
            changes: { after: { media: output.media, label: output.label, grade, model: opt.model, est_usd: opt.usd, est_krw: opt.krw, output_index } },
            source: 'agent_office', actor: approval.actor,
        });
        rep.media_generating = { output_index, grade, started_at: new Date().toISOString() };
        await pool.query(`UPDATE agent_runs SET result = $2 WHERE id = $1`, [run.id, JSON.stringify(run.result)]);
        res.json({
            message: output.media === '영상'
                ? `영상 생성 시작 (${opt.label}) — 완료까지 최대 6분, 완료되면 텔레그램 알림 + 보고서함 📎`
                : `이미지 생성 시작 (${opt.label}) — 잠시 후 보고서 카드에서 📎 확인`,
        });
        // ── 비동기 생성 (응답 후) ──
        (async () => {
            const finishUpdate = async (mutate) => {
                const fr = await pool.query(`SELECT result FROM agent_runs WHERE id = $1`, [run.id]);
                const result = fr.rows[0].result;
                mutate(result.report);
                await pool.query(`UPDATE agent_runs SET result = $2 WHERE id = $1`, [run.id, JSON.stringify(result)]);
            };
            try {
                const { buf, ext } = await generateMisoMedia(approval, output, opt);
                const safe = String(output.label || '시안').replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
                const fname = `미소생성_${safe}_${kstTodayStr().replace(/-/g, '')}.${ext}`;
                const fid = await saveReportFile(fname, buf, run.id, approval.actor);
                await finishUpdate(r2 => {
                    delete r2.media_generating;
                    r2.media_files = [...(r2.media_files || []), {
                        file_id: fid, file_name: fname, media: output.media, grade,
                        model: opt.model, est_krw: opt.krw, output_index, created_at: new Date().toISOString(),
                    }];
                });
                await writeAudit({
                    action: 'media_generated', targetType: 'report_file', targetId: fid,
                    changes: { after: { file_name: fname, size_bytes: buf.length, media: output.media, grade, model: opt.model, est_usd: opt.usd, est_krw: opt.krw, run_id: run.id } },
                    source: 'agent_office', actor: approval.actor,
                });
                await notifyTelegram(`🎨 미소 ${output.media} 생성 완료 (${grade}) — 보고서함 📎`);
            } catch (e) {
                console.error('미소 생성 실패:', e.message);
                await finishUpdate(r2 => {
                    delete r2.media_generating;
                    r2.media_error = `생성 실패 (${output.media}/${grade}): ${String(e.message).slice(0, 300)} — 재시도하려면 생성 버튼을 다시 눌러주세요`;
                }).catch(() => {});
                await writeAudit({
                    action: 'media_generate_failed', targetType: 'agent_run', targetId: run.id,
                    changes: { after: { media: output.media, grade, model: opt.model, error: String(e.message).slice(0, 300) } },
                    source: 'agent_office', actor: approval.actor,
                });
                await notifyTelegram('⚠️ 미소 생성 실패 — 보고서함에서 사유 확인').catch(() => {});
            }
        })();
    } catch (err) { handleAdminErr(res, err); }
});

// ===== 지시 #16: 똑똑이용 읽기 전용 관측 도구 3종 =====
// 읽기 전용 보장: 아래 3개 svc는 SELECT만 수행 — DB 쓰기는 조회 이력 audit(mcpObserveAudit) 1건뿐.
// 마루 지시 입력 도구는 만들지 않음 (지시 입력 = 대표 전용, 결재 구조 유지)
// 지시 #47: 관측 도구 표시용 KST 변환 — 내부 기록(DB·audit)은 UTC 유지, 응답에 표시 필드만 병기
function kstDisplay(ts) {
    if (!ts) return null;
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' KST';
}
async function mcpObserveAudit(tool, args, actor) {
    await writeAudit({
        action: 'mcp_observe', targetType: 'mcp_tool',
        changes: { after: { tool, args: args || {} } }, source: 'mcp', actor,
    });
}
async function svcGetLiveLog({ limit }, actor) {
    const n = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const r = await pool.query(
        `SELECT id, content, status, result, run_id, created_at, processed_at
         FROM pending_orders ORDER BY id DESC LIMIT $1`, [n]);
    await mcpObserveAudit('get_live_log', { limit: n }, actor);
    return {
        count: r.rows.length,
        orders: r.rows.map(o => {
            const res = o.result || {};
            return {
                id: o.id, status: o.status, content: o.content,
                response_type: res.type || null,
                response: res.summary || res.question || res.notice || (res.route && res.route.task_summary) || null,
                file_name: (res.report && res.report.file_name) || res.file_name || null,
                run_id: o.run_id, created_at: o.created_at, processed_at: o.processed_at,
                created_at_kst: kstDisplay(o.created_at), processed_at_kst: kstDisplay(o.processed_at), // 지시 #47
            };
        }),
    };
}
async function svcGetTestResults({ run_id, limit }, actor) {
    if (run_id) {
        const r = await pool.query(
            `SELECT id, status, started_at, result FROM agent_runs WHERE id = $1 AND is_test = true`, [run_id]);
        if (!r.rows.length) throw new Error(`역량 점검 회차 #${run_id}를 찾을 수 없습니다 (is_test 회차만 조회 가능)`);
        const row = r.rows[0];
        const rep = (row.result && row.result.report) || {};
        await mcpObserveAudit('get_test_results', { run_id }, actor);
        return {
            id: row.id, status: row.status, started_at: row.started_at,
            started_at_kst: kstDisplay(row.started_at), // 지시 #47 — 표시는 KST 필드 사용 권장
            summary: (row.result && row.result.summary) || null,
            duration_s: rep.duration_s || null,
            sections: (rep.sections || []).map(s => ({
                agent: s.agent, pass: s.pass, total: s.total,
                results: (s.results || []).map(q => ({
                    name: q.name, pass: q.pass, question: q.q || null,
                    expected: q.expected, actual: q.actual,
                })),
            })),
        };
    }
    const n = Math.min(Math.max(parseInt(limit) || 10, 1), 30);
    const r = await pool.query(
        `SELECT id, status, started_at, result->>'summary' AS summary
         FROM agent_runs WHERE is_test = true ORDER BY id DESC LIMIT $1`, [n]);
    await mcpObserveAudit('get_test_results', { limit: n }, actor);
    return { count: r.rows.length, runs: r.rows.map(x => ({ ...x, started_at_kst: kstDisplay(x.started_at) })) };
}
async function svcGetReports({ id, limit }, actor) {
    if (id) {
        const r = await pool.query(
            `SELECT r.id, r.status, r.started_at, r.finished_at, r.result, r.is_deleted, a.name AS agent_name, a.team
             FROM agent_runs r JOIN agents a ON a.id = r.agent_id
             WHERE r.id = $1 AND COALESCE(r.is_test, false) = false`, [id]);
        if (!r.rows.length) throw new Error(`보고서 #${id}를 찾을 수 없습니다`);
        const row = r.rows[0];
        const res = row.result || {};
        let file = null;
        const fid = res.report && res.report.file_id;
        if (fid) {
            const f = await pool.query(
                `SELECT id, filename, size_bytes, created_at FROM report_files WHERE id = $1 AND is_deleted = false`, [fid]);
            if (f.rows.length) file = {
                id: f.rows[0].id, filename: f.rows[0].filename, size_bytes: f.rows[0].size_bytes,
                created_at: f.rows[0].created_at,
                note: '파일 바이너리는 MCP로 전송하지 않습니다 — 다운로드는 프로그램 화면에서',
            };
        }
        await mcpObserveAudit('get_reports', { id }, actor);
        return {
            id: row.id, agent: row.agent_name, team: row.team, status: row.status,
            confirmed_hidden: row.is_deleted, // 대표 [✔확인] 후 숨김(soft-delete) 여부 — 원본은 보존됨
            started_at: row.started_at, finished_at: row.finished_at,
            started_at_kst: kstDisplay(row.started_at), finished_at_kst: kstDisplay(row.finished_at), // 지시 #47
            summary: res.summary || null, lines: res.lines || [], report: res.report || null, file,
        };
    }
    const n = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    // 확인 완료 보고서는 is_deleted=true(soft-delete·숨김)로 보존되므로 필터하지 않고 플래그로 노출
    const r = await pool.query(
        `SELECT r.id, a.name AS agent, r.status, r.started_at, r.result->>'summary' AS summary,
                (r.result->'report'->>'file_id') IS NOT NULL AS has_file,
                r.is_deleted AS confirmed_hidden
         FROM agent_runs r JOIN agents a ON a.id = r.agent_id
         WHERE COALESCE(r.is_test, false) = false
         ORDER BY r.id DESC LIMIT $1`, [n]);
    await mcpObserveAudit('get_reports', { limit: n }, actor);
    return { count: r.rows.length, reports: r.rows };
}

const MCP_SERVER_INFO = { name: '제주아꼼이네 관리', version: '1.0.0' };
const MCP_TOOLS = [
    {
        name: 'register_instruction',
        description: '클로드 코드 지시함에 작업 지시를 등록합니다 (대표 승인된 지시만). 클로드 코드가 폴링으로 감지해 실행하고 응답을 기록합니다. 외부 행동 승인제·자동수정 금지 등 기존 원칙이 그대로 적용되는 전달 통로입니다.',
        inputSchema: { type: 'object', properties: { content: { type: 'string', description: '지시 내용 전문 (5000자 이내)' } }, required: ['content'] },
        handler: async (args, actor) => svcRegisterInstruction(args, actor),
    },
    {
        name: 'get_instruction_status',
        description: '지시함의 상태·응답을 조회합니다. id 지정 시 해당 건, 생략 시 최신 N건(limit, 기본 5). 상태: 대기(미감지)/진행(실행 중)/완료(응답 기록됨).',
        inputSchema: { type: 'object', properties: { id: { type: 'integer', description: '지시 번호' }, limit: { type: 'integer', description: '최신 N건 (기본 5, 최대 30)' } } },
        handler: async (args) => svcInstructionStatus(args),
    },
    {
        name: 'list_schedules',
        description: '기간별 일정을 조회합니다. from/to(YYYY-MM-DD)로 범위 지정, 생략 시 전체. 삭제된 일정은 제외됩니다.',
        inputSchema: { type: 'object', properties: { from: { type: 'string', description: '시작일 YYYY-MM-DD' }, to: { type: 'string', description: '종료일 YYYY-MM-DD' } } },
        handler: async (args) => svcListSchedules({ from: args.from, to: args.to }),
    },
    {
        name: 'create_schedule',
        description: '새 일정을 등록합니다. date(YYYY-MM-DD)와 title은 필수. type/start_time(HH:MM)/content는 선택. 담당자는 대표로 자동 설정됩니다.',
        inputSchema: { type: 'object', properties: { date: { type: 'string' }, title: { type: 'string' }, type: { type: 'string' }, start_time: { type: 'string' }, content: { type: 'string' } }, required: ['date', 'title'] },
        handler: async (args, actor) => svcCreateSchedule(args, actor),
    },
    {
        name: 'update_schedule',
        description: '기존 일정을 수정합니다. id 필수. date/title/type/start_time/content/is_completed 중 바꿀 값만 전달합니다.',
        inputSchema: { type: 'object', properties: { id: { type: 'integer' }, date: { type: 'string' }, title: { type: 'string' }, type: { type: 'string' }, start_time: { type: 'string' }, content: { type: 'string' }, is_completed: { type: 'boolean' } }, required: ['id'] },
        handler: async (args, actor) => { const { id, ...patch } = args; return svcUpdateSchedule(id, patch, actor); },
    },
    {
        name: 'list_pending_approvals',
        description: '결재 대기중인 기안서류(휴가/근태/시말서 등) 목록을 조회합니다. status(pending/approved/rejected) 생략 시 pending.',
        inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
        handler: async (args) => svcListApprovals(args.status || 'pending'),
    },
    {
        name: 'get_approval_detail',
        description: '기안서류 한 건의 상세 정보를 조회합니다. id 필수.',
        inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        handler: async (args) => svcGetApprovalDetail(args.id),
    },
    {
        name: 'search_items',
        description: '품목 마스터에서 품목을 검색/조회합니다. q(검색어)로 이름·별칭 부분검색, 생략 시 활성 품목 전체. (송장변환 품목과 별개인 관리용 목록)',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        handler: async (args) => svcListItems({ q: args.q || '' }),
    },
    {
        name: 'add_item',
        description: '품목 마스터에 새 품목을 추가합니다. name 필수, alias(별칭)/spec(규격) 선택.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' }, alias: { type: 'string' }, spec: { type: 'string' } }, required: ['name'] },
        handler: async (args, actor) => svcCreateItem(args, actor),
    },
    {
        name: 'update_item',
        description: '품목 정보를 수정합니다. id 필수. name/alias/spec 중 바꿀 값만 전달.',
        inputSchema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, alias: { type: 'string' }, spec: { type: 'string' } }, required: ['id'] },
        handler: async (args, actor) => { const { id, ...patch } = args; return svcUpdateItem(id, patch, actor); },
    },
    {
        name: 'get_settlements',
        description: '정산 내역을 조회합니다(읽기 전용). from/to(YYYY-MM-DD)로 기간 지정. 거래처/금액/품목이 반환됩니다.',
        inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        handler: async (args) => svcGetSettlements({ from: args.from, to: args.to }),
    },
    // 지시 #16: 관측 도구 3종 (읽기 전용 — 조회 이력은 audit 기록)
    {
        name: 'get_live_log',
        description: 'AGENT OFFICE LIVE 로그를 조회합니다(읽기 전용). 최근 지시 원문·마루 응답·상태·타임스탬프. limit 기본 20, 최대 100.',
        inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: '최근 N건 (기본 20, 최대 100)' } } },
        handler: async (args, actor) => svcGetLiveLog(args, actor),
    },
    {
        name: 'get_test_results',
        description: '역량 점검 성적표를 조회합니다(읽기 전용). run_id 생략 시 회차 목록(limit 기본 10), run_id 지정 시 문항별 상세(요원·문항명·통과/실패·기대·실제).',
        inputSchema: { type: 'object', properties: { run_id: { type: 'integer', description: '회차 번호 (예: 49)' }, limit: { type: 'integer', description: '목록 조회 시 최근 N건 (기본 10, 최대 30)' } } },
        handler: async (args, actor) => svcGetTestResults(args, actor),
    },
    {
        name: 'get_reports',
        description: '보고서함을 조회합니다(읽기 전용). id 생략 시 목록(limit 기본 20, 최대 100), id 지정 시 보고 본문 전체. 첨부 파일은 메타(파일명·크기·생성일)만 — 바이너리 전송 없음.',
        inputSchema: { type: 'object', properties: { id: { type: 'integer', description: '보고서(run) 번호' }, limit: { type: 'integer', description: '목록 조회 시 최근 N건' } } },
        handler: async (args, actor) => svcGetReports(args, actor),
    },
    // v5.1.1 (지시 #28-2): 유일한 '실행' 도구 — 역량 점검 실행 1가지만 (그 외 실행·쓰기 불가, 읽기 전용 3종과 분리)
    {
        name: 'run_capability_test',
        description: "역량 점검(전 요원 자동 테스트)을 실행합니다 — 이 서버에서 유일하게 허용된 '실행' 도구이며 역량 점검 실행 1가지만 가능합니다. 운영 규칙(운영규칙_지시함.md): 대표가 대화에서 승인('ㄱ')한 후에만 호출할 것. 모든 호출은 audit(mcp_run_test)로 기록되어 사후 감사됩니다. 완료 시 텔레그램 결과 발송, 문항 상세는 get_test_results(run_id)로 조회.",
        inputSchema: { type: 'object', properties: {} },
        handler: async (args, actor) => {
            // 호출 전수 audit — 시작 실패(중복 실행 등)해도 호출 시도 자체가 기록됨 (사후 감사)
            await writeAudit({
                action: 'mcp_run_test', targetType: 'agent_run',
                changes: { after: { via: 'mcp', rule: '대표 대화 승인(ㄱ) 전제 — 운영규칙_지시함.md' } },
                source: 'mcp', actor,
            });
            const run = await svcStartCapabilityTest(actor);
            return { run_id: run.id, message: `역량 점검 시작 (run #${run.id}, 약 3~4분) — 완료 시 텔레그램 알림, 문항 상세는 get_test_results로` };
        },
    },
    // 지시 #51: 실전 스모크 실행 도구 — [#51-실행] 지시·대표 'ㄱ' 승인 후에만 호출 (실행 도구 2종째, 운영규칙 개정)
    {
        name: 'run_smoke_test',
        description: "실전 문구 스모크 시험(지시 #51 — 대표 원문 5건)을 실행합니다. 운영 규칙: [#51-실행] 지시 등록 + 대표 대화 승인('ㄱ') 후에만 호출할 것 (AI 호출 약 9회 비용). 전 문항 is_test 격리 — 실제 일정 등록·발송·이미지 생성 없음. 호출은 audit(mcp_run_smoke) 기록, 결과는 텔레그램 🧪 + get_test_results(run_id)로 답변 전문 판독.",
        inputSchema: { type: 'object', properties: {} },
        handler: async (args, actor) => {
            await writeAudit({
                action: 'mcp_run_smoke', targetType: 'agent_run',
                changes: { after: { via: 'mcp', rule: "[#51-실행] 지시 + 대표 승인(ㄱ) 전제" } },
                source: 'mcp', actor,
            });
            const run = await svcStartSmokeTest(actor);
            return { run_id: run.id, message: `실전 스모크 시작 (run #${run.id}, 약 3~5분·AI 약 9회) — 완료 시 텔레그램 🧪, 전문은 get_test_results로` };
        },
    },
];

async function handleMcpRpc(msg) {
    if (!msg || typeof msg !== 'object' || !msg.method) return null;
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) return null; // 알림/응답 → 202
    const { id, method, params } = msg;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    try {
        if (method === 'initialize') {
            return reply({
                protocolVersion: (params && params.protocolVersion) || '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: MCP_SERVER_INFO,
            });
        }
        if (method === 'ping') return reply({});
        if (method === 'tools/list') {
            return reply({ tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
        }
        if (method === 'tools/call') {
            const tool = MCP_TOOLS.find(t => t.name === (params && params.name));
            if (!tool) return fail(-32602, `알 수 없는 도구: ${params && params.name}`);
            const actor = await getMcpActor();
            try {
                const data = await tool.handler((params && params.arguments) || {}, actor);
                return reply({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
            } catch (err) {
                return reply({ content: [{ type: 'text', text: `오류: ${err?.message || String(err)}` }], isError: true });
            }
        }
        return fail(-32601, `지원하지 않는 메서드: ${method}`);
    } catch (err) {
        return fail(-32603, err?.message || String(err));
    }
}

function mcpSecretOk(req) {
    const secret = process.env.MCP_AUTH_TOKEN;
    return !!secret && req.params.secret === secret;
}
app.post('/mcp/:secret', async (req, res) => {
    if (!mcpSecretOk(req)) return res.status(404).json({ error: 'Not found' });
    if (Array.isArray(req.body)) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: '배치 요청 미지원' } });
    const response = await handleMcpRpc(req.body);
    if (response === null) return res.status(202).end();
    res.json(response);
});
app.get('/mcp/:secret', (req, res) => {
    if (!mcpSecretOk(req)) return res.status(404).json({ error: 'Not found' });
    res.status(405).json({ error: 'Method Not Allowed (SSE 미지원)' });
});
app.delete('/mcp/:secret', (req, res) => {
    if (!mcpSecretOk(req)) return res.status(404).json({ error: 'Not found' });
    res.status(405).json({ error: 'Method Not Allowed' });
});

// claude.ai MCP 커넥터 OAuth 탐색 경로 — 인증 없는(authless) 서버임을 정직하게 404로 응답
// SPA 캐치올이 200+HTML을 주면 claude.ai 신규 연결 절차가 OAuth 서버로 오인해 등록 실패함 (2026-07-18 진단)
app.all(/^\/\.well-known\/.*/, (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`서버 실행 중: http://localhost:${PORT}`);
        // 6차: 기존 피드백 교훈 소급 추출 (미처리분만 — 멱등)
        setTimeout(() => backfillLessonsFromFeedback(), 8000);
        // 지시 #11: 텔레그램 자가점검 — 부팅 시 발송 경로 상태를 audit에 기록 (시크릿 미포함)
        setTimeout(() => telegramSelfcheck(), 5000);
        // 지시 #52: 스모크 실행 요청 플래그 소비 — 지시함 경로 승인분(도구 스냅샷 부재 시)을 부팅 시 1회 실행.
        // 플래그는 대표 승인 지시(#52 등) 근거로만 세팅되며, 소비 즉시 해제 + audit (중복 실행 방지)
        setTimeout(async () => {
            try {
                const f = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'smoke_request'`);
                if (f.rows.length && f.rows[0].value && f.rows[0].value.pending === true) {
                    await pool.query(`UPDATE agent_office_config SET value = jsonb_set(value, '{pending}', 'false'), updated_at = NOW() WHERE key = 'smoke_request'`);
                    await writeAudit({
                        action: 'smoke_request_consumed', targetType: 'agent_run',
                        changes: { after: { via: 'boot', basis: f.rows[0].value.basis || '지시 #52' } },
                        source: 'agent_office', actor: null,
                    });
                    await svcStartSmokeTest(null, f.rows[0].value.scope || null);
                    console.log('지시 #52: 스모크 실행 요청 플래그 소비 — 실전 스모크 시작');
                }
            } catch (e) { console.error('스모크 요청 플래그 처리 실패:', e.message); }
        }, 12000);
    });
}).catch(err => {
    console.error('DB 초기화 실패:', err);
    process.exit(1);
});
