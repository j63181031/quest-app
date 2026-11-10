const { Pool } = require('pg');

// ⚠️ 여기를 본인의 Supabase URI 주소로 반드시 바꾸세요! (따옴표 유지)
const connectionString = 'https://tpzsoxtjovsbzpxqxvdi.supabase.co';

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

// SQL 문법 변환기 (? 를 $1 로 바꿈)
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
  // 테이블 자동 생성 함수
  init: async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, total INTEGER DEFAULT 0, cleared INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS quests (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, "desc" TEXT, xp INTEGER NOT NULL, reward_text TEXT, reward_image TEXT, start_at TEXT, due_at TEXT, event_at TEXT, repeat_days TEXT, repeat_time TEXT, last_done_date TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS history (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, quest_name TEXT NOT NULL, type TEXT NOT NULL, xp INTEGER NOT NULL, cleared_at BIGINT NOT NULL, reward_text TEXT, reward_image TEXT);
      `);
      console.log("✅ DB 준비 완료");
    } finally {
      client.release();
    }
  }
};
