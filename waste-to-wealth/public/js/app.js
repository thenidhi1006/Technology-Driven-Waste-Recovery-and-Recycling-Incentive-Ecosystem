/* Waste to Wealth - single page app (no build step).
   All text is inserted with textContent via h(), never innerHTML, so user data cannot inject HTML. */
(function () {
  'use strict';

  // ---------- helpers ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  const $ = (s) => document.querySelector(s);
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const num = (n, d = 1) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d });

  let lang = store.get('wtw_lang') || 'en';
  const t = (k) => (window.I18N[lang] && window.I18N[lang][k]) || window.I18N.en[k] || k;

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 3800);
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = store.get('wtw_token');
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch('/api' + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    } catch {
      throw new Error('Cannot reach the server. Check your internet connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      logout(true);
      throw new Error(data.error || 'Please log in again.');
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  const post = (p, body, method = 'POST') => api(p, { method, body: JSON.stringify(body || {}) });

  // ---------- state ----------
  const state = { user: null, categories: [], config: { localities: [], modelUrl: '' }, cart: {} };

  async function loadBasics() {
    const [cat, cfg] = await Promise.all([api('/categories'), api('/config')]);
    state.categories = cat.categories;
    state.config = cfg;
  }

  function logout(expired) {
    store.del('wtw_token');
    state.user = null;
    state.cart = {};
    location.hash = '#/';
    render();
    if (expired) toast('Your session expired. Please log in.', true);
  }

  // ---------- routing ----------
  const NAV = {
    citizen: [['#/', 'nav_home'], ['#/pickups', 'nav_pickups'], ['#/impact', 'nav_impact'], ['#/board', 'nav_board'], ['#/rewards', 'nav_rewards']],
    recycler: [['#/', 'nav_requests']],
    admin: [['#/', 'nav_overview'], ['#/rates', 'nav_rates'], ['#/recyclers', 'nav_recyclers']],
  };

  const VIEWS = {
    citizen: { '#/': homeView, '#/book': bookView, '#/pickups': pickupsView, '#/impact': impactView, '#/board': boardView, '#/rewards': rewardsView },
    recycler: { '#/': recyclerView },
    admin: { '#/': adminOverview, '#/rates': adminRates, '#/recyclers': adminRecyclers },
  };

  function renderChrome() {
    document.documentElement.lang = lang;
    $('#tagline').textContent = t('tagline');
    $('#lang').value = lang;
    const lo = $('#logout');
    lo.textContent = t('logout');
    lo.hidden = !state.user;
    const nav = $('#nav');
    nav.textContent = '';
    if (!state.user) { nav.hidden = true; return; }
    nav.hidden = false;
    const cur = location.hash || '#/';
    for (const [href, key] of NAV[state.user.role]) {
      nav.append(h('a', { href, 'aria-current': cur === href ? 'page' : null }, t(key)));
    }
  }

  async function render() {
    const main = $('#main');
    renderChrome();
    main.textContent = '';
    if (!state.user) { main.append(authView()); return; }
    const route = location.hash || '#/';
    const view = VIEWS[state.user.role][route] || VIEWS[state.user.role]['#/'];
    main.append(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const node = await view();
      main.textContent = '';
      main.append(node);
    } catch (err) {
      main.textContent = '';
      main.append(h('div', { class: 'notice bad', role: 'alert' }, err.message));
    }
  }

  // ---------- auth ----------
  function authView() {
    let mode = 'login';
    const box = h('div');
    function draw() {
      box.textContent = '';
      const isReg = mode === 'register';
      const f = {};
      const field = (id, label, attrs = {}) => {
        f[id] = h('input', { id, name: id, ...attrs });
        return [h('label', { for: id }, label), f[id]];
      };
      const roleBox = h('div', {},
        h('label', {}, 'I am a'),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'role', value: 'citizen', checked: true }), 'Household / student'),
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'role', value: 'recycler' }), 'Scrap collector / recycler')
      );
      const recyclerFields = h('div', { hidden: true },
        field('business_name', 'Business name', { autocomplete: 'organization' }),
        field('service_areas', 'Areas you serve (comma separated)', { placeholder: 'Kukatpally, Miyapur' })
      );
      roleBox.addEventListener('change', () => {
        recyclerFields.hidden = roleBox.querySelector('input[name=role]:checked').value !== 'recycler';
      });

      const form = h('form', { novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        const body = { identifier: f.identifier.value, password: f.password.value };
        if (isReg) {
          Object.assign(body, {
            name: f.name.value, locality: f.locality.value, group_name: f.group_name.value,
            role: roleBox.querySelector('input[name=role]:checked').value,
            business_name: f.business_name.value, service_areas: f.service_areas.value,
          });
        }
        try {
          const out = await post(isReg ? '/auth/register' : '/auth/login', body);
          store.set('wtw_token', out.token);
          state.user = out.user;
          await loadBasics();
          location.hash = '#/';
          render();
        } catch (err) { msg.textContent = err.message; msg.hidden = false; }
      } },
        isReg && field('name', t('name'), { autocomplete: 'name', required: true }),
        field('identifier', t('identifier'), { autocomplete: 'username', required: true, inputmode: 'email' }),
        field('password', t('password'), { type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true }),
        isReg && field('locality', t('locality'), { placeholder: 'e.g. Kukatpally', required: true, list: 'areas' }),
        isReg && h('datalist', { id: 'areas' }, state.config.localities.map((l) => h('option', { value: l }))),
        isReg && field('group_name', 'Colony / hostel / department (optional)', { placeholder: 'e.g. Green Colony' }),
        isReg && roleBox,
        isReg && recyclerFields,
        h('div', { class: 'notice bad', role: 'alert', hidden: true, id: 'authmsg' }),
        h('div', { class: 'row', style: 'margin-top:14px' },
          h('button', { class: 'btn', type: 'submit' }, isReg ? t('register') : t('login')),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { mode = isReg ? 'login' : 'register'; draw(); } },
            isReg ? 'I already have an account' : 'New here? Create account'))
      );
      const msg = form.querySelector('#authmsg');

      const demo = h('div', { class: 'card soft demo' },
        h('h3', {}, 'Try the demo'),
        h('p', { class: 'muted' }, 'Tap a role to fill in sample login details, then press Log in.'),
        ...[['Citizen', 'demo@wtw.in', 'Demo@123'], ['Recycler', 'ravi@wtw.in', 'Recycler@123'], ['Admin', 'admin@wtw.in', 'Admin@123']].map(([n, u, p]) =>
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => {
            if (mode !== 'login') { mode = 'login'; draw(); }
            $('#identifier').value = u; $('#password').value = p; $('#password').focus();
          } }, n))
      );

      box.append(
        h('section', { class: 'hero' },
          h('h1', {}, 'Your waste has value.'),
          h('p', { class: 'muted' }, 'See what your scrap is worth, book a local scrap collector, and earn Green Points for recycling every week.')),
        h('div', { class: 'grid cols-2' }, h('div', { class: 'card' }, h('h2', {}, isReg ? t('register') : t('login')), form), demo)
      );
    }
    draw();
    return box;
  }

  // ---------- citizen: home (calculator + scan) ----------
  function cartLines() {
    return state.categories
      .map((c) => ({ c, kg: Number(state.cart[c.id]) || 0 }))
      .filter((l) => l.kg > 0);
  }

  function homeView() {
    const totalEl = h('span', { class: 'big' });
    const ptsEl = h('span', { class: 'big' });
    const bookBtn = h('button', { class: 'btn', onclick: () => (location.hash = '#/book') }, t('book'));
    const noteEl = h('p', { class: 'hint' });

    function recalc() {
      const lines = cartLines();
      const total = lines.reduce((s, l) => s + (l.c.quoted ? 0 : l.kg * l.c.rate_per_kg), 0);
      const kg = lines.reduce((s, l) => s + l.kg, 0);
      totalEl.textContent = money(total);
      ptsEl.textContent = Math.round(kg * 10);
      bookBtn.disabled = !lines.length;
      noteEl.textContent = lines.some((l) => l.c.quoted) ? 'E-waste is priced by the recycler at pickup, so it is not in the total.' : '';
    }

    const list = h('ul', { class: 'items' },
      state.categories.map((c) => {
        const input = h('input', {
          id: 'kg' + c.id, type: 'number', inputmode: 'decimal', min: '0', max: '1000', step: '0.5', placeholder: '0',
          value: state.cart[c.id] || '', 'aria-label': `${c.name} weight in kg`,
          oninput: (e) => { const v = parseFloat(e.target.value); if (v > 0) state.cart[c.id] = v; else delete state.cart[c.id]; recalc(); },
        });
        return h('li', { class: 'item' },
          h('span', { class: 'ico', 'aria-hidden': 'true' }, c.icon),
          h('div', {}, h('strong', {}, c.name), h('div', { class: 'muted' }, c.quoted ? 'Price quoted at pickup' : `about ${money(c.rate_per_kg)} per kg`)),
          input);
      })
    );

    const wrap = h('div', {},
      h('h1', {}, t('worth_title')),
      h('p', { class: 'muted' }, t('worth_sub')),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' }, list),
        scanCard(() => { render(); })
      ),
      h('div', { class: 'summary' },
        h('div', { class: 'row between' },
          h('div', {}, h('div', { class: 'muted' }, t('est_value')), totalEl),
          h('div', {}, h('div', { class: 'muted' }, t('points_preview')), ptsEl),
          bookBtn),
        noteEl,
        h('p', { class: 'hint' }, 'Indicative rates. Final payment depends on the weight your recycler confirms.'))
    );
    recalc();
    return wrap;
  }

  // Optional photo suggestion using a Teachable Machine model (set TM_MODEL_URL in .env).
  const KEYWORDS = [['plastic bottle', 'Plastic Bottles'], ['hard plastic', 'Hard Plastic'], ['cardboard', 'Cardboard'], ['paper', 'Newspaper & Paper'], ['metal', 'Iron & Steel'], ['e-waste', 'E-waste'], ['ewaste', 'E-waste']];
  const mapClass = (cls) => {
    const k = KEYWORDS.find(([w]) => cls.toLowerCase().includes(w));
    const cat = state.categories.find((c) => c.name === (k ? k[1] : cls));
    return cat ? cat.id : null;
  };
  let modelPromise = null;
  function loadScript(src) {
    return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.append(s); });
  }
  function loadModel() {
    if (!modelPromise) {
      modelPromise = (async () => {
        await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8/dist/teachablemachine-image.min.js');
        const base = state.config.modelUrl;
        return window.tmImage.load(base + 'model.json', base + 'metadata.json');
      })().catch((e) => { modelPromise = null; throw e; });
    }
    return modelPromise;
  }

  function scanCard(onAdded) {
    const result = h('div', { 'aria-live': 'polite' });
    const preview = h('img', { alt: 'Selected photo', style: 'max-width:100%;max-height:200px;border-radius:10px;display:none;margin-top:8px' });
    const select = h('select', { id: 'scan-cat', 'aria-label': 'Choose category' },
      h('option', { value: '' }, 'Choose a category…'),
      state.categories.map((c) => h('option', { value: c.id }, c.name)));
    const weight = h('input', { id: 'scan-weight', type: 'number', inputmode: 'decimal', min: '0.1', max: '1000', step: '0.1', value: '1', 'aria-label': 'Estimated weight in kilograms' });
    let file = null; let predicted = ''; let confidence = 0;

    const addBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      const id = Number(select.value);
      if (!id) { toast('Please choose a category first.', true); return; }
      const kg = Number(weight.value);
      if (!(kg > 0) || kg > 1000) { toast('Enter a weight between 0.1 and 1000 kg.', true); return; }
      state.cart[id] = (Number(state.cart[id]) || 0) + kg;
      if (file) {
        const fd = new FormData();
        fd.append('photo', file); fd.append('predicted_category', predicted);
        fd.append('confidence', String(confidence)); fd.append('final_category_id', String(id));
        fetch('/api/scans', { method: 'POST', headers: { Authorization: 'Bearer ' + store.get('wtw_token') }, body: fd }).catch(() => {});
      }
      toast('Added to your list. Update the weight if needed.');
      onAdded();
    } }, 'Add to my list');

    const input = h('input', { type: 'file', id: 'scan-file', accept: 'image/*', capture: 'environment', onchange: async (e) => {
      file = e.target.files[0]; if (!file) return;
      preview.src = URL.createObjectURL(file); preview.style.display = 'block';
      result.textContent = '';
      if (!state.config.modelUrl) {
        result.append(h('p', { class: 'hint' }, 'Photo suggestions are not switched on, so please choose the category yourself.'));
        return;
      }
      result.append(h('p', { class: 'hint' }, 'Looking at your photo…'));
      try {
        const model = await loadModel();
        const preds = (await model.predict(preview)).sort((a, b) => b.probability - a.probability);
        predicted = preds[0].className; confidence = preds[0].probability;
        const catId = mapClass(predicted);
        result.textContent = '';
        if (confidence >= 0.6 && catId) {
          select.value = String(catId);
          result.append(h('p', {}, `Looks like: ${predicted} (${Math.round(confidence * 100)}% sure). You can change it below.`));
        } else {
          result.append(h('p', { class: 'notice' }, 'We are not sure about this one. Please choose the category yourself.'));
        }
      } catch {
        result.textContent = '';
        result.append(h('p', { class: 'hint' }, 'Photo suggestion is unavailable right now. Please choose the category yourself.'));
      }
    } });

    return h('div', { class: 'card' },
      h('h2', {}, t('scan_title')),
      h('p', { class: 'muted' }, state.config.modelUrl
        ? 'Snap a photo for a category suggestion, then confirm the material and estimated weight.'
        : 'Snap a photo, choose the material, and enter its estimated weight. You can review the value before booking.'),
      h('label', { for: 'scan-file' }, 'Photo of the item'), input, preview, result,
      h('label', { for: 'scan-cat' }, 'Category'), select,
      h('label', { for: 'scan-weight' }, 'Estimated weight (kg)'), weight,
      h('div', { style: 'margin-top:10px' }, addBtn));
  }

  // ---------- citizen: booking ----------
  const STATUS = {
    unassigned: ['Finding a recycler', 'warn'], requested: ['Waiting for recycler', 'warn'], accepted: ['Recycler accepted', 'ok'],
    awaiting_approval: ['Please check the amount', 'warn'], completed: ['Completed', 'ok'], disputed: ['Problem reported', 'bad'], cancelled: ['Cancelled', 'bad'],
  };
  const badge = (s) => h('span', { class: 'badge ' + (STATUS[s] ? STATUS[s][1] : '') }, STATUS[s] ? STATUS[s][0] : s);

  async function bookView() {
    const lines = cartLines();
    if (!lines.length) { location.hash = '#/'; return h('div'); }
    const { slots } = await api('/pickups/slots');
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const total = lines.reduce((s, l) => s + (l.c.quoted ? 0 : l.kg * l.c.rate_per_kg), 0);
    const f = {
      address: h('textarea', { id: 'address', required: true, placeholder: 'House / flat no., street, landmark' }),
      locality: h('input', { id: 'locality', list: 'loc', value: state.user.locality || '', required: true }),
      date: h('input', { id: 'date', type: 'date', min: today, value: today, required: true }),
      slot: h('select', { id: 'slot' }, slots.map((s) => h('option', { value: s }, s))),
    };
    const msg = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    return h('div', {},
      h('h1', {}, t('book')),
      h('div', { class: 'grid cols-2' },
        h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          try {
            const out = await post('/pickups', {
              address: f.address.value, locality: f.locality.value, slot_date: f.date.value, slot_time: f.slot.value,
              items: lines.map((l) => ({ category_id: l.c.id, weight_kg: l.kg })),
            });
            state.cart = {};
            toast(out.pickup.status === 'unassigned' ? 'Booked. We are finding a recycler for your area.' : 'Pickup booked!');
            location.hash = '#/pickups';
          } catch (err) { msg.textContent = err.message; msg.hidden = false; }
        } },
          h('label', { for: 'address' }, 'Pickup address'), f.address,
          h('p', { class: 'hint' }, 'Your address is shared only with the recycler who accepts your request.'),
          h('label', { for: 'locality' }, t('locality')), f.locality,
          h('datalist', { id: 'loc' }, state.config.localities.map((l) => h('option', { value: l }))),
          h('label', { for: 'date' }, 'Date'), f.date,
          h('label', { for: 'slot' }, 'Time slot'), f.slot,
          msg,
          h('div', { class: 'row', style: 'margin-top:14px' },
            h('button', { class: 'btn', type: 'submit' }, 'Confirm booking'),
            h('a', { class: 'btn ghost', href: '#/' }, 'Back'))),
        h('div', { class: 'card soft' },
          h('h2', {}, 'Your items'),
          h('ul', { class: 'items' }, lines.map((l) => h('li', { class: 'item' },
            h('span', { class: 'ico', 'aria-hidden': 'true' }, l.c.icon), h('span', {}, l.c.name),
            h('strong', {}, `${num(l.kg)} kg`)))),
          h('p', {}, 'Estimated value: ', h('strong', {}, money(total))),
          h('p', { class: 'hint' }, 'Indicative rate, locked at booking. Final payment depends on the weight confirmed at pickup.'))
      )
    );
  }

  // ---------- citizen: pickups ----------
  function itemsTable(p) {
    return h('table', {},
      h('thead', {}, h('tr', {}, ['Item', 'Est. kg', 'Final kg', 'Rate/kg'].map((x) => h('th', {}, x)))),
      h('tbody', {}, p.items.map((i) => h('tr', {},
        h('td', {}, `${i.icon} ${i.category_name}`), h('td', {}, num(i.est_weight_kg)),
        h('td', {}, i.actual_weight_kg == null ? '-' : num(i.actual_weight_kg, 2)),
        h('td', {}, i.quoted && !i.rate_applied ? 'at pickup' : money(i.rate_applied))))));
  }

  async function pickupsView() {
    const { pickups } = await api('/pickups');
    const act = (fn, okMsg) => async () => { try { const out = await fn(); if (out && out.award) toast(`Done! +${out.award.points.total} Green Points. Streak: ${out.award.streak} week(s).`); else if (okMsg) toast(okMsg); render(); } catch (err) { toast(err.message, true); } };
    return h('div', {},
      h('div', { class: 'row between' }, h('h1', {}, 'My pickups'), h('button', { class: 'btn small ghost', onclick: () => render() }, 'Refresh')),
      !pickups.length && h('div', { class: 'card' }, h('p', {}, 'No pickups yet.'), h('a', { class: 'btn', href: '#/' }, 'Check what your scrap is worth')),
      h('div', { class: 'grid' }, pickups.map((p) => h('article', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `Pickup #${p.id}`), badge(p.status)),
        h('p', { class: 'muted' }, `${p.slot_date} · ${p.slot_time} · ${p.locality}` + (p.recycler_name ? ` · ${p.recycler_name}` : '')),
        itemsTable(p),
        h('p', {}, p.status === 'awaiting_approval' || p.status === 'completed'
          ? ['Final amount: ', h('strong', {}, money(p.total_amount))]
          : ['Estimated: ', h('strong', {}, money(p.est_total)), ' (indicative)']),
        p.status === 'disputed' && h('div', { class: 'notice' }, 'You reported: ' + p.dispute_reason + '. The recycler will re-check the weight.'),
        p.status === 'awaiting_approval' && h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: act(() => post(`/pickups/${p.id}/approve`, {}, 'PATCH')) }, 'Approve amount'),
          h('button', { class: 'btn ghost', onclick: act(() => { const r = prompt('What looks wrong? (optional)') ; if (r === null) return Promise.resolve(); return post(`/pickups/${p.id}/dispute`, { reason: r }, 'PATCH'); }) }, 'Report a problem')),
        ['requested', 'accepted', 'unassigned'].includes(p.status) && h('button', { class: 'btn small ghost', onclick: act(() => post(`/pickups/${p.id}/cancel`, {}, 'PATCH'), 'Pickup cancelled') }, 'Cancel pickup')
      )))
    );
  }

  // ---------- citizen: impact, board, rewards ----------
  async function impactView() {
    const d = await api('/impact/me');
    const tile = (n, l) => h('div', { class: 'card tile' }, h('div', { class: 'num' }, n), h('div', { class: 'lbl' }, l));
    const max = Math.max(1, ...d.by_category.map((c) => c.kg));
    return h('div', {},
      h('h1', {}, 'My impact'),
      h('div', { class: 'grid cols-3' },
        tile(num(d.kg, 2) + ' kg', 'Recycled'), tile(money(d.rupees), 'Earned'), tile(num(d.co2_kg) + ' kg', 'CO₂ saved (estimate)'),
        tile(num(d.points, 0), 'Green Points'), tile(d.streak + ' wk', 'Current streak'), tile(d.pickups, 'Pickups done')),
      h('div', { class: 'notice info' }, d.streak
        ? `You are on a ${d.streak}-week streak. Recycle once every week to keep it going and earn +20 bonus points from week 2.`
        : 'Complete a pickup this week to start a streak. From week 2 you earn +20 bonus points every week.'),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' }, h('h2', {}, 'What you recycled'),
          d.by_category.length ? d.by_category.map((c) => h('div', { style: 'margin:8px 0' },
            h('div', { class: 'row between' }, h('span', {}, `${c.icon} ${c.name}`), h('strong', {}, `${num(c.kg, 2)} kg`)),
            h('div', { class: 'bar-track', role: 'presentation' }, h('div', { class: 'bar-fill', style: `width:${(c.kg / max) * 100}%` }))))
            : h('p', { class: 'muted' }, 'Nothing yet. Your first pickup will show up here.')),
        h('div', { class: 'card' }, h('h2', {}, 'Recent points'),
          d.ledger.length ? h('ul', { class: 'items' }, d.ledger.map((l) => h('li', { class: 'row between', style: 'padding:6px 0' }, h('span', {}, l.reason), h('strong', {}, (l.points > 0 ? '+' : '') + l.points))))
            : h('p', { class: 'muted' }, 'No points yet.'),
          h('p', { class: 'hint' }, `Your points are worth about ${money(d.points_value_rs)} in shop rewards (100 points = ₹10). CO₂ is a rough estimate.`)))
    );
  }

  async function boardView() {
    const d = await api('/leaderboard');
    let tab = 'users';
    const box = h('div');
    function draw() {
      box.textContent = '';
      const rows = tab === 'users' ? d.users : d.groups;
      box.append(
        h('div', { class: 'tabs' },
          h('button', { 'aria-pressed': tab === 'users', onclick: () => { tab = 'users'; draw(); } }, 'People'),
          h('button', { 'aria-pressed': tab === 'groups', onclick: () => { tab = 'groups'; draw(); } }, 'Groups')),
        h('div', { class: 'card' }, h('table', {},
          h('caption', { class: 'sr-only' }, tab === 'users' ? 'Top people by Green Points' : 'Top groups by Green Points'),
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, tab === 'users' ? 'Name' : 'Group'), h('th', {}, tab === 'users' ? 'Group' : 'Members'), h('th', {}, 'Points'))),
          h('tbody', {}, rows.map((r) => h('tr', { class: r.me ? 'me' : '' }, h('td', {}, r.rank), h('td', {}, r.name + (r.me ? ' (you)' : '')), h('td', {}, tab === 'users' ? (r.group || '-') : r.members), h('td', {}, r.points)))))));
    }
    draw();
    return h('div', {}, h('h1', {}, 'Leaderboard'), d.my_rank && h('p', { class: 'muted' }, `Your rank: #${d.my_rank}. Ranking uses points earned, so spending points never lowers your rank.`), box);
  }

  async function rewardsView() {
    const d = await api('/rewards');
    const out = h('div', { 'aria-live': 'polite' });
    return h('div', {},
      h('h1', {}, 'Rewards'),
      h('p', { class: 'muted' }, 'You have ', h('strong', {}, num(d.balance, 0)), ' Green Points. Show the code at the partner shop.'),
      out,
      h('div', { class: 'grid cols-2' }, d.rewards.map((r) => h('div', { class: 'card' },
        h('h3', {}, r.partner_name), h('p', {}, r.description),
        h('button', { class: 'btn small', disabled: d.balance < r.points_cost, onclick: async () => {
          try { const res = await post(`/rewards/${r.id}/redeem`); out.textContent = ''; out.append(h('div', { class: 'notice good' }, `Your code for ${res.reward.partner_name}: `, h('strong', {}, res.code))); toast('Reward unlocked!'); setTimeout(render, 2500); }
          catch (err) { toast(err.message, true); }
        } }, `Redeem · ${r.points_cost} pts`)))),
      d.redeemed.length > 0 && h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', {}, 'Your codes'),
        h('ul', { class: 'items' }, d.redeemed.map((x) => h('li', { class: 'row between', style: 'padding:6px 0' }, h('span', {}, `${x.partner_name}: ${x.description}`), h('strong', {}, x.code)))))
    );
  }

  // ---------- recycler ----------
  async function recyclerView() {
    const [{ pickups }, me] = await Promise.all([api('/pickups'), api('/auth/me')]);
    const rec = me.user.recycler;
    const act = (fn) => async () => { try { await fn(); render(); } catch (err) { toast(err.message, true); } };
    const weighForm = (p) => {
      const inputs = p.items.map((i) => ({
        i,
        kg: h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.05', required: true, value: i.actual_weight_kg ?? '', 'aria-label': `${i.category_name} actual kg` }),
        rate: i.quoted ? h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', required: true, placeholder: 'Rs/kg', value: i.rate_applied || '', 'aria-label': `${i.category_name} price per kg` }) : null,
      }));
      return h('form', { novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        try {
          await post(`/pickups/${p.id}/complete`, { items: inputs.map((x) => ({ item_id: x.i.id, actual_weight: x.kg.value, rate_applied: x.rate ? x.rate.value : undefined })) }, 'PATCH');
          toast('Weights sent. Waiting for the customer to approve.'); render();
        } catch (err) { toast(err.message, true); }
      } },
        h('h3', {}, 'Enter the weighed quantity'),
        inputs.map((x) => h('div', { class: 'row', style: 'margin:6px 0' }, h('span', { style: 'flex:1 1 140px' }, `${x.i.icon} ${x.i.category_name} (est. ${num(x.i.est_weight_kg)} kg)`), x.kg, x.rate)),
        h('button', { class: 'btn', type: 'submit' }, 'Send to customer'));
    };
    return h('div', {},
      h('h1', {}, rec ? rec.business_name : 'Requests'),
      rec && !rec.verified && h('div', { class: 'notice' }, 'Your account is waiting for admin verification. You will start receiving requests once you are verified.'),
      rec && h('p', { class: 'muted' }, `Areas: ${rec.service_areas}`),
      h('div', { class: 'row between' }, h('h2', {}, 'Pickup requests'), h('button', { class: 'btn small ghost', onclick: () => render() }, 'Refresh')),
      !pickups.length && h('div', { class: 'card' }, 'No requests yet.'),
      h('div', { class: 'grid' }, pickups.map((p) => h('article', { class: 'card' },
        h('div', { class: 'row between' }, h('h3', {}, `#${p.id} · ${p.citizen_name}`), badge(p.status)),
        h('p', { class: 'muted' }, `${p.slot_date} · ${p.slot_time} · ${p.locality}`),
        p.address ? h('p', {}, h('strong', {}, 'Address: '), p.address, p.citizen_phone ? ` · ${p.citizen_phone}` : '') : h('p', { class: 'hint' }, 'Full address and phone are shown after you accept.'),
        itemsTable(p),
        p.status === 'requested' && h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: act(() => post(`/pickups/${p.id}/accept`, { accept: true }, 'PATCH')) }, 'Accept'),
          h('button', { class: 'btn ghost', onclick: act(() => post(`/pickups/${p.id}/accept`, { accept: false }, 'PATCH')) }, 'Decline')),
        ['accepted', 'disputed'].includes(p.status) && [p.status === 'disputed' && h('div', { class: 'notice' }, 'Customer says: ' + p.dispute_reason), weighForm(p)],
        p.status === 'awaiting_approval' && h('p', {}, 'Waiting for the customer to approve ', h('strong', {}, money(p.total_amount)), '. Collect payment in cash or UPI.'),
        p.status === 'completed' && h('p', {}, 'Completed. Amount: ', h('strong', {}, money(p.total_amount)))
      )))
    );
  }

  // ---------- admin ----------
  async function adminOverview() {
    const s = await api('/admin/stats');
    const tile = (n, l) => h('div', { class: 'card tile' }, h('div', { class: 'num' }, n), h('div', { class: 'lbl' }, l));
    return h('div', {},
      h('h1', {}, 'Platform overview'),
      h('div', { class: 'grid cols-3' },
        tile(s.citizens, 'Citizens'), tile(s.recyclers, 'Recyclers'), tile(s.pending_recyclers, 'Waiting for verification'),
        tile(s.pickups, 'Pickups'), tile(s.open_problems, 'Open problems'), tile(num(s.kg, 1) + ' kg', 'Recycled'),
        tile(money(s.rupees), 'Paid to citizens'), tile(num(s.co2_kg, 1) + ' kg', 'CO₂ saved (estimate)')),
      s.pending_recyclers > 0 && h('div', { class: 'notice' }, 'New recyclers are waiting. Open the Recyclers tab to verify them.'),
      s.open_problems > 0 && h('div', { class: 'notice' }, 'Some pickups are disputed or have no recycler in their area. Add recyclers for those areas.'));
  }

  async function adminRates() {
    const { categories } = await api('/admin/rates');
    const nf = { name: h('input', { id: 'nc-name', placeholder: 'e.g. Glass bottles' }), rate: h('input', { id: 'nc-rate', type: 'number', min: '0', step: '1', placeholder: 'Rs per kg' }) };
    return h('div', {},
      h('h1', {}, 'Rates'),
      h('p', { class: 'muted' }, 'Update using local market rates (suggested: weekly). Every change is saved in the rate history. Users always see these as indicative.'),
      h('div', { class: 'card' }, h('ul', { class: 'items' }, categories.map((c) => {
        const inp = h('input', { type: 'number', min: '0', step: '1', value: c.rate_per_kg, 'aria-label': `${c.name} rate per kg` });
        return h('li', { class: 'item', style: 'grid-template-columns:44px 1fr 110px 90px' },
          h('span', { class: 'ico', 'aria-hidden': 'true' }, c.icon), h('div', {}, h('strong', {}, c.name), h('div', { class: 'muted' }, c.quoted ? 'quoted at pickup' : 'Rs per kg')), inp,
          h('button', { class: 'btn small', onclick: async () => { try { await post(`/admin/rates/${c.id}`, { rate_per_kg: inp.value }, 'PUT'); toast('Rate saved'); } catch (err) { toast(err.message, true); } } }, 'Save'));
      }))),
      h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', {}, 'Add a category'),
        h('label', { for: 'nc-name' }, 'Name'), nf.name, h('label', { for: 'nc-rate' }, 'Rate (Rs per kg)'), nf.rate,
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async () => { try { await post('/admin/categories', { name: nf.name.value, rate_per_kg: nf.rate.value }); toast('Category added'); render(); } catch (err) { toast(err.message, true); } } }, 'Add category')))
    );
  }

  async function adminRecyclers() {
    const { recyclers } = await api('/admin/recyclers');
    return h('div', {},
      h('h1', {}, 'Recyclers'),
      h('div', { class: 'grid' }, recyclers.map((r) => h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h3', {}, r.business_name), h('span', { class: 'badge ' + (r.verified ? 'ok' : 'warn') }, r.verified ? 'Verified' : 'Not verified')),
        h('p', { class: 'muted' }, `${r.name} · ${r.phone || r.email} · Areas: ${r.service_areas}`),
        h('button', { class: 'btn small' + (r.verified ? ' ghost' : ''), onclick: async () => { try { await post(`/admin/recyclers/${r.id}/verify`, { verified: !r.verified }, 'PATCH'); render(); } catch (err) { toast(err.message, true); } } }, r.verified ? 'Remove verification' : 'Verify')))));
  }

  // ---------- boot ----------
  $('#lang').addEventListener('change', (e) => { lang = e.target.value; store.set('wtw_lang', lang); render(); });
  $('#logout').addEventListener('click', () => logout(false));
  window.addEventListener('hashchange', () => { render(); $('#main').focus(); });

  (async function init() {
    try {
      await loadBasics();
      if (store.get('wtw_token')) {
        try { state.user = (await api('/auth/me')).user; } catch { store.del('wtw_token'); }
      }
    } catch (err) {
      $('#main').append(h('div', { class: 'notice bad', role: 'alert' }, err.message));
      return;
    }
    render();
  })();
})();
