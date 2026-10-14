/* AM IPTV — frontend JS */

/* ======================================================
   TAAL-PICKER (klik buiten = sluiten)
   ====================================================== */
document.addEventListener('click', function (e) {
  if (!e.target.closest('.lang-picker')) {
    document.querySelectorAll('.lang-drop').forEach(function (d) { d.style.display = ''; });
  }
});

/* ======================================================
   SMOOTH SCROLL
   ====================================================== */
document.querySelectorAll('a[href^="#"]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    var target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

/* ======================================================
   PLAN KNOPPEN op landingspagina → /register of /checkout
   ====================================================== */
document.querySelectorAll('.plan-btn, .plan-mini-btn').forEach(function (btn) {
  btn.addEventListener('click', function (e) {
    var plan = btn.getAttribute('data-plan');
    if (!plan) return;

    // Controleer of we al ingelogd zijn (dashboard-knop)
    if (btn.classList.contains('plan-mini-btn')) {
      e.preventDefault();
      var msg = document.getElementById('checkout-msg');
      if (msg) { msg.textContent = 'Betaalpagina openen…'; msg.classList.remove('hidden'); }
      fetch('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan })
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.url) { window.location.href = data.url; }
        else if (msg) { msg.textContent = data.error || 'Fout bij aanmaken betaling'; }
      }).catch(function () {
        if (msg) { msg.textContent = 'Verbindingsfout'; }
      });
      return;
    }

    // Landingspagina: bewaar plan-keuze en ga naar register
    sessionStorage.setItem('chosen_plan', plan);
    window.location.href = '/register';
  });
});

/* Na registratie: als er een plan-keuze is, direct checkout starten */
if (window.location.pathname === '/dashboard') {
  var chosenPlan = sessionStorage.getItem('chosen_plan');
  if (chosenPlan) {
    sessionStorage.removeItem('chosen_plan');
    fetch('/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: chosenPlan })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.url) window.location.href = data.url;
    });
  }
}

/* ======================================================
   SCROLL ANIMATIES
   ====================================================== */
var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.feature-card, .plan-card, .faq-item').forEach(function (el) {
  el.classList.add('anim');
  observer.observe(el);
});

/* ======================================================
   HERO PARTICLES (canvas)
   ====================================================== */
var canvas = document.getElementById('particles');
if (canvas) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width = window.innerWidth;
  var H = canvas.height = window.innerHeight;
  var pts = [];
  for (var i = 0; i < 60; i++) {
    pts.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.5 + .5,
      vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
      a: Math.random() * .5 + .15 });
  }
  function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    pts.forEach(function (p) {
      p.x = (p.x + p.vx + W) % W;
      p.y = (p.y + p.vy + H) % H;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(167,139,250,' + p.a + ')';
      ctx.fill();
    });
    requestAnimationFrame(drawParticles);
  }
  drawParticles();
  window.addEventListener('resize', function () {
    W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight;
  });
}
