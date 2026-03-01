require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool, types } = require('pg');

// DATE 타입을 문자열로 반환 (타임존 이슈 방지)
types.setTypeParser(1082, val => val);

const app = express();
const PORT = process.env.PORT || 3000;

// DB 연결
const dbConfig = {
    connectionString: process.env.DATABASE_URL
};
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(dbConfig);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB 테이블 자동 생성
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
        CREATE TABLE IF NOT EXISTS pricing (
            id SERIAL PRIMARY KEY,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            partner VARCHAR(50) NOT NULL,
            items JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    console.log('DB 테이블 초기화 완료');
}

// === Settlements API ===

// GET /api/settlements?month=2026-02
app.get('/api/settlements', async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            result = await pool.query(
                "SELECT * FROM settlements WHERE TO_CHAR(date, 'YYYY-MM') = $1 ORDER BY date, id",
                [month]
            );
        } else {
            result = await pool.query('SELECT * FROM settlements ORDER BY date, id');
        }
        const data = result.rows.map(row => ({
            id: row.id,
            date: row.date,
            partner: row.partner,
            amount: Number(row.amount),
            items: row.items,
            fromPricing: row.from_pricing
        }));
        res.json(data);
    } catch (err) {
        console.error('GET /api/settlements error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settlements
app.post('/api/settlements', async (req, res) => {
    try {
        const { date, partner, amount, items, fromPricing } = req.body;
        const result = await pool.query(
            'INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [date, partner, amount || 0, JSON.stringify(items || []), fromPricing || false]
        );
        const row = result.rows[0];
        res.json({
            id: row.id,
            date: row.date,
            partner: row.partner,
            amount: Number(row.amount),
            items: row.items,
            fromPricing: row.from_pricing
        });
    } catch (err) {
        console.error('POST /api/settlements error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/settlements/:id
app.delete('/api/settlements/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM settlements WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/settlements error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Pricing API ===

// GET /api/pricing
app.get('/api/pricing', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pricing ORDER BY start_date DESC, id DESC');
        const data = result.rows.map(row => ({
            id: row.id,
            startDate: row.start_date,
            endDate: row.end_date,
            partner: row.partner,
            items: row.items
        }));
        res.json(data);
    } catch (err) {
        console.error('GET /api/pricing error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/pricing (+ 정산 데이터 연동 저장)
app.post('/api/pricing', async (req, res) => {
    try {
        const { startDate, endDate, partner, items } = req.body;
        const result = await pool.query(
            'INSERT INTO pricing (start_date, end_date, partner, items) VALUES ($1, $2, $3, $4) RETURNING *',
            [startDate, endDate, partner, JSON.stringify(items || [])]
        );
        const row = result.rows[0];

        // 정산 데이터에도 연동 저장
        const totalAmount = (items || []).reduce((sum, r) => sum + (r.price || 0), 0);
        const settlementItems = (items || []).map(r => ({
            name: r.name, price: r.price, qty: 1, subtotal: r.price
        }));

        await pool.query(
            'INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1, $2, $3, $4, true)',
            [startDate, partner, totalAmount, JSON.stringify(settlementItems)]
        );

        res.json({
            id: row.id,
            startDate: row.start_date,
            endDate: row.end_date,
            partner: row.partner,
            items: row.items
        });
    } catch (err) {
        console.error('POST /api/pricing error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/pricing/:id
app.delete('/api/pricing/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pricing WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/pricing error:', err);
        res.status(500).json({ error: err.message });
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`서버 실행 중: http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('DB 초기화 실패:', err);
    process.exit(1);
});
