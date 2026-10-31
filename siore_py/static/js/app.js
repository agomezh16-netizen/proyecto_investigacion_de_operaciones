/* =========================================================
   SIORE · interfaz
   Editor dinámico del modelo, forma estándar, tablas del Simplex,
   dashboard, escenarios, comparación con PuLP, historial y exportación.
   ========================================================= */
(function () {
  'use strict';

  const S = window.SIORE;
  const sub = S.sub, fmt = S.fmt;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const nf = v => (Number.isFinite(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');
  const nv = v => (Number.isFinite(v) ? v : '');
  const money = (v, cur) => (v < 0 ? '−' : '') + (cur || '') + nf(Math.abs(v));
  const listEs = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);

  const STATUS = {
    optimal: { label: 'Óptimo', cls: 'ok' },
    infeasible: { label: 'No factible', cls: 'bad' },
    unbounded: { label: 'No acotado', cls: 'warn' },
    error: { label: 'Error', cls: 'bad' }
  };
  const COLORS = ['#0d6a8a', '#f0b429', '#26704f', '#a8352b', '#6b5ca5', '#c2603c', '#3d8dae', '#7a8b3a'];

  /* ---------- Ejemplos ---------- */
  const EXAMPLES = {
    software: {
      name: 'Cartera de proyectos de desarrollo', type: 'max', cur: 'Q',
      vars: ['Proyectos Web', 'Apps móviles', 'APIs'], c: [4400, 5400, 5800],
      cons: [
        { name: 'Horas de desarrollo', a: [10, 12, 14], sign: '<=', b: 520 },
        { name: 'Horas de QA', a: [4, 5, 6], sign: '<=', b: 215 },
        { name: 'Horas de diseño', a: [6, 8, 4], sign: '<=', b: 280 },
        { name: 'Presupuesto (miles de Q)', a: [8, 9, 10], sign: '<=', b: 500 }
      ],
      scenarios: [
        { name: 'Más horas de desarrollo', b: [600, 215, 280, 500] },
        { name: 'Más horas de QA', b: [520, 260, 280, 500] }
      ]
    },
    logistica: {
      name: 'Flota de reparto al menor costo', type: 'min', cur: 'Q',
      vars: ['Viajes en camión', 'Viajes en pickup', 'Viajes en moto'], c: [120, 70, 40],
      cons: [
        { name: 'Capacidad de carga (kg)', a: [400, 150, 30], sign: '>=', b: 1200 },
        { name: 'Entregas mínimas', a: [6, 4, 3], sign: '>=', b: 60 },
        { name: 'Máximo de viajes en camión', a: [1, 0, 0], sign: '<=', b: 8 },
        { name: 'Total de viajes programados', a: [1, 1, 1], sign: '=', b: 30 }
      ],
      scenarios: [
        { name: 'Carga requerida 1,800 kg', b: [1800, 60, 8, 30] },
        { name: 'Se permiten 12 camiones', b: [1200, 60, 12, 30] }
      ]
    },
    vacio: {
      name: 'Nuevo problema', type: 'max', cur: 'Q',
      vars: ['Variable 1', 'Variable 2', 'Variable 3'], c: [0, 0, 0],
      cons: [1, 2, 3].map(k => ({ name: 'Restricción ' + k, a: [0, 0, 0], sign: '<=', b: 0 })),
      scenarios: []
    }
  };

  /* ---------- Estado ---------- */
  const state = {
    model: null, result: null, solvedModel: null, stale: false,
    server: null, serverPending: false, scenarios: [], view: 'modelo', run: 0
  };

  async function api(url, body, method) {
    try {
      const r = await fetch(url, {
        method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const j = await r.json();
      if (!r.ok || j.error) return { error: true, message: j.message || ('Error ' + r.status) };
      return j;
    } catch (err) {
      return { error: true, message: 'No se pudo contactar al servidor Flask (' + err.message + '). ¿Está ejecutándose app.py?' };
    }
  }

  function setModel(model, scenarios) {
    state.model = model;
    state.scenarios = (scenarios || []).map(s => ({ name: s.name, b: s.b.slice(), result: null, model: null }));
    state.result = null; state.solvedModel = null; state.stale = false; state.server = null; state.exerciseId = null;
    $('#problemName').value = model.name;
    $('#problemType').value = model.type;
    $('#currency').value = model.cur;
    renderEditor(); updateChip(); msg('');
  }

  function loadExample(key) {
    const ex = clone(EXAMPLES[key]);
    const scenarios = ex.scenarios || [];
    delete ex.scenarios;
    setModel(ex, scenarios);
  }

  function touch() { if (state.result) { state.stale = true; updateChip(); } }

  function updateChip() {
    const c = $('#statusChip');
    if (!state.result) { c.textContent = 'Sin resolver'; c.className = 'chip'; return; }
    if (state.stale) { c.textContent = 'Modelo modificado: vuelve a resolver'; c.className = 'chip warn'; return; }
    const st = STATUS[state.result.status];
    c.textContent = 'Modelo: ' + st.label; c.className = 'chip ' + st.cls;
  }

  function msg(text, cls) {
    const m = $('#modelMsg');
    m.textContent = text || ''; m.className = 'msg' + (cls ? ' ' + cls : '');
  }

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  /* ---------- Editor del modelo ---------- */
  function renderEditor() {
    const m = state.model, n = m.vars.length;
    let h = '<div class="table-wrap"><table class="model-grid"><thead><tr><th class="lead" scope="col">Variable de decisión</th>';
    m.vars.forEach((v, j) => {
      h += '<th scope="col"><div class="varhead"><span class="sym">x' + sub(j + 1) + '</span>' +
        (n > 1 ? '<button type="button" class="icon" data-act="delvar" data-j="' + j + '" title="Quitar x' + sub(j + 1) + '" aria-label="Quitar variable x' + sub(j + 1) + '">×</button>' : '') +
        '</div><input class="txt" data-f="varname" data-j="' + j + '" value="' + esc(v) + '" aria-label="Nombre de x' + sub(j + 1) + '"></th>';
    });
    h += '<th scope="col">Signo</th><th scope="col">Disponible / requerido</th><th></th></tr></thead><tbody>';
    h += '<tr class="obj"><th scope="row" class="lead">Coeficiente en Z</th>';
    m.c.forEach((c, j) => {
      h += '<td><input class="num" type="number" step="any" data-f="c" data-j="' + j + '" value="' + nv(c) + '" aria-label="Coeficiente de x' + sub(j + 1) + ' en Z"></td>';
    });
    h += '<td colspan="3" class="hint">' + (m.type === 'max' ? 'Maximizar' : 'Minimizar') + ' Z</td></tr>';
    m.cons.forEach((r, i) => {
      h += '<tr><th scope="row" class="lead"><input class="txt" data-f="cname" data-i="' + i + '" value="' + esc(r.name) + '" aria-label="Nombre de la restricción ' + (i + 1) + '"></th>';
      r.a.forEach((a, j) => {
        h += '<td><input class="num" type="number" step="any" data-f="a" data-i="' + i + '" data-j="' + j + '" value="' + nv(a) + '" aria-label="Coeficiente de x' + sub(j + 1) + ' en la restricción ' + (i + 1) + '"></td>';
      });
      h += '<td><select data-f="sign" data-i="' + i + '" aria-label="Signo de la restricción ' + (i + 1) + '">' +
        ['<=', '>=', '='].map(s => '<option value="' + esc(s) + '"' + (r.sign === s ? ' selected' : '') + '>' + S.SIGN[s] + '</option>').join('') + '</select></td>';
      h += '<td><input class="num" type="number" step="any" data-f="b" data-i="' + i + '" value="' + nv(r.b) + '" aria-label="Valor de la restricción ' + (i + 1) + '"></td>';
      h += '<td>' + (m.cons.length > 1 ? '<button type="button" class="icon" data-act="delcon" data-i="' + i + '" title="Quitar restricción" aria-label="Quitar restricción ' + (i + 1) + '">×</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    $('#editor').innerHTML = h;
    renderPreview();
  }

  function renderPreview() {
    const m = state.model;
    const legend = m.vars.map((v, j) => 'x' + sub(j + 1) + ' = ' + v).join('\n');
    $('#formal').textContent = S.formalModel(m).join('\n') + '\n\nDonde:\n' + legend;
  }

  function addVar() {
    const m = state.model;
    m.vars.push('Variable ' + (m.vars.length + 1)); m.c.push(0);
    m.cons.forEach(r => r.a.push(0));
    renderEditor(); touch();
  }
  function addCon() {
    const m = state.model;
    m.cons.push({ name: 'Restricción ' + (m.cons.length + 1), a: m.vars.map(() => 0), sign: '<=', b: 0 });
    state.scenarios.forEach(s => s.b.push(0));
    renderEditor(); touch();
  }

  $('#editor').addEventListener('input', e => {
    const t = e.target, f = t.dataset.f;
    if (!f) return;
    const m = state.model, i = +t.dataset.i, j = +t.dataset.j, num = parseFloat(t.value);
    if (f === 'varname') m.vars[j] = t.value;
    else if (f === 'c') m.c[j] = num;
    else if (f === 'cname') m.cons[i].name = t.value;
    else if (f === 'a') m.cons[i].a[j] = num;
    else if (f === 'sign') m.cons[i].sign = t.value;
    else if (f === 'b') m.cons[i].b = num;
    renderPreview(); touch();
  });

  $('#editor').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = state.model;
    if (b.dataset.act === 'delvar') {
      const j = +b.dataset.j;
      m.vars.splice(j, 1); m.c.splice(j, 1); m.cons.forEach(r => r.a.splice(j, 1));
    } else if (b.dataset.act === 'delcon') {
      const i = +b.dataset.i;
      m.cons.splice(i, 1); state.scenarios.forEach(s => s.b.splice(i, 1));
    }
    renderEditor(); touch();
  });

  $('#problemName').addEventListener('input', e => { state.model.name = e.target.value; });
  $('#currency').addEventListener('input', e => { state.model.cur = e.target.value; touch(); });
  $('#problemType').addEventListener('change', e => { state.model.type = e.target.value; renderEditor(); touch(); });
  $('#addVar').addEventListener('click', addVar);
  $('#addCon').addEventListener('click', addCon);
  $('#loadExample').addEventListener('click', () => loadExample($('#exampleSelect').value));
  $('#solveBtn').addEventListener('click', () => runAll('dashboard'));

  /* ---------- Navegación ---------- */
  function renderView(id) {
    if (id === 'estandar') renderStandard();
    else if (id === 'simplex') renderSimplex();
    else if (id === 'dashboard') renderDashboard();
    else if (id === 'escenarios') renderScenarios();
    else if (id === 'comparacion') renderCompare();
    else if (id === 'historial') renderHistorial();
  }
  function go(id) {
    state.view = id;
    $$('main > section').forEach(s => { s.hidden = s.id !== id; });
    $$('.rail button').forEach(b => b.setAttribute('aria-current', b.dataset.go === id ? 'step' : 'false'));
    renderView(id);
    window.scrollTo({ top: 0 });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });

  /* ---------- Resolver (Python: Simplex propio + PuLP) y guardado en la base de datos ---------- */
  async function runAll(target) {
    const m = clone(state.model);
    const err = S.validate(m);
    if (err) { msg(err, 'bad'); return; }
    msg('');
    const token = ++state.run;
    const btn = $('#solveBtn');
    btn.disabled = true;
    const data = await api('/api/resolver', { model: m, scenarios: state.scenarios.map(s => ({ name: s.name, b: s.b })) });
    btn.disabled = false;
    if (token !== state.run) return;
    if (data.error) { msg(data.message, 'bad'); toast(data.message); return; }

    state.result = data.propio; state.solvedModel = m; state.stale = false;
    state.server = { engines: data.pulp, notes: data.notas }; state.serverPending = false;
    state.exerciseId = data.id;
    state.scenarios.forEach((sc, k) => {
      const d = data.escenarios[k];
      const mm = clone(m);
      mm.cons.forEach((r, i) => { if (i < sc.b.length) r.b = sc.b[i]; });
      sc.model = mm; sc.result = d ? d.propio : null;
    });
    updateChip();
    go(target || 'dashboard');
    toast('Ejercicio #' + data.id + ' guardado en la base de datos.');
  }

  /* ---------- 2. Forma estándar ---------- */
  function emptyBox(text, withButton) {
    return '<div class="empty">' + esc(text) + (withButton ? '<br><button type="button" class="btn" data-go="modelo">Ir al modelo</button>' : '') + '</div>';
  }

  function renderStandard() {
    const el = $('#stdOut'), m = state.model, err = S.validate(m);
    if (err) { el.innerHTML = emptyBox(err, true); return; }
    const sf = S.buildStandardForm(m), t = S.standardText(sf, m);
    const aux = sf.cols.filter(c => c.type !== 'x');
    const kinds = {
      s: ['Holgura', 'Recurso no utilizado.'],
      e: ['Exceso', 'Excedente sobre el mínimo requerido.'],
      a: ['Artificial', 'Solo sirve para iniciar el Simplex; debe valer 0 en una solución factible.']
    };
    let h = '<div class="panel"><h3>Modelo original</h3><pre class="std-lines">' + esc(S.formalModel(m).join('\n')) + '</pre></div>';
    h += '<div class="panel"><h3>Modelo transformado</h3><pre class="std-lines">' + esc(t.objective + '\nsujeto a:\n' + t.equations.map(q => '   ' + q).join('\n') +
      '\n   ' + sf.cols.map(c => c.name).join(', ') + ' ≥ 0') + '</pre></div>';
    h += '<div class="panel"><h3>Variables auxiliares</h3>';
    if (aux.length) {
      h += '<div class="table-wrap"><table class="data"><thead><tr><th>Variable</th><th>Tipo</th><th>Restricción</th><th>Qué representa</th></tr></thead><tbody>' +
        aux.map(c => '<tr><td>' + c.name + '</td><td style="text-align:left"><span class="tag neutral">' + kinds[c.type][0] + '</span></td><td style="text-align:left">' +
          esc(sf.rows[c.row].name) + '</td><td style="text-align:left">' + kinds[c.type][1] + '</td></tr>').join('') + '</tbody></table></div>';
    } else h += '<p>Este modelo no necesita variables auxiliares.</p>';
    h += '<ul class="notes">' + t.notes.map(q => '<li>' + esc(q) + '</li>').join('') + '</ul></div>';
    el.innerHTML = h;
  }

  /* ---------- 3. Simplex paso a paso ---------- */
  function tableauHtml(it, res) {
    const cols = res.colNames, N = cols.length;
    let h = '<div class="table-wrap"><table class="tableau"><thead><tr><th scope="col">Base</th>' +
      cols.map((c, j) => '<th scope="col" class="' + (j === it.enter ? 'ecol' : '') + '">' + c + '</th>').join('') + '<th scope="col">LD</th><th scope="col">Razón</th></tr></thead><tbody>';
    it.T.forEach((row, i) => {
      h += '<tr class="' + (i === it.leave ? 'lrow' : '') + '"><th scope="row">' + it.basisNames[i] + '</th>';
      for (let j = 0; j < N; j++) {
        h += '<td class="' + (j === it.enter ? 'ecol' : '') + (i === it.leave && j === it.enter ? ' pivot' : '') + '">' + fmt(row[j]) + '</td>';
      }
      h += '<td>' + fmt(row[N]) + '</td><td>' + (it.ratios && it.ratios[i] !== null && it.ratios[i] !== undefined ? fmt(it.ratios[i]) : '—') + '</td></tr>';
    });
    h += '<tr class="zrow"><th scope="row">' + res.zLabel + '</th>' +
      cols.map((c, j) => '<td class="' + (j === it.enter ? 'ecol' : '') + '">' + S.fmtM(it.zv[j], it.zm[j]) + '</td>').join('') +
      '<td>' + S.fmtM(it.zv[N], it.zm[N]) + '</td><td></td></tr></tbody></table></div>';
    return h;
  }

  function renderSimplex() {
    const el = $('#simplexOut'), res = state.result;
    if (!res) { el.innerHTML = emptyBox('Resuelve el modelo para ver las tablas del Simplex.', true); return; }
    const cols = res.colNames, last = res.iterations.length - 1;
    let h = state.stale ? '<div class="banner warn">El modelo cambió después de resolver. Estas tablas corresponden a la última resolución.</div>' : '';
    res.iterations.forEach((it, k) => {
      let title = k === 0 ? 'Tabla inicial' : 'Iteración ' + k;
      if (k === last && res.status === 'optimal') title += ' · tabla final';
      let info;
      if (it.enter < 0) {
        info = res.status === 'infeasible'
          ? 'El Simplex terminó, pero una variable artificial sigue en la base con valor positivo: el modelo es <strong>no factible</strong>.'
          : 'No quedan valores negativos en la fila Z: la solución es <strong>óptima</strong>.';
      } else if (it.leave < 0) {
        info = 'Entra <strong>' + cols[it.enter] + '</strong>, pero ninguna fila tiene un valor positivo en su columna: el problema es <strong>no acotado</strong>.';
      } else {
        info = 'Entra <strong>' + cols[it.enter] + '</strong> (valor más negativo en Z) · Sale <strong>' + it.basisNames[it.leave] +
          '</strong> (razón mínima ' + fmt(it.ratios[it.leave]) + ') · Pivote <strong>' + fmt(it.T[it.leave][it.enter]) + '</strong>';
      }
      h += '<div class="iter"><h3>' + title + '</h3><p class="iter-info">' + info + '</p>' + tableauHtml(it, res);
      if (k === last && res.status === 'optimal') {
        const basic = it.basisNames.map((b, i) => b + ' = ' + fmt(it.T[i][cols.length]));
        const non = cols.filter(c => !it.basisNames.includes(c));
        h += '<p class="basis-list"><strong>Variables básicas:</strong> ' + basic.join(', ') + '<br><strong>Variables no básicas (valen 0):</strong> ' + (non.length ? non.join(', ') : 'ninguna') + '</p>';
      }
      h += '</div>';
    });
    el.innerHTML = h;
  }

  /* ---------- 4. Dashboard ---------- */
  function compareEngine(e) {
    const A = state.result;
    const sameStatus = e.status === A.status;
    let sameZ = true, sameX = true;
    if (sameStatus && A.status === 'optimal' && Array.isArray(e.x)) {
      sameZ = Math.abs(A.z - e.z) <= 1e-6 * (1 + Math.abs(A.z));
      sameX = A.x.every((v, j) => Math.abs(v - e.x[j]) <= 1e-6 * (1 + Math.abs(v)));
    }
    return { sameStatus, sameZ, sameX, ok: sameStatus && sameZ };
  }

  function matchInfo() {
    if (!state.result) return { label: '—', cls: 'neutral' };
    if (!state.server || !state.server.engines.length) return { label: 'PuLP no disponible', cls: 'warn' };
    return state.server.engines.every(e => compareEngine(e).ok) ? { label: 'Coincide', cls: 'ok' } : { label: 'No coincide', cls: 'bad' };
  }

  function interpretation(m, res, rows) {
    const isMax = m.type === 'max', cur = m.cur;
    const pos = m.vars.map((v, j) => ({ v, x: res.x[j] })).filter(o => o.x > 1e-9);
    const zero = m.vars.filter((v, j) => res.x[j] <= 1e-9);
    let p1;
    if (!pos.length) p1 = 'La solución óptima no asigna actividad a ninguna variable (Z = ' + money(res.z, cur) + ').';
    else p1 = 'La solución óptima recomienda ' + listEs(pos.map(o => nf(o.x) + ' ' + o.v)) + ', ' +
      (isMax ? 'generando una utilidad de ' : 'con un costo mínimo de ') + money(res.z, cur) + '.';
    const extra = [];
    if (zero.length && pos.length) extra.push('No se recomienda asignar: ' + listEs(zero) + '.');
    const binding = rows.filter(r => r.binding);
    if (binding.length) extra.push((binding.length === 1 ? 'Restricción sin margen (cuello de botella): ' : 'Restricciones sin margen (cuellos de botella): ') + listEs(binding.map(r => '«' + r.name + '»')) + '.');
    const valued = rows.filter(r => r.shadow !== null && Math.abs(r.shadow) > 1e-9).sort((a, b) => Math.abs(b.shadow) - Math.abs(a.shadow))[0];
    if (valued) {
      extra.push('El valor más sensible es «' + valued.name + '»: cada unidad adicional ' + (valued.shadow >= 0 ? 'aumenta' : 'reduce') +
        (isMax ? ' la utilidad en ' : ' el costo en ') + money(Math.abs(valued.shadow), cur) + ' (mientras la base óptima no cambie).');
    }
    return { p1, extra };
  }

  function usageBars(rows) {
    return rows.map(r => {
      const top = Math.max(r.available, r.used, 1e-9);
      return '<div class="bar-row"><div class="bar-label" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="bar-track">' +
        '<div class="bar-fill ' + (r.binding ? 'full' : '') + '" style="width:' + (Math.max(r.used, 0) / top * 100).toFixed(1) + '%"></div>' +
        '<div class="bar-mark" style="left:calc(' + (r.available / top * 100).toFixed(1) + '% - 1px)" title="' + (r.sign === '>=' ? 'Requerido' : 'Disponible') + '"></div></div>' +
        '<div class="bar-val">' + nf(r.used) + ' / ' + nf(r.available) + '</div></div>';
    }).join('') + '<p class="legend">Barra = utilizado. Marca negra = ' + 'disponible o requerido. Ámbar = recurso sin margen.</p>';
  }

  function slackBars(rows) {
    const top = Math.max(...rows.map(r => r.slack), 1e-9);
    return rows.map(r => '<div class="bar-row"><div class="bar-label" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="bar-track">' +
      '<div class="bar-fill alt" style="width:' + (r.slack / top * 100).toFixed(1) + '%"></div></div><div class="bar-val">' + nf(r.slack) + ' (' + r.kind.toLowerCase() + ')</div></div>').join('') +
      '<p class="legend">Una barra vacía indica que esa restricción está activa en el óptimo.</p>';
  }

  function donut(m, res) {
    const contrib = m.c.map((c, j) => c * res.x[j]);
    const useContrib = contrib.every(v => v >= -1e-9) && contrib.reduce((a, b) => a + b, 0) > 1e-9;
    const vals = useContrib ? contrib : res.x.map(v => Math.max(v, 0));
    const total = vals.reduce((a, b) => a + b, 0);
    if (total <= 1e-9) return '<p>No hay valores positivos para repartir.</p>';
    let acc = 0;
    const stops = vals.map((v, j) => {
      const from = acc / total * 100; acc += v; const to = acc / total * 100;
      return COLORS[j % COLORS.length] + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
    }).join(', ');
    const items = vals.map((v, j) => '<li><span class="sw" style="background:' + COLORS[j % COLORS.length] + '"></span>' + esc(m.vars[j]) +
      '<span class="pct">' + (v / total * 100).toFixed(1) + '%</span></li>').join('');
    const what = useContrib ? (m.type === 'max' ? 'aporte de cada variable a la utilidad' : 'aporte de cada variable al costo') : 'participación de cada variable en la cantidad total';
    return '<div class="donut-wrap"><div class="donut" role="img" aria-label="Gráfico de dona: ' + what + '" style="background:conic-gradient(' + stops + ')"></div><ul class="donut-legend">' + items + '</ul></div><p class="legend">Se muestra el ' + what + '.</p>';
  }

  function scenarioBars(m) {
    const items = [{ name: 'Base', res: state.result }].concat(state.scenarios.map(s => ({ name: s.name, res: s.result })))
      .filter(o => o.res && o.res.status === 'optimal');
    if (items.length < 2) return '';
    const top = Math.max(...items.map(o => Math.abs(o.res.z)), 1e-9);
    return items.map((o, k) => '<div class="bar-row"><div class="bar-label" title="' + esc(o.name) + '">' + esc(o.name) + '</div><div class="bar-track"><div class="bar-fill ' + (k === 0 ? '' : 'alt') +
      '" style="width:' + (Math.abs(o.res.z) / top * 100).toFixed(1) + '%"></div></div><div class="bar-val">' + money(o.res.z, m.cur) + '</div></div>').join('');
  }

  function renderDashboard() {
    const el = $('#dashOut'), res = state.result;
    if (!res) { el.innerHTML = emptyBox('Resuelve el modelo para ver el dashboard.', true); return; }
    const m = state.solvedModel, cur = m.cur, isMax = m.type === 'max', st = STATUS[res.status], match = matchInfo();
    let h = state.stale ? '<div class="banner warn">El modelo cambió después de resolver. Pulsa «Resolver modelo» para actualizar el dashboard.</div>' : '';
    h += '<div class="kpis">' +
      '<div class="kpi"><div class="k-label">Estado del modelo</div><div class="k-value"><span class="tag ' + st.cls + '">' + st.label + '</span></div></div>' +
      '<div class="kpi main"><div class="k-label">' + (isMax ? 'Utilidad máxima (Z)' : 'Costo mínimo (Z)') + '</div><div class="k-value">' + (res.status === 'optimal' ? money(res.z, cur) : '—') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Iteraciones del Simplex</div><div class="k-value">' + res.pivots + '</div></div>' +
      '<div class="kpi"><div class="k-label">Verificación con PuLP</div><div class="k-value"><span class="tag ' + match.cls + '">' + match.label + '</span></div></div></div>';

    if (res.status !== 'optimal') {
      const text = res.status === 'infeasible'
        ? 'Modelo no factible: las restricciones se contradicen y ninguna combinación de variables las cumple a la vez. Revisa los valores disponibles o requeridos.'
        : res.status === 'unbounded'
          ? 'Modelo no acotado: la función objetivo puede mejorar sin límite. Revisa si falta una restricción de recurso.'
          : 'Error: ' + (res.message || 'no se pudo resolver el modelo.');
      el.innerHTML = h + '<div class="banner ' + st.cls + '">' + esc(text) + '</div>';
      return;
    }

    const rows = S.analyze(m, res.x, res.shadow);
    const interp = interpretation(m, res, rows);
    const sc = scenarioBars(m);

    h += '<div class="dash-grid">';
    h += '<div class="panel wide"><h3>Interpretación automática</h3><p class="interp">' + esc(interp.p1) + '</p>' +
      (interp.extra.length ? '<p class="interp">' + interp.extra.map(esc).join(' ') + '</p>' : '') + '</div>';

    h += '<div class="panel"><h3>Solución óptima</h3><table class="data"><thead><tr><th>Variable</th><th>Valor</th><th>Aporte a Z</th></tr></thead><tbody>' +
      m.vars.map((v, j) => '<tr><td>x' + sub(j + 1) + ' · ' + esc(v) + '</td><td>' + nf(res.x[j]) + '</td><td>' + money(m.c[j] * res.x[j], cur) + '</td></tr>').join('') +
      '<tr><th>Z</th><th></th><th>' + money(res.z, cur) + '</th></tr></tbody></table></div>';

    h += '<div class="panel"><h3>Participación de cada variable</h3>' + donut(m, res) + '</div>';
    h += '<div class="panel"><h3>Recursos utilizados vs. disponibles</h3>' + usageBars(rows) + '</div>';
    h += '<div class="panel"><h3>Holguras de las restricciones</h3>' + slackBars(rows) + '</div>';
    if (sc) h += '<div class="panel wide"><h3>Comparación entre escenarios (valor de Z)</h3>' + sc + '</div>';

    h += '<div class="panel wide"><h3>Tabla de recursos</h3><div class="table-wrap"><table class="data"><thead><tr><th>Recurso</th><th>Disponible / requerido</th><th>Utilizado</th><th>Holgura / exceso</th><th>Estado</th><th>Precio sombra</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + esc(r.name) + ' (' + S.SIGN[r.sign] + ')</td><td>' + nf(r.available) + '</td><td>' + nf(r.used) + '</td><td>' + nf(r.slack) + '</td><td><span class="tag ' + (r.binding ? 'warn' : 'ok') + '">' + (r.binding ? 'Activa' : r.kind) + '</span></td><td>' +
        (r.shadow === null ? '—' : money(r.shadow, cur)) + '</td></tr>').join('') +
      '</tbody></table></div><p class="legend">Precio sombra: cuánto cambia Z por cada unidad adicional del recurso, mientras la base óptima no cambie.</p></div>';
    h += '</div>';
    el.innerHTML = h;
  }

  /* ---------- 5. Escenarios ---------- */
  function renderScenarios() {
    const el = $('#scenOut'), m = state.model, base = state.solvedModel;
    let h = '<div class="panel"><h3>Recursos por escenario</h3><div class="table-wrap"><table class="data"><thead><tr><th>Recurso</th><th>Base</th>' +
      state.scenarios.map((s, k) => '<th><input class="name" data-sf="name" data-s="' + k + '" value="' + esc(s.name) + '" aria-label="Nombre del escenario ' + (k + 1) + '"> ' +
        '<button type="button" class="icon" data-sact="del" data-s="' + k + '" aria-label="Quitar escenario ' + esc(s.name) + '">×</button></th>').join('') + '</tr></thead><tbody>' +
      m.cons.map((r, i) => '<tr><td>' + esc(r.name) + ' (' + S.SIGN[r.sign] + ')</td><td>' + nf(r.b) + '</td>' +
        state.scenarios.map((s, k) => '<td class="' + (s.b[i] !== r.b ? 'changed' : '') + '"><input type="number" step="any" data-sf="b" data-s="' + k + '" data-i="' + i + '" value="' + nv(s.b[i]) + '" aria-label="' + esc(r.name) + ', escenario ' + (k + 1) + '"></td>').join('') + '</tr>').join('') +
      '</tbody></table></div><div class="actions"><button type="button" class="btn" data-sact="add">Agregar escenario</button>' +
      '<button type="button" class="btn primary" data-sact="run">Ejecutar escenarios</button></div>' +
      '<p class="legend">Las celdas en ámbar son recursos distintos al escenario base. Al ejecutar, también se vuelve a resolver el modelo base.</p></div>';

    const res = state.result;
    if (!res || !base) {
      el.innerHTML = h + emptyBox('Ejecuta los escenarios para ver la comparación contra el modelo base.', false);
      return;
    }
    const scs = state.scenarios.filter(s => s.result);
    if (state.stale) h += '<div class="banner warn">El modelo cambió después de resolver. Pulsa «Ejecutar escenarios» para actualizar.</div>';
    if (!scs.length) { el.innerHTML = h + emptyBox('Agrega un escenario y modifica sus recursos.', false); return; }

    const cur = base.cur;
    const cols = [{ name: 'Base', res }].concat(scs.map(s => ({ name: s.name, res: s.result })));
    const cell = (o, fn) => (o.res.status === 'optimal' ? fn(o.res) : '—');
    const delta = (o, k) => {
      if (k === 0 || o.res.status !== 'optimal' || res.status !== 'optimal') return '<td>—</td>';
      const d = o.res.z - res.z;
      return '<td class="' + (d > 1e-9 ? 'diff-up' : d < -1e-9 ? 'diff-down' : '') + '">' + (d > 0 ? '+' : d < 0 ? '−' : '') + money(Math.abs(d), cur) + '</td>';
    };
    const pct = (o, k) => {
      if (k === 0 || o.res.status !== 'optimal' || res.status !== 'optimal' || Math.abs(res.z) < 1e-9) return '<td>—</td>';
      const d = (o.res.z - res.z) / Math.abs(res.z) * 100;
      return '<td>' + (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(1) + '%</td>';
    };
    h += '<div class="panel"><h3>Comparación de resultados</h3><div class="table-wrap"><table class="data"><thead><tr><th>Indicador</th>' + cols.map(o => '<th>' + esc(o.name) + '</th>').join('') + '</tr></thead><tbody>' +
      '<tr><td>Estado</td>' + cols.map(o => '<td><span class="tag ' + STATUS[o.res.status].cls + '">' + STATUS[o.res.status].label + '</span></td>').join('') + '</tr>' +
      '<tr><th>' + (base.type === 'max' ? 'Utilidad Z' : 'Costo Z') + '</th>' + cols.map(o => '<th>' + cell(o, r => money(r.z, cur)) + '</th>').join('') + '</tr>' +
      base.vars.map((v, j) => '<tr><td>x' + sub(j + 1) + ' · ' + esc(v) + '</td>' + cols.map(o => '<td>' + cell(o, r => nf(r.x[j])) + '</td>').join('') + '</tr>').join('') +
      '<tr><td>Cambio en Z</td>' + cols.map(delta).join('') + '</tr><tr><td>Cambio %</td>' + cols.map(pct).join('') + '</tr></tbody></table></div></div>';

    const lines = scs.filter(s => s.result.status === 'optimal' && res.status === 'optimal').map(s => {
      const changes = base.cons.map((r, i) => (s.b[i] !== r.b ? '«' + r.name + '» de ' + nf(r.b) + ' a ' + nf(s.b[i]) : null)).filter(Boolean);
      const d = s.result.z - res.z;
      return '<li><strong>' + esc(s.name) + ':</strong> ' + (changes.length ? esc(changes.join(', ')) : 'sin cambios en los recursos') + '. Z pasa de ' + money(res.z, cur) + ' a ' + money(s.result.z, cur) +
        ' (' + (d > 0 ? 'sube ' : d < 0 ? 'baja ' : 'sin cambio ') + (Math.abs(d) > 1e-9 ? money(Math.abs(d), cur) : '') + ').</li>';
    });
    if (lines.length) h += '<div class="panel"><h3>Interpretación</h3><ul class="notes">' + lines.join('') + '</ul></div>';
    const bars = scenarioBars(base);
    if (bars) h += '<div class="panel"><h3>Valor de Z por escenario</h3>' + bars + '</div>';
    el.innerHTML = h;
  }

  $('#scenOut').addEventListener('input', e => {
    const t = e.target, f = t.dataset.sf;
    if (!f) return;
    const sc = state.scenarios[+t.dataset.s];
    if (f === 'name') sc.name = t.value;
    else if (f === 'b') sc.b[+t.dataset.i] = parseFloat(t.value);
  });
  $('#scenOut').addEventListener('click', e => {
    const b = e.target.closest('[data-sact]');
    if (!b) return;
    const act = b.dataset.sact;
    if (act === 'add') {
      state.scenarios.push({ name: 'Escenario ' + (state.scenarios.length + 1), b: state.model.cons.map(r => r.b), result: null, model: null });
      renderScenarios();
    } else if (act === 'del') {
      state.scenarios.splice(+b.dataset.s, 1); renderScenarios();
    } else if (act === 'run') runAll('escenarios');
  });

  /* ---------- 6. Comparación A vs. B ---------- */
  function renderCompare() {
    const el = $('#cmpOut'), A = state.result;
    if (!A) { el.innerHTML = emptyBox('Resuelve el modelo para comparar los dos métodos.', true); return; }
    const m = state.solvedModel, cur = m.cur, srv = state.server;
    const engines = srv ? srv.engines : [];
    let h = state.stale ? '<div class="banner warn">El modelo cambió después de resolver. Se comparan los resultados de la última resolución.</div>' : '';
    if (!engines.length) {
      h += '<div class="banner warn">PuLP no está disponible en el servidor, por lo que no hay comparación.</div>' +
        '<p>Instálalo con <code>pip install pulp</code> y reinicia <code>app.py</code>.</p>';
      el.innerHTML = h; return;
    }
    const checks = engines.map(compareEngine);
    const allOk = checks.every(c => c.ok), xDiff = checks.some(c => c.ok && !c.sameX);
    h += '<div class="banner ' + (allOk ? 'ok' : 'bad') + '">' + (allOk ? 'Los métodos coinciden: mismo estado y mismo valor de Z.' : 'Los métodos NO coinciden. Revisa el modelo y los resultados de cada motor.') + '</div>';
    h += '<div class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Indicador</th><th>Método A · Simplex propio</th>' +
      engines.map(e => '<th>Método B · ' + esc(e.engine) + '</th>').join('') + '</tr></thead><tbody>';
    h += '<tr><td>Estado</td><td><span class="tag ' + STATUS[A.status].cls + '">' + STATUS[A.status].label + '</span></td>' +
      engines.map(e => '<td><span class="tag ' + (STATUS[e.status] || STATUS.error).cls + '">' + (STATUS[e.status] || STATUS.error).label + '</span></td>').join('') + '</tr>';
    h += '<tr><th>Z</th><th>' + (A.status === 'optimal' ? money(A.z, cur) : '—') + '</th>' +
      engines.map(e => '<th>' + (e.status === 'optimal' ? money(e.z, cur) : '—') + '</th>').join('') + '</tr>';
    m.vars.forEach((v, j) => {
      h += '<tr><td>x' + sub(j + 1) + ' · ' + esc(v) + '</td><td>' + (A.status === 'optimal' ? nf(A.x[j]) : '—') + '</td>' +
        engines.map((e, k) => '<td class="' + (checks[k].ok && !checks[k].sameX ? 'changed' : '') + '">' + (e.status === 'optimal' && e.x ? nf(e.x[j]) : '—') + '</td>').join('') + '</tr>';
    });
    h += '<tr><td>Iteraciones</td><td>' + A.pivots + '</td>' + engines.map(() => '<td>—</td>').join('') + '</tr></tbody></table></div>';
    if (xDiff) h += '<p class="legend">Z coincide pero algunas cantidades difieren: el modelo puede tener óptimos alternativos (varias soluciones con el mismo Z).</p>';
    h += '</div>';
    el.innerHTML = h;
  }

  /* ---------- Exportación (Power BI / JSON) ---------- */
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function descargarCsv(url, nombre) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      saveBlob(await r.blob(), nombre);
      toast('CSV generado desde la base de datos. En Power BI: Obtener datos → Texto/CSV.');
    } catch (err) { toast('No se pudo descargar el CSV: ' + err.message); }
  }

  function exportCsv() {
    if (!state.result || !state.exerciseId) { toast('Primero resuelve el modelo.'); return; }
    descargarCsv('/api/ejercicios/' + state.exerciseId + '/csv', 'siore_ejercicio_' + state.exerciseId + '.csv');
  }

  function exportJson() {
    if (!state.result) { toast('Primero resuelve el modelo.'); return; }
    const m = state.solvedModel;
    const pack = (model, res) => (res && res.status === 'optimal'
      ? { estado: res.status, z: res.z, variables: model.vars.map((v, j) => ({ nombre: v, valor: res.x[j] })), recursos: S.analyze(model, res.x, res.shadow) }
      : { estado: res ? res.status : 'sin resultado' });
    const data = {
      id: state.exerciseId, problema: m.name, tipo: m.type, moneda: m.cur, modelo: m, base: pack(m, state.result),
      escenarios: state.scenarios.filter(s => s.result).map(s => Object.assign({ nombre: s.name, recursos_disponibles: s.b }, pack(s.model, s.result)))
    };
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'siore_dashboard.json');
    toast('JSON exportado.');
  }

  /* ---------- 7. Historial (base de datos) ---------- */
  async function renderHistorial() {
    const el = $('#histOut');
    el.innerHTML = '<div class="empty">Cargando…</div>';
    const d = await api('/api/ejercicios');
    if (d.error) { el.innerHTML = '<div class="banner bad">' + esc(d.message) + '</div>'; return; }
    if (!d.ejercicios.length) { el.innerHTML = emptyBox('Aún no hay ejercicios guardados. Cada modelo que resuelvas se guardará aquí.', true); return; }
    el.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Fecha</th><th>Problema</th><th>Tamaño</th><th>Estado</th><th>Z</th><th>PuLP</th><th>Escenarios</th><th>Acciones</th></tr></thead><tbody>' +
      d.ejercicios.map(e => {
        const st = STATUS[e.estado] || STATUS.error;
        const pu = e.coincide === null ? '<span class="tag warn">No disponible</span>' : e.coincide ? '<span class="tag ok">Coincide</span>' : '<span class="tag bad">No coincide</span>';
        return '<tr><td>' + e.id + '</td><td>' + esc(new Date(e.creado_en).toLocaleString('es-GT')) + '</td><td>' + esc(e.nombre) + ' <span class="tag neutral">' + (e.tipo === 'max' ? 'Máx.' : 'Mín.') + '</span></td>' +
          '<td>' + e.n_vars + ' var. × ' + e.n_cons + ' rest.</td><td><span class="tag ' + st.cls + '">' + st.label + '</span></td><td>' + (e.z === null ? '—' : money(e.z, e.moneda)) + '</td><td>' + pu + '</td><td>' + e.n_escenarios + '</td>' +
          '<td style="white-space:nowrap"><button type="button" class="btn" data-hact="open" data-id="' + e.id + '">Abrir</button> <button type="button" class="btn" data-hact="csv" data-id="' + e.id + '">CSV</button> ' +
          '<button type="button" class="icon" data-hact="del" data-id="' + e.id + '" aria-label="Eliminar ejercicio ' + e.id + '" title="Eliminar">×</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="legend">«Abrir» carga el modelo y sus escenarios en el editor. Al resolverlo de nuevo se guarda como un ejercicio nuevo.</p>';
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-hact]');
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.hact;
    if (act === 'csvall') descargarCsv('/api/exportar.csv', 'siore_todos_los_ejercicios.csv');
    else if (act === 'csv') descargarCsv('/api/ejercicios/' + id + '/csv', 'siore_ejercicio_' + id + '.csv');
    else if (act === 'del') {
      if (!window.confirm('¿Eliminar el ejercicio #' + id + ' de la base de datos?')) return;
      const r = await api('/api/ejercicios/' + id, null, 'DELETE');
      if (r.error) toast(r.message); else { toast('Ejercicio #' + id + ' eliminado.'); renderHistorial(); }
    } else if (act === 'open') {
      const r = await api('/api/ejercicios/' + id);
      if (r.error) { toast(r.message); return; }
      const ex = r.ejercicio;
      setModel(ex.modelo, ex.escenarios.map(s => ({ name: s.nombre, b: s.disponibles })));
      go('modelo');
      toast('Ejercicio #' + id + ' cargado. Pulsa «Resolver modelo» para ejecutarlo de nuevo.');
    }
  });

  $('#exportCsv').addEventListener('click', exportCsv);
  $('#exportJson').addEventListener('click', exportJson);

  /* ---------- Inicio ---------- */
  loadExample('software');
  go('modelo');
})();
