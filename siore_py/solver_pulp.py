"""SIORE · Método B: PuLP (solver CBC)."""
try:
    import pulp
except ImportError:  # PuLP no instalado: la app sigue funcionando sin la verificación
    pulp = None

_ESTADOS = {"Optimal": "optimal", "Infeasible": "infeasible", "Unbounded": "unbounded"}


def version():
    return getattr(pulp, "__version__", None) if pulp else None


def resolver_pulp(modelo):
    """Resuelve el mismo modelo con PuLP. Devuelve (resultado, nota).

    resultado = {"engine", "status", "x", "z", "message"} o None si PuLP no está instalado.
    """
    if pulp is None:
        return None, "PuLP no está instalado. Instálalo con: pip install pulp"

    sentido = pulp.LpMaximize if modelo["type"] == "max" else pulp.LpMinimize
    prob = pulp.LpProblem("SIORE", sentido)
    xs = [pulp.LpVariable(f"x{j + 1}", lowBound=0) for j in range(len(modelo["c"]))]

    prob += pulp.lpSum(c * x for c, x in zip(modelo["c"], xs))
    for k, r in enumerate(modelo["cons"], 1):
        expr = pulp.lpSum(a * x for a, x in zip(r["a"], xs))
        if r["sign"] == "<=":
            prob += expr <= r["b"], f"R{k}"
        elif r["sign"] == ">=":
            prob += expr >= r["b"], f"R{k}"
        else:
            prob += expr == r["b"], f"R{k}"

    try:
        prob.solve(pulp.PULP_CBC_CMD(msg=0))
    except Exception as exc:  # CBC no encontrado, etc.
        return {"engine": "PuLP (CBC)", "status": "error", "x": None, "z": None,
                "message": f"PuLP no pudo ejecutarse: {exc}"}, None

    estado_pulp = pulp.LpStatus[prob.status]
    status = _ESTADOS.get(estado_pulp, "error")
    res = {"engine": "PuLP (CBC)", "status": status, "x": None, "z": None, "message": estado_pulp}
    if status == "optimal":
        x = [round(v.value() or 0.0, 9) for v in xs]
        res["x"] = x
        res["z"] = sum(float(c) * xv for c, xv in zip(modelo["c"], x))
    return res, None
