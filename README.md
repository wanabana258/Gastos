# Mis gastos (PWA)

App para apuntar gastos con frases cortas ("3€ en cafetería uni"). Sin cuentas,
sin servidor, sin saldo: todo se guarda en el móvil y funciona sin conexión.

## Estructura

```
index.html            Página única (barra de captura + pestañas)
manifest.webmanifest  Datos de instalación (nombre, iconos, colores)
sw.js                 Service worker: caché para usar la app sin internet
css/estilos.css       Diseño (variables de color en :root; modo claro/oscuro automático)
js/app.js             Interfaz: vistas, hoja de confirmación, eventos
js/parser.js          Frase → importe + concepto
js/categorias.js      Categorías, diccionario de palabras clave y aprendizaje
js/almacen.js         Guardado en localStorage, copia de seguridad, fusión al importar
js/csv.js             Exportar/importar CSV
js/graficas.js        Donut SVG y barras (sin librerías)
icons/                Iconos de la app
```

## Probar en el ordenador

El service worker solo funciona con HTTPS o `localhost` (no abriendo el archivo con doble clic):

```
cd gastos-app
python3 -m http.server 8000
# abre http://localhost:8000
```

## Publicar gratis en GitHub Pages

1. Crea un repositorio público en GitHub (por ejemplo `gastos`).
   Solo el código será público; tus gastos nunca salen del móvil.
2. Sube el contenido de esta carpeta (con `index.html` en la raíz):
   ```
   git init
   git add .
   git commit -m "Primera versión"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/gastos.git
   git push -u origin main
   ```
3. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**,
   rama `main`, carpeta `/ (root)`, **Save**.
4. En uno o dos minutos estará en `https://TU_USUARIO.github.io/gastos/`.

Alternativa sin Git: arrastrar la carpeta a https://app.netlify.com/drop (necesita cuenta gratuita para que la web no caduque).

## Instalar en Android

1. Abre la dirección en **Chrome** (con conexión, solo la primera vez).
2. Menú **⋮ → Instalar aplicación** (o "Añadir a la pantalla de inicio").
   También puede aparecer un botón en **Ajustes → Instalar**.
3. Ya tienes el icono. Prueba el modo avión: debe abrir y funcionar igual.

Usa siempre la misma dirección: cada dirección tiene sus propios datos.

## Copia de seguridad

- **Ajustes → Guardar copia completa (.json)**: descarga todos los gastos y las palabras aprendidas.
  Mándatela a Drive, al correo o a un chat contigo mismo.
- **Ajustes → Exportar gastos a Excel (.csv)**: para abrirlo en Excel/Sheets.
- **Ajustes → Importar o restaurar**: acepta el `.json` o el `.csv`. Si importas dos veces
  el mismo archivo no se duplica nada.
- Cambio de móvil: instala la app desde la misma dirección e importa el `.json`.
- Si borras los datos de Chrome o del sitio, se pierden los gastos: haz copia cada mes.

## Cómo modificarla

- **Palabras clave / categorías**: `js/categorias.js` (objeto `DICCIONARIO` y lista `CATEGORIAS`).
- **Colores y tamaños**: variables al principio de `css/estilos.css`.
- **Nuevos archivos**: añádelos a `ARCHIVOS` en `sw.js` y cambia `VERSION` (`'v2'`).
  Para cambios en archivos existentes basta con subirlos: la app se actualiza al abrirla dos veces.
- Los importes se guardan en **céntimos** (enteros) para evitar errores de redondeo.

## Pendiente para la siguiente versión

Comparativa con el mes anterior, sección "¿Qué podría recortar?" y límites mensuales por categoría.
