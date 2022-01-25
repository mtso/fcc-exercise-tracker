const pg = require('pg');

const client = new pg.Client({
  connectionString: process.env.PGURL,
});

;(async function() {
  console.log('creating tables...')
  
  await client.connect()

  // comment out to avoid deleting any existing tables
  const res = await client.query(`DROP TABLE IF EXISTS app_user`)
  console.log(res)
  const resP = await client.query(`DROP TABLE IF EXISTS exercise`)
  console.log(resP)
  
  const result = await client.query(`CREATE TABLE IF NOT EXISTS app_user (
    id VARCHAR(20) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    exercise_count BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT idx_uniq_username UNIQUE (username)
  )`);
  console.log(result)

  const resultP = await client.query(`CREATE TABLE IF NOT EXISTS exercise (
    id VARCHAR(20) PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    description VARCHAR(255) NOT NULL,
    duration BIGINT NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE
  );
  CREATE INDEX idx_user_id ON exercise(user_id);
  CREATE INDEX idx_date ON exercise(date)`)
  console.log(resultP)
  
  console.log('created tables');
})().catch(err => console.error(err));
