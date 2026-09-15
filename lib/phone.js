const PHONE_COUNTRIES = Object.freeze({
  '+886': { label: '台灣 +886', placeholder: '9xxxxxxxx', pattern: /^9\d{8}$/ },
  '+852': { label: '香港 +852', placeholder: '8 碼電話', pattern: /^\d{8}$/ },
  '+86': { label: '中國 +86', placeholder: '1xxxxxxxxxx', pattern: /^1\d{10}$/ },
  '+65': { label: '新加坡 +65', placeholder: '8 碼電話', pattern: /^[3689]\d{7}$/ },
  '+60': { label: '馬來西亞 +60', placeholder: '1xxxxxxxx', pattern: /^1\d{8,9}$/ }
});

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeInternationalPhone(value, countryCode = '') {
  const dial = digits(countryCode);
  let local = digits(value);
  if (!local) return '';
  if (!dial) return local;
  if (local.startsWith(dial)) local = local.slice(dial.length);
  if (dial === '886' && local.startsWith('0')) local = local.slice(1);
  return dial + local;
}

function isValidInternationalPhone(value, countryCode = '') {
  const dial = String(countryCode || '').trim();
  const config = PHONE_COUNTRIES[dial];
  if (!config) return false;
  const normalized = normalizeInternationalPhone(value, dial);
  return config.pattern.test(normalized.slice(digits(dial).length));
}

function phoneValidationMessage(countryCode = '') {
  const config = PHONE_COUNTRIES[String(countryCode || '').trim()];
  return config ? `請輸入正確的${config.label}電話號碼。` : '請選擇國碼並輸入正確的電話號碼。';
}

module.exports = { PHONE_COUNTRIES, normalizeInternationalPhone, isValidInternationalPhone, phoneValidationMessage };
