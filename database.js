const { Pool } = require('pg');

// ⚠️ 여기를 본인의 Supabase URI 주소로 반드시 바꾸세요!
const connectionString = 'postgresql://postgres:[qbkmc1665!!]@db.tpzsoxtjovsbzpxqxvdi.supabase.co:5432/postgres';

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

// 테이블이 없으면 자동으로 만들어주는 기능
const initDB = async () => {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, total INTEGER DEFAULT 0, cleared INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS quests (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, "desc" TEXT, xp INTEGER NOT NULL, reward_text TEXT, reward_image TEXT, start_at TEXT, due_at TEXT, event_at TEXT, repeat_days TEXT, repeat_time TEXT, last_done_date TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS history (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, quest_name TEXT NOT NULL, type TEXT NOT NULL, xp INTEGER NOT NULL, cleared_at BIGINT NOT NULL, reward_text TEXT, reward_image TEXT);
    `);
    console.log("✅ Supabase 창고 연결 및 테이블 준비 완료!");
    client.release();
  } catch (err) {
    console.error("❌ DB 연결 에러:", err);
  }
};

initDB();

// 서버 코드(server.js)를 많이 안 고쳐도 되게 도와주는 변환 도구
const convertQuery = (text) => {
  let index = 1;
  return text.replace(/\?/g, () => `$${index++}`);
};

module.exports = {
  query: (text, params) => pool.query(convertQuery(text), params),
  get: async (text, params) => {
    const res = await pool.query(convertQuery(text), params);
    return res.rows[0];
  },
  all: async (text, params) => {
    const res = await pool.query(convertQuery(text), params);
    return res.rows;
  },
  run: (text, params) => pool.query(convertQuery(text), params),
  serialize: (fn) => fn()
};