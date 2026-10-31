"""SIORE · base de datos SQLite: guarda cada ejercicio resuelto."""
import json
import os
import sqlite3
from datetime import datetime, timezone

from simplex_propio import analizar

RUTA = os.environ.get("SIORE_DB", os.path.join(os.path.dirname(__file__), "datos", "siore.db"))

ESQUEMA = """
CREATE TABLE IF NOT EXISTS ejercicios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT    NOT NULL,
    tipo          TEXT    NOT NULL CHECK (tipo IN ('max', 'min')),
    moneda        TEXT    NOT NULL DEFAULT '',
    creado_en     TEXT    NOT NULL,
    modelo_json   TEXT    NOT NULL,
    estado        TEXT    NOT NULL,
    z             REAL,
    iteraciones   INTEGER,
    pulp_estado   TEXT,
    pulp_z        REAL,
    coincide      INTEGER            -- 1 coinciden, 0 no coinciden, NULL sin PuLP
);
CREATE TABLE IF NOT EXISTS variables (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ejercicio_id  INTEGER NOT NULL REFERENCES ejercicios(id) ON DELETE CASCADE,
    indice        INTEGER NOT NULL,
    nombre        TEXT    NOT NULL,
    coeficiente   REAL    NOT NULL
);
CREATE TABLE IF NOT EXISTS restricciones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ejercicio_id     INTEGER NOT NULL REFERENCES ejercicios(id) ON DELETE CASCADE,
    indice           INTEGER NOT NULL,
    nombre           TEXT    NOT NULL,
    coeficientes_json TEXT   NOT NULL,
    signo            TEXT    NOT NULL CHECK (signo IN ('<=', '>=', '=')),
    disponible       REAL    NOT NULL
);
CREATE TABLE IF NOT EXISTS escenarios (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ejercicio_id     INTEGER NOT NULL REFERENCES ejercicios(id) ON DELETE CASCADE,
    nombre           TEXT    NOT NULL,
    es_base          INTEGER NOT NULL DEFAULT 0,
    disponibles_json TEXT    NOT NULL,
    estado           TEXT    NOT NULL,
    z                REAL,
    x_json           TEXT,
    recursos_json    TEXT,
    pulp_estado      TEXT,
    pulp_z           REAL,
    coincide         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_escenarios_ejercicio ON escenarios(ejercicio_id);
"""


def conectar():
    os.makedirs(os.path.dirname(RUTA), exist_ok=True)
    con = sqlite3.connect(RUTA)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def iniciar():
    con = conectar()
    con.executescript(ESQUEMA)
    con.commit()
    con.close()


def coinciden(propio, pulp_res):
    """1 / 0 según coincidan estado y Z; None si PuLP no estuvo disponible."""
    if pulp_res is None:
        return None
    if propio["status"] != pulp_res["status"]:
        return 0
    if propio["status"] == "optimal":
        return int(abs(propio["z"] - pulp_res["z"]) <= 1e-6 * (1 + abs(propio["z"])))
    return 1


def _fila_escenario(con, ejercicio_id, nombre, es_base, modelo, propio, pulp_res):
    ok = propio["status"] == "optimal"
    recursos = analizar(modelo, propio["x"], propio["shadow"]) if ok else None
    con.execute(
        """INSERT INTO escenarios (ejercicio_id, nombre, es_base, disponibles_json, estado, z, x_json,
                                   recursos_json, pulp_estado, pulp_z, coincide)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (ejercicio_id, nombre, int(es_base), json.dumps([r["b"] for r in modelo["cons"]]),
         propio["status"], propio["z"], json.dumps(propio["x"]) if ok else None,
         json.dumps(recursos) if recursos else None,
         pulp_res["status"] if pulp_res else None, pulp_res["z"] if pulp_res else None,
         coinciden(propio, pulp_res)))


def guardar(modelo, base, escenarios):
    """Guarda un ejercicio resuelto (modelo + base + escenarios). Devuelve su id.

    base = (propio, pulp);  escenarios = [(nombre, modelo_escenario, propio, pulp), ...]
    """
    propio, pulp_res = base
    con = conectar()
    try:
        with con:
            cur = con.execute(
                """INSERT INTO ejercicios (nombre, tipo, moneda, creado_en, modelo_json, estado, z,
                                           iteraciones, pulp_estado, pulp_z, coincide)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (modelo.get("name") or "Sin nombre", modelo["type"], modelo.get("cur") or "",
                 datetime.now(timezone.utc).isoformat(timespec="seconds"), json.dumps(modelo),
                 propio["status"], propio["z"], propio.get("pivots"),
                 pulp_res["status"] if pulp_res else None, pulp_res["z"] if pulp_res else None,
                 coinciden(propio, pulp_res)))
            eid = cur.lastrowid
            nombres = modelo.get("vars") or []
            for j, c in enumerate(modelo["c"]):
                con.execute("INSERT INTO variables (ejercicio_id, indice, nombre, coeficiente) VALUES (?,?,?,?)",
                            (eid, j + 1, nombres[j] if j < len(nombres) else f"x{j + 1}", c))
            for i, r in enumerate(modelo["cons"]):
                con.execute("""INSERT INTO restricciones (ejercicio_id, indice, nombre, coeficientes_json, signo, disponible)
                               VALUES (?,?,?,?,?,?)""",
                            (eid, i + 1, r.get("name") or f"Restricción {i + 1}", json.dumps(r["a"]), r["sign"], r["b"]))
            _fila_escenario(con, eid, "Base", True, modelo, propio, pulp_res)
            for nombre, m_esc, p, q in escenarios:
                _fila_escenario(con, eid, nombre, False, m_esc, p, q)
        return eid
    finally:
        con.close()


def listar():
    con = conectar()
    try:
        filas = con.execute(
            """SELECT e.id, e.nombre, e.tipo, e.moneda, e.creado_en, e.estado, e.z, e.iteraciones,
                      e.pulp_estado, e.coincide,
                      (SELECT COUNT(*) FROM variables v WHERE v.ejercicio_id = e.id) AS n_vars,
                      (SELECT COUNT(*) FROM restricciones r WHERE r.ejercicio_id = e.id) AS n_cons,
                      (SELECT COUNT(*) FROM escenarios s WHERE s.ejercicio_id = e.id AND s.es_base = 0) AS n_escenarios
               FROM ejercicios e ORDER BY e.id DESC""").fetchall()
        return [dict(f) for f in filas]
    finally:
        con.close()


def obtener(eid):
    con = conectar()
    try:
        e = con.execute("SELECT * FROM ejercicios WHERE id = ?", (eid,)).fetchone()
        if e is None:
            return None
        escs = con.execute("SELECT * FROM escenarios WHERE ejercicio_id = ? AND es_base = 0 ORDER BY id", (eid,)).fetchall()
        return {"id": e["id"], "creado_en": e["creado_en"], "modelo": json.loads(e["modelo_json"]),
                "estado": e["estado"], "z": e["z"],
                "escenarios": [{"nombre": s["nombre"], "disponibles": json.loads(s["disponibles_json"]),
                                "estado": s["estado"], "z": s["z"]} for s in escs]}
    finally:
        con.close()


def eliminar(eid):
    con = conectar()
    try:
        with con:
            return con.execute("DELETE FROM ejercicios WHERE id = ?", (eid,)).rowcount > 0
    finally:
        con.close()


ETIQUETA = {"optimal": "Óptimo", "infeasible": "No factible", "unbounded": "No acotado", "error": "Error"}


def filas_csv(eid=None):
    """Filas en formato largo (una por indicador) para Power BI. eid=None → todos los ejercicios."""
    con = conectar()
    try:
        if eid is None:
            ejercicios = con.execute("SELECT * FROM ejercicios ORDER BY id").fetchall()
        else:
            ejercicios = con.execute("SELECT * FROM ejercicios WHERE id = ?", (eid,)).fetchall()
        salida = []
        for e in ejercicios:
            nombres = [v["nombre"] for v in con.execute(
                "SELECT nombre FROM variables WHERE ejercicio_id = ? ORDER BY indice", (e["id"],))]
            base = {"Ejercicio": e["nombre"], "EjercicioId": e["id"], "Fecha": e["creado_en"]}
            for s in con.execute("SELECT * FROM escenarios WHERE ejercicio_id = ? ORDER BY id", (e["id"],)):
                estado = ETIQUETA.get(s["estado"], s["estado"])
                comun = {**base, "Escenario": s["nombre"]}
                salida.append({**comun, "Categoria": "Resultado", "Nombre": "Z", "Valor": s["z"], "Estado": estado})
                if s["estado"] != "optimal":
                    continue
                for nombre, v in zip(nombres, json.loads(s["x_json"])):
                    salida.append({**comun, "Categoria": "Variable", "Nombre": nombre, "Valor": v, "Estado": estado})
                for r in json.loads(s["recursos_json"]):
                    salida.append({**comun, "Categoria": "Recurso", "Nombre": r["name"], "Disponible": r["available"],
                                   "Utilizado": r["used"], "Holgura": r["slack"], "PrecioSombra": r["shadow"],
                                   "Estado": "Activa" if r["binding"] else r["kind"]})
        return salida
    finally:
        con.close()
