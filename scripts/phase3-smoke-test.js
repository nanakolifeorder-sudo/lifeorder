const fs = require('fs');
const path = require('path');
const { routeAction, normalizeTenant } = require('../lib/service');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
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
}

function answerPayload(config) {
  const answers = {};
  for (const question of config.questions || []) {
    if (question.type === 'multiple') {
      answers[String(question.id)] = (question.options || []).slice(0, 2).map(option => option.key);
    } else if (question.type === 'single') {
      answers[String(question.id)] = question.options?.[0]?.key || '';
    } else {
      answers[String(question.id)] = 'MVP smoke test answer';
    }
  }
  return answers;
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env'));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const tenant = normalizeTenant(process.env.TEST_TENANT || 'dm-test');
  const projectCode = String(process.env.TEST_PROJECT || 'LO').toUpperCase();
  const req = { method: 'POST', headers: {}, socket: {} };

  const config = await routeAction('getQuizConfig', { projectCode }, req, tenant);
  if (!config.success) throw new Error(config.message || 'getQuizConfig failed');
  if (!Array.isArray(config.questions) || !config.questions.length) throw new Error('No quiz questions found. Did you run the demo seed?');
  console.log(`Quiz config OK: ${config.questions.length} questions, version ${config.versionCode}`);

  const submitted = await routeAction('submitQuiz', {
    projectCode,
    name: 'MVP Smoke Test',
    email: `mvp-smoke-${Date.now()}@example.com`,
    phone: '0900000000',
    answers: answerPayload(config)
  }, req, tenant);
  if (!submitted.success) throw new Error(submitted.message || 'submitQuiz failed');
  console.log(`Submit quiz OK: ${submitted.resultId}`);

  const report = await routeAction('getQuizResult', { projectCode, qrid: submitted.resultId }, req, tenant);
  if (!report.success) throw new Error(report.message || 'getQuizResult failed');
  console.log(`Quiz result OK: ${report.resultId}`);
  console.log(`Report URL: ${submitted.reportUrl}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});

