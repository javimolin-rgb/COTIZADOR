/* Cotizador Neorigen — todo corre en el navegador, no hay backend. */

const REQUIRED_DATOS = ["Cliente", "Fecha", "Vendedor", "Teléfono Vendedor", "Proyecto / Ubicación", "Vigencia (días)"];
const REQUIRED_CASAS = ["Modelo", "Distribución", "Pisos", "M2 Útil", "M2 Terraza",
  "Valor UF m2 Útil", "Valor UF m2 Terraza"];

// Distribución real de cada modelo (dormitorios/baños), verificada en vivo en neorigen.cl —
// se usa para autocompletar el campo al elegir el modelo en el ingreso manual (queda editable).
const DISTRIBUCION_POR_MODELO = {
  "Lingue": "1D-1B",
  "Huingán": "2D-2B",
  "Maitén": "4D-4B",
  "Peumo": "2D-2B",
  "Roble": "3D-3B",
  "Coihue": "3D-3B+ESC",
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

    // Autocompleta dormitorios/baños según el modelo elegido (queda editable igual).
    const preset = DISTRIBUCION_POR_MODELO[modeloSelect.value];
    if (preset) {
      card.querySelector('[data-field="Distribución"]').value = preset;
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
  document.querySelectorAll("#datos-form [data-field]").forEach(inp => { d[inp.dataset.field] = inp.value.trim(); });
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
// ======================================================================

const pdfStage = document.getElementById("pdf-stage");

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstChild;
}

function buildCasaBlock(c) {
  return `
    <div class="casa-block">
      <h2>Casa ${c.modelo}</h2>
      <div class="chip-row">
        <div class="chip"><span class="num">${c.distribucion}</span><span class="lbl">Distribución</span></div>
        <div class="chip"><span class="num">${c.pisos}</span><span class="lbl">Pisos</span></div>
        <div class="chip"><span class="num">${fmt(c.m2u, 1)}</span><span class="lbl">M2 útil</span></div>
        <div class="chip"><span class="num">${fmt(c.m2t, 1)}</span><span class="lbl">M2 terraza</span></div>
        <div class="chip"><span class="num">${fmt(c.m2tot, 1)}</span><span class="lbl">M2 total</span></div>
      </div>

      <table class="price-table">
        <thead><tr>
          <th>Concepto</th><th class="num">Valor UF/m2</th><th class="num">Superficie m2</th><th class="num">Total UF</th>
        </tr></thead>
        <tbody>
          <tr><td>M2 útil</td><td class="num">${fmt(c.vu, 2)}</td><td class="num">${fmt(c.m2u, 1)}</td><td class="num">${fmt(c.totalUtil)}</td></tr>
          <tr><td>M2 terraza</td><td class="num">${fmt(c.vt, 2)}</td><td class="num">${fmt(c.m2t, 1)}</td><td class="num">${fmt(c.totalTerraza)}</td></tr>
        </tbody>
      </table>

      <div class="total-box">
        <div>
          <span class="k">Valor UF neto + IVA</span>
          <div class="v">UF ${fmt(c.totalNeto)}</div>
        </div>
        <div style="text-align:right">
          <span class="k">Valor promedio</span>
          <div class="sub">UF ${fmt(c.promM2, 2)} / m2</div>
        </div>
      </div>

      ${c.notas ? `<div class="notes-block">${c.notas}</div>` : ""}
    </div>
  `;
}

function buildSinglePage(d, casas) {
  const casasHtml = casas.map(buildCasaBlock).join("");

  return el(`
    <div class="pdf-page">
      <div class="pdf-header">
        <img src="assets/logo-neorigen.png" alt="Neorigen">
        <div class="title-block">
          <p class="kicker">Vive lo natural</p>
          <h1>Cotización</h1>
        </div>
      </div>

      <div class="meta-grid">
        <div><span class="k">Cliente</span><span class="v">${d["Cliente"]}</span></div>
        <div><span class="k">Fecha</span><span class="v">${d["Fecha"]}</span></div>
        <div><span class="k">Vigencia</span><span class="v">${d["Vigencia (días)"]} días</span></div>
        <div><span class="k">Proyecto / Ubicación</span><span class="v">${d["Proyecto / Ubicación"]}</span></div>
        <div><span class="k">Vendedor</span><span class="v">${d["Vendedor"]}</span></div>
        <div><span class="k">Teléfono vendedor</span><span class="v">${d["Teléfono Vendedor"]}</span></div>
      </div>

      ${casasHtml}

      <div class="cond-section">
        <p class="section-title">Condiciones generales</p>
        <ul class="cond-list">
          <li>Contrato a precio cerrado.</li>
          <li>Forma de pago: cuotas contra estado de avance.</li>
          <li>Proyectos diseñados para ocuparse inmediatamente, con todo el equipamiento esencial, salvo cama, refrigerador, lavadora y otros electrodomésticos personales.</li>
          <li>El proyecto puede ajustarse a tus requerimientos personales o del terreno.</li>
          <li>Esta cotización tiene una vigencia de ${d["Vigencia (días)"]} días desde la fecha de emisión.</li>
        </ul>
      </div>

      <div class="pdf-foot">
        <strong>${d["Vendedor"]} · ${d["Teléfono Vendedor"]} · neorigen.cl</strong> — Cotización sujeta a estudio de factibilidad del terreno y especificaciones técnicas a definir. Las imágenes, caracterizaciones y textos son referenciales.
      </div>
    </div>
  `);
}

async function generatePdf(mode) {
  const btn = mode === "upload" ? btnGenerateUpload : btnGenerateManual;
  const msg = document.querySelector(`.generating-msg[data-for="${mode}"]`);
  btn.disabled = true;
  msg.hidden = false;
  await new Promise(r => setTimeout(r, 30));

  try {
    const d = state.datos;
    const page = buildSinglePage(d, state.casas);
    pdfStage.innerHTML = "";
    pdfStage.appendChild(page);

    const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const img = canvas.toDataURL("image/jpeg", 0.95);

    // El PDF es siempre 1 sola página: el ancho queda fijo (A4) y el alto se
    // calcula según el contenido real capturado, sin importar cuántas casas
    // se hayan cotizado.
    const pageWidthPx = 794;
    const pageHeightPx = Math.round(canvas.height / (canvas.width / pageWidthPx));

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "px", format: [pageWidthPx, pageHeightPx], hotfixes: ["px_scaling"] });
    pdf.addImage(img, "JPEG", 0, 0, pageWidthPx, pageHeightPx);

    const cliente = (state.datos["Cliente"] || "cliente").toString().trim().replace(/[^\w\-]+/g, "_");
    const fecha = (state.datos["Fecha"] || "").toString().trim().replace(/[^\w\-]+/g, "_");
    pdf.save(`Cotizacion_Neorigen_${cliente}_${fecha}.pdf`);
  } catch (err) {
    console.error(err);
    const showErr = mode === "upload" ? showErrorUpload : showErrorManual;
    showErr("Ocurrió un error generando el PDF: " + err.message);
  } finally {
    pdfStage.innerHTML = "";
    btn.disabled = false;
    msg.hidden = true;
  }
}
