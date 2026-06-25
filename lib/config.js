function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function appUrl() {
  return env('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
}

module.exports = {
  env,
  required,
  appUrl,
  ownerName: () => env('OWNER_NAME', 'DMtest'),
  ownerEmail: () => env('OWNER_EMAIL', 'ncs1491311@gmail.com'),
  ownerPassword: () => env('OWNER_PASSWORD', '1111'),
  googleRedirectUri: () => `${appUrl()}/api/oauth-callback`
};
