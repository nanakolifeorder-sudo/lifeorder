const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
  return true;
}

function exists(relativePath) {
  return fs.existsSync(path.join(process.cwd(), relativePath));
}

function parseJson(relativePath) {
  JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8').replace(/^\uFEFF/, ''));
}

function checkText(relativePath, patterns) {
  const text = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  const missing = patterns.filter(pattern => !text.includes(pattern));
  if (missing.length) throw new Error(`${relativePath} missing: ${missing.join(', ')}`);
}

function report(ok, label, detail) {
  const prefix = ok ? 'OK  ' : 'MISS';
  console.log(`${prefix} ${label}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  const requiredFiles = [
    'api/index.js',
    'lib/service.js',
    'lib/quiz-crm.js',
    'public/quiz.html',
    'public/report.html',
    'public/booking.html',
    'sql/integration-phase-2-quiz-crm-schema.sql',
    'sql/integration-phase-2-demo-seed.sql',
    'scripts/run-sql-file.js',
    'scripts/phase3-smoke-test.js'
  ];

  let failures = 0;
  for (const file of requiredFiles) {
    const ok = exists(file);
    report(ok, file);
    if (!ok) failures += 1;
  }

  for (const file of ['package.json', 'vercel.json']) {
    try {
      parseJson(file);
      report(true, `${file} parses`);
    } catch (error) {
      report(false, `${file} parses`, error.message);
      failures += 1;
    }
  }

  const envLoaded = loadEnvFile(path.join(process.cwd(), '.env'));
  report(envLoaded, '.env present');
  if (!envLoaded) failures += 1;

  const databaseUrl = process.env.DATABASE_URL || '';
  const hasDatabaseUrl = /^postgres(?:ql)?:\/\//i.test(databaseUrl);
  report(hasDatabaseUrl, 'DATABASE_URL present', hasDatabaseUrl ? databaseUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@') : 'expected postgres://...');
  if (!hasDatabaseUrl) failures += 1;

  const nodeModules = exists('node_modules');
  report(nodeModules, 'node_modules present');
  if (!nodeModules) failures += 1;

  const pgModule = exists('node_modules/pg/package.json');
  report(pgModule, 'pg installed');
  if (!pgModule) failures += 1;

  try {
    checkText('vercel.json', ['"source": "/quiz"', '"source": "/report"', '"source": "/booking"']);
    report(true, 'Vercel rewrites include quiz/report/booking');
  } catch (error) {
    report(false, 'Vercel rewrites include quiz/report/booking', error.message);
    failures += 1;
  }

  try {
    checkText('public/report.html', ['/booking?', 'qrid']);
    checkText('public/quiz.html', ['/report?', 'submitQuiz']);
    checkText('public/booking.html', ['quizResultId', 'qrid']);
    report(true, 'Quiz -> report -> booking qrid chain');
  } catch (error) {
    report(false, 'Quiz -> report -> booking qrid chain', error.message);
    failures += 1;
  }

  if (failures) {
    console.log(`\nPreflight failed: ${failures} item(s) need attention before DB smoke test.`);
    process.exit(1);
  }

  console.log('\nPreflight OK. You can run migration, seed, then smoke test.');
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
