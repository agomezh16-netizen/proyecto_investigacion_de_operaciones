# SIORE · Sistema Inteligente de Optimización de Recursos (versión Python)

Aplicación web de Programación Lineal con **Flask**, **PuLP** y una base de datos **SQLite** que guarda cada ejercicio resuelto.

## Cómo ejecutarlo
```bash
pip install -r requirements.txt     # flask y pulp
python app.py                        # abre http://127.0.0.1:5000
```
La base de datos `datos/siore.db` se crea sola al iniciar. PuLP trae el solver CBC incluido; si PuLP no está instalado,
la app funciona igual pero la comparación Simplex propio vs. PuLP aparece como «no disponible».

## Estructura
| Archivo | Función |
|---|---|
| `app.py` | Servidor Flask y API (resolver, historial, exportar CSV) |
| `simplex_propio.py` | **Método A**: Simplex propio (Gran M simbólica), con todas las iteraciones |
| `solver_pulp.py` | **Método B**: el mismo modelo resuelto con PuLP (CBC) |
| `db.py` | Base de datos SQLite: guardar, listar, abrir, eliminar y generar CSV |
| `templates/index.html` | Interfaz (7 pasos) |
| `static/js/app.js`, `static/js/utilidades.js`, `static/css/style.css` | Interfaz del navegador: formulario dinámico, dashboard y estilos |

## Base de datos (`datos/siore.db`)
| Tabla | Contenido |
|---|---|
| `ejercicios` | Una fila por cada vez que resuelves: nombre, tipo, moneda, fecha, modelo completo (JSON), estado, Z, iteraciones, resultado de PuLP y si coinciden |
| `variables` | Variables de decisión del ejercicio con su coeficiente en Z |
| `restricciones` | Restricciones: coeficientes, signo y valor disponible o requerido |
| `escenarios` | El escenario **Base** y cada escenario alterno: recursos, estado, Z, cantidades, tabla de recursos y comparación con PuLP |

Cada pulsación de «Resolver modelo» (o «Ejecutar escenarios») crea un ejercicio nuevo. Desde el paso **Historial** puedes abrirlo de nuevo en el editor, eliminarlo o exportarlo.

## Power BI
- Dashboard → **Exportar CSV para Power BI**: el ejercicio actual (base + escenarios).
- Historial → **Exportar todo a CSV**: todos los ejercicios guardados.
- En Power BI Desktop: *Obtener datos → Texto/CSV*. Formato largo: filtra por `Categoria` (Resultado, Variable, Recurso) y usa `Escenario` o `Ejercicio` como leyenda.
- También puedes conectar Power BI directamente al archivo `siore.db` con un conector SQLite/ODBC.

## Requisitos del enunciado → dónde están
Modelo dinámico y notación formal (paso 1) · forma estándar (2) · Simplex propio paso a paso (3) · dashboard con solución, Z, tabla de recursos, estado, 4 gráficos e interpretación (4) · escenarios (5) · comparación con PuLP (6) · historial en base de datos (7).

## Notas
- Las soluciones son continuas (Programación Lineal): un resultado como 0.81 viajes es válido en el modelo.
- Si hay óptimos alternativos, Z coincide pero las cantidades pueden diferir entre métodos; la pantalla lo avisa.
- `app.py` usa el servidor de desarrollo de Flask: ideal para la defensa y pruebas locales.
