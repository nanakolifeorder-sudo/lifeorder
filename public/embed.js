(function () {
  var cfg = window.DM_BOOKING_CONFIG || {};
  var appUrl = (cfg.appUrl || '').replace(/\/$/, '');
  var tenant = cfg.tenant || '';
  var project = cfg.project || 'LO';
  var target = document.getElementById(cfg.containerId || 'dm-booking');

  if (!target) {
    target = document.createElement('div');
    target.id = cfg.containerId || 'dm-booking';
    document.currentScript.parentNode.insertBefore(target, document.currentScript);
  }

  if (!appUrl || !tenant) {
    target.innerHTML = '<p style="font-family:Arial,sans-serif;color:#d93025;">Booking install code is missing appUrl or tenant.</p>';
    return;
  }

  var params = new URLSearchParams({
    tenant: tenant,
    p: project
  });
  if (cfg.skipForm) params.set('skipForm', 'true');

  var iframe = document.createElement('iframe');
  iframe.src = appUrl + '/booking?' + params.toString();
  iframe.title = cfg.title || 'Booking';
  iframe.style.width = '100%';
  iframe.style.minHeight = cfg.minHeight || '820px';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.setAttribute('loading', 'lazy');
  target.innerHTML = '';
  target.appendChild(iframe);
})();

