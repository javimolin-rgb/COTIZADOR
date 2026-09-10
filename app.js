/* Cotizador Neorigen — todo corre en el navegador, no hay backend. */

const REQUIRED_DATOS = ["Cliente", "Teléfono Cliente", "Correo Cliente", "Fecha", "Vendedor",
  "Teléfono Vendedor", "Proyecto / Ubicación", "Vigencia (días)"];
const REQUIRED_CASAS = ["Modelo", "Distribución", "Pisos", "M2 Útil", "M2 Terraza",
  "Valor UF m2 Útil", "Valor UF m2 Terraza"];

// Ficha técnica y precio base de cada modelo, según la "LISTA DE PRECIOS DEL 27 DE AGOSTO
// DE 2026" (planilla oficial de precios de venta) — se usa para autocompletar distribución,
// pisos, m2 y valores UF/m2 al elegir el modelo en el ingreso manual. Todos los campos quedan
// editables igual después de autocompletarse (el vendedor puede ajustar valores por cliente/
// terreno, tal como ya se hacía a mano).
const PRECIOS_POR_MODELO = {
  "Lingue":           { distribucion: "1D-1B",     pisos: "2 pisos", m2Util: 57.39,  m2Terraza: 29.07, valorUtil: 38,   valorTerraza: 6 },
  "Huingán":          { distribucion: "2D-2B",     pisos: "1 piso",  m2Util: 73.76,  m2Terraza: 37.76, valorUtil: 36.5, valorTerraza: 6 },
  "Peumo":            { distribucion: "2D-2B",     pisos: "2 pisos", m2Util: 87.3,   m2Terraza: 37.86, valorUtil: 36,   valorTerraza: 6 },
  "Boldo":            { distribucion: "4D-2B",     pisos: "2 pisos", m2Util: 103.85, m2Terraza: 30,    valorUtil: 36,   valorTerraza: 6 },
  "Huingán Familiar": { distribucion: "3D-2B",     pisos: "1 piso",  m2Util: 106.53, m2Terraza: 48.06, valorUtil: 34.5, valorTerraza: 6 },
  "Roble":            { distribucion: "4D-3B",     pisos: "2 pisos", m2Util: 142.5,  m2Terraza: 34,    valorUtil: 33.5, valorTerraza: 6 },
  "Maitén":           { distribucion: "4D-4B",     pisos: "2 pisos", m2Util: 145.79, m2Terraza: 85.4,  valorUtil: 34,   valorTerraza: 6 },
  "Coihue":           { distribucion: "3D-3B+ESC", pisos: "1 piso",  m2Util: 167.38, m2Terraza: 60.52, valorUtil: 33,   valorTerraza: 6 },
};

// Datos de contacto por vendedor — se usan para autocompletar teléfono y correo
// al elegir el vendedor en el ingreso manual (los campos quedan editables igual).
const VENDEDORES = {
  "Alejandro Vásquez": { telefono: "+56 9 4223 4330", correo: "" },
  "Flavio Simonetti": { telefono: "+56 9 4235 5665", correo: "" },
  "Macarena Diaz": { telefono: "+56 9 4235 5665", correo: "" },
};

const state = { datos: null, casas: null };

// ======================================================================
// Tabs
// ======================================================================

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.querySelectorAll(".tab-panel").forEach(p => p.hidden = true);
    document.getElementById("tab-" + btn.dataset.tab).hidden = false;
  });
});

// ======================================================================
// Shared helpers: number parsing/formatting + row normalization
// ======================================================================

function toNumber(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

// Chilean-style formatting: thousands with '.', decimals with ','
function fmt(n, decimals = 0) {
  return Number(n || 0).toLocaleString("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Igual que fmt(), pero sin ceros decimales de más (para escribir un valor "como lo
// tipearía una persona" dentro de un input editable: 30 en vez de 30,00, 36,5 en vez de 36,50).
function fmtEditable(n, maxDecimals = 2) {
  return Number(n || 0).toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
}

function missingFields(row, requiredCols) {
  return requiredCols.filter(c => row[c] === undefined || String(row[c]).trim() === "");
}

/** row: objeto con las mismas llaves en español usadas en la planilla (Modelo, Distribución, ...).
 *  Devuelve un objeto normalizado con números listos para pintar el PDF, calculando los
 *  totales que vengan vacíos a partir de los m2 y el valor UF/m2. */
function normalizeCasaRow(row) {
  const m2u = toNumber(row["M2 Útil"]);
  const m2t = toNumber(row["M2 Terraza"]);
  const m2tot = toNumber(row["M2 Totales"]) || round1(m2u + m2t);
  const vu = toNumber(row["Valor UF m2 Útil"]);
  const vt = toNumber(row["Valor UF m2 Terraza"]);
  const totalUtil = toNumber(row["Total UF Útil"]) || round1(m2u * vu);
  const totalTerraza = toNumber(row["Total UF Terraza"]) || round1(m2t * vt);
  const totalNeto = toNumber(row["Valor UF Neto + IVA"]) || round1(totalUtil + totalTerraza);
  const promM2 = toNumber(row["Valor Prom UF/m2"]) || (m2tot ? round2(totalNeto / m2tot) : 0);
  return {
    modelo: row["Modelo"], distribucion: row["Distribución"], pisos: row["Pisos"],
    m2u, m2t, m2tot, vu, vt, totalUtil, totalTerraza, totalNeto, promM2,
    notas: row["Notas"] || ""
  };
}

// ======================================================================
// MODO 1 — subir planilla
// ======================================================================

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const errorBoxUpload = document.getElementById("error-box-upload");
const panelPreview = document.getElementById("panel-preview");
const previewDatos = document.getElementById("preview-datos");
const previewTable = document.getElementById("preview-table");
const btnGenerateUpload = document.getElementById("btn-generate-upload");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
["dragenter", "dragover"].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
fileInput.addEventListener("change", e => { const f = e.target.files[0]; if (f) handleFile(f); });

function showErrorUpload(msg) {
  errorBoxUpload.hidden = false;
  errorBoxUpload.textContent = msg;
  panelPreview.hidden = true;
  dropzone.classList.remove("ok");
}
function clearErrorUpload() { errorBoxUpload.hidden = true; errorBoxUpload.textContent = ""; }

function handleFile(file) {
  clearErrorUpload();
  fileNameEl.textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      parseWorkbook(wb);
      dropzone.classList.add("ok");
    } catch (err) {
      console.error(err);
      showErrorUpload("No pude leer ese archivo. Verifica que sea un .xlsx válido, exportado desde Excel o Google Sheets.");
    }
  };
  reader.onerror = () => showErrorUpload("Hubo un problema leyendo el archivo del disco.");
  reader.readAsArrayBuffer(file);
}

function sheetToObjects(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function parseWorkbook(wb) {
  const datosRows = sheetToObjects(wb, "Datos");
  const casasRows = sheetToObjects(wb, "Casas");

  if (!datosRows || !casasRows) {
    showErrorUpload(
      "La planilla debe tener dos hojas llamadas exactamente 'Datos' y 'Casas'.\n" +
      "Hojas encontradas: " + wb.SheetNames.join(", ") + "\n" +
      "Descarga la planilla de ejemplo para ver el formato exacto."
    );
    return;
  }
  if (datosRows.length === 0) { showErrorUpload("La hoja 'Datos' está vacía. Debe tener una fila con los datos del cliente."); return; }
  if (casasRows.length === 0) { showErrorUpload("La hoja 'Casas' está vacía. Agrega al menos una fila con el modelo cotizado."); return; }

  const datos = datosRows[0];
  const missingDatos = missingFields(datos, REQUIRED_DATOS);
  if (missingDatos.length) {
    showErrorUpload("A la hoja 'Datos' le faltan estas columnas o están vacías:\n— " + missingDatos.join("\n— "));
    return;
  }

  const casaProblems = [];
  casasRows.forEach((row, i) => {
    const missing = missingFields(row, REQUIRED_CASAS);
    if (missing.length) casaProblems.push(`Fila ${i + 2} de 'Casas': falta ${missing.join(", ")}`);
  });
  if (casaProblems.length) {
    showErrorUpload("Revisa la hoja 'Casas':\n" + casaProblems.join("\n"));
    return;
  }

  state.datos = datos;
  state.casas = casasRows.map(normalizeCasaRow);
  renderPreview();
}

function renderPreview() {
  const d = state.datos;
  previewDatos.innerHTML = REQUIRED_DATOS.map(k => `
    <div><span class="label">${k}</span><span class="value">${d[k]}</span></div>
  `).join("");

  const cols = ["Modelo", "Distribución", "Pisos", "M2 Útil", "M2 Terraza", "M2 Totales",
    "Total UF Útil", "Total UF Terraza", "Valor UF Neto + IVA", "Valor Prom UF/m2"];
  previewTable.querySelector("thead").innerHTML = "<tr>" + cols.map(c => `<th>${c}</th>`).join("") + "</tr>";
  previewTable.querySelector("tbody").innerHTML = state.casas.map(c => `
    <tr>
      <td>${c.modelo}</td><td>${c.distribucion}</td><td>${c.pisos}</td>
      <td>${fmt(c.m2u, 1)}</td><td>${fmt(c.m2t, 1)}</td><td>${fmt(c.m2tot, 1)}</td>
      <td>${fmt(c.totalUtil)}</td><td>${fmt(c.totalTerraza)}</td>
      <td>${fmt(c.totalNeto)}</td><td>${fmt(c.promM2, 2)}</td>
    </tr>
  `).join("");

  panelPreview.hidden = false;
  panelPreview.scrollIntoView({ behavior: "smooth", block: "start" });
}

btnGenerateUpload.addEventListener("click", () => generatePdf("upload"));

// ======================================================================
// MODO 2 — ingreso manual
// ======================================================================

const casasContainer = document.getElementById("casas-container");
const casaTemplate = document.getElementById("casa-card-template");
const btnAddCasa = document.getElementById("btn-add-casa");
const btnGenerateManual = document.getElementById("btn-generate-manual");
const errorBoxManual = document.getElementById("error-box-manual");

// ---- selector de vendedor: autocompleta teléfono/correo (quedan editables) ----
const vendedorSelect = document.getElementById("vendedor-select");
const vendedorCustom = document.getElementById("vendedor-custom");
const vendedorTelefono = document.getElementById("vendedor-telefono");
const vendedorCorreo = document.getElementById("vendedor-correo");

vendedorSelect.addEventListener("change", () => {
  const esOtro = vendedorSelect.value === "__otro__";
  vendedorCustom.hidden = !esOtro;
  if (esOtro) {
    vendedorCustom.focus();
    return; // vendedor nuevo: teléfono/correo quedan como estén, para escribirlos a mano
  }
  const preset = VENDEDORES[vendedorSelect.value];
  if (preset) {
    vendedorTelefono.value = preset.telefono;
    vendedorCorreo.value = preset.correo;
  }
});

function addCasaCard() {
  const node = casaTemplate.content.cloneNode(true);
  const card = node.querySelector(".casa-card");

  card.querySelector(".casa-remove").addEventListener("click", () => {
    card.remove();
  });

  const modeloSelect = card.querySelector(".modelo-select");
  const modeloCustom = card.querySelector(".modelo-custom");
  modeloSelect.addEventListener("change", () => {
    modeloCustom.hidden = modeloSelect.value !== "__otro__";
    if (!modeloCustom.hidden) modeloCustom.focus();

    // Autocompleta distribución, pisos, m2 y valores UF/m2 según el modelo elegido,
    // tal como aparecen en la planilla oficial de precios (todos los campos quedan
    // editables igual, por si hay que ajustar algo según el cliente o el terreno).
    const preset = PRECIOS_POR_MODELO[modeloSelect.value];
    if (preset) {
      card.querySelector('[data-field="Distribución"]').value = preset.distribucion;
      card.querySelector('[data-field="Pisos"]').value = preset.pisos;
      card.querySelector('[data-field="M2 Útil"]').value = fmtEditable(preset.m2Util);
      card.querySelector('[data-field="M2 Terraza"]').value = fmtEditable(preset.m2Terraza);
      card.querySelector('[data-field="Valor UF m2 Útil"]').value = fmtEditable(preset.valorUtil);
      card.querySelector('[data-field="Valor UF m2 Terraza"]').value = fmtEditable(preset.valorTerraza);
      recalcCard(card);
    }
  });

  card.querySelectorAll(".calc-input").forEach(inp =>
    inp.addEventListener("input", () => recalcCard(card))
  );

  casasContainer.appendChild(card);
  recalcCard(card);
}

// Los campos de m2/valores del formulario manual son <input type="text"> (para poder
// aceptar tanto coma como punto decimal, como se escribe normalmente en Chile).
// Acepta "73,8" o "73.8" por igual.
function plainNumber(v) {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(String(v).trim().replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function recalcCard(card) {
  const get = sel => plainNumber(card.querySelector(sel)?.value);
  const m2u = get('[data-field="M2 Útil"]');
  const m2t = get('[data-field="M2 Terraza"]');
  const vu = get('[data-field="Valor UF m2 Útil"]');
  const vt = get('[data-field="Valor UF m2 Terraza"]');

  const m2totInput = card.querySelector('[data-field="M2 Totales"]');
  if (!m2totInput.value) m2totInput.placeholder = fmt(round1(m2u + m2t), 1) || "(auto)";
  const m2tot = plainNumber(m2totInput.value) || round1(m2u + m2t);

  const totalUtil = round1(m2u * vu);
  const totalTerraza = round1(m2t * vt);
  const totalNeto = round1(totalUtil + totalTerraza);
  const promM2 = m2tot ? round2(totalNeto / m2tot) : 0;

  card.querySelector('[data-computed="Total UF Útil"]').value = "UF " + fmt(totalUtil);
  card.querySelector('[data-computed="Total UF Terraza"]').value = "UF " + fmt(totalTerraza);
  card.querySelector('[data-computed="Valor UF Neto + IVA"]').value = "UF " + fmt(totalNeto);
  card.querySelector('[data-computed="Valor Prom UF/m2"]').value = "UF " + fmt(promM2, 2);
}

btnAddCasa.addEventListener("click", addCasaCard);
addCasaCard(); // arranca con una tarjeta lista para llenar

function collectDatosFromForm() {
  const d = {};
  document.querySelectorAll("#datos-form [data-field]").forEach(inp => {
    let val = inp.value.trim();
    if (inp.dataset.field === "Vendedor" && val === "__otro__") {
      val = document.getElementById("vendedor-custom").value.trim();
    }
    d[inp.dataset.field] = val;
  });
  return d;
}

function collectCasasFromForm() {
  const cards = Array.from(casasContainer.querySelectorAll(".casa-card"));
  return cards.map(card => {
    const row = {};
    card.querySelectorAll("[data-field]").forEach(inp => {
      if (inp.classList.contains("modelo-custom")) return;
      let val = inp.classList.contains("calc-input") ? (inp.value === "" ? "" : plainNumber(inp.value)) : inp.value.trim();
      if (inp.dataset.field === "Modelo" && val === "__otro__") {
        val = card.querySelector(".modelo-custom").value.trim();
      }
      row[inp.dataset.field] = val;
    });
    return row;
  });
}

function showErrorManual(msg) { errorBoxManual.hidden = false; errorBoxManual.textContent = msg; }
function clearErrorManual() { errorBoxManual.hidden = true; errorBoxManual.textContent = ""; }

btnGenerateManual.addEventListener("click", () => {
  clearErrorManual();
  const datos = collectDatosFromForm();
  const missingDatos = missingFields(datos, REQUIRED_DATOS);
  if (missingDatos.length) {
    showErrorManual("Faltan estos datos generales:\n— " + missingDatos.join("\n— "));
    return;
  }

  const casasRaw = collectCasasFromForm();
  if (casasRaw.length === 0) {
    showErrorManual("Agrega al menos una casa.");
    return;
  }
  const casaProblems = [];
  casasRaw.forEach((row, i) => {
    const missing = missingFields(row, REQUIRED_CASAS);
    if (missing.length) casaProblems.push(`Casa #${i + 1}: falta ${missing.join(", ")}`);
  });
  if (casaProblems.length) {
    showErrorManual(casaProblems.join("\n"));
    return;
  }

  state.datos = datos;
  state.casas = casasRaw.map(normalizeCasaRow);
  generatePdf("manual");
});

// ======================================================================
// Generación del PDF (compartida por ambos modos)
//
// El PDF se dibuja directamente con los comandos de texto/gráficos de jsPDF
// (no se "fotografía" la pantalla) — así el texto queda real y seleccionable/
// copiable, y las tildes y la ñ se ven perfectas gracias a las fuentes de
// marca (Fraunces/Work Sans/IBM Plex Mono) embebidas en vendor/fonts.js, sin
// depender de internet para verse bien.
// ======================================================================

const PT_PER_PX = 0.75; // 96dpi (css px, igual que el resto del diseño) -> 72dpi (pt, unidad nativa del PDF)
function toPt(px) { return px * PT_PER_PX; }

const PAGE_W = 816;      // tamaño carta (Letter, 8.5in) @ 96dpi de ancho
const PAGE_H = 1056;     // tamaño carta (Letter, 11in) @ 96dpi de alto — TODAS las páginas del PDF miden esto
const MARGIN_X = 48;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 28;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_MAX_Y = PAGE_H - MARGIN_BOTTOM; // límite inferior útil de cada página

const COLOR = {
  navy: [1, 30, 47],
  verdePino: [60, 74, 62],
  madera: [169, 118, 74],
  niebla: [241, 244, 243],
  ink: [26, 31, 34],
  border: [223, 227, 226],
  notesText: [55, 69, 68],
  footGray: [139, 151, 149],
  white: [255, 255, 255],
  whiteMuted: [178, 194, 203],
};

const FONT_MAP = [
  ["Fraunces-SemiBold", "Fraunces-SemiBold.ttf", "FrauncesSB"],
  ["WorkSans-Regular", "WorkSans-Regular.ttf", "WorkSans"],
  ["WorkSans-SemiBold", "WorkSans-SemiBold.ttf", "WorkSansSB"],
  ["IBMPlexMono-Regular", "IBMPlexMono-Regular.ttf", "PlexMono"],
  ["IBMPlexMono-SemiBold", "IBMPlexMono-SemiBold.ttf", "PlexMonoSB"],
];

function registerFonts(doc) {
  const bundle = window.NEORIGEN_FONTS || {};
  FONT_MAP.forEach(([key, filename, family]) => {
    if (!bundle[key]) return;
    doc.addFileToVFS(filename, bundle[key]);
    doc.addFont(filename, family, "normal");
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setF(doc, family, sizePx, colorRgb) {
  doc.setFont(family, "normal");
  doc.setFontSize(toPt(sizePx));
  if (colorRgb) doc.setTextColor(colorRgb[0], colorRgb[1], colorRgb[2]);
}

function textWidthPx(doc, str) {
  return doc.getTextWidth(str) / PT_PER_PX;
}

// ---- encabezado: logo + "Cotización" ----
function drawHeader(doc, d, y, logoImg) {
  const logoH = 72;
  const logoW = logoH * (logoImg.naturalWidth / logoImg.naturalHeight);
  doc.addImage(logoImg, "PNG", toPt(MARGIN_X), toPt(y), toPt(logoW), toPt(logoH), undefined, "MEDIUM");

  const rightX = PAGE_W - MARGIN_X;
  setF(doc, "PlexMono", 10, COLOR.madera);
  doc.text("VIVE LO NATURAL", toPt(rightX), toPt(y), { baseline: "top", align: "right" });
  setF(doc, "FrauncesSB", 26, COLOR.navy);
  doc.text("Cotización", toPt(rightX), toPt(y + 15), { baseline: "top", align: "right" });

  const headerBottom = y + logoH;
  const ruleY = headerBottom + 16;
  doc.setDrawColor(...COLOR.navy);
  doc.setLineWidth(toPt(2));
  doc.line(toPt(MARGIN_X), toPt(ruleY), toPt(rightX), toPt(ruleY));
  return ruleY + 18;
}

// ---- datos generales: grilla de 3 columnas x 3 filas ----
// Fila 1: identidad y contacto del cliente. Fila 2: datos de la cotización.
// Fila 3: contacto del vendedor (el correo del vendedor es opcional — si no se
// cargó, esa celda simplemente se deja en blanco, sin romper la simetría de la grilla).
function drawMetaGrid(doc, d, y) {
  const fields = [
    ["Cliente", d["Cliente"]],
    ["Teléfono cliente", d["Teléfono Cliente"]],
    ["Correo cliente", d["Correo Cliente"]],
    ["Fecha", d["Fecha"]],
    ["Vigencia", `${d["Vigencia (días)"]} días`],
    ["Proyecto / Ubicación", d["Proyecto / Ubicación"]],
    ["Vendedor", d["Vendedor"]],
    ["Teléfono vendedor", d["Teléfono Vendedor"]],
    ["Correo vendedor", d["Correo Vendedor"]],
  ];
  const colGap = 20, rowGap = 12;
  const colW = (CONTENT_W - colGap * 2) / 3;
  const rowH = 28;
  const nRows = 3;

  fields.forEach(([label, value], i) => {
    if (!value) return; // celda opcional sin datos (p. ej. correo del vendedor): se deja en blanco
    const col = i % 3, row = Math.floor(i / 3);
    const x = MARGIN_X + col * (colW + colGap);
    const cellY = y + row * (rowH + rowGap);
    setF(doc, "PlexMono", 9, COLOR.madera);
    doc.text(label.toUpperCase(), toPt(x), toPt(cellY), { baseline: "top" });
    setF(doc, "WorkSansSB", 12.5, COLOR.ink);
    doc.text(String(value), toPt(x), toPt(cellY + 13), { baseline: "top" });
  });

  const contentBottom = y + rowH * nRows + rowGap * (nRows - 1);
  const ruleY = contentBottom + 18;
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(toPt(1));
  doc.line(toPt(MARGIN_X), toPt(ruleY), toPt(PAGE_W - MARGIN_X), toPt(ruleY));
  return ruleY + 20;
}

// Alto que suma el separador punteado entre casas (ver drawCasaBlock) — se usa
// para calcular si una casa cabe en el espacio que queda de la página actual.
const DIVIDER_H = 36;

// ---- una "casa" cotizada: título + chips + tabla de precios + total + notas ----
// `isFirst` = es la primera casa dibujada en la página ACTUAL (no necesariamente
// la primera casa de toda la cotización) — así nunca queda un separador punteado
// huérfano justo debajo del encabezado de una página nueva.
function drawCasaBlock(doc, c, y, isFirst) {
  if (!isFirst) {
    y += 18;
    doc.setDrawColor(...COLOR.border);
    doc.setLineWidth(toPt(1));
    doc.setLineDashPattern([toPt(3), toPt(2)], 0);
    doc.line(toPt(MARGIN_X), toPt(y), toPt(PAGE_W - MARGIN_X), toPt(y));
    doc.setLineDashPattern([], 0);
    y += 18;
  }

  setF(doc, "FrauncesSB", 17, COLOR.navy);
  doc.text(`Casa ${c.modelo}`, toPt(MARGIN_X), toPt(y), { baseline: "top" });
  y += 17 * 1.25 + 10;

  // -- fila de chips (con salto de línea si no caben todos) --
  // El chip de "Pisos" no lleva etiqueta: el valor ("1 piso", "2 pisos") ya se
  // explica solo, y agregar la etiqueta "PISOS" al lado quedaba redundante
  // ("1 piso PISOS").
  const chips = [
    [c.distribucion, "Distribución"],
    [c.pisos, ""],
    [fmt(c.m2u, 1), "M2 útil"],
    [fmt(c.m2t, 1), "M2 terraza"],
    [fmt(c.m2tot, 1), "M2 total"],
  ];
  const chipH = 24, padX = 10, gapNumLbl = 6, chipGap = 8;
  let cx = MARGIN_X, rowY = y;
  chips.forEach(([num, lbl]) => {
    const lblUpper = lbl.toUpperCase();
    doc.setFont("PlexMonoSB", "normal"); doc.setFontSize(toPt(12));
    const numW = textWidthPx(doc, num);
    doc.setFont("WorkSans", "normal"); doc.setFontSize(toPt(8.5));
    const lblW = lblUpper ? textWidthPx(doc, lblUpper) : 0;
    const chipW = padX + numW + (lblUpper ? gapNumLbl + lblW : 0) + padX;

    if (cx + chipW > MARGIN_X + CONTENT_W && cx > MARGIN_X) {
      cx = MARGIN_X;
      rowY += chipH + chipGap;
    }

    doc.setDrawColor(...COLOR.navy);
    doc.setLineWidth(toPt(1.3));
    doc.roundedRect(toPt(cx), toPt(rowY), toPt(chipW), toPt(chipH), toPt(4), toPt(4), "S");

    const midY = rowY + chipH / 2;
    setF(doc, "PlexMonoSB", 12, COLOR.navy);
    doc.text(num, toPt(cx + padX), toPt(midY), { baseline: "middle" });
    if (lblUpper) {
      setF(doc, "WorkSans", 8.5, COLOR.verdePino);
      doc.text(lblUpper, toPt(cx + padX + numW + gapNumLbl), toPt(midY), { baseline: "middle" });
    }

    cx += chipW + chipGap;
  });
  y = rowY + chipH + 14;

  // -- tabla de precios --
  const colW = [240, Math.round((CONTENT_W - 240) / 3), Math.round((CONTENT_W - 240) / 3), 0];
  colW[3] = CONTENT_W - colW[0] - colW[1] - colW[2];
  const headerH = 23, rowH2 = 26;
  const rows = [
    ["M2 útil", fmt(c.vu, 2), fmt(c.m2u, 1), fmt(c.totalUtil)],
    ["M2 terraza", fmt(c.vt, 2), fmt(c.m2t, 1), fmt(c.totalTerraza)],
  ];
  const headerLabels = ["Concepto", "Valor UF/m2", "Superficie m2", "Total UF"];

  let tx = MARGIN_X;
  doc.setFillColor(...COLOR.niebla);
  doc.rect(toPt(MARGIN_X), toPt(y), toPt(CONTENT_W), toPt(headerH), "F");
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(toPt(1));
  headerLabels.forEach((label, i) => {
    doc.rect(toPt(tx), toPt(y), toPt(colW[i]), toPt(headerH), "S");
    setF(doc, "PlexMono", 9, COLOR.verdePino);
    const align = i === 0 ? "left" : "right";
    const lx = i === 0 ? tx + 10 : tx + colW[i] - 10;
    doc.text(label.toUpperCase(), toPt(lx), toPt(y + headerH / 2), { baseline: "middle", align });
    tx += colW[i];
  });

  let ry = y + headerH;
  rows.forEach(row => {
    tx = MARGIN_X;
    row.forEach((cell, i) => {
      doc.setDrawColor(...COLOR.border);
      doc.setLineWidth(toPt(1));
      doc.rect(toPt(tx), toPt(ry), toPt(colW[i]), toPt(rowH2), "S");
      setF(doc, i === 0 ? "WorkSans" : "PlexMono", 11.5, COLOR.ink);
      const align = i === 0 ? "left" : "right";
      const lx = i === 0 ? tx + 10 : tx + colW[i] - 10;
      doc.text(String(cell), toPt(lx), toPt(ry + rowH2 / 2), { baseline: "middle", align });
      tx += colW[i];
    });
    ry += rowH2;
  });
  y = ry + 12;

  // -- total destacado --
  const boxH = 48, padXBox = 20;
  doc.setFillColor(...COLOR.navy);
  doc.roundedRect(toPt(MARGIN_X), toPt(y), toPt(CONTENT_W), toPt(boxH), toPt(6), toPt(6), "F");
  setF(doc, "PlexMono", 9.5, COLOR.whiteMuted);
  doc.text("VALOR UF NETO + IVA", toPt(MARGIN_X + padXBox), toPt(y + 15), { baseline: "middle" });
  setF(doc, "FrauncesSB", 23, COLOR.white);
  doc.text(`UF ${fmt(c.totalNeto)}`, toPt(MARGIN_X + padXBox), toPt(y + 33), { baseline: "middle" });
  const rightEdge = MARGIN_X + CONTENT_W - padXBox;
  setF(doc, "PlexMono", 9.5, COLOR.whiteMuted);
  doc.text("VALOR PROMEDIO", toPt(rightEdge), toPt(y + 17), { baseline: "middle", align: "right" });
  setF(doc, "PlexMono", 10, COLOR.whiteMuted);
  doc.text(`UF ${fmt(c.promM2, 2)} / m2`, toPt(rightEdge), toPt(y + 32), { baseline: "middle", align: "right" });
  y += boxH + 12;

  // -- notas (opcional) --
  if (c.notas) {
    setF(doc, "WorkSans", 11);
    const notesW = CONTENT_W - 14 * 2;
    const lines = doc.splitTextToSize(c.notas, toPt(notesW));
    const lineH = 11 * 1.4;
    const notesBoxH = 10 * 2 + lines.length * lineH;
    doc.setFillColor(...COLOR.niebla);
    doc.rect(toPt(MARGIN_X), toPt(y), toPt(CONTENT_W), toPt(notesBoxH), "F");
    doc.setFillColor(...COLOR.madera);
    doc.rect(toPt(MARGIN_X), toPt(y), toPt(3), toPt(notesBoxH), "F");
    doc.setTextColor(...COLOR.notesText);
    lines.forEach((line, i) => {
      doc.text(line, toPt(MARGIN_X + 14), toPt(y + 10 + i * lineH), { baseline: "top" });
    });
    y += notesBoxH;
  }

  return y;
}

// ---- condiciones generales (lista en 2 columnas) ----
function drawCondiciones(doc, d, y) {
  setF(doc, "PlexMono", 10.5, COLOR.madera);
  doc.text("CONDICIONES GENERALES", toPt(MARGIN_X), toPt(y), { baseline: "top" });
  const ruleY = y + 10.5 * 1.2 + 6;
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(toPt(1));
  doc.line(toPt(MARGIN_X), toPt(ruleY), toPt(PAGE_W - MARGIN_X), toPt(ruleY));
  y = ruleY + 10;

  const items = [
    "Contrato a precio cerrado.",
    "Forma de pago: cuotas contra estado de avance.",
    "Proyectos diseñados para ocuparse inmediatamente, con todo el equipamiento esencial, salvo cama, refrigerador, lavadora y otros electrodomésticos personales.",
    "El proyecto puede ajustarse a tus requerimientos personales o del terreno.",
    `Esta cotización tiene una vigencia de ${d["Vigencia (días)"]} días desde la fecha de emisión.`,
  ];
  const colGap = 24;
  const colW = (CONTENT_W - colGap) / 2;
  const col1Count = Math.ceil(items.length / 2);
  const columns = [items.slice(0, col1Count), items.slice(col1Count)];

  setF(doc, "WorkSans", 9.8, COLOR.ink);
  const bulletLineH = 9.8 * 1.35;

  const bottoms = columns.map((list, colIdx) => {
    const x = MARGIN_X + colIdx * (colW + colGap);
    let cy = y;
    list.forEach(item => {
      const lines = doc.splitTextToSize("•  " + item, toPt(colW));
      lines.forEach(line => {
        doc.text(line, toPt(x), toPt(cy), { baseline: "top" });
        cy += bulletLineH;
      });
      cy += 6;
    });
    return cy;
  });
  return Math.max(...bottoms);
}

// ---- pie de página ----
function drawFooter(doc, d, y) {
  y += 4;
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(toPt(1));
  doc.line(toPt(MARGIN_X), toPt(y), toPt(PAGE_W - MARGIN_X), toPt(y));
  y += 12;

  const centerX = PAGE_W / 2;
  setF(doc, "WorkSansSB", 8.3, COLOR.verdePino);
  const contactParts = [d["Vendedor"], d["Teléfono Vendedor"]];
  if (d["Correo Vendedor"]) contactParts.push(d["Correo Vendedor"]);
  contactParts.push("neorigen.cl");
  doc.text(contactParts.filter(Boolean).join(" · "), toPt(centerX), toPt(y), { baseline: "top", align: "center" });
  y += 8.3 * 1.5;

  setF(doc, "WorkSans", 8.3, COLOR.footGray);
  const disclaimer = "Cotización sujeta a estudio de factibilidad del terreno y especificaciones técnicas a definir. Las imágenes, caracterizaciones y textos son referenciales.";
  const lines = doc.splitTextToSize(disclaimer, toPt(CONTENT_W));
  const lineH = 8.3 * 1.5;
  lines.forEach((line, i) => {
    doc.text(line, toPt(centerX), toPt(y + i * lineH), { baseline: "top", align: "center" });
  });
  return y + lines.length * lineH;
}

// ======================================================================
// Página 2: "Proyectos llave en mano" — página fija (no depende de los
// datos de la cotización) que siempre se agrega al final, en Azul Origen
// con texto blanco, con todo lo que incluye cada proyecto Neorigen.
// ======================================================================

const TURNKEY_ITEMS = [
  "Asesoría y acompañamiento en todo el proceso",
  "Estructura completamente aislada (muros, techos y pisos)",
  "Construcción sobre pilotes (eficiencia térmica y energética)",
  "Mayor eficiencia con fachada ventilada (circulación de aire entre muros exteriores)",
  "Muebles de cocina y closet en cada dormitorio (diseño flexible)",
  "Artefactos de cocina (horno, encimera, extractor, cuba)",
  "Cuarzo para cubiertas de cocina",
  "Baños completamente equipados con shower, WC, vanitorio y kit de accesorios",
  "Ventanas termopanel con perfil PVC (color a elección)",
  "Piso y revestimiento de muro en madera (calidez y confort)",
  "Muros pintados albayalde y piso vitrificado",
  "Grifería y quincallería completa",
  "Puertas de 2 mts de altura en toda la casa",
  "Red eléctrica, sanitaria y de gas",
  "Amplias terrazas aptas para zonas extremas",
  "Estufa a combustión lenta incluida (Amesti o Bosca)",
  "Diseños de planimetría flexibles y personalizados",
  "Tramitación de permisos y recepción municipal",
  "Fosa séptica, drenes y acometidas a servicios básicos",
];

// Invierte a blanco el logo (que viene en trazo navy sobre fondo transparente)
// para poder usarlo sobre el fondo Azul Origen de esta página — igual que el
// filter:brightness(0) invert(1) que ya se usa en el encabezado de la app.
function invertLogoToWhite(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imgData.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; // deja el alfa (px[i+3]) intacto
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function drawTurnkeyPage(doc, logoWhite) {
  // El fondo navy cubre la página carta completa (se lee el alto vigente del
  // documento en vez de usar PAGE_H "a mano" para no depender de que nadie
  // desalinee esto si en algún momento cambia cómo se arma la página).
  doc.setFillColor(...COLOR.navy);
  doc.rect(0, 0, toPt(PAGE_W), doc.internal.pageSize.getHeight(), "F");

  const rightX = PAGE_W - MARGIN_X;
  const centerX = PAGE_W / 2;
  let y = MARGIN_TOP;

  // -- encabezado (mismo tratamiento que la página 1, en blanco sobre navy) --
  const logoH = 48;
  const logoW = logoH * (logoWhite.width / logoWhite.height);
  doc.addImage(logoWhite, "PNG", toPt(MARGIN_X), toPt(y), toPt(logoW), toPt(logoH), undefined, "MEDIUM");
  setF(doc, "PlexMono", 10, COLOR.whiteMuted);
  doc.text("VIVE LO NATURAL", toPt(rightX), toPt(y), { baseline: "top", align: "right" });
  setF(doc, "FrauncesSB", 22, COLOR.white);
  doc.text("Llave en mano", toPt(rightX), toPt(y + 15), { baseline: "top", align: "right" });

  const ruleY = y + logoH + 16;
  doc.setDrawColor(...COLOR.whiteMuted);
  doc.setLineWidth(toPt(1));
  doc.line(toPt(MARGIN_X), toPt(ruleY), toPt(rightX), toPt(ruleY));
  y = ruleY + 34;

  // -- título central --
  setF(doc, "PlexMono", 10, COLOR.madera);
  doc.text("INCLUIDO EN TODOS NUESTROS PROYECTOS", toPt(centerX), toPt(y), { baseline: "top", align: "center" });
  y += 10 * 1.3 + 8;
  setF(doc, "FrauncesSB", 27, COLOR.white);
  doc.text("Proyectos llave en mano", toPt(centerX), toPt(y), { baseline: "top", align: "center" });
  y += 27 * 1.25 + 28;

  // -- lista en 2 columnas --
  const colGap = 32;
  const colW = (CONTENT_W - colGap) / 2;
  const col1Count = Math.ceil(TURNKEY_ITEMS.length / 2);
  const columns = [TURNKEY_ITEMS.slice(0, col1Count), TURNKEY_ITEMS.slice(col1Count)];

  setF(doc, "WorkSans", 11.5, COLOR.white);
  const lineH = 11.5 * 1.55;
  const listTop = y;
  const bottoms = columns.map((list, colIdx) => {
    const x = MARGIN_X + colIdx * (colW + colGap);
    let cy = listTop;
    list.forEach(item => {
      const lines = doc.splitTextToSize(item, toPt(colW - 16));
      lines.forEach((line, i) => {
        setF(doc, "WorkSans", 11.5, COLOR.white);
        doc.text((i === 0 ? "•  " : "    ") + line, toPt(x), toPt(cy), { baseline: "top" });
        cy += lineH;
      });
      cy += 7;
    });
    return cy;
  });
  y = Math.max(...bottoms) + 30;

  // -- cierre --
  doc.setDrawColor(...COLOR.whiteMuted);
  doc.setLineWidth(toPt(1));
  doc.line(toPt(MARGIN_X), toPt(y), toPt(rightX), toPt(y));
  y += 30;
  setF(doc, "FrauncesSB", 19, COLOR.white);
  doc.text("Conversemos para diseñar juntos tu casa", toPt(centerX), toPt(y), { baseline: "top", align: "center" });
  y += 19 * 1.3 + 40;

  // -- pie --
  setF(doc, "PlexMono", 9, COLOR.whiteMuted);
  doc.text("NEORIGEN · VIVE LO NATURAL · NEORIGEN.CL", toPt(centerX), toPt(y), { baseline: "top", align: "center" });
  y += 9 * 1.4;

  return y;
}

// Todas las páginas miden lo mismo (tamaño carta fijo), así que ya no hace
// falta "medir la página completa" como antes — pero para decidir si una
// casa cabe en el espacio que queda de la página actual sí hay que saber su
// alto ANTES de dibujarla de verdad. jsPDF fija la posición de cada trazo
// usando el alto de página vigente en el momento de dibujar (no se puede
// "recortar" después sin cortar contenido por error), así que se mide
// dibujando `drawFn` una vez de más, en un documento de prueba descartable
// con una página bien alta, y se descarta ese documento.
function measureBlockHeight(drawFn) {
  const { jsPDF } = window.jspdf;
  const probe = new jsPDF({ unit: "pt", format: [toPt(PAGE_W), toPt(4000)], orientation: "p" });
  registerFonts(probe);
  return drawFn(probe, MARGIN_TOP) - MARGIN_TOP;
}

async function generatePdf(mode) {
  const btn = mode === "upload" ? btnGenerateUpload : btnGenerateManual;
  const msg = document.querySelector(`.generating-msg[data-for="${mode}"]`);
  btn.disabled = true;
  msg.hidden = false;
  await new Promise(r => setTimeout(r, 30));

  try {
    const d = state.datos;
    const casas = state.casas;

    const { jsPDF } = window.jspdf;
    const logoImg = await loadImage("assets/logo-neorigen.png");
    const logoWhite = invertLogoToWhite(logoImg);

    const pageFormat = [toPt(PAGE_W), toPt(PAGE_H)];
    const doc = new jsPDF({ unit: "pt", format: pageFormat, orientation: "p" });
    registerFonts(doc);

    // Todas las páginas de la cotización repiten el mismo encabezado (logo +
    // "Cotización" + filete) para mantener el orden y la armonía visual sin
    // importar en cuántas páginas termine cayendo el contenido.
    let isFirstContentPage = true;
    function startContentPage() {
      if (!isFirstContentPage) doc.addPage(pageFormat, "p");
      isFirstContentPage = false;
      return drawHeader(doc, d, MARGIN_TOP, logoImg);
    }

    let y = startContentPage();
    y = drawMetaGrid(doc, d, y);

    // Cada casa se mide antes de dibujarla: si no entera en lo que queda de
    // la página actual, se pasa una página nueva completa (nunca se corte
    // un bloque de casa a la mitad) — así, con más de 1-2 casas cotizadas,
    // la cotización simplemente continúa en la(s) página(s) que hagan falta,
    // manteniendo siempre el mismo orden y el mismo lenguaje visual.
    let firstCasaOnPage = true;
    casas.forEach(c => {
      const coreH = measureBlockHeight((probe, startY) => drawCasaBlock(probe, c, startY, true));
      const blockH = coreH + (firstCasaOnPage ? 0 : DIVIDER_H);
      if (y + blockH > CONTENT_MAX_Y) {
        y = startContentPage();
        firstCasaOnPage = true;
      }
      y = drawCasaBlock(doc, c, y, firstCasaOnPage);
      firstCasaOnPage = false;
    });

    // "Condiciones generales" es texto normal que sigue inmediatamente después
    // de la última casa (nunca se pega al fondo ni se separa de las casas).
    // Solo el pie de contacto (vendedor/teléfono/correo + disclaimer) se
    // comporta como un pie de página real, pegado siempre al margen inferior.
    // Igual se miden juntos para decidir si entran completos en la página
    // actual (nunca se separan entre sí ni se cortan a la mitad).
    const condH = measureBlockHeight((probe, startY) => drawCondiciones(probe, d, startY));
    const footerH = measureBlockHeight((probe, startY) => drawFooter(probe, d, startY));
    if (y + condH + footerH > CONTENT_MAX_Y) {
      y = startContentPage();
    }
    drawCondiciones(doc, d, y);
    drawFooter(doc, d, CONTENT_MAX_Y - footerH);

    // Página fija, siempre agregada al final: "Proyectos llave en mano".
    doc.addPage(pageFormat, "p");
    drawTurnkeyPage(doc, logoWhite);

    const cliente = (d["Cliente"] || "cliente").toString().trim().replace(/[^\w\-]+/g, "_");
    const fecha = (d["Fecha"] || "").toString().trim().replace(/[^\w\-]+/g, "_");
    doc.save(`Cotizacion_Neorigen_${cliente}_${fecha}.pdf`);
  } catch (err) {
    console.error(err);
    const showErr = mode === "upload" ? showErrorUpload : showErrorManual;
    showErr("Ocurrió un error generando el PDF: " + err.message);
  } finally {
    btn.disabled = false;
    msg.hidden = true;
  }
}
