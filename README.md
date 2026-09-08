# Cotizador Neorigen

Página web (sin backend) para generar el PDF de una cotización de casa Neorigen, con el diseño
del manual de marca (azul Origen #011E2F, tipografías Fraunces / Work Sans / IBM Plex Mono, logo real).

Todo corre en el navegador: subes una planilla Excel **o** escribes los datos a mano, y el PDF se
arma y descarga ahí mismo — no hay servidor, no hay que instalar nada, funciona gratis en GitHub Pages.

## Qué incluye

- **Modo 1 — Subir planilla:** sube un `.xlsx` con dos hojas (`Datos` y `Casas`) y genera el PDF.
  Incluye una planilla de ejemplo descargable con datos reales (Casa Huingán / Casa Coihue) para
  copiar el formato.
- **Modo 2 — Ingreso manual:** un formulario con menú desplegable para elegir el modelo (Lingue,
  Huingán, Maitén, Peumo, Roble, Coihue, u "Otro" para escribir uno nuevo), que permite agregar
  varias casas a la misma cotización. Los totales en UF se calculan solos a medida que escribes
  los m2 y el valor UF/m2 (y los puedes dejar así o sobreescribirlos).
- El PDF generado tiene: portada con el cliente y el proyecto, una página por cada casa cotizada
  (ficha con m2, distribución, tabla de precios y total destacado) y una página de condiciones +
  contacto del vendedor.

## Cómo publicarlo en GitHub Pages

**Opción rápida (sin usar la terminal):**
1. Ve a [github.com/new](https://github.com/new), crea un repositorio nuevo (ej: `neorigen-cotizador`), público.
2. Entra al repo → botón "Add file" → "Upload files" → arrastra **todos** los archivos y carpetas
   de esta entrega (manteniendo la carpeta `vendor/` y `assets/` tal cual) → "Commit changes".
3. Ve a **Settings → Pages**, en "Source" elige la rama `main` y carpeta `/ (root)` → Save.
4. En 1-2 minutos queda publicado en `https://<tu-usuario>.github.io/neorigen-cotizador/`.

**Opción con git (como hiciste con PIANO):**
```
cd neorigen-cotizador
git init
git add .
git commit -m "Cotizador Neorigen"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/neorigen-cotizador.git
git push -u origin main
```
Luego activa Pages igual que en el paso 3 de arriba.

## Estructura de archivos

```
index.html               la página
style.css                 estilos (tokens de marca: navy, verde pino, madera, niebla)
app.js                    toda la lógica: parseo de Excel, formulario manual, armado del PDF
vendor/                   3 librerías de terceros (SheetJS, jsPDF, html2canvas) — no depende de ningún CDN
assets/logo-neorigen.png  logo real de Neorigen (extraído de la firma de correo de Flavio)
plantilla-cotizacion.xlsx planilla de ejemplo descargable desde la propia página
```

## Notas técnicas / a tener en cuenta

- El PDF se arma "fotografiando" cada página con html2canvas y pegando esa imagen en el PDF — por
  eso queda idéntico al diseño en pantalla, pero el texto del PDF **no es seleccionable/copiable**
  (es una imagen). Si más adelante quieren un PDF con texto real seleccionable, se puede rehacer
  con otra librería, pero es bastante más trabajo de maquetación.
- Las tipografías (Fraunces, Work Sans, IBM Plex Mono) se cargan desde Google Fonts, así que la
  página necesita conexión a internet para verse con la tipografía correcta (si no hay internet,
  cae a una tipografía de reemplazo del sistema, pero el resto del diseño no se rompe).
- La hoja `Datos` es una sola fila (los datos generales de la cotización); la hoja `Casas` puede
  tener tantas filas como casas se estén cotizando — cada una se convierte en una página del PDF.
- Si dejas vacías las columnas de totales en la planilla o en el formulario, se calculan solas
  (m2 × valor UF/m2). Si las completas a mano, se respeta lo que hayas escrito.
