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
  ownerName: () => env('OWNER_NAME', 'System Owner'),
  ownerEmail: () => env('OWNER_EMAIL', ''),
  googleRedirectUri: () => `${appUrl()}/api/oauth-callback`
};
