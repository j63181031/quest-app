// database.js - 데이터베이스 설정 파일

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// quest.db 파일 형태로 데이터베이스 저장
const dbPath = path.join(__dirname, 'quest.db');
const db = new sqlite3.Database(dbPath);

// 서버가 켜질 때 필요한 보관함(테이블) 4개를 자동으로 만듭니다.
db.serialize(() => {
  // 1. 회원 정보 보관함
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. 프로필 (레벨, XP, 클리어 횟수 등) 보관함
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      cleared INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 3. 진행 중인 퀘스트 보관함
  db.run(`
    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      desc TEXT,
      xp INTEGER NOT NULL,
      reward_text TEXT,
      reward_image TEXT,
      start_at TEXT,
      due_at TEXT,
      event_at TEXT,
      repeat_days TEXT,
      repeat_time TEXT,
      last_done_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 4. 지난 클리어 기록 및 보관함
  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_name TEXT NOT NULL,
      type TEXT NOT NULL,
      xp INTEGER NOT NULL,
      cleared_at INTEGER NOT NULL,
      reward_text TEXT,
      reward_image TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

console.log("sqlite3 데이터베이스 준비 완료!");

module.exports = db;