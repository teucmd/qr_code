import QRCode from "qrcode";

const $ = sel => document.querySelector(sel);
const textEl = $('#text');
const sizeEl = $('#size');
const fgEl = $('#fg');
const bgEl = $('#bg');
const marginEl = $('#margin');
const ecEl = $('#ecLevel');
const ecInfoEl = $('#ecInfo');
const scaleEl = $('#scale');
const generateBtn = $('#generate');
const downloadBtn = $('#download');
const downloadTypeEl = $('#downloadType');
const copyBtn = $('#copyBtn');
const canvas = $('#qrCanvas');
const ctx = canvas.getContext('2d');

const logoFile = $('#logoFile');
const logoSizeEl = $('#logoSize');
const logoPaddingEl = $('#logoPadding');
const darkToggle = $('#darkToggle');
// start with dark mode toggle on to match default theme
darkToggle.checked = true;

// character capacity display element
const charCapsEl = $('#charCaps');
const charCountEl = $('#charCount');

// new embed elements
const embedFileEl = $('#embedFile');
const embedInfoEl = $('#embedInfo');
const embedModeEl = $('#embedMode');
const limitWarningEl = $('#limitWarning');
// modal elements for warnings
const limitModal = $('#limitModal');
const modalMessage = $('#modalMessage');
const modalClose = $('#modalClose');
const modalOk = $('#modalOk');
const modalBackdrop = $('#modalBackdrop');

let logoImage = null;
let embedFile = null;

// capacity thresholds (approximate maximum payload sizes chosen for practical use)
// These are intentionally conservative limits for embedded data when forcing a version.
// v6Limit and v10Limit are bytes allowed for the payload we embed (not exact QR spec).
const v6Limit = 300;   // use version 6 if payload <= this
const v10Limit = 800;  // use version 10 if payload <= this (bigger fallback)
const maxAllowed = v10Limit;

// simple character capacity estimates (conservative, for display only)
// These are approximate max characters for alphanumeric/text encoding at common EC levels.
// Values chosen to be conservative and illustrative; they won't replace the QR probing logic.
const charCapacities = {
  1:  25,
  2:  47,
  3:  77,
  4: 114,
  5: 154,
  6: 195,
  7: 224,
  8: 279,
  9: 335,
  10: 395
};

function setCanvasSize(px){
  canvas.width = px;
  canvas.height = px;
}

// update the character capacity display next to the text box
function updateCharCaps() {
  if (!charCapsEl) return;
  // adjust displayed capacities based on selected error correction level (conservative multipliers)
  const ec = (ecEl && ecEl.value) ? ecEl.value : 'M';
  const ecMultiplier = {
    L: 1.0,   // low error correction => max capacity
    M: 0.85,  // mid
    Q: 0.7,   // quartile
    H: 0.6    // high (more redundancy => fewer chars)
  }[ec] || 0.85;

  // show a compact summary for common versions (1,6,10)
  const baseV1 = (charCapacities[1] !== undefined) ? charCapacities[1] : null;
  const baseV6 = (charCapacities[6] !== undefined) ? charCapacities[6] : null;
  const baseV10 = (charCapacities[10] !== undefined) ? charCapacities[10] : null;

  const v1 = baseV1 ? Math.max(1, Math.floor(baseV1 * ecMultiplier)) : '—';
  const v6 = baseV6 ? Math.max(1, Math.floor(baseV6 * ecMultiplier)) : '—';
  const v10 = baseV10 ? Math.max(1, Math.floor(baseV10 * ecMultiplier)) : '—';

  charCapsEl.textContent = `v1: ${v1} · v6: ${v6} · v10: ${v10} chars`;
}

// simple helper to update the error-correction info area so the earlier call doesn't fail
function updateEcInfo() {
  if (!ecInfoEl) return;
  const level = ecEl.value || 'M';
  const descriptions = {
    L: 'L (≈7% recovery)',
    M: 'M (≈15% recovery)',
    Q: 'Q (≈25% recovery)',
    H: 'H (≈30% recovery)'
  };
  ecInfoEl.textContent = `Error correction level helps the QR code recover from damage: ${descriptions[level] || descriptions.M}.`;
}

function getOptions(extra = {}) {
  return Object.assign({
    errorCorrectionLevel: ecEl.value,
    margin: Number(marginEl.value),
    color: {
      dark: fgEl.value,
      light: bgEl.value
    },
    scale: Number(scaleEl.value)
  }, extra);
}

 // helper to update embed info area
 function updateEmbedInfo() {
   if (!embedFile) {
     embedInfoEl.textContent = `No file selected to embed. Max for version 6: ${v6Limit} bytes. Max for version 10: ${v10Limit} bytes.`;
     embedInfoEl.style.color = 'var(--muted)';
     return;
   }
  const size = embedFile.size;
  let note = `File: ${embedFile.name} — ${size} bytes. `;
  if (size <= v6Limit) {
    note += `Will embed using QR version 6 (limit ${v6Limit} bytes).`;
    embedInfoEl.style.color = 'var(--muted)';
  } else if (size <= v10Limit) {
    note += `Will embed using QR version 10 (limit ${v10Limit} bytes).`;
    embedInfoEl.style.color = 'var(--muted)';
  } else {
    note += `Too large to embed (max ${v10Limit} bytes). Generation will be blocked.`;
    embedInfoEl.style.color = '#fb7185'; // red-ish
  }
  embedInfoEl.textContent = note;
}

async function prepareEmbedPayload() {
  if (!embedFile) return null;
  // read as ArrayBuffer for size check and base64 if needed
  const mode = embedModeEl.value;
  const ab = await embedFile.arrayBuffer();
  const size = ab.byteLength;
  if (size > maxAllowed) return { error: 'too_large', size };

  if (mode === 'base64') {
    // base64 encode raw bytes (binary-friendly)
    const u8 = new Uint8Array(ab);
    let binary = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    const b64 = btoa(binary);
    // simple container prefix so QR consumer can detect file metadata
    const meta = JSON.stringify({ name: embedFile.name, type: embedFile.type, mode: 'base64' });
    return { payload: `FILE:${meta}:${b64}`, size: b64.length };
  } else {
    // auto/data URL mode: use data URL text (can be longer, but user chose)
    const blob = new Blob([ab], { type: embedFile.type || 'application/octet-stream' });
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const meta = JSON.stringify({ name: embedFile.name, type: embedFile.type, mode: 'dataurl' });
    return { payload: `FILE:${meta}:${dataUrl}`, size: dataUrl.length };
  }
}

let lastRenderedValue = '';
async function render(){
  let value = textEl.value.trim();

  // if embedding selected, prepare payload and replace the value
  if (embedFile) {
    const prep = await prepareEmbedPayload();
    if (!prep) {
      // no payload prepared
    } else if (prep.error === 'too_large') {
      // inform user and abort generation
      embedInfoEl.textContent = `Selected file (${prep.size} bytes) exceeds max embed size (${maxAllowed} bytes). Remove or choose a smaller file.`;
      embedInfoEl.style.color = '#fb7185';
      downloadBtn.disabled = true;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      return;
    } else {
      // determine desired version based on payload size
      let forcedVersion = undefined;
      if (prep.size <= v6Limit) forcedVersion = 6;
      else if (prep.size <= v10Limit) forcedVersion = 10;
      else {
        embedInfoEl.textContent = `Payload too large (${prep.size} bytes). Max is ${v10Limit} bytes.`;
        embedInfoEl.style.color = '#fb7185';
        downloadBtn.disabled = true;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        return;
      }
      // set the QR value to the file payload
      value = prep.payload;
      // include version into options
      var extraOpts = { version: forcedVersion };
    }
  }

  if(!value){
    limitWarningEl.style.display = 'none';
    ctx.clearRect(0,0,canvas.width,canvas.height);
    downloadBtn.disabled = true;
    return;
  }

  const px = Number(sizeEl.value) || 512;
  setCanvasSize(px);

  try{
    // pre-check rendering to decide if content requires larger version
    // we'll test version 6 first; if it fails but version 10 succeeds, warn and force v10.
    let forcedVersion = extraOpts && extraOpts.version ? extraOpts.version : undefined;
    let willUseVersion = forcedVersion;

    // create temp canvases for probing
    const probe6 = document.createElement('canvas');
    probe6.width = px;
    probe6.height = px;
    let probe6ok = true;
    try {
      await QRCode.toCanvas(probe6, value, getOptions(Object.assign({}, { version: 6 })));
    } catch (e) {
      probe6ok = false;
    }

    if (!probe6ok) {
      // try version 10
      const probe10 = document.createElement('canvas');
      probe10.width = px;
      probe10.height = px;
      try {
        await QRCode.toCanvas(probe10, value, getOptions(Object.assign({}, { version: 10 })));
        // version 10 can hold it — warn user that we will use v10
        showModal('Content exceeds version 6 capacity — using version 10 (max).', false);
        willUseVersion = 10;
      } catch (e) {
        // even v10 cannot hold it: block generation
        showModal('Content too large to encode (exceeds version 10 limit). Shorten the text or remove/embed file.', true);
        downloadBtn.disabled = true;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        return;
      }
    } else {
      // content fits in v6; ensure modal closed
      hideModal();
    }

    // render QR into a temporary canvas so we can composite logo cleanly
    const tmp = document.createElement('canvas');
    tmp.width = px;
    tmp.height = px;
    // apply determined version if present
    const renderOpts = (willUseVersion) ? Object.assign({}, extraOpts || {}, { version: willUseVersion }) : extraOpts;
    await QRCode.toCanvas(tmp, value, getOptions(typeof renderOpts !== 'undefined' ? renderOpts : {}));

    // clear main canvas and draw the QR from tmp
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(tmp, 0, 0);

    // remember the last rendered QR content (used by download SVG or convenience)
    lastRenderedValue = value;

    // if logo present, draw centered with optional white padding
    if (logoImage) {
      const pct = Number(logoSizeEl.value) || 18;
      const pad = Number(logoPaddingEl.value) || 6;
      const logoW = Math.round(px * (pct / 100));
      const logoH = Math.round(logoImage.height * (logoW / logoImage.width));
      const x = Math.round((px - logoW) / 2);
      const y = Math.round((px - logoH) / 2);

      if (pad > 0) {
        const padPx = Math.round(pad * (logoW / 100)); // relative small padding
        ctx.fillStyle = getOptions().color.light || '#fff';
        const rx = x - padPx;
        const ry = y - padPx;
        const rw = logoW + padPx * 2;
        const rh = logoH + padPx * 2;
        const radius = Math.max(6, Math.round(rw * 0.08));
        // rounded rect background
        roundRect(ctx, rx, ry, rw, rh, radius, true, false);
      }

      ctx.drawImage(logoImage, x, y, logoW, logoH);
    }

    downloadBtn.disabled = false;
  }catch(err){
    console.error(err);
    downloadBtn.disabled = true;
  } finally {
    // clean up extraOpts for next render
    if (typeof extraOpts !== 'undefined') extraOpts = undefined;
  }
}

// modal helpers
function showModal(message, isError = false){
  if (!limitModal) return;
  modalMessage.textContent = message;
  modalMessage.style.color = isError ? '#fb7185' : 'var(--muted)';
  limitModal.setAttribute('aria-hidden', 'false');
}
function hideModal(){
  if (!limitModal) return;
  limitModal.setAttribute('aria-hidden', 'true');
}

// wire modal close actions
if (modalClose) modalClose.addEventListener('click', hideModal);
if (modalOk) modalOk.addEventListener('click', hideModal);
if (modalBackdrop) modalBackdrop.addEventListener('click', hideModal);

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  const radius = r;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

generateBtn.addEventListener('click', render);
ecEl.addEventListener('change', () => { updateEcInfo(); render(); });
updateEcInfo();

// update capacities immediately and when text changes
updateCharCaps();
// update live char count
function updateCharCount(){
  if(!charCountEl) return;
  const len = textEl.value.length;
  charCountEl.textContent = `${len} char${len === 1 ? '' : 's'}`;
}
updateCharCount();

textEl.addEventListener('input', () => {
  // if user types, update capacities & live char count (keeps UI responsive)
  updateCharCaps();
  updateCharCount();
});

// immediate initial render if there's default content
render();

/* download button: supports PNG/JPEG (raster from canvas) and SVG (regenerate as SVG string) */
downloadBtn.addEventListener('click', async () => {
  // require a rendered value (prefer lastRenderedValue set by render)
  const value = (typeof lastRenderedValue !== 'undefined' && lastRenderedValue) ? lastRenderedValue : textEl.value.trim();
  if (!value) return;

  const type = (downloadTypeEl && downloadTypeEl.value) ? downloadTypeEl.value : 'image/png';
  const baseName = (value.match(/[a-z0-9]+/i) || ['qr'])[0];
  if (type === 'image/svg+xml') {
    try {
      // create an SVG string using qrcode library
      const opts = {
        errorCorrectionLevel: ecEl.value,
        margin: Number(marginEl.value)
      };
      const svgStr = await QRCode.toString(value, Object.assign({}, opts, { type: 'svg' }));
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = baseName + '.svg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error('SVG export failed', e);
    }
  } else {
    // raster export from current canvas
    const mime = (type === 'image/jpeg') ? 'image/jpeg' : 'image/png';
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = baseName + (mime === 'image/jpeg' ? '.jpg' : '.png');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }, mime, mime === 'image/jpeg' ? 0.92 : undefined);
  }
});

/* ensure downloadType visual state reflects whether a real value is chosen
   and (in dark mode) displays black text when nothing is selected */
function updateDownloadTypeState() {
  if (!downloadTypeEl) return;
  if (downloadTypeEl.value) downloadTypeEl.classList.add('has-value');
  else downloadTypeEl.classList.remove('has-value');
}
if (downloadTypeEl) {
  downloadTypeEl.addEventListener('change', updateDownloadTypeState);
  // initial state
  updateDownloadTypeState();
}

// copy canvas image to clipboard (if supported)
copyBtn.addEventListener('click', async () => {
  if (!navigator.clipboard) return;
  try{
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const item = new ClipboardItem({'image/png': blob});
    await navigator.clipboard.write([item]);
    copyBtn.textContent = 'Copied';
    setTimeout(()=>copyBtn.textContent = 'Copy Image', 1200);
  }catch(e){
    console.warn('copy failed', e);
    copyBtn.textContent = 'Failed';
    setTimeout(()=>copyBtn.textContent = 'Copy Image', 1200);
  }
});

// convenient shortcuts: Enter+Cmd/Ctrl to generate
textEl.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    render();
  }
});

// live preview updates for certain controls
[fgEl,bgEl,ecEl,marginEl,scaleEl,sizeEl,logoSizeEl,logoPaddingEl].forEach(el=>{
  el.addEventListener('input', () => {
    if (el._t) clearTimeout(el._t);
    el._t = setTimeout(render, 180);
  });
});

// dark mode toggle
darkToggle.addEventListener('change', e => {
  const on = darkToggle.checked;
  document.body.setAttribute('data-theme', on ? 'dark' : 'light');
  // swap sensible default colors when toggling if user hasn't changed them
  if (!fgEl.dataset.modified) fgEl.value = on ? '#e6edf3' : '#1f2937';
  if (!bgEl.dataset.modified) bgEl.value = on ? '#0b1220' : '#ffffff';
  render();
});

// detect manual color changes
[fgEl, bgEl].forEach(el => {
  el.addEventListener('input', () => {
    el.dataset.modified = '1';
  });
});

// logo upload handling
logoFile.addEventListener('change', () => {
  const f = logoFile.files && logoFile.files[0];
  if (!f) {
    logoImage = null;
    render();
    return;
  }
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    logoImage = img;
    URL.revokeObjectURL(url);
    render();
  };
  img.onerror = () => {
    logoImage = null;
    URL.revokeObjectURL(url);
    console.warn('Logo load failed');
  };
  img.src = url;
});

// embed file handling
embedFileEl.addEventListener('change', () => {
  const f = embedFileEl.files && embedFileEl.files[0];
  if (!f) {
    embedFile = null;
    updateEmbedInfo();
    render();
    return;
  }
  embedFile = f;
  updateEmbedInfo();
});