import pg from 'pg';
import { hashPassword } from './security.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const email = (process.env.INITIAL_ADMIN_EMAIL || 'admin@imdstech.net').trim().toLowerCase();
const password = process.env.INITIAL_ADMIN_PASSWORD || '';
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (password.length < 16) throw new Error('INITIAL_ADMIN_PASSWORD must contain at least 16 characters');

const pool = new Pool({ connectionString: databaseUrl });
const existing = await pool.query('select id,email from app.platform_users limit 1');
if (existing.rowCount) {
  console.log('platform admin already exists; bootstrap skipped');
  await pool.end();
  process.exit(0);
}

const result = await pool.query(`insert into app.platform_users(email,password_hash,full_name,global_role,mfa_enforced,is_active)
  values($1,$2,'IMDS Platform Owner','platform_owner',false,true)
  returning id,email,global_role`, [email, hashPassword(password)]);
console.log(`created platform owner ${result.rows[0].email}`);
await pool.end();
