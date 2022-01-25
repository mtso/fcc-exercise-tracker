// Utilities we need
const express = require("express");
const bodyParser = require('body-parser');
const pg = require('pg');
const nanoid = require('nanoid')

const newId = nanoid.customAlphabet('abcdefghijklmnopqrstuvwxyz1234567890', 20)
const app = express();

app.use(bodyParser.urlencoded())
app.use(bodyParser.json())

const pool = new pg.Pool({
  connectionString: process.env.PGURL,
  max: 4,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

function rowToUser(row) {
  return {
    _id: row.id,
    username: row.username,
  }
}

function rowToExercise(row) {
  return {
    description: row.description,
    duration: +row.duration,
    date: row.date && row.date.toDateString(),
  }
}

app.get('/api/users', async (req, res) => {
  const client = await pool.connect()
  
  try {
    const result = await client.query(`SELECT * FROM app_user`);
    res.status(200).json(result.rows.map(rowToUser))
  } catch (err) {
    console.error(err);
    res.status(500).json({errors: ["internal_server_error"]})
  } finally {
    client.release()
  }
})

app.post('/api/users', async (req, res) => {
  const username = req.body.username;
  if (!username) {
    return res.status(400).json({ errors: ["missing_username"] })
  }

  const client = await pool.connect()
  const id = newId();
  try {
    const result = await client.query(`INSERT INTO app_user (id, username) VALUES ($1, $2)`, [id, username])
    if (result.rowCount !== 1) {
      return res.status(500).json({ errors: ["internal_server_error"] })
    } else {
      res.json({ _id: id, username })
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({errors: ["internal_server_error"]})
  } finally {
    client.release()
  }
})

app.get('/api/users/:id/logs', async (req, res) => {
  const client = await pool.connect()
  const userId = req.params.id;
  const from = req.query.from;
  const to = req.query.to;
  const limit = req.query.limit;
  
  const errors = [];

  if (!!from && !/\d{4}-\d{2}-\d{2}/.test(from)) {
    errors.push("invalid_date_from")
  }

  if (!!to && !/\d{4}-\d{2}-\d{2}/.test(to)) {
    errors.push("invalid_date_to")
  }

  if (!!limit && isNaN(limit)) {
    errors.push("invalid_number_limit")
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }
  
  try {
    const userRead = await client.query(`SELECT * FROM app_user WHERE id = $1`, [userId])
    if (userRead.rows.length < 1) {
      return res.status(400).json({errors: ["id_not_found"]})
    }

    let exerciseQuery = `SELECT * FROM exercise WHERE user_id = $1`
    const readParams = [userId]
    if (from) {
      readParams.push(from)
      exerciseQuery += ` AND date >= $` + readParams.length
    }
    if (to) {
      readParams.push(to)
      exerciseQuery += ` AND date <= $` + readParams.length
    }
    exerciseQuery += ` ORDER BY date DESC`
    if (limit !== undefined) {
      readParams.push(limit)
      exerciseQuery += ` LIMIT $` + readParams.length
    }

    const exerciseRead = await client.query(exerciseQuery, readParams)
    const log = exerciseRead.rows.map(rowToExercise)
    const user = rowToUser(userRead.rows[0])
    res.json(Object.assign({}, user, {
      count: +userRead.rows[0].exercise_count,
      log,
    }))
  } catch (err) {
    console.error(err)
    res.status(500).json({errors: ["internal_server_error"]})
  } finally {
    client.release();
  }
})

app.post('/api/users/:id/exercises', async (req, res) => {
  const userId = req.params.id;
  const description = req.body.description;
  const duration = req.body.duration;
  const date = req.body.date || null;
  const errors = [];
  
  if (!description) {
    errors.push("missing_description")
  }
  
  if (duration === undefined) {
    errors.push("missing_duration")
  }
  else if (isNaN(duration)) {
    errors.push("duration_must_be_number")
  }
  
  if (!!date && !/\d{4}-\d{2}-\d{2}/.test(date)) {
    errors.push("invalid_date")
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }

  const client = await pool.connect()
  const id = newId();

  try {
    await client.query('BEGIN')
    const userUpdate = await client.query(`UPDATE app_user SET exercise_count=exercise_count+1 WHERE id = $1`, [userId])
    if (userUpdate.rowCount < 1) {
      return res.status(400).json({errors: ["id_not_found"]})
    }

    const insertText = !!date ? 'INSERT INTO exercise (id, user_id, description, duration, date) VALUES ($1, $2, $3, $4, $5) RETURNING id' : 'INSERT INTO exercise (id, user_id, description, duration) VALUES ($1, $2, $3, $4) RETURNING id'
    const insertParams = [id, userId, description, duration];
    if (!!date) {
      insertParams.push(date);
    }
    const exerciseResult = await client.query(insertText, insertParams)
    if (exerciseResult.rowCount !== 1) {
      console.error('failed to create exercise record')
      return res.status(500).json({ errors: ["internal_server_error" ]})
    }
    await client.query('COMMIT')

    const userRead = await client.query(`SELECT * FROM app_user WHERE id = $1`, [userId])
    if (userRead.rows.length < 1) {
      return res.status(400).json({errors: ["id_not_found"]})
    }
    // Retrieve stored exercise record for potentially server-generated default date.
    const exerciseRead = await client.query(`SELECT * FROM exercise WHERE id = $1`, [id])
    if (exerciseRead.rows.length !== 1) {
      console.error('Exercise not found but should exist', id)
      return res.status(500).json({ errors: ["internal_server_error" ]})
    }
    
    const user = rowToUser(userRead.rows[0])
    const exercise = rowToExercise(exerciseRead.rows[0])

    res.json(Object.assign({}, user, exercise))
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(e)
    res.status(500).json({ errors: ["internal_server_error" ]})
  } finally {
    client.release()
  }
})

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log(`Listening on ${listener.address().port}`);
})
