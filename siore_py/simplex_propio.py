"""SIORE · Método A: Simplex propio (método de la Gran M), escrito desde cero.

M se maneja de forma simbólica: cada valor de la fila Z es a + b·M, así no hay
errores por usar un número "muy grande". Devuelve todas las tablas (iteraciones)
para que la interfaz las muestre.
"""
import math

EPS = 1e-9
MAX_ITER = 500
_SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
_FLIP = {"<=": ">=", ">=": "<=", "=": "="}


def sub(n):
    return str(n).translate(_SUB)


def _es_numero(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validar(modelo):
    """Devuelve un texto de error o None si el modelo es válido."""
    try:
        c, cons = modelo["c"], modelo["cons"]
        if modelo.get("type") not in ("max", "min"):
            return "El tipo de problema debe ser maximización o minimización."
        n = len(c)
        if n == 0:
            return "Agrega al menos una variable de decisión."
        if not cons:
            return "Agrega al menos una restricción."
        if not all(_es_numero(v) for v in c):
            return "Hay coeficientes vacíos o inválidos en la función objetivo."
        for i, r in enumerate(cons, 1):
            if len(r["a"]) != n or not all(_es_numero(v) for v in r["a"]):
                return f"La restricción {i} tiene coeficientes vacíos o inválidos."
            if not _es_numero(r["b"]):
                return f"La restricción {i} no tiene valor de disponibilidad o requerimiento."
            if r["sign"] not in _FLIP:
                return f"La restricción {i} tiene un signo inválido."
    except (KeyError, TypeError):
        return "El modelo recibido está incompleto."
    return None


def construir_forma_estandar(modelo):
    """≤ → + holgura (s)   ≥ → − exceso (e) + artificial (a)   = → + artificial (a)."""
    n = len(modelo["c"])
    es_max = modelo["type"] == "max"
    c_obj = [float(v) if es_max else -float(v) for v in modelo["c"]]

    filas = []
    for i, r in enumerate(modelo["cons"]):
        a, b, signo = [float(v) for v in r["a"]], float(r["b"]), r["sign"]
        volteada = b < 0
        if volteada:  # el lado derecho debe ser ≥ 0
            a, b, signo = [-v for v in a], -b, _FLIP[signo]
        filas.append({"a": a, "b": b, "sign": signo, "flipped": volteada})

    cols = [{"name": "x" + sub(j + 1), "type": "x", "xi": j} for j in range(n)]
    holgura, exceso, artif = {}, {}, {}
    for i, r in enumerate(filas):
        if r["sign"] == "<=":
            holgura[i] = len(cols)
            cols.append({"name": "s" + sub(i + 1), "type": "s", "row": i})
        elif r["sign"] == ">=":
            exceso[i] = len(cols)
            cols.append({"name": "e" + sub(i + 1), "type": "e", "row": i})
    for i, r in enumerate(filas):
        if r["sign"] != "<=":
            artif[i] = len(cols)
            cols.append({"name": "a" + sub(i + 1), "type": "a", "row": i})

    N = len(cols)
    A = []
    for i, r in enumerate(filas):
        fila = [0.0] * N
        fila[:n] = r["a"]
        if i in holgura:
            fila[holgura[i]] = 1.0
        if i in exceso:
            fila[exceso[i]] = -1.0
        if i in artif:
            fila[artif[i]] = 1.0
        A.append(fila)
    base = [holgura[i] if r["sign"] == "<=" else artif[i] for i, r in enumerate(filas)]
    return {"n": n, "N": N, "cols": cols, "A": A, "b": [r["b"] for r in filas], "base": base,
            "c_obj": c_obj, "filas": filas, "es_max": es_max,
            "holgura": holgura, "exceso": exceso, "artif": artif}


def resolver(modelo, _sonda=False):
    """Resuelve el modelo con el Simplex (Gran M). Devuelve un dict listo para JSON."""
    error = validar(modelo)
    if error:
        return {"status": "error", "invalid": True, "message": error}

    sf = construir_forma_estandar(modelo)
    cols, N, n = sf["cols"], sf["N"], sf["n"]
    m = len(sf["A"])
    T = [fila[:] + [b] for fila, b in zip(sf["A"], sf["b"])]
    zv = [0.0] * (N + 1)   # parte constante de la fila Z
    zm = [0.0] * (N + 1)   # parte que multiplica a M
    for j, c in enumerate(cols):
        if c["type"] == "x":
            zv[j] = -sf["c_obj"][c["xi"]]
        elif c["type"] == "a":
            zm[j] = 1.0
    base = sf["base"][:]
    for i, bj in enumerate(base):  # eliminar artificiales de la fila Z: Z -= M · fila
        if cols[bj]["type"] == "a":
            for k in range(N + 1):
                zm[k] -= T[i][k]

    nombres = [c["name"] for c in cols]
    iteraciones = []

    def foto(entra, sale, razones):
        return {"T": [f[:] for f in T], "zv": zv[:], "zm": zm[:],
                "basisNames": [nombres[b] for b in base],
                "enter": entra, "leave": sale, "ratios": razones}

    status, mensaje = None, ""
    for _ in range(MAX_ITER + 1):
        # Variable entrante: valor más negativo de la fila Z (primero la parte M)
        e = -1
        for j in range(N):
            neg = zm[j] < -EPS or (abs(zm[j]) <= EPS and zv[j] < -EPS)
            if not neg:
                continue
            if (e < 0 or zm[j] < zm[e] - EPS
                    or (abs(zm[j] - zm[e]) <= EPS and zv[j] < zv[e] - EPS)):
                e = j
        if e < 0:
            iteraciones.append(foto(-1, -1, None))
            status = "optimal"
            break

        # Variable saliente: prueba de razón mínima
        razones = [T[i][N] / T[i][e] if T[i][e] > EPS else None for i in range(m)]
        l = -1
        for i in range(m):
            if razones[i] is None:
                continue
            if (l < 0 or razones[i] < razones[l] - 1e-12
                    or (abs(razones[i] - razones[l]) <= 1e-12 and base[i] < base[l])):
                l = i
        if l < 0:
            iteraciones.append(foto(e, -1, razones))
            status = "unbounded"
            break
        iteraciones.append(foto(e, l, razones))

        # Pivoteo
        p = T[l][e]
        T[l] = [v / p for v in T[l]]
        for i in range(m):
            if i != l:
                f = T[i][e]
                if abs(f) > EPS:
                    T[i] = [a - f * b for a, b in zip(T[i], T[l])]
        fv, fm = zv[e], zm[e]
        for k in range(N + 1):
            zv[k] -= fv * T[l][k]
            zm[k] -= fm * T[l][k]
        base[l] = e

    if status is None:
        status, mensaje = "error", f"Se superó el máximo de {MAX_ITER} iteraciones (posible ciclaje)."

    res = {"status": status, "message": mensaje, "iterations": iteraciones, "colNames": nombres,
           "zLabel": "Z" if sf["es_max"] else "Z′ (= −Z)",
           "pivots": max(0, len(iteraciones) - 1), "x": None, "z": None, "shadow": None}

    if status != "optimal":
        if status == "unbounded":
            res["message"] = "La función objetivo puede mejorar sin límite."
            # Con artificiales positivas en la base no se puede afirmar "no acotado":
            # se comprueba antes si el modelo es factible (objetivo nulo).
            hay_art = any(cols[b]["type"] == "a" and T[i][N] > 1e-7 for i, b in enumerate(base))
            if hay_art and not _sonda:
                sonda = resolver({**modelo, "c": [0] * n, "type": "max"}, _sonda=True)
                if sonda["status"] == "infeasible":
                    res["status"] = "infeasible"
                    res["message"] = "Ninguna combinación de variables cumple todas las restricciones a la vez."
        return res

    for i, b in enumerate(base):  # artificial positiva en la base → no factible
        if cols[b]["type"] == "a" and T[i][N] > 1e-7:
            res["status"] = "infeasible"
            res["message"] = "Ninguna combinación de variables cumple todas las restricciones a la vez."
            return res

    x = [0.0] * n
    for i, b in enumerate(base):
        if cols[b]["type"] == "x":
            x[cols[b]["xi"]] = 0.0 if abs(T[i][N]) < 1e-9 else round(T[i][N], 9)
    z = sum(float(c) * xv for c, xv in zip(modelo["c"], x))

    # Precios sombra (dZ/db) leídos de la fila Z final
    sombra = []
    for i, r in enumerate(sf["filas"]):
        if i in sf["holgura"]:
            y = zv[sf["holgura"][i]]
        elif i in sf["exceso"]:
            y = -zv[sf["exceso"][i]]
        else:
            y = zv[sf["artif"][i]]
        y *= (-1 if r["flipped"] else 1) * (1 if sf["es_max"] else -1)
        sombra.append(0.0 if abs(y) < 1e-9 else y)

    res.update(x=x, z=z, shadow=sombra)
    return res


def analizar(modelo, x, sombra=None):
    """Tabla de recursos: disponible vs. utilizado vs. holgura."""
    filas = []
    for i, r in enumerate(modelo["cons"]):
        usado = sum(a * xv for a, xv in zip(r["a"], x))
        if r["sign"] == "<=":
            holgura, tipo = r["b"] - usado, "Holgura"
        elif r["sign"] == ">=":
            holgura, tipo = usado - r["b"], "Exceso"
        else:
            holgura, tipo = abs(usado - r["b"]), "Igualdad"
        if abs(holgura) < 1e-7:
            holgura = 0.0
        filas.append({"name": r.get("name") or f"Restricción {i + 1}", "sign": r["sign"],
                      "available": r["b"], "used": usado, "slack": holgura, "kind": tipo,
                      "shadow": sombra[i] if sombra else None, "binding": holgura == 0})
    return filas
