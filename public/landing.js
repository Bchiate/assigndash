(function () {
  'use strict';

  const modal = document.getElementById('authModal');
  const tabs = document.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const resendBtn = document.getElementById('resendBtn');

  function show(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  function openModal(tab) {
    modal.classList.add('open');
    selectTab(tab || 'login');
  }

  function selectTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    loginForm.style.display = name === 'login' ? 'flex' : 'none';
    signupForm.style.display = name === 'signup' ? 'flex' : 'none';
    document.getElementById('loginError').textContent = '';
    document.getElementById('signupError').textContent = '';
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  document.getElementById('getStartedBtn').addEventListener('click', () => openModal('signup'));
  document.getElementById('modalClose').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('open'); });
  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

  // Supabase redirects here after the confirmation link is clicked (or fails).
  (function handleConfirmationRedirect() {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has('confirmed') && !hash.has('error_code')) return;
    history.replaceState(null, '', '/'); // drop tokens or error details from the address bar
    openModal('login');
    if (hash.has('error_code')) {
      show(document.getElementById('loginNotice'), 'That confirmation link is invalid or has expired. Log in to request a new one.');
    } else {
      show(document.getElementById('loginNotice'), 'Your email address is confirmed. Log in to continue.');
    }
  })();

  // Demo mode: offer a one-click throwaway account.
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg.demo) return;
      document.getElementById('demoBanner').hidden = false;
      document.getElementById('demoBtn').hidden = false;
      document.getElementById('getStartedBtn').classList.add('secondary');
    })
    .catch(() => {});

  document.getElementById('demoBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Starting demo...';
    const { res, data } = await postJson('/api/demo-login');
    if (res.ok) {
      window.location.href = '/dashboard';
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Try the demo';
    show(document.getElementById('landingNotice'), data.error || 'Could not start the demo.');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    show(document.getElementById('loginNotice'), '');
    resendBtn.hidden = true;
    const fd = new FormData(loginForm);
    const btn = loginForm.querySelector('.form-submit');
    btn.disabled = true;
    btn.textContent = 'Logging in...';
    try {
      const { res, data } = await postJson('/api/login', { email: fd.get('email'), password: fd.get('password') });
      if (!res.ok) {
        if (data.code === 'email_not_confirmed') resendBtn.hidden = false;
        throw new Error(data.error || 'Login failed.');
      }
      window.location.href = '/dashboard';
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  resendBtn.addEventListener('click', async () => {
    const email = new FormData(loginForm).get('email');
    resendBtn.disabled = true;
    await postJson('/api/resend-confirmation', { email });
    resendBtn.disabled = false;
    resendBtn.hidden = true;
    document.getElementById('loginError').textContent = '';
    show(document.getElementById('loginNotice'), 'If that address has an unconfirmed account, a new confirmation link is on its way.');
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('signupError');
    errEl.textContent = '';
    show(document.getElementById('signupNotice'), '');
    const fd = new FormData(signupForm);
    const btn = signupForm.querySelector('.form-submit');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    try {
      const { res, data } = await postJson('/api/register', {
        name: fd.get('name'),
        email: fd.get('email'),
        password: fd.get('password'),
      });
      if (!res.ok) throw new Error(data.error || 'Sign-up failed.');
      if (data.needsConfirmation) {
        signupForm.reset();
        show(
          document.getElementById('signupNotice'),
          `Check your inbox: we sent a confirmation link to ${fd.get('email')}. Open it, then log in.`,
        );
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
      }
      window.location.href = '/dashboard';
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
})();
