"""SIORE · servidor Flask.

Rutas:
  GET  /                              interfaz
  POST /api/resolver                  resuelve (Simplex propio + PuLP) y guarda el ejercicio
  GET  /api/ejercicios                historial
  GET  /api/ejercicios/<id>           un ejercicio guardado
  DELETE /api/ejercicios/<id>         elimina un ejercicio
  GET  /api/ejercicios/<id>/csv       CSV para Power BI de un ejercicio
  GET  /api/exportar.csv              CSV para Power BI de todos los ejercicios
"""
import csv
import io
import platform
import re

from flask import Flask, Response, jsonify, render_template, request

import db
import simplex_propio
import solver_pulp

app = Flask(__name__)
app.json.ensure_ascii = False
db.iniciar()

MAX_VARS = MAX_CONS = 200
COLUMNAS_CSV = ["Ejercicio", "EjercicioId", "Fecha", "Escenario", "Categoria", "Nombre", "Valor",
                "Disponible", "Utilizado", "Holgura", "PrecioSombra", "Estado"]


def error(mensaje, codigo=400):
    return jsonify({"error": True, "message": mensaje}), codigo


def _limpiar_modelo(d):
    """Toma solo los campos conocidos del JSON recibido."""
    cons = [{"name": str(r.get("name", "")), "a": r["a"], "sign": r["sign"], "b": r["b"]} for r in d["cons"]]
    return {"name": str(d.get("name", ""))[:200], "type": d["type"], "cur": str(d.get("cur", ""))[:4],
            "vars": [str(v)[:200] for v in d.get("vars", [])], "c": d["c"], "cons": cons}


def _resolver_ambos(modelo):
    propio = simplex_propio.resolver(modelo)
    if propio.get("invalid"):
        return propio, None
    pulp_res, _ = solver_pulp.resolver_pulp(modelo)
    return propio, pulp_res


@app.get("/")
def index():
    return render_template("index.html", python=platform.python_version(), pulp=solver_pulp.version())


@app.post("/api/resolver")
def api_resolver():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict) or not isinstance(datos.get("model"), dict):
        return error("Solicitud inválida.")
    try:
        modelo = _limpiar_modelo(datos["model"])
    except (KeyError, TypeError, AttributeError):
        return error("El modelo recibido está incompleto.")
    if len(modelo["c"]) > MAX_VARS or len(modelo["cons"]) > MAX_CONS:
        return error("El modelo es demasiado grande.")
    problema = simplex_propio.validar(modelo)
    if problema:
        return error(problema)

    propio, pulp_res = _resolver_ambos(modelo)
    notas = []
    if pulp_res is None:
        notas.append(solver_pulp.resolver_pulp(modelo)[1])

    escenarios_out, para_guardar = [], []
    for sc in (datos.get("scenarios") or [])[:20]:
        try:
            b = sc.get("b", [])
            m_esc = {**modelo, "cons": [{**r, "b": (b[i] if i < len(b) else r["b"])} for i, r in enumerate(modelo["cons"])]}
            nombre = str(sc.get("name") or "Escenario")[:200]
        except (AttributeError, TypeError):
            continue
        p, q = _resolver_ambos(m_esc)
        escenarios_out.append({"name": nombre, "propio": p, "pulp": [q] if q else []})
        if not p.get("invalid"):
            para_guardar.append((nombre, m_esc, p, q))

    eid = db.guardar(modelo, (propio, pulp_res), para_guardar)
    return jsonify({"id": eid, "propio": propio, "pulp": [pulp_res] if pulp_res else [],
                    "notas": [n for n in notas if n], "escenarios": escenarios_out})


@app.get("/api/ejercicios")
def api_listar():
    return jsonify({"ejercicios": db.listar()})


@app.get("/api/ejercicios/<int:eid>")
def api_obtener(eid):
    e = db.obtener(eid)
    return jsonify({"ejercicio": e}) if e else error("No existe ese ejercicio.", 404)


@app.delete("/api/ejercicios/<int:eid>")
def api_eliminar(eid):
    return jsonify({"ok": True}) if db.eliminar(eid) else error("No existe ese ejercicio.", 404)


def _respuesta_csv(filas, nombre):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(COLUMNAS_CSV)
    for f in filas:
        linea = []
        for c in COLUMNAS_CSV:
            v = f.get(c, "")
            v = "" if v is None else v
            if isinstance(v, float):
                v = round(v, 9)
            if isinstance(v, str) and v and v[0] in "=+-@":  # evita inyección de fórmulas en Excel
                v = "'" + v
            linea.append(v)
        w.writerow(linea)
    nombre = re.sub(r"[^A-Za-z0-9_\-]", "_", nombre)
    return Response("\ufeff" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{nombre}.csv"',
                             "Content-Type": "text/csv; charset=utf-8"})


@app.get("/api/ejercicios/<int:eid>/csv")
def api_csv(eid):
    if db.obtener(eid) is None:
        return error("No existe ese ejercicio.", 404)
    return _respuesta_csv(db.filas_csv(eid), f"siore_ejercicio_{eid}")


@app.get("/api/exportar.csv")
def api_csv_todos():
    return _respuesta_csv(db.filas_csv(None), "siore_todos_los_ejercicios")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
