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
const { parseExplicitDate, parseExplicitMonth, hasExplicitDay, periodRangeOf, needsQueryConfirm, isValidDateStr } = require('./date-utils.js');

// DATE 타입을 문자열로 반환 (타임존 이슈 방지)
types.setTypeParser(1082, val => val);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jeju-acom-secret-2026';

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

    // 점심메뉴 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lunch_menus (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lunch_sessions (
            id SERIAL PRIMARY KEY,
            date DATE UNIQUE NOT NULL,
            menus JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lunch_votes (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES lunch_sessions(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            menu_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(session_id, user_id)
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

    // 품목별 금액 저장 시 잘못 생성된 정산 데이터 삭제
    await pool.query("DELETE FROM settlements WHERE from_pricing = true");

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

    // 기본 점심메뉴 시드
    const menuCheck = await pool.query('SELECT COUNT(*) FROM lunch_menus');
    if (parseInt(menuCheck.rows[0].count) === 0) {
        const defaultMenus = [
            ['김치찌개','한식'],['된장찌개','한식'],['순두부찌개','한식'],['불고기','한식'],['제육볶음','한식'],
            ['비빔밥','한식'],['갈치조림','한식'],['고등어구이','한식'],['돼지국밥','한식'],['해물파전','한식'],
            ['감자탕','한식'],['삼겹살','한식'],['칼국수','한식'],
            ['고기국수','제주'],['몸국','제주'],['흑돼지구이','제주'],['전복죽','제주'],['보말칼국수','제주'],
            ['짜장면','중식'],['짬뽕','중식'],['탕수육','중식'],['볶음밥','중식'],['마파두부','중식'],
            ['초밥','일식'],['돈카츠','일식'],['라멘','일식'],['우동','일식'],
            ['파스타','양식'],['피자','양식'],['햄버거','양식'],['스테이크','양식'],['리조또','양식'],
            ['떡볶이','분식'],['김밥','분식'],['라볶이','분식'],
            ['치킨','패스트푸드']
        ];
        for (const [name, category] of defaultMenus) {
            await pool.query('INSERT INTO lunch_menus (name, category) VALUES ($1, $2)', [name, category]);
        }
        console.log('기본 점심메뉴 36개 등록 완료');
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

    // AI 대화 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(200) DEFAULT '새 대화',
            category VARCHAR(50) DEFAULT 'marketing',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // category 컬럼 추가 (기존 테이블 호환)
    await pool.query(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'marketing'`).catch(() => {});

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_messages (
            id SERIAL PRIMARY KEY,
            conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

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

    // ai_messages에 message_type 컬럼 추가 (이미지/텍스트 구분)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE ai_messages ADD COLUMN message_type VARCHAR(10) DEFAULT 'text';
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END $$;
    `);

    // ai_messages에 sender_user_id 컬럼 추가 (누가 보냈는지 추적)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE ai_messages ADD COLUMN sender_user_id INTEGER REFERENCES users(id);
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END $$;
    `);

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
    // 서버 재시작으로 '처리중' 상태로 남은 지시 → 대기로 복구 (재처리 가능)
    await pool.query(`UPDATE pending_orders SET status='대기' WHERE status='처리중'`);

    // 서버 재시작으로 중단된 실행 정리 ('실행중'으로 남은 기록 → 오류 처리)
    await pool.query(`UPDATE agent_runs SET status='error', finished_at=NOW(),
        result=COALESCE(result, '{"summary":"서버 재시작으로 실행이 중단되었습니다"}'::jsonb)
        WHERE status='running'`);
    await pool.query(`UPDATE agents SET status='idle' WHERE status='running'`);

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
    // 5차: 미소 프롬프트 작성 연결 반영 (이미지/영상 생성은 대표가 Gemini에서 직접 — 자동 생성 없음)
    await pool.query(`UPDATE agents SET description = '시안 방향·Gemini 이미지/영상 프롬프트 제작 (✅ 프롬프트 작성 연결됨 — 5차 · 생성은 대표가 Gemini에서 직접)'
        WHERE code = 'miso' AND is_deleted = false`);

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
            isCompleted: r.is_completed || false
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
    const invRes = await pool.query('SELECT id, product_name, company_stock, daesong_stock, base_date, updated_at FROM box_inventory ORDER BY id');
    const byName = {};
    invRes.rows.forEach(r => {
        byName[r.product_name] = {
            id: r.id,
            productName: r.product_name,
            company: Number(r.company_stock) || 0,
            daesong: Number(r.daesong_stock) || 0,
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
        } else {                       // transfer: 시온 이동
            box.company -= q;
            box.daesong += q;
        }
    }

    // 정산 차감 (대성 정산) — 기준일 이후만, 날짜별 박스타입 매핑 (history와 동일 로직)
    const setts = await pool.query('SELECT date, items FROM settlements WHERE partner = $1 ORDER BY date', ['대성(시온)']);
    const mapCache = {};
    for (const s of setts.rows) {
        const d = normDateSafe(s.date);
        const items = (typeof s.items === 'string' ? JSON.parse(s.items) : s.items) || [];
        if (items.length === 0) continue;
        if (!(d in mapCache)) mapCache[d] = (await getDaesongBoxTypeMap(d)).boxTypeMap;
        const btMap = mapCache[d];
        for (const it of items) {
            const bt = btMap[it.name];
            if (!bt) continue;
            const box = byName[bt];
            if (!box) continue;
            if (box.baseDate && !(d > box.baseDate)) continue;
            box.daesong -= (Number(it.qty) || 0);
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
            baseDate: b.baseDate,
            updatedAt: b.updatedAt
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/box-inventory/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { companyStock, daesongStock } = req.body;
        // [A안] 수동 수정 = 기준값(base) 재설정 + 기준일을 오늘로 → 이후 입출고만 자동 반영
        await pool.query(
            'UPDATE box_inventory SET company_stock = $1, daesong_stock = $2, base_date = CURRENT_DATE, updated_by = $3, updated_at = NOW() WHERE id = $4',
            [companyStock, daesongStock, req.user.id, req.params.id]
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
        if (!['order', 'transfer'].includes(movementType)) return res.status(400).json({ error: 'movementType은 order 또는 transfer' });
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
                    type: 'transfer',             // 업체 → 대성 이동
                    qty: Number(m.qty) || 0,
                    sign: 0,                      // 회사 전체 합은 변동 없음 (재배치)
                    stockTarget: 'transfer',
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
                    // 3차: 특징 기반 매칭 (과일명+용도+중량+꼬마여부)
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
async function getDaesongBoxTypeMap(dateStr) {
    const pr = await pool.query(
        `SELECT items FROM pricing
         WHERE partner = $1 AND start_date <= $2::date AND end_date >= $2::date
         ORDER BY id ASC`,
        ['대성(시온)', dateStr]
    );
    const boxTypeMap = {};
    pr.rows.forEach(r => (r.items || []).forEach(p => {
        if (p.boxType && p.boxType !== '해당없음') boxTypeMap[p.name] = p.boxType;
    }));
    return { boxTypeMap, count: pr.rows.length };
}

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
                    // 3차: 특징 기반 매칭 (과일명+용도+중량+꼬마여부)
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
    const wMatch = t.match(/(\d+)\s*kg/i);
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

// === Lunch Menu API ===

app.get('/api/lunch/menus', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM lunch_menus ORDER BY category, name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lunch/menus', authMiddleware, async (req, res) => {
    try {
        const { name, category } = req.body;
        if (!name) return res.status(400).json({ error: '식당 이름은 필수입니다' });
        const actualCategory = category || '기타';
        const result = await pool.query('INSERT INTO lunch_menus (name, category) VALUES ($1, $2) RETURNING *', [name, actualCategory]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/lunch/menus/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM lunch_menus WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lunch/today', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const restaurants = await pool.query('SELECT id, name FROM lunch_menus ORDER BY name');
        const session = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);

        if (session.rows.length === 0) {
            return res.json({ restaurants: restaurants.rows, session: null, votes: [], myVote: null });
        }

        const s = session.rows[0];
        const votes = await pool.query(
            'SELECT v.menu_name, v.user_id, u.name as user_name, u.color as user_color FROM lunch_votes v JOIN users u ON v.user_id = u.id WHERE v.session_id = $1',
            [s.id]
        );
        const myVote = votes.rows.find(v => v.user_id === req.user.id);
        res.json({ restaurants: restaurants.rows, session: { id: s.id, date: s.date }, votes: votes.rows, myVote: myVote ? myVote.menu_name : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lunch/recommend', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const existing = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);
        if (existing.rows.length > 0) {
            const s = existing.rows[0];
            const votes = await pool.query(
                'SELECT v.menu_name, v.user_id, u.name as user_name, u.color as user_color FROM lunch_votes v JOIN users u ON v.user_id = u.id WHERE v.session_id = $1',
                [s.id]
            );
            const myVote = votes.rows.find(v => v.user_id === req.user.id);
            return res.json({ session: { id: s.id, date: s.date, menus: s.menus }, votes: votes.rows, myVote: myVote ? myVote.menu_name : null, isNew: false });
        }

        const allMenus = await pool.query('SELECT name, category FROM lunch_menus ORDER BY RANDOM() LIMIT 6');
        if (allMenus.rows.length === 0) return res.status(400).json({ error: '등록된 메뉴가 없습니다' });

        const menus = allMenus.rows.map(m => ({ name: m.name, category: m.category }));
        const result = await pool.query(
            'INSERT INTO lunch_sessions (date, menus) VALUES ($1, $2) RETURNING *',
            [today, JSON.stringify(menus)]
        );
        const s = result.rows[0];
        res.json({ session: { id: s.id, date: s.date, menus: s.menus }, votes: [], myVote: null, isNew: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lunch/vote', authMiddleware, async (req, res) => {
    try {
        const { menuName } = req.body;
        if (!menuName) return res.status(400).json({ error: '식당명은 필수입니다' });

        const today = new Date().toISOString().split('T')[0];
        let session = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);
        if (session.rows.length === 0) {
            try {
                session = await pool.query("INSERT INTO lunch_sessions (date, menus) VALUES ($1, '[]'::jsonb) RETURNING *", [today]);
            } catch (e) {
                session = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);
            }
        }
        const sessionId = session.rows[0].id;

        await pool.query(
            `INSERT INTO lunch_votes (session_id, user_id, menu_name) VALUES ($1, $2, $3)
             ON CONFLICT (session_id, user_id) DO UPDATE SET menu_name = $3, created_at = NOW()`,
            [sessionId, req.user.id, menuName]
        );

        const votes = await pool.query(
            'SELECT v.menu_name, v.user_id, u.name as user_name, u.color as user_color FROM lunch_votes v JOIN users u ON v.user_id = u.id WHERE v.session_id = $1',
            [sessionId]
        );
        const myVote = votes.rows.find(v => v.user_id === req.user.id);
        res.json({ votes: votes.rows, myVote: myVote ? myVote.menu_name : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 점심 투표 초기화
app.delete('/api/lunch/today', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const session = await pool.query('SELECT id FROM lunch_sessions WHERE date = $1', [today]);
        if (session.rows.length > 0) {
            await pool.query('DELETE FROM lunch_votes WHERE session_id = $1', [session.rows[0].id]);
            await pool.query('DELETE FROM lunch_sessions WHERE id = $1', [session.rows[0].id]);
        }
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

// === AI Workspace API ===

const AI_SYSTEM_PROMPTS = {
    marketing: `═══════════════════════════════════════════
📱 제주아꼼이네 문자·톡톡 발송 전문가 V2 (통합 완성판)
═══════════════════════════════════════════
너는 제주아꼼이네 농업회사법인(주)의 문자(알리고 SMS/LMS) 및
네이버 톡톡 발송용 카피를 전담하는 전문가다.
범 대표님(전승범 CEO)의 지시를 받아 즉시 발송 가능한
완성형 카피를 만들어낸다.
너는 단순 카피 생산기가 아니라, 가이드북·라임·규격을
모두 내재화한 마케팅 자산팀이다.
═══════════════════════════════════════════
🚨 최우선 원칙 — 절대 위반 금지
═══════════════════════════════════════════
아래 수록된 "실전 정답지 톤 앵커"의 톤을 그대로 재현해야 한다.
정답지 톤을 벗어난 카피는 모두 부적격이다.
카피 작성 시 반드시 "표준 LMS 10블록 구조"를 그대로 따른다.
임의 변형 금지. 블록 순서 변경 금지.
핵심 라임은 검증된 표현을 그대로 활용한다.
"(광고)제주아꼼이네입니다^^" (첫 줄 고정)
"항상 믿고 찾아주시는 아꼼이네 VIP 고객님께 먼저 안내드립니다!"
"고객님, 저희 ○○ 기억하세요?"
"고객님, 솔직하게 말씀드릴 게 있어요."
"정말 자신 있게 강력 추천드리오니, 이번 마지막 기회 꼭 잡으세요~~!^^"
"올해도 정성껏 골라 담아드리겠습니다."
"매년 찾아주셔서 너무 감사합니다!!"
═══════════════════════════════════════════
🌟 회사 비전 (모든 카피의 영혼)
═══════════════════════════════════════════
"단순한 온라인 판매를 넘어, 제주의 맛과 문화를
대한민국 어디서든 — 그리고 세계에서도 경험하게 한다."
최종 목표: 제주 농식품 1위 → 코스닥 상장
3대 철학:
① 고객 최우선 (찐 고객·친근한 CS·재구매 신뢰)
② 직원이 편한 시스템
③ 제주 브랜드화
═══════════════════════════════════════════
💎 카피 작성 5대 원칙
═══════════════════════════════════════════
【명분 우선】 명분 없는 할인은 절대 금지
시즌·이정표·고객관계·상품특성·행사 명분 중 하나 필수
"특가" → ❌ / "5,000평 새출발 감사 특가" → ✅
【숫자 명시】 모호함 절대 금지
"중량 업" → ❌ / "3kg → 5kg" → ✅
"할인" → ❌ / "2,000원 쿠폰" → ✅
【신뢰 우선】 과장·허위 절대 금지
모든 셀링 포인트는 사실 기반
"100% 무료 반품" 자신감 약속
【재구매 유도】 단골 자산 강화
"기억하세요?" / "또 그 시기가 왔어요" 톤
VIP 우대감 ("먼저 알려드립니다")
【제주 정체성】 차별화 핵심
"5,000평 귤밭 직접 재배"
"아꼼이가 직접 골랐어요"
"제주 농부의 정성"
═══════════════════════════════════════════
🏷️ 명분 라이브러리 (5가지 카테고리)
═══════════════════════════════════════════
모든 행사·할인은 아래 5가지 중 하나 이상의 명분을 반드시 가진다.
【① 회사 성장·이정표 명분】
농업회사법인 새출발 감사 (2025 법인 전환)
자사몰 akkome.com 오픈 기념
체험장 3,000명 돌파 감사
5,000평 귤밭 매입 기념 (2026 하반기)
(예정) 선과장 오픈 / 직영 판매장 / 육지 거점 / F&B 본점 / 해외 첫 수출 / 코스닥 상장
【② 계절·제철 명분】 (가장 자주 사용, 신뢰도 최강)
지금이 1년 중 가장 맛있을 때 (제철 정점)
첫 수확분 한정 입고 / 출하 마지막 주
이 시기 놓치면 내년을 기다려야 합니다
초반 ○○이 1년 중 가장 ○○ (미니밤호박: 초반 포슬포슬)
한 달 먼저 익은 신품종 (애플초당)
【③ 고객 관계 명분】 (아꼼이네 차별화 핵심)
VIP 단골 고객님께만 먼저 / 단골 전용 사전 안내
재구매 고객 감사 (작년 구매자 우선)
1년 만에 돌아온 제철 인사
매년 찾아주시는 분들께 감사 보답
【④ 상품 특성 명분】
한정 수량 입고 / 농장 직접 수확분만
신상품 첫 출시 기념 / 검증된 품질만
왁스코팅 0% (레몬) / 후숙 불필요 (하우스한라봉)
자연 변수로 인한 미니 사이즈 / 못난이 = 맛은 같고 모양만
【⑤ 행사·시즌 명분】 (연간 캘린더)
1월 설날 선물 / 2월 졸업·입학 / 5월 가정의 달(어버이날·어린이날·스승의날)
6월 여름 제철 시작 / 7~8월 휴가철·여름 보양
9월 추석 선물 / 11월 김장·연말 감사 / 12월 연말 선물·송년
【명분 조합 전략】 명분 2~3개 조합 시 효과 폭발
2중: 계절② + 고객관계③ = "제철 맞아 단골 고객님께 먼저"
3중: 가정의 달⑤ + 제철 정점② + 쿠폰 마감④
4중(역대급): 신품종 첫 도전④ + 비 정직 명분④ + 단골 우대③ + 150박스 한정④
【금지 → 권장 표현 변환표】
"특가 세일!" → "VIP 고객님께 먼저 드리는 한정 혜택"
"할인 진행 중" → "농업회사법인 새출발 감사 이벤트"
"오늘만 싸게" → "이 시기 놓치면 내년을 기다리셔야 합니다"
"재고떨이" → "첫 수확분 한정 — 단골 고객님께 먼저"
"묻지마 할인" → "5,000평 귤밭 직접 수확 감사"
"땡처리" → "수확 종료 임박 — 마지막 주문 기회"
"대박 할인" → "신품종 첫 출시 기념 미니 특가"
═══════════════════════════════════════════
✨ 검증된 킬러 카피 자산 (그대로 활용 권장)
═══════════════════════════════════════════
【손실 회피】 "★ 놓치면 억울할 수 있습니다 ★" (단독 박스 강조 시 클릭률 최강)
【자신감】
"정말 자신 있게 강력 추천드리오니, 이번 마지막 기회 꼭 잡으세요"
"100% 무료 반품 — 그만큼 자신 있게 보내드립니다."
"이 정도 자신감, 아무나 못 합니다."
"당도 폭발! 한 입에 깜짝 놀라실 겁니다."
"부모님 한 입 드시고 '어디서 샀니?' 물어보실 거예요."
【재소환 (단골)】
"고객님, 저희 ○○ 기억하세요?"
"작년에 보내드렸던 그 ○○입니다."
"또 그 시기가 왔어요."
"작년에 너무 맛있다고 해주셨던 그 ○○입니다."
"'올해 ○○ 언제 나와요?' 물어봐 주신 고객님,"
【선점·우대】
"VIP 고객님께만 먼저 안내드립니다."
"단골 고객님께 가장 먼저 알려드립니다."
"먼저 살짝 귀띔드립니다 :)"
【정직 마케팅 (약점 → 자신감 반전)】
"솔직하게 말씀드릴게요." / "부끄럽지만 솔직하게 말씀드려요."
"비가 너무 많이 와서 크기 작은 녀석들이 좀 나왔습니다. 그런데 — 작다고 맛까지 작은 건 아니거든요!"
"마트 기준엔 못 미치지만, 한 입 베어물어보고 자신이 생겼어요."
"맛은 그대로, 크기만 미니. 그래서 특가입니다."
"알이 꽉 차서 오히려 더 달고 아삭합니다."
【제철·시즌】
"지금이 1년 중 가장 맛있을 때입니다."
"당도도 향도 1년 중 정점입니다."
"이 시기 지나면 내년을 기다리셔야 합니다."
"1년에 딱 이맘때만 만나는 ○○이에요."
"드디어 올해 첫 수확이 시작됐어요."
【마감·긴박감】
"○○박스 한정 — 소진 시 종료!"
"이번 주 일요일까지만 한정!"
"연휴 끼면 도착이 늦어지니 찾으실 거면 지금 바로 챙기세요."
이중·삼중 마감 조합: 수량 마감 + 쿠폰 마감 + 배송 마지노선
【감사 마무리】
"매년 찾아주셔서 너무 감사합니다!!"
"올해도 정성껏 골라 담아드리겠습니다."
"문의사항은 편하게 연락 주시면 친절하고 빠르게 도와드리겠습니다"
═══════════════════════════════════════════
📐 표준 LMS 10블록 구조 (반드시 이 순서!)
═══════════════════════════════════════════
【블록 1】 첫 인사 (절대 고정)
(광고)제주아꼼이네입니다^^
【블록 2】 VIP 우대 인사 (상황별 4가지 패턴)
패턴 A — VIP 안내 톤 (시즌 행사·마감 임박·신상품 출시):
"항상 믿고 찾아주시는
아꼼이네 VIP 고객님께 먼저 안내드립니다!"
패턴 B — 단골 재소환 톤 (작년 구매 고객 재구매):
"고객님, 저희 ○○ 기억하세요?"
또는 "고객님, 작년에 보내드렸던 저희 ○○ 기억하세요?"
패턴 C — 정직 진입 톤 (약점 솔직 + 자신감 반전):
"고객님, 솔직하게 말씀드릴 게 있어요."
또는 "고객님, 부끄럽지만 솔직하게 말씀드려요."
패턴 D — 궁금증 자극 톤 (단골이 기다리던 시즌):
""올해 ○○ 언제 나와요?" 물어봐 주신 고객님,"
【블록 3】 핵심 안내 (상품·시즌·명분 설명)
왜 지금 안내되는지 명분 설명
정직한 톤으로 상황 (필요 시 약점도 솔직히)
제철·신선도·차별점 자연스럽게 녹임
신상품: "올해 처음 도전한", "단골 고객님께 가장 먼저"
단골 재구매: "작년에 너무 맛있다고 해주셨던"
【블록 4】 ★ 박스 강조 (필수, 절대 생략 금지)
━━━━━━━━━━━━━━━━━━
★ 핵심 셀링 포인트 1 (제철·당도·신선도)
★ 핵심 셀링 포인트 2 (차별화·자신감)
★ 핵심 셀링 포인트 3 (마감·한정·특가)
━━━━━━━━━━━━━━━━━━
【블록 5】 혜택 안내 (3가지 구조 권장)
가격 인하 / 미니 특가
○○원 할인쿠폰 (~날짜 마감)
추가 이벤트 (한 박스 더, 사은품 등)
또는 ◆ 기호로 강조:
◆ ○○원 추가 할인쿠폰 (~날짜)
◆ (1 ID당 1회 / 기간 한정)
【블록 6】 한정·마감 강조
▶ ○○박스 한정 — 소진 시 종료
▶ 현재 주문 시 ○월 ○일 일괄 발송
▶ 맛 아쉬우시면 100% 무료 반품
【블록 7】 강력 추천 마무리 (검증 라임)
"정말 자신 있게 강력 추천드리오니,
이번 마지막 기회 꼭 잡으세요~~!^^"
【블록 8】 감사 + 안내 (따뜻한 클로징, 검증 라임)
"올해도 정성껏 골라 담아드리겠습니다."
또는 "올해 첫 신품종, 단골 고객님께 가장 먼저 보내드릴 수 있어 감사합니다!!"
또는 "매년 찾아주셔서 너무 감사합니다!!"
【블록 9】 링크
▶ 제주아꼼이네 스마트스토어 ○○ 바로가기
https://smartstore.naver.com/akkome/products/[링크]
【블록 10】 VIP 혜택 블록 (절대 고정!)
─────────────────
[VIP 전용 혜택 안내]
겨울 감귤농장 체험 무료 (1인)
아꼼이네 오션라운지(카페) 아이스크림 무료 (1인)
시기별 제철 할인 우선 안내
수신 원치 않으시면 편히 말씀해 주세요.
늘 정성을 다하겠습니다. 감사합니다!
제주아꼼이네
═══════════════════════════════════════════
🎯 실전 정답지 톤 앵커 (이 톤 그대로 재현!)
═══════════════════════════════════════════
아래 2개는 범 대표님이 직접 검증한 실제 발송본이다.
새 카피 작성 시 가장 비슷한 상황의 정답지를 찾아
톤·구조를 그대로 복사 후 변형한다.
──────── 정답 앵커 #1 — 미니밤호박 (단골 재구매/감성형) ────────
(광고)제주아꼼이네입니다^^
고객님, 작년에 보내드렸던
저희 미니밤호박 기억하세요?
오늘부터 드디어 올해 첫 수확이 시작됐어요.
단골 고객님께 가장 먼저 알려드립니다.
━━━━━━━━━━━━━━━━━━
★ 오늘 수확 — 진짜 싱싱합니다!
★ 초반 호박이 1년 중 가장 포슬해요
★ 이번 주 일요일까지만 한정!
━━━━━━━━━━━━━━━━━━
수확 초반 호박이 제일 맛있는 거,
드셔보신 분은 아시잖아요.
찜기에 쪄서 한 입 베어물면
포슬포슬 밤맛이 입안 가득 퍼지는 그 맛,
작년에 너무 맛있다고 해주셨던 그 호박입니다.
이 시기 지나면 후반 호박이라
포슬한 맛이 옅어져요.
지금이 1년 중 딱 맛 좋을 때입니다.
▶ 상품 구성
▶ 1. 특품최상급 (3kg / 5kg / 10kg)
▶ 2. 중품 못난이 (3kg / 5kg / 10kg)
※ 가정에서 드시기엔 못난이도 충분히 맛있어요^^
◆ 1,000원 추가 할인쿠폰 지급 중!
◆ 오늘부터 이번 주 일요일까지만!
(1 ID당 1회 / 기간 한정)
이번 주 지나면 행사 종료됩니다.
가장 맛있는 시기, 놓치지 마세요.
올해도 정성껏 골라 담아드리겠습니다.
맛이 아쉬우시면 무료 수거 후 100% 반품,
자신 있게 보내드립니다.
▶ 미니밤호박 오늘 수확분 받기
https://smartstore.naver.com/akkome/products/[링크]
─────────────────
[VIP 전용 혜택 안내]
겨울 감귤농장 체험 무료 (1인)
아꼼이네 오션라운지(카페) 아이스크림 무료 (1인)
시기별 제철 할인 우선 안내
수신 원치 않으시면 편히 말씀해 주세요.
늘 정성을 다하겠습니다. 감사합니다!
제주아꼼이네
──────── 정답 앵커 #2 — 애플초당 마감 임박 (VIP+정직+검증 라임) ────────
(광고)제주아꼼이네입니다^^
항상 믿고 찾아주시는
아꼼이네 VIP 고객님께 먼저 안내드립니다!
올해 처음 도전한 신품종 '애플초당옥수수'
수확 판매를 시작했습니다.
기존 초당옥수수는 6월 말~7월 초에 나오는데,
이번 신품종이 한 달 먼저 익었어요.
단골 고객님께 가장 먼저 만나보실 기회입니다.
정직하게 말씀드릴게요.
비가 너무 많이 와서
크기가 작은 녀석들이 좀 나왔습니다.
━━━━━━━━━━━━━━━━━━
★ 작다고 맛까지 작은 건 아니거든요!
★ 알이 꽉 차서 더 달고 아삭합니다
★ 사과처럼 아삭한 새로운 식감!
━━━━━━━━━━━━━━━━━━
맛은 그대로, 크기만 미니.
그래서 미니 특가로 보내드립니다.
▶ 놓치면 억울할 3가지 혜택!
미니 특가 (가격 인하)
1,000원 할인쿠폰 (~6/28 일요일까지)
한 박스 더! 이벤트
※ 오늘·내일(~6/23) 주문 고객 대상
※ 6/24(화) 10명 랜덤 추첨
※ 동일 상품 1박스 더 보내드립니다!
▶ 150박스 한정 — 소진 시 종료!
▶ 현재 주문 시 내일(6/23) 일괄 발송!
▶ 맛 아쉬우시면 100% 무료 반품
정말 자신 있게 강력 추천드립니다.
이번 신품종 마지막 기회 꼭 잡으세요~~!^^
올해 첫 신품종, 단골 고객님께
가장 먼저 보내드릴 수 있어 감사합니다!!
▶ 애플초당옥수수 바로가기
https://smartstore.naver.com/akkome/products/[링크]
─────────────────
[VIP 전용 혜택 안내]
겨울 감귤농장 체험 무료 (1인)
아꼼이네 오션라운지(카페) 아이스크림 무료 (1인)
시기별 제철 할인 우선 안내
수신 원치 않으시면 편히 말씀해 주세요.
늘 정성을 다하겠습니다. 감사합니다!
제주아꼼이네
═══════════════════════════════════════════
🎨 톤별 가이드 (블록 2~3 선택용)
═══════════════════════════════════════════
【재구매·단골 톤】 (가장 많이 사용)
진입: "기억하세요?" / "작년에 보내드렸던"
본문: "또 그 시기가 왔어요" / "작년에 너무 맛있다고 해주셨던"
마무리: "올해도 정성껏 골라 담아"
【VIP 안내 톤】 (시즌 행사·마감 임박)
진입: "항상 믿고 찾아주시는 VIP 고객님께 먼저"
본문: "단골 고객님께 가장 먼저 만나보실 기회"
마무리: "정말 자신 있게 강력 추천"
【정직 솔직 톤】 (약점 있는 상품·신상품·등급 변경)
진입: "솔직하게 말씀드릴 게 있어요"
본문: "비가 많이 와서... 근데 작다고 맛까지 작은 건 아니거든요"
마무리: "100% 무료 반품 — 그만큼 자신 있게"
【감성 스토리 톤】 (가정의 달·시즌 선물)
진입: "5월이 시작됐네요" / "부모님께 정성 보낼 시간"
본문: "부모님 한 입 드시고 '어디서 샀니?' 물어보실 거예요"
마무리: "올해 5월, 정성껏 고른 ○○으로"
═══════════════════════════════════════════
📐 채널별 규격
═══════════════════════════════════════════
【알리고 SMS/LMS】
SMS: 90자 이내 (짧은 푸시·마감 임박용)
LMS: 1,000자 이내 (메인 안내·VIP 발송)
❌ 이모지(😊🎁🍊) 전부 ?로 깨짐
✅ 특수기호만 사용: ★ ▶ ◆ ━ ─
✅ 첫 줄 (광고) 표기 필수
✅ 10블록 구조 절대 준수
✅ VIP 혜택 블록 (블록 10) 절대 고정
LMS 제목란: 40byte 제한 (한글 약 13자)
【네이버 톡톡】
일반 메시지: 약 400자 이내
이미지형 카드: 제목 1줄(~30자) + 내용 8줄(~220자) + 버튼 2개(각 14자)
✅ 이모지 사용 가능 (🍊🎁⏰💥💛 등)
✅ 버튼 텍스트 최대 14자
❌ (광고) 표기 불필요 (스마트스토어 자동 처리)
링크 = 버튼으로 대체
═══════════════════════════════════════════
🏢 회사 기본 정보
═══════════════════════════════════════════
상호: 제주아꼼이네 농업회사법인(주)
대표: 전승범 (범 대표님)
사업장: 제주특별자치도 제주시
자사몰: akkome.com
스마트스토어: smartstore.naver.com/akkome
오프라인: 오션라운지 카페, 체험장, 5,000평 귤밭
주 고객층:
30~50대 여성 (특히 40~50대 비중↑)
신선도·품질 민감, 가족·지인 선물 비중 높음
첫 2줄로 클릭 결정
발송 골든타임:
오전 10~11시 (살림 정리 후)
오후 2~4시 (점심 후 여유 시간)
저녁 8~9시 (저녁 정리 후 핸드폰 보는 시간)
═══════════════════════════════════════════
🍊 상품 라인업 (시즌 + 킬러 포인트 + 권장 톤)
═══════════════════════════════════════════
【감귤·만감류】 (메인 매출)
노지한라봉 (12~3월): 노지·깊은 단맛 / 전통·정통 톤
→ "한겨울 햇살을 그대로 머금은 깊은 단맛"
하우스한라봉 (5~6월): 후숙 불필요! / 자신감·차별화 톤
→ "후숙 필요 없이 받자마자 바로 꿀맛!"
카라향·벚꽃카라향 (3~5월): 당도·향 정점 / 감성·선물 톤 (5월 가정의 달 시너지)
→ "'이거 어디서 샀니?' 부모님이 먼저 물어보시는 카라향"
천혜향·수라향 (1~2월): 고당도·선물용 / 프리미엄 톤 (설 시즌 핵심)
블러드오렌지 (3~5월): 붉은 과육 임팩트 / 독특함·신선함 톤
레몬 (4~5월, 시즌 짧음): 왁스코팅 0%! / 정직·신뢰 톤
→ "왁스코팅 0% — 껍질째 안심하고 쓰세요"
하귤 (5~6월): 감귤·자몽 중간, 새콤 청량감 / 시즌 마무리 톤
【옥수수】
애플초당 (6월 중하순): 신품종·한 달 일찍·사과 아삭함 / 정직 마케팅 톤
기존 초당 (6월 말~7월 초): 달콤한 건강 간식 / 작년 검증 라임 그대로 활용
→ "★ 놓치면 억울할 수 있습니다 ★"
【채소·나물】
취나물 (봄, 제철 짧음): 수확 즉시 발송 / "이번 주만 한정" 시기 한정 톤
미니밤호박: 초반 호박이 1년 중 가장 포슬! / 단골 재소환 톤
→ "찜기에 쪄서 한 입 베어물면 포슬포슬 밤맛이 입안 가득~"
부지갱이 (봄~여름): 제주 향토 채소 / 발견·소개 톤
당근·비트·콜라비·양배추·브로콜리: 정기 안내·발견 톤 ("○○도 준비했습니다")
【향후 라인업 (27년까지)】
고기류(흑돼지·소고기·닭): 제주 청정 자연 톤
생선류(갈치·옥돔·방어·고등어·자리돔): 당일 출항·새벽 경매 직송 톤
가공품(귤청·잼·드레싱·건귤·음료): 정성·간직·선물 톤
【모든 상품 공통 차별화 자산】
5,000평 귤밭 직접 재배 / 체험장 3,000명+ 방문
100% 무료 반품 보장 / 아꼼이 캐릭터
검증된 품목만 판매 / AI 상담 + 사람의 따뜻함
═══════════════════════════════════════════
📋 작업 처리 프로세스
═══════════════════════════════════════════
범 대표님 지시 받으면 반드시 이 순서로:
【1단계】 사전 점검
명분 정리 (2~3중 명분 조합 권장)
채널 확인 (알리고 LMS / 톡톡)
마감일·수량·혜택 숫자 확인
빠진 정보 있으면 먼저 질문 (가격·링크 등)
가격은 확정 전이면 [가격] 플레이스홀더로 작성
【2단계】 카피 작성
표준 10블록 구조 정확 준수
검증된 정답지 톤 그대로 재현
항상 3가지 버전 제공 (①안정형 / ②어그로형 / ③감성형) — 단일 지시여도 3개 안을 모두 제시해 범 대표님이 골라 쓰실 수 있게 한다
각 버전 글자 수·추천 사용처 명시
날짜는 상대 표현 우선 ("모레(수)", "이번 주 일요일까지")
【3단계】 최종 검수
10블록 구조 체크
검증 라임 사용 확인
규격 체크리스트 (이모지 X, 1,000자 이내)
발송 전 확인사항 명시
등급·스펙 변경 시 → 네이버 상세페이지 동시 수정 리마인드
【4단계】 발송 전략 제안
발송 타이밍 추천 (골든타임)
1차·2차·3차 발송 시퀀스 (초기 안내 → 쿠폰 마감 리마인드 → 추첨 결과 발표)
LMS 제목 추천 (40byte = 한글 13자)
【5단계】 후속 액션 제안
마감 임박 푸시 / 후기 유도
인접 카테고리 확장 / 재구매 사이클 설계
═══════════════════════════════════════════
✅ 출력 형식 (반드시 이 구조!)
═══════════════════════════════════════════
🎖️ [팀장 똑똑이 - 작업 접수]
받은 지시: (한 줄 요약)
비전 연결: (이 작업이 회사 어느 단계/비전과 연결)
사전 점검: 명분·채널·정보 확인
✍️ [카피라이터 글잘이 - 작업 결과]
★ 아래 3가지 안(①안정형 / ②어그로형 / ③감성형)을 반드시 모두 제시한다.
★ 실제 발송할 "완성본(팩트)"은 아래 배너 구분선(┏┓┗┛)으로 감싸, 설명 부분과 확연히 구별되게 한다.
★ 이 화면은 마크다운이 렌더링되지 않는 평문 환경이다 → 코드블록(백틱 3개)·굵게(별표 2개) 절대 사용 금지. 강조는 오직 구분선·기호(┏┓┗┛ ━ │ ★ ▶ ◆ ─ ○)로만 한다.
★ ┏┓┗┛가 들어간 배너 줄은 발송 시 복사 대상이 아니다 (대표님은 배너 "안쪽"만 복사). 발송본 안에는 이모지 절대 금지.
★ 3개 안은 각각 표준 10블록 구조를 완전히 갖춘 완성본이어야 한다 (요약·생략 금지).

── 각 안 출력 형식 (이 틀 그대로) ──

┏━━━━━━━━━ 【①안 · 안정형 발송본】 ━━━━━━━━━┓
(광고)제주아꼼이네입니다^^
[10블록 완성 본문 그대로 — 정석 VIP 안내 톤]
제주아꼼이네
┗━━━━━━━━━━━━ ①안 끝 ━━━━━━━━━━━━┛
▸ 글자 수: ○○자 (1,000자 이내)  │  추천 사용처: ○○  │  핵심 키워드: ○○

┏━━━━━━━━━ 【②안 · 어그로형 발송본】 ━━━━━━━━━┓
[10블록 완성 본문 그대로 — 손실회피·긴박감·마감 강조 톤]
┗━━━━━━━━━━━━ ②안 끝 ━━━━━━━━━━━━┛
▸ 글자 수: ○○자  │  추천 사용처: ○○  │  핵심 키워드: ○○

┏━━━━━━━━━ 【③안 · 감성형 발송본】 ━━━━━━━━━┓
[10블록 완성 본문 그대로 — 단골 재소환·스토리·따뜻함 강조 톤]
┗━━━━━━━━━━━━ ③안 끝 ━━━━━━━━━━━━┛
▸ 글자 수: ○○자  │  추천 사용처: ○○  │  핵심 키워드: ○○
🎖️ [팀장 똑똑이 - 최종 검수 & 보고]
✅ 10블록 구조 체크
✅ 검증 라임 사용 확인
✅ 알리고 규격 (이모지 X, 기호만 O)
✅ VIP 블록 + 수신거부 포함
발송 전 채워야 할 곳:
[링크] 자리에 스마트스토어 URL
[가격] 확정가 삽입 (발송 직전)
💬 범 대표님께 한마디:
3개 안 중 상황별 추천 (예: "이번 건은 ②안 추천 — 마감 임박이라 긴박감이 먹힙니다")
추천 발송 타이밍
LMS 제목 추천
후속 액션 제안
비전 연결 코멘트
═══════════════════════════════════════════
🚨 절대 위반 금지 사항 정리
═══════════════════════════════════════════
❌ "(광고)제주아꼼이네입니다^^" 변경
❌ VIP 우대 인사 블록 생략
❌ ★ 박스 강조 (━━ + ★) 생략
❌ 이모지 사용 (😊🎁🍊 등) — 알리고에서 전부 ? 깨짐
❌ VIP 혜택 블록 + 수신거부 생략
❌ 명분 없는 "특가" "할인" 표현
❌ 과장·허위·모호 표현
❌ 검증 라임 임의 변경
❌ 표준 10블록 순서 변경
✅ 항상 검증된 정답지 톤 앵커의 톤을 그대로 재현
✅ 표준 10블록 구조를 정확히 따름
✅ 명분이 살아있는 카피 (2~3중 조합 권장)
✅ 단골 우대·재구매 유도 톤
✅ 정직·자신감 균형
✅ 친근하고 따뜻한 마무리
✅ 항상 3개 안(안정형/어그로형/감성형)을 모두 제시
✅ 발송본(팩트)은 배너 구분선(┏┓┗┛)으로 감싸 설명과 확연히 구별
✅ 평문 환경이므로 마크다운(백틱 코드블록·별표 굵게) 사용 금지 — 기호·구분선으로만 강조
═══════════════════════════════════════════
준비됐습니다, 범 대표님!
작업 지시를 내려주시면 위 표준 구조와 정답지 톤 그대로
즉시 발송 가능한 완성형 카피를 만들어드리겠습니다.
🍊 제주에서 시작해, 세계로 나아가는 회사의
문자·톡톡 마케팅을 전담하겠습니다.`,
    qna: '당신은 친절하고 똑똑한 AI 어시스턴트입니다. 사용자가 궁금한 것을 무엇이든 물어보면 정확하고 이해하기 쉽게 답변해줍니다. 일상적인 질문, 업무 관련 질문, 상식, 아이디어 등 다양한 주제에 대해 도움을 줍니다.',
    document: '당신은 문서 작성 전문 도우미입니다. 보고서, 공문, 안내문, 이메일, 회의록, 기획서 등 다양한 업무 문서를 작성하거나 수정하는 것을 도와줍니다. 명확하고 깔끔한 문체로 작성하며, 사용자의 요청에 맞는 적절한 형식과 톤을 사용합니다.',
    cs: '당신은 제주아꼼이네 농업회사법인의 CS(고객상담) 답변 도우미입니다. 고객 문의, 클레임, 교환/반품, 배송 관련 답변을 작성해줍니다. 정중하고 공감하는 톤으로, 고객이 만족할 수 있도록 답변합니다. 제주 감귤, 천혜향, 레드향, 한라봉 등 제주 과일을 판매하는 업체입니다.',
    general: '당신은 다재다능한 AI 어시스턴트입니다. 대화, 질문 답변, 아이디어 브레인스토밍, 번역, 요약, 분석 등 다양한 작업을 도와줍니다. 사용자의 요청에 맞게 유연하게 대응하며, 친절하고 유용한 답변을 제공합니다.'
};
const AI_SYSTEM_PROMPT = AI_SYSTEM_PROMPTS.marketing; // 기본값 (하위 호환)

app.get('/api/ai/conversations', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT c.id, c.title, c.category, c.user_id, c.created_at, u.name as user_name FROM ai_conversations c JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/conversations/:id', authMiddleware, async (req, res) => {
    try {
        const conv = await pool.query(
            'SELECT c.*, u.name as user_name FROM ai_conversations c JOIN users u ON c.user_id = u.id WHERE c.id = $1',
            [req.params.id]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        const messages = await pool.query(
            "SELECT m.id, m.role, m.content, m.message_type, m.created_at, CASE WHEN m.role = 'user' THEN COALESCE(u.name, cu.name) ELSE 'AI' END as sender_name FROM ai_messages m LEFT JOIN users u ON m.sender_user_id = u.id LEFT JOIN users cu ON cu.id = (SELECT user_id FROM ai_conversations WHERE id = m.conversation_id) WHERE m.conversation_id = $1 ORDER BY m.created_at ASC",
            [req.params.id]
        );
        res.json({ conversation: conv.rows[0], messages: messages.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/conversations', authMiddleware, async (req, res) => {
    try {
        const { title, category } = req.body || {};
        const validCategory = AI_SYSTEM_PROMPTS[category] ? category : 'marketing';
        const result = await pool.query(
            'INSERT INTO ai_conversations (user_id, title, category) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, title || '새 대화', validCategory]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ai/conversations/:id', authMiddleware, async (req, res) => {
    try {
        const conv = await pool.query('SELECT user_id FROM ai_conversations WHERE id = $1', [req.params.id]);
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });
        if (conv.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '삭제 권한이 없습니다' });
        }
        await pool.query('DELETE FROM ai_conversations WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 대화방 이름 수정
app.put('/api/ai/conversations/:id/title', authMiddleware, async (req, res) => {
    try {
        const { title } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: '이름을 입력해주세요' });
        const conv = await pool.query('SELECT user_id FROM ai_conversations WHERE id = $1', [req.params.id]);
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });
        if (conv.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '수정 권한이 없습니다' });
        }
        await pool.query('UPDATE ai_conversations SET title = $1 WHERE id = $2', [title.trim(), req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/chat', authMiddleware, async (req, res) => {
    try {
        const { conversationId, message, image, imageMimeType } = req.body;
        if (!conversationId) return res.status(400).json({ error: '대화 ID는 필수입니다' });
        if (!message && !image) return res.status(400).json({ error: '메시지 또는 이미지는 필수입니다' });

        const userMessage = message || '이 이미지를 분석해주세요';

        // 대화 존재 확인
        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1',
            [conversationId]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        // 사용자 메시지 저장
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type, sender_user_id) VALUES ($1, $2, $3, 'text', $4)",
            [conversationId, 'user', image ? `📎 ${userMessage}` : userMessage, req.user.id]
        );

        let assistantContent;

        if (image) {
            // 이미지 포함 → Gemini API 사용
            if (!process.env.GEMINI_API_KEY) {
                return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다' });
            }

            const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await genai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: imageMimeType || 'image/jpeg', data: image } },
                        { text: userMessage }
                    ]
                }]
            });

            // Gemini 응답에서 텍스트 추출
            if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                const parts = response.candidates[0].content.parts || [];
                assistantContent = parts.filter(p => p.text).map(p => p.text).join('\n') || 'AI가 응답을 생성하지 못했습니다.';
            } else {
                assistantContent = 'AI가 응답을 생성하지 못했습니다.';
            }
        } else {
            // 텍스트만 → 기존 Claude API 사용
            if (!process.env.ANTHROPIC_API_KEY) {
                return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다' });
            }

            // 기존 메시지 히스토리 로드 (텍스트만, 기존 NULL 데이터 호환)
            const history = await pool.query(
                "SELECT role, content FROM ai_messages WHERE conversation_id = $1 AND (message_type = 'text' OR message_type IS NULL) ORDER BY created_at ASC",
                [conversationId]
            );

            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const aiResponse = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 8192,
                system: AI_SYSTEM_PROMPTS[conv.rows[0].category] || AI_SYSTEM_PROMPTS.marketing,
                messages: history.rows.map(m => ({ role: m.role, content: m.content }))
            });

            assistantContent = aiResponse.content[0].text;
        }

        // AI 응답 저장
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type) VALUES ($1, $2, $3, 'text')",
            [conversationId, 'assistant', assistantContent]
        );

        res.json({ reply: assistantContent });
    } catch (err) {
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.statusCode || err?.code;
        console.error('AI 채팅 오류:', { status, message: errMsg, name: err?.name });

        const isNotFound = status === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND');
        const is429 = status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
        const isAuth = status === 401 || status === 403 || errMsg.includes('API_KEY') || errMsg.includes('PERMISSION_DENIED');

        if (isNotFound) {
            res.status(500).json({ error: 'AI 모델을 찾을 수 없습니다. 관리자에게 문의해주세요.' });
        } else if (is429) {
            res.status(429).json({ error: 'API 요청 한도 초과입니다. 잠시 후 다시 시도해주세요.' });
        } else if (isAuth) {
            res.status(500).json({ error: 'API 인증 오류입니다. 관리자에게 문의해주세요.' });
        } else {
            res.status(500).json({ error: `AI 응답 생성 오류: ${errMsg.substring(0, 100)}` });
        }
    }
});

// === AI 이미지 생성 (Gemini) ===
app.post('/api/ai/image', authMiddleware, async (req, res) => {
    try {
        const { conversationId, prompt, referenceImage, referenceImageMimeType } = req.body;
        if (!conversationId || !prompt) return res.status(400).json({ error: '대화 ID와 프롬프트는 필수입니다' });

        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1',
            [conversationId]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        // 사용자 메시지 저장
        const saveMsg = referenceImage ? `📎🎨 ${prompt}` : prompt;
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type, sender_user_id) VALUES ($1, 'user', $2, 'text', $3)",
            [conversationId, saveMsg, req.user.id]
        );

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다' });
        }

        const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Gemini에 보낼 contents 구성
        const parts = [];
        if (referenceImage) {
            parts.push({ inlineData: { mimeType: referenceImageMimeType || 'image/jpeg', data: referenceImage } });
        }
        parts.push({ text: prompt });

        // Gemini 이미지 생성 함수 (재시도 로직 포함)
        const generateImage = async (retryCount = 0) => {
            try {
                return await genai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: [{ role: 'user', parts }],
                    config: {
                        responseModalities: ['Text', 'Image']
                    }
                });
            } catch (apiErr) {
                const status = apiErr?.status || apiErr?.statusCode || apiErr?.code;
                const errMsg = apiErr?.message || String(apiErr);
                const is429 = status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
                console.error(`이미지 생성 API 오류 (시도 ${retryCount + 1}):`, {
                    status,
                    message: errMsg,
                    name: apiErr?.name,
                    details: apiErr?.errorDetails || apiErr?.details
                });

                if (is429 && retryCount === 0) {
                    console.log('429 quota 초과 - 30초 후 재시도합니다...');
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    return generateImage(1);
                }
                throw apiErr;
            }
        };

        const response = await generateImage();

        // 응답에서 이미지와 텍스트 추출
        let imageUrl = '';
        let revisedPrompt = '';

        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
            const parts = response.candidates[0].content.parts || [];
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                } else if (part.text) {
                    revisedPrompt = part.text;
                }
            }
        }

        if (!imageUrl) {
            return res.status(500).json({ error: '이미지 생성에 실패했습니다. 다른 프롬프트로 시도해 주세요.' });
        }

        // AI 응답 저장 (이미지 data URL + 텍스트를 JSON으로)
        const imageContent = JSON.stringify({ url: imageUrl, revised_prompt: revisedPrompt });
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type) VALUES ($1, 'assistant', $2, 'image')",
            [conversationId, imageContent]
        );

        res.json({ imageUrl, revisedPrompt });
    } catch (err) {
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.statusCode || err?.code;
        console.error('이미지 생성 오류:', { status, message: errMsg, name: err?.name, details: err?.errorDetails || err?.details });

        const is429 = status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
        const isNotFound = status === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND');
        const isAuth = status === 401 || status === 403 || errMsg.includes('API_KEY') || errMsg.includes('PERMISSION_DENIED');
        const isSafety = errMsg.includes('SAFETY') || errMsg.includes('blocked') || errMsg.includes('safety');

        if (is429) {
            res.status(429).json({ error: 'API 요청 한도 초과입니다. 잠시 후 다시 시도해주세요.' });
        } else if (isNotFound) {
            res.status(500).json({ error: 'AI 모델을 찾을 수 없습니다. 관리자에게 문의해주세요.' });
        } else if (isAuth) {
            res.status(500).json({ error: 'API 인증 오류입니다. 관리자에게 문의해주세요.' });
        } else if (isSafety) {
            res.status(400).json({ error: '안전 정책에 의해 이미지 생성이 차단되었습니다. 다른 프롬프트로 시도해주세요.' });
        } else {
            res.status(500).json({ error: `이미지 생성 실패: ${errMsg.substring(0, 100)}` });
        }
    }
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
async function svcListSchedules({ from, to }) {
    const cond = ['s.is_deleted = false'];
    const params = [];
    if (from) { params.push(from); cond.push(`s.date >= $${params.length}`); }
    if (to) { params.push(to); cond.push(`s.date <= $${params.length}`); }
    const r = await pool.query(
        `SELECT s.id, s.date, s.title, s.type, s.start_time, s.content, s.is_completed,
                s.user_id, u.name AS user_name
         FROM schedules s LEFT JOIN users u ON s.user_id = u.id
         WHERE ${cond.join(' AND ')}
         ORDER BY s.date ASC, s.id ASC`, params);
    return r.rows;
}
async function svcCreateSchedule({ date, title, type = 'normal', start_time = null, content = null, user_id }, actor) {
    if (!date || !title) throw { status: 400, message: '날짜(date)와 제목(title)은 필수입니다' };
    const uid = user_id ?? actor?.id ?? null;
    const r = await pool.query(
        `INSERT INTO schedules (user_id, date, title, type, start_time, content)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [uid, date, title, type, start_time, content]);
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
            ? await runner.result({ agent, pool, params: runParams, helpers: { matchItemToPricing, normDateSafe } })
            : { summary: '완료' };
        await agentRunAppendStep(run.id, agentStep('report', agent.name, '완료 보고'));
        if (managerName && managerName !== agent.name) {
            await agentRunAppendStep(run.id, agentStep('review', managerName, '검수 후 상신'));
        }
        await agentRunAppendStep(run.id, agentStep('done', '마루', '보고서함에 보고 등록'));
        await pool.query(`UPDATE agent_runs SET status='done', result=$2, finished_at=NOW() WHERE id=$1`,
            [run.id, JSON.stringify(result)]);
        await pool.query(`UPDATE agents SET status='done', last_run_at=NOW() WHERE id=$1`, [agent.id]);
        // 완료 배지는 프론트에서 3초 표시 — 이후 대기 상태로 복귀
        setTimeout(() => {
            pool.query(`UPDATE agents SET status='idle' WHERE id=$1 AND status='done'`, [agent.id]).catch(() => {});
        }, 5000);
    } catch (err) {
        console.error('AGENT OFFICE 실행 오류:', err.message);
        await pool.query(`UPDATE agent_runs SET status='error', result=$2, finished_at=NOW() WHERE id=$1`,
            [run.id, JSON.stringify({ summary: `오류: ${err.message}` })]).catch(() => {});
        await pool.query(`UPDATE agents SET status='error' WHERE id=$1`, [agent.id]).catch(() => {});
    }
}

// 에이전트 목록 (사무실 렌더용 — 도구/학습노트 수/최근 실행 포함)
app.get('/api/agent-office/agents', authMiddleware, adminOnly, async (req, res) => {
    try {
        const agents = (await pool.query(
            `SELECT * FROM agents WHERE is_deleted = false ORDER BY sort_order, id`)).rows;
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
            `SELECT id, status, steps, result, started_at, finished_at FROM agent_runs
             WHERE agent_id = $1 AND is_deleted = false AND is_test = false ORDER BY started_at DESC LIMIT 5`, [agent.id])).rows;
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
app.post('/api/agent-office/feedback', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { agent_id, run_id = null, feedback_type, comment = '', corrected_output = '' } = req.body || {};
        const TYPES = ['good', 'edited', 'bad', 'comment'];
        if (!agent_id || !TYPES.includes(feedback_type)) throw { status: 400, message: 'agent_id와 feedback_type(good/edited/bad/comment)은 필수입니다' };
        if (feedback_type === 'bad' && !String(comment).trim()) throw { status: 400, message: '👎 피드백은 이유 한 줄이 필요합니다 (교훈화용)' };
        let original = null;
        if (run_id) {
            const runQ = await pool.query(`SELECT result FROM agent_runs WHERE id = $1`, [run_id]);
            original = runQ.rows[0]?.result ? JSON.stringify(runQ.rows[0].result) : null;
        }
        const row = (await pool.query(
            `INSERT INTO agent_feedback (agent_id, run_id, feedback_type, original_output, corrected_output, comment)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [agent_id, run_id, feedback_type, original, corrected_output, comment])).rows[0];
        await writeAudit({
            action: 'create', targetType: 'agent_feedback', targetId: row.id,
            changes: { after: { agent_id, run_id, feedback_type, comment } },
            source: 'agent_office', actor: adminActor(req),
        });
        // 6차: ✏️/👎/💬 피드백은 교훈 후보 자동 추출 (제안 상태 — 대표 승인 후에만 활성)
        if (feedback_type !== 'good') extractLessonFromFeedback(row, adminActor(req));
        res.json({ message: '피드백이 기록되었습니다 — 교훈 후보를 정리 중입니다', feedback: row });
    } catch (err) { handleAdminErr(res, err); }
});

// 교훈 승인 — 대표 승인 시에만 '제안' → 'active' (자동 활성화 금지)
app.post('/api/agent-office/lessons/:id/approve', authMiddleware, adminOnly, async (req, res) => {
    try {
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
            `SELECT f.id, f.feedback_type, f.comment, f.corrected_output, f.created_at, f.run_id,
                    a.name AS agent_name, a.team AS agent_team,
                    r.result->>'summary' AS run_summary
             FROM agent_feedback f
             JOIN agents a ON f.agent_id = a.id
             LEFT JOIN agent_runs r ON f.run_id = r.id
             WHERE f.is_deleted = false ORDER BY f.created_at DESC LIMIT 100`);
        res.json({ feedback: r.rows });
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
            action: { type: 'string', enum: ['route', 'clarify', 'feedback', 'schedule', 'settlement_input'], description: 'route=새 작업 배정, clarify=애매해서 되묻기, feedback=기존 결과물 평가/수정, schedule=일정 조회·등록(마루 직접), settlement_input=정산현황 숫자 입력(마루 직접)' },
            team: { type: 'string', description: '배정 팀 (마케팅팀/재무팀/법무팀/개발부서/기획팀 중 하나). clarify면 빈 문자열' },
            assignee: { type: 'string', description: '담당 요원 이름 (글샘/미소/예리/세미/지율/기안/마루 중 하나). clarify면 빈 문자열' },
            task_summary: { type: 'string', description: '지시 내용 한 줄 요약' },
            reason: { type: 'string', description: '배정 근거 또는 판단 이유 한 줄' },
            clarify_question: { type: 'string', description: 'clarify일 때 대표에게 물을 질문 딱 하나. route면 빈 문자열' },
            item_keyword: { type: 'string', description: "지시에 언급된 품목 키워드 하나 (예: '하우스감귤', '카라향', '레몬'). 품목 언급이 없으면 빈 문자열" },
            period: { type: 'string', description: "기간 조건: '이번주'→'this_week', '이번달/이달'→'this_month', 특정 월(예: '6월')→'YYYY-MM' 형식(오늘 날짜 기준, 미래 월이면 작년으로), 기간 언급 없으면 빈 문자열" },
            target_date: { type: 'string', description: "재무 지시에서 특정 하루를 물으면(예: '4월 14일 정산현황') 그 날짜 YYYY-MM-DD (미래면 작년). 아니면 빈 문자열" },
            settlement_date: { type: 'string', description: 'action=settlement_input일 때 입력 대상 날짜 YYYY-MM-DD (언급 없으면 오늘). 그 외엔 빈 문자열' },
            settlement_entries: {
                type: 'array',
                description: 'action=settlement_input일 때 언급된 항목만 (미언급 항목은 넣지 않음). 그 외엔 빈 배열',
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
            feedback_kind: { type: 'string', enum: ['칭찬', '수정', '지적', '코멘트'], description: "action=feedback일 때 피드백 분류. 그 외 action이면 '코멘트'로 둘 것" },
            schedule_op: { type: 'string', enum: ['조회', '등록', '불가', '해당없음'], description: "action=schedule일 때: 조회/등록, 삭제·수정 요구면 '불가'. 그 외 action이면 '해당없음'" },
            schedule_from: { type: 'string', description: '일정 조회 시작일 YYYY-MM-DD (조회일 때만, 아니면 빈 문자열)' },
            schedule_to: { type: 'string', description: '일정 조회 종료일 YYYY-MM-DD (조회일 때만, 아니면 빈 문자열)' },
            schedule_items: {
                type: 'array',
                description: '등록할 일정 목록 (schedule_op=등록일 때만, 아니면 빈 배열)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        date: { type: 'string', description: 'YYYY-MM-DD — 애매한 표현은 오늘 기준 가장 가까운 미래 해당 날짜로 확정 제안' },
                        time: { type: 'string', description: 'HH:MM, 시간 언급 없으면 빈 문자열' },
                        title: { type: 'string', description: '일정 내용' },
                        assignee_name: { type: 'string', description: '담당자 이름 (실제 직원 명단 중에서만). 미지정이면 빈 문자열(=대표)' },
                        date_note: { type: 'string', description: "애매한 날짜 표현이었으면 원래 표현 그대로 (예: '금요일쯤'). 명확했으면 빈 문자열" },
                    },
                    required: ['date', 'time', 'title', 'assignee_name', 'date_note'],
                },
            },
        },
        required: ['action', 'team', 'assignee', 'task_summary', 'reason', 'clarify_question', 'item_keyword', 'period', 'target_date', 'feedback_kind', 'schedule_op', 'schedule_from', 'schedule_to', 'schedule_items', 'settlement_date', 'settlement_entries'],
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
    return `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE의 실장 '마루'다.
범 대표님(전승범)의 지시를 접수해 담당 팀·요원을 배정하는 것이 너의 유일한 임무다.
오늘 날짜: ${todayKst} (KST)

## 조직도
${orgLines}

## 오더 라우팅 규칙 (분야 키워드 → 배정)
${JSON.stringify(routingTable, null, 2)}

## 판단 원칙 (반드시 준수)
1. 지시가 라우팅 규칙의 어느 분야에 해당하는지 판단해 action='route'로 팀·요원을 배정한다.
2. 지시가 새 작업이 아니라 **기존 결과물에 대한 평가·수정 요구**면 (예: "아까 그 문자 요일 틀렸어", "방금 카피 너무 좋았어", "프롬프트에 돌담 빼줘") action='feedback'으로 분류한다.
   assignee=그 결과물을 만든 요원(문자·카피→글샘, 이미지·영상 프롬프트→미소, 정산 보고→세미), feedback_kind=칭찬/수정/지적/코멘트.
   어느 요원의 결과물인지 불명확하면 clarify로 되묻는다.
3. 분야가 불명확하거나 여러 해석이 가능하면 절대 추측하지 말고 action='clarify'로 되묻는다. 질문은 한 번에 딱 하나만.
4. 일정 분야는 팀 배정 없이 마루(너)가 직접 처리한다: action='schedule'.
   - 조회 ("이번주 일정 뭐 있어?", "내일 일정") → schedule_op='조회', schedule_from/to를 YYYY-MM-DD로 채운다 (이번주=오늘 기준 이번 월요일~일요일, 오늘/내일은 해당 하루).
   - 등록 ("화요일 카라향 출고 등록해줘") → schedule_op='등록', schedule_items에 각 건을 채운다.
     날짜는 반드시 YYYY-MM-DD로 확정 제안 — 애매한 표현("금요일쯤", "다음주 초")은 오늘 기준 가장 가까운 미래의 해당 날짜로 제안하고 date_note에 원래 표현을 기록한다.
     담당자는 실제 직원 명단에 있는 이름일 때만 assignee_name에 넣고, 미지정이면 빈 문자열(=대표)로 둔다.
     여러 건이면 schedule_items에 전부 담는다 (한 번에 확인받기 위해).
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
5. 여러 분야가 섞인 지시는 가장 핵심인 분야 하나로 배정하고 reason에 나머지를 언급한다.
6. 재무 지시(세미 배정)에서는 조건을 함께 추출한다:
   - item_keyword: 특정 품목이 언급되면 그 키워드만 (예: "하우스감귤 매출 얼마야?" → "하우스감귤"). 품목 언급 없으면 빈 문자열.
   - period: "이번주"→this_week, "이번달"→this_month, "6월"처럼 특정 월→YYYY-MM (오늘 날짜 기준 올해, 아직 오지 않은 월이면 작년). 기간 언급 없으면 빈 문자열.
   - target_date는 지시에 적힌 날짜를 글자 그대로 옮긴다 ("4월 5일"→"YYYY-04-05"). 하루를 더하거나 빼는 계산·조정 절대 금지.
   - 조건이 없는 재무 지시는 둘 다 빈 문자열로 두면 전체 보고서가 나간다. 조건이 없다고 clarify하지 말 것.
7. 반드시 route_order 도구를 호출해 답한다. 다른 텍스트 응답은 하지 않는다.
8. 모든 문자열 필드에는 순수한 값만 넣는다. XML/태그 문법(<parameter>, </ 등)과 <, > 문자를 절대 포함하지 않는다.
   해당 없는 문자열 필드는 빈 문자열(""), 해당 없는 배열 필드는 빈 배열([])로 둔다.`;
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
        time: maruCleanToken(i && i.time),
        title: maruCleanText(i && i.title),
        assignee_name: maruCleanToken(i && i.assignee_name),
        date_note: maruCleanText(i && i.date_note),
    }));
    return d;
}

// 날짜 파싱은 date-utils.js로 이동 (v5.0 1단계 — 월 단위 파싱 추가, 로컬 테스트 공용)

// 접수 지시 상태 갱신 헬퍼
async function maruFinishOrder(orderId, status, result, runId = null) {
    await pool.query(
        `UPDATE pending_orders SET status=$2, result=$3, run_id=$4, processed_at=NOW() WHERE id=$1`,
        [orderId, status, JSON.stringify(result), runId]);
}

// 마루 판단 호출 (오염 감지 → 재시도 → 정화 포함) — 실제 처리와 역량 테스트가 공용
async function maruDecide(content) {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다 (Render 환경변수 확인 필요)');
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = await maruBuildSystemPrompt();
    const call = async (extraNote) => {
        const msg = await anthropic.messages.create({
            model: MARU_MODEL,
            max_tokens: 800,
            system: systemPrompt + (extraNote || ''),
            tools: [MARU_ROUTE_TOOL],
            tool_choice: { type: 'tool', name: 'route_order' },
            messages: [{ role: 'user', content: `대표 지시: ${content}` }],
        });
        const tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu) throw new Error('마루 응답에서 배정 결과(tool_use)를 찾지 못했습니다');
        return tu.input;
    };
    let raw = await call();
    let polluted = maruDecisionPolluted(raw);
    // A-①: 오염 파편 실물 수집 (1차 응답 + 재시도 응답 각각) — audit 기록으로 실오염/오탐 판별
    const pollution = polluted ? { first: maruPollutionSample(raw) } : null;
    if (polluted) {
        raw = await call('\n\n※ 경고: 직전 응답의 필드 값에 XML 태그 문법이 섞여 있었다. 각 필드에는 순수한 값만 넣어라. 해당 없는 문자열 필드는 반드시 빈 문자열("")로, 배열 필드는 빈 배열로 둔다. 태그 문자(<, >)는 어떤 필드에도 절대 넣지 않는다.');
        polluted = maruDecisionPolluted(raw);
        if (polluted) pollution.retry = maruPollutionSample(raw);
    }
    return { d: maruCleanDecision(raw), polluted, pollution };
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
        await step('마루 라우팅 점검 중... (10문항)');
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
        ];
        for (const c of rc) {
            try {
                const { d, polluted } = await maruDecide(c.q);
                const actual = `${d.action}/${d.assignee || d.schedule_op || ''}${polluted ? ' (오염 재시도 발생)' : ''}`;
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
                        + `${String(d.item_keyword || '').trim() ? ' 품목=' + d.item_keyword : ''}${polluted ? ' (오염 재시도 발생)' : ''}`;
                    add('고난도', c.name, c.check(d) && !maruDecisionPolluted(d), c.exp, actual, c.q);
                } catch (e) { add('고난도', c.name, false, c.exp, '오류: ' + e.message, c.q); }
            }
            // 서버 가드 단위 검증 (0원): 존재하지 않는 날짜 판별
            add('고난도', '④-보조 서버 날짜 검증 (2026-04-31=무효)',
                isValidDateStr('2026-04-30') === true && isValidDateStr('2026-04-31') === false,
                '4-30 유효 / 4-31 무효', `4-30=${isValidDateStr('2026-04-30')} / 4-31=${isValidDateStr('2026-04-31')}`);
        }

        // ===== 세미 (코드 실행 — DB 계산값 대조) =====
        await step('세미 정산 점검 중... (8문항 — DB 대조)');
        const semiAgent = (await pool.query(`SELECT * FROM agents WHERE code = 'semi' LIMIT 1`)).rows[0];
        const semiRunner = loadAgentRunner('세미');
        const helpers = { matchItemToPricing, normDateSafe };
        const callSemi = (p) => semiRunner.result({ agent: semiAgent, pool, params: { workplace: '전체', ...p }, helpers });
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
            { name: '하우스귤 7월 (계열 매칭·하귤 제외)', p: { item_keyword: '하우스귤', period: '2026-07' }, exp: '15,779,500원 · 하귤 미포함',
              check: r => Math.abs((r.report?.product_total || 0) - 15779500) < 10 && (r.report?.items || []).every(i => !i.name.includes('하귤')),
              act: r => Math.round(r.report?.product_total || 0).toLocaleString('ko-KR') + '원' },
            { name: '없는 품목 (바나나) 정직 안내', p: { item_keyword: '바나나' }, exp: '찾을 수 없음 + 등록 품목 목록',
              check: r => r.report?.no_match === true && Array.isArray(r.report?.available_items), act: r => r.summary },
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
}

// ------------------------------------------------------------
// 7차: 마루 직접 처리 — 일정 (운영_지시규칙.md 원칙 적용)
// 조회=즉시 실행·즉답 / 등록=정리→확인 1회→실행 / 삭제=불가 안내
// 실행 기록은 서버 코드가 직접 기록 (LIVE 로그 + 보고서함)
// ------------------------------------------------------------
function kstTodayStr() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 표기 규칙: 날짜(요일) 시간 — 내용 (담당자)
function fmtScheduleLine(dateStr, time, title, assignee) {
    const ds = String(dateStr).slice(0, 10);
    const d = new Date(ds + 'T00:00:00Z');
    const day = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
    const md = `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
    return `${md}(${day})${time ? ' ' + time : ''} — ${title} (${assignee || '대표'})`;
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
    return run;
}

// 일정 지시 처리 (조회/등록 제안/불가)
async function maruHandleSchedule(order, d, actor) {
    if (d.schedule_op === '조회') {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(d.schedule_from) ? d.schedule_from : kstTodayStr();
        const to = /^\d{4}-\d{2}-\d{2}$/.test(d.schedule_to) ? d.schedule_to : from;
        const rows = await svcListSchedules({ from, to });
        const lines = rows.slice(0, 30).map(s => fmtScheduleLine(s.date, s.start_time, s.title, s.user_name));
        const summaryText = rows.length
            ? `완료: ${from}~${to} 일정 ${rows.length}건`
            : `${from}~${to} 등록된 일정이 없습니다`;
        const run = await maruRecordRun('일정 조회', summaryText, lines.slice(0, 3),
            { type: 'maru_schedule', op: '조회', from, to, items: lines, count: rows.length });
        await maruFinishOrder(order.id, '완료', {
            type: 'schedule_list', from, to, count: rows.length, items: lines.slice(0, 10), run_id: run?.id,
        }, run?.id);
        return;
    }
    if (d.schedule_op === '등록') {
        const items = (Array.isArray(d.schedule_items) ? d.schedule_items : [])
            .filter(i => i && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && String(i.title || '').trim());
        if (items.length === 0) {
            await maruFinishOrder(order.id, '질문', {
                type: 'clarify', question: '등록할 일정의 날짜와 내용을 알려주세요 (예: "화요일 카라향 출고")',
                summary: d.task_summary, reason: d.reason,
            });
            return;
        }
        // 등록은 확인 1회 필수 — 목록 전체를 보여주고 대기 (여러 건도 확인 1회)
        const formatted = items.map(i =>
            fmtScheduleLine(i.date, i.time, i.title, i.assignee_name)
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
    // 승인 → 실제 등록 (svcCreateSchedule 재사용: audit_log 자동 기록)
    const items = (pending.result && pending.result.items) || [];
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
            user_id: uid ?? actor?.id ?? undefined, // 담당자 미지정/미매칭 = 대표
        }, actor);
        created.push(fmtScheduleLine(i.date, i.time, i.title, i.assignee_name));
    }
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
async function dispatchLiveAgent(order, route, conditions, actor, mirrorOrderId = null) {
    const finish = async (status, result, runId = null) => {
        await maruFinishOrder(order.id, status, result, runId);
        if (mirrorOrderId) await maruFinishOrder(mirrorOrderId, status, result, runId);
    };
    const agentQ = await pool.query(
        `SELECT * FROM agents WHERE name = $1 AND is_deleted = false LIMIT 1`, [route.assignee]);
    const agent = agentQ.rows[0] || null;
    const condText = [conditions.item_keyword, conditions.target_date || conditions.period].filter(Boolean).join(' · ');
    const routeInfo = {
        type: 'route', team: route.team, assignee: route.assignee, summary: route.task_summary, reason: route.reason,
        conditions: (conditions.item_keyword || conditions.period || conditions.target_date) ? conditions : null,
    };

    // 실전 연결된 worker만 실제 실행 (agents/{이름}.js의 live:true — 현재 세미)
    const runner = agent ? loadAgentRunner(agent.name) : null;
    const isLive = !!(agent && runner.live && agent.role === 'worker' && agent.is_active);

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
    executeAgentTestRun(run, agent, mgr.rows[0]?.name || null, {
        workplace: '전체',
        item_keyword: conditions.item_keyword,
        period: conditions.period,
        target_date: conditions.target_date,
        order_content: order.content,
    });
    await finish('완료', { ...routeInfo, run_id: run.id }, run.id);
}

// 마루 처리 엔진: 지시 1건 분석 → 배정 → (연결된 요원이면) 실제 실행
async function processOrderWithMaru(order, actor) {
    try {
        await pool.query(`UPDATE pending_orders SET status='처리중' WHERE id=$1`, [order.id]);
        // 일정 등록 확인 대기 중이면 "응/등록해" 답변을 여기서 처리 (AI 호출 없음)
        if (await maruTryScheduleConfirm(order, actor)) return;
        // 판단 호출 (오염 감지·재시도·정화 포함) — 역량 테스트와 공용 로직
        const { d, polluted, pollution } = await maruDecide(order.content);
        if (polluted) console.warn(`마루 응답 오염 잔존 (지시 #${order.id}):`, JSON.stringify(pollution));
        await writeAudit({
            action: 'maru_route', targetType: 'pending_order', targetId: order.id,
            changes: { after: { decision: d, model: MARU_MODEL, polluted_retry: polluted, pollution_sample: pollution } },
            source: 'agent_office', actor,
        });

        // ① 애매한 지시 → 되묻기 (추측 실행 금지)
        if (d.action === 'clarify') {
            await maruFinishOrder(order.id, '질문', {
                type: 'clarify', question: d.clarify_question, summary: d.task_summary, reason: d.reason,
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
            await maruFinishOrder(order.id, '피드백', {
                type: 'feedback', target: target.name, kind: d.feedback_kind || '코멘트',
                feedback_id: fbRow.id, summary: d.task_summary, reason: d.reason,
            });
            return;
        }

        // ①-3 일정 분야 → 마루 직접 처리 (조회 즉답 / 등록 확인 1회 / 삭제 불가)
        if (d.action === 'schedule') {
            await maruHandleSchedule(order, d, actor);
            return;
        }

        // ①-4 정산현황 입력 → 마루 직접 처리 (파싱 → 확인 1회 → 부분 저장)
        if (d.action === 'settlement_input') {
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
            // 특정일: 하루 어긋남 방지 (기존 핫픽스 유지)
            if (conditions.target_date || hasExplicitDay(order.content)) {
                const explicit = parseExplicitDate(order.content, today);
                if (explicit && explicit !== conditions.target_date) {
                    console.log(`날짜 보정: 마루 '${conditions.target_date || '(없음)'}' → 원문 파싱 '${explicit}'`);
                    conditions.target_date = explicit;
                }
            }
            // 월 단위: 'N월/N월달/지난달/이번달/YYYY년 N월' — 2025-04 오해석 사고 재발 방지
            const em = parseExplicitMonth(order.content, today);
            if (em) {
                if (conditions.target_date && !hasExplicitDay(order.content)) {
                    console.log(`날짜 보정: 특정일 '${conditions.target_date}' 무효화 — 원문은 월 단위 (${em})`);
                    conditions.target_date = '';
                }
                if (em !== conditions.period) {
                    console.log(`기간 보정: 마루 '${conditions.period || '(없음)'}' → 원문 파싱 '${em}'`);
                    conditions.period = em;
                }
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
            // 1-2: 오래된 기간(3개월 이상 과거 또는 작년 이전) 조회는 복창 확인 후 실행
            const range = periodRangeOf(conditions, today);
            if (needsQueryConfirm(range, today)) {
                await maruFinishOrder(order.id, '질문', {
                    type: 'query_confirm',
                    route: { team: d.team, assignee: d.assignee, task_summary: d.task_summary, reason: d.reason },
                    conditions,
                    question: `『${range.label}(${range.from}~${range.to})』 조회로 진행할까요? ("응"으로 답해주세요)`,
                });
                return;
            }
        }
        await dispatchLiveAgent(order,
            { team: d.team, assignee: d.assignee, task_summary: d.task_summary, reason: d.reason },
            conditions, actor);
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
        if (!content) throw { status: 400, message: '지시 내용을 입력해주세요' };
        if (content.length > 500) throw { status: 400, message: '지시는 500자 이내로 입력해주세요' };
        const row = (await pool.query(
            `INSERT INTO pending_orders (content) VALUES ($1) RETURNING *`, [content])).rows[0];
        await writeAudit({
            action: 'create', targetType: 'pending_order', targetId: row.id,
            changes: { after: { content, status: row.status } },
            source: 'agent_office', actor: adminActor(req),
        });
        processOrderWithMaru(row, adminActor(req)); // 비동기 — 응답은 즉시, 결과는 폴링
        res.json({ message: '지시가 접수되었습니다 — 마루가 분석 중입니다', order: row });
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
               AND (${showHidden ? 'TRUE' : 'r.id IS NULL OR r.is_deleted = false'})
             ORDER BY o.created_at DESC LIMIT ${limit}`);
        res.json({ orders: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});

// 10차: 역량 점검 실행 (명령 한 번 — 결과는 보고서함에 '역량 점검 보고서'로 등록)
app.post('/api/agent-office/capability-test', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (!process.env.ANTHROPIC_API_KEY) throw { status: 500, message: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다' };
        if (capTestRunning) throw { status: 409, message: '역량 점검이 이미 진행 중입니다 — 완료 후 다시 실행해주세요' };
        const maru = (await pool.query(`SELECT * FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0];
        if (!maru) throw { status: 500, message: '마루 에이전트를 찾을 수 없습니다' };
        const firstStep = agentStep('order', '마루', '🧪 역량 점검 시작 — 전 요원 자동 테스트 (마루·세미·글샘·미소)');
        const run = (await pool.query(
            `INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, TRUE) RETURNING *`,
            [maru.id, JSON.stringify([firstStep])])).rows[0];
        await pool.query(`UPDATE agents SET status='running' WHERE id = $1`, [maru.id]);
        capTestRunning = true;
        executeCapabilityTest(run, adminActor(req))
            .catch(err => {
                console.error('역량 점검 실행 오류:', err.message);
                return pool.query(`UPDATE agent_runs SET status='error', result=$2, finished_at=NOW() WHERE id=$1`,
                    [run.id, JSON.stringify({ summary: `오류: ${err.message}` })]);
            })
            .finally(() => {
                capTestRunning = false;
                pool.query(`UPDATE agents SET status='idle' WHERE id = $1 AND status='running'`, [maru.id]).catch(() => {});
            });
        res.json({ message: '역량 점검을 시작했습니다 (약 2~3분 소요 — 완료 시 보고서함에 등록)', run });
    } catch (err) { handleAdminErr(res, err); }
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
            pollution_retries: retries.rows[0].c,    // 재시도: 응답 오염 감지 후 재호출
            confirm_cancels: cancels.rows[0].c,      // 복창 후 정정: 확인 단계에서 "아니" 취소
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

const MCP_SERVER_INFO = { name: '제주아꼼이네 관리', version: '1.0.0' };
const MCP_TOOLS = [
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
    });
}).catch(err => {
    console.error('DB 초기화 실패:', err);
    process.exit(1);
});
