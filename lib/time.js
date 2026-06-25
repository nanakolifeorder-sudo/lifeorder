function pad2(value) {
  return String(value).padStart(2, '0');
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

function zonedDateString(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function getOffsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second || 0)
  );
  return (asUtc - date.getTime()) / 60000;
}

function zonedTimeToUtc(dateString, timeString, timeZone) {
  const [year, month, day] = dateString.split('-').map(Number);
  const [hour, minute] = timeString.split(':').map(Number);
  const guessedUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getOffsetMinutes(guessedUtc, timeZone);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60000);
}

function addDaysToDateString(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dayOfWeek(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function minutesToTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function timeToMinutes(value) {
  if (!value) return 0;
  if (value === '24:00') return 1440;
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function formatSlot(date, timeZone) {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.month}/${map.day} (${map.weekday}) ${map.hour}:${map.minute}`;
}

module.exports = {
  zonedDateString,
  zonedTimeToUtc,
  addDaysToDateString,
  dayOfWeek,
  minutesToTime,
  timeToMinutes,
  formatSlot
};
