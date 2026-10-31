/* =========================================================
   SIORE · utilidades de presentación (navegador)
   El Simplex propio y PuLP se ejecutan en Python (simplex_propio.py, solver_pulp.py).
   Aquí solo se valida, se da formato y se arma el texto del modelo y de la forma estándar.
   ========================================================= */
(function (global) {
  'use strict';

  const EPS = 1e-9;
  const SUB = '₀₁₂₃₄₅₆₇₈₉';

  const sub = n => String(n).replace(/\d/g, d => SUB[d]);

  /** Formatea un número para mostrarlo (máx. 4 decimales, signo − tipográfico). */
  function fmt(v, dec = 4) {
    if (!Number.isFinite(v)) return String(v);
    const r = Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
    if (Math.abs(r) < 1e-12) return '0';
    return r < 0 ? '−' + String(-r) : String(r);
  }

  /** Formatea un valor a + b·M de la fila Z. */
  function fmtM(v, m) {
    const hasM = Math.abs(m) > EPS;
    const hasV = Math.abs(v) > EPS;
    if (!hasM) return fmt(v);
    const coef = Math.abs(Math.abs(m) - 1) < EPS ? '' : fmt(Math.abs(m));
    let s = (m < 0 ? '−' : '') + coef + 'M';
    if (hasV) s += (v < 0 ? ' − ' : ' + ') + fmt(Math.abs(v));
    return s;
  }

  /** Texto lineal: 500x₁ + 400x₂ − x₃ */
  function linear(coefs, names) {
    let s = '';
    coefs.forEach((c, j) => {
      if (Math.abs(c) < EPS) return;
      const abs = Math.abs(c);
      const term = (Math.abs(abs - 1) < EPS ? '' : fmt(abs)) + names[j];
      if (!s) s = (c < 0 ? '−' : '') + term;
      else s += (c < 0 ? ' − ' : ' + ') + term;
    });
    return s || '0';
  }

  const SIGN = { '<=': '≤', '>=': '≥', '=': '=' };

  /** Valida el modelo capturado por el usuario. Devuelve texto de error o null. */
  function validate(model) {
    const n = model.c.length;
    if (!n) return 'Agrega al menos una variable de decisión.';
    if (!model.cons.length) return 'Agrega al menos una restricción.';
    if (model.c.some(v => !Number.isFinite(v))) {
      return 'Hay coeficientes vacíos o inválidos en la función objetivo.';
    }
    for (let i = 0; i < model.cons.length; i++) {
      const r = model.cons[i];
      if (r.a.length !== n || r.a.some(v => !Number.isFinite(v))) {
        return 'La restricción ' + (i + 1) + ' tiene coeficientes vacíos o inválidos.';
      }
      if (!Number.isFinite(r.b)) {
        return 'La restricción ' + (i + 1) + ' no tiene valor de disponibilidad o requerimiento.';
      }
      if (!SIGN[r.sign]) return 'La restricción ' + (i + 1) + ' tiene un signo inválido.';
    }
    return null;
  }

  /** Texto formal del modelo (antes de resolver). */
  function formalModel(model) {
    const xn = model.c.map((_, j) => 'x' + sub(j + 1));
    const lines = [];
    lines.push((model.type === 'max' ? 'Max' : 'Min') + ' Z = ' + linear(model.c, xn));
    lines.push('sujeto a:');
    model.cons.forEach(r => {
      lines.push('   ' + linear(r.a, xn) + ' ' + SIGN[r.sign] + ' ' + fmt(r.b) + (r.name ? '      (' + r.name + ')' : ''));
    });
    lines.push('   ' + xn.join(', ') + ' ≥ 0');
    return lines;
  }

  /**
   * Convierte a forma estándar (maximización, lado derecho ≥ 0):
   *  ≤  → + holgura (s)      ≥  → − exceso (e) + artificial (a)      =  → + artificial (a)
   */
  function buildStandardForm(model) {
    const n = model.c.length;
    const maxType = model.type === 'max';
    const cObj = model.c.map(v => (maxType ? v : -v));

    const rows = model.cons.map((r, i) => {
      let a = r.a.slice(), b = r.b, sign = r.sign, flipped = false;
      if (b < 0) {
        a = a.map(v => -v); b = -b; flipped = true;
        sign = sign === '<=' ? '>=' : sign === '>=' ? '<=' : '=';
      }
      return { a, b, sign, flipped, name: r.name || ('Restricción ' + (i + 1)) };
    });

    const cols = [];
    for (let j = 0; j < n; j++) cols.push({ name: 'x' + sub(j + 1), type: 'x', xi: j });
    const slackCol = [], surCol = [], artCol = [];
    rows.forEach((r, i) => {
      if (r.sign === '<=') { slackCol[i] = cols.length; cols.push({ name: 's' + sub(i + 1), type: 's', row: i }); }
      else if (r.sign === '>=') { surCol[i] = cols.length; cols.push({ name: 'e' + sub(i + 1), type: 'e', row: i }); }
    });
    rows.forEach((r, i) => {
      if (r.sign !== '<=') { artCol[i] = cols.length; cols.push({ name: 'a' + sub(i + 1), type: 'a', row: i }); }
    });

    const N = cols.length;
    const A = rows.map((r, i) => {
      const row = new Array(N).fill(0);
      r.a.forEach((v, j) => { row[j] = v; });
      if (slackCol[i] !== undefined) row[slackCol[i]] = 1;
      if (surCol[i] !== undefined) row[surCol[i]] = -1;
      if (artCol[i] !== undefined) row[artCol[i]] = 1;
      return row;
    });
    const basis = rows.map((r, i) => (r.sign === '<=' ? slackCol[i] : artCol[i]));
    const b = rows.map(r => r.b);
    return { n, N, cols, A, b, basis, cObj, rows, maxType, slackCol, surCol, artCol };
  }

  /** Descripción en texto de la forma estándar para mostrarla al usuario. */
  function standardText(sf, model) {
    const colNames = sf.cols.map(c => c.name);
    const xn = colNames.slice(0, sf.n);
    let obj = (sf.maxType ? 'Max Z = ' : 'Max Z′ = −Z = ') + linear(sf.cObj, xn);
    sf.cols.forEach(c => {
      if (c.type === 's' || c.type === 'e') obj += ' + 0' + c.name;
      if (c.type === 'a') obj += ' − M' + c.name;
    });
    const equations = sf.A.map((row, i) => linear(row, colNames) + ' = ' + fmt(sf.b[i]));
    const notes = [];
    if (!sf.maxType) notes.push('El problema es de minimización: se resuelve como Max Z′ = −Z y al final se recupera Z = −Z′.');
    sf.rows.forEach((r, i) => {
      const tag = 'R' + (i + 1) + ' «' + r.name + '»';
      let t = '';
      if (r.flipped) t += 'El lado derecho era negativo: se multiplicó por −1 e invirtió el signo. ';
      if (r.sign === '<=') t += 'Es ≤: se suma la variable de holgura ' + colNames[sf.slackCol[i]] + ' (recurso no utilizado).';
      else if (r.sign === '>=') t += 'Es ≥: se resta la variable de exceso ' + colNames[sf.surCol[i]] + ' (excedente sobre el mínimo) y se suma la artificial ' + colNames[sf.artCol[i]] + ' para tener una solución básica factible inicial.';
      else t += 'Es =: no lleva holgura ni exceso; se suma la artificial ' + colNames[sf.artCol[i]] + ' para iniciar el Simplex.';
      notes.push(tag + ': ' + t);
    });
    if (sf.cols.some(c => c.type === 'a')) {
      notes.push('Método de la Gran M: cada artificial entra a Z con coeficiente −M (M es un número muy grande), así el Simplex las saca de la base.');
    }
    return { objective: obj, equations, notes };
  }

  /** Tabla de recursos: disponible vs. utilizado vs. holgura. */
  function analyze(model, x, shadow) {
    return model.cons.map((r, i) => {
      const used = r.a.reduce((s, a, j) => s + a * x[j], 0);
      let slack, kind;
      if (r.sign === '<=') { slack = r.b - used; kind = 'Holgura'; }
      else if (r.sign === '>=') { slack = used - r.b; kind = 'Exceso'; }
      else { slack = Math.abs(used - r.b); kind = 'Igualdad'; }
      if (Math.abs(slack) < 1e-7) slack = 0;
      return {
        name: r.name || ('Restricción ' + (i + 1)), sign: r.sign, available: r.b, used, slack, kind,
        shadow: shadow ? shadow[i] : null, binding: slack === 0
      };
    });
  }

  global.SIORE = { validate, formalModel, buildStandardForm, standardText, analyze, fmt, fmtM, sub, linear, SIGN };
})(typeof window !== 'undefined' ? window : globalThis);
