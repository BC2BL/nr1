const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "nr1_diagnostic",
  ssl: process.env.DB_HOST && process.env.DB_HOST !== "localhost"
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;
