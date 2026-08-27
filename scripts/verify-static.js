const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = ['public/admin.html', 'public/booking.html', 'public/quiz.html', 'public/report.html', 'public/unsubscribe.html'];
let checked = 0;
for (const file of files) {
  const full = path.join(process.cwd(), file);
  const html = fs.readFileSync(full, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  scripts.forEach((source, index) => {
    new vm.Script(source, { filename: `${file}#script${index + 1}` });
    checked += 1;
  });
}
console.log(`Inline script syntax OK (${checked} scripts).`);
