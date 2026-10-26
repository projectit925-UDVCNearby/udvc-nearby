// ===== UDVC Nearby: แผนที่ที่พักและร้านอาหาร =====
// ขั้นตอน: สร้างแผนที่ -> โหลดข้อมูลจาก Supabase -> สร้างหมุด
//          -> กรองตามที่ผู้ใช้เลือก -> แสดงหมุดและรายการที่ผ่านตัวกรอง
// ฟังก์ชันระดับ 2: รีวิว, รายการโปรด, คำนวณค่าใช้จ่ายต่อเดือน, เปรียบเทียบหอ
// (ค่า db และ COLLEGE มาจากไฟล์ js/supabase-config.js)

// 1) สร้างแผนที่ ตรงกลางที่วิทยาลัย
const map = L.map("map").setView([COLLEGE.lat, COLLEGE.lng], 16);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; ผู้ร่วมพัฒนา OpenStreetMap"
}).addTo(map);

// กลุ่มหมุดที่ผ่านตัวกรอง (ล้างแล้วใส่ใหม่ทุกครั้งที่ตัวกรองเปลี่ยน)
const markerLayer = L.layerGroup().addTo(map);

let places = [];          // ที่พัก + ร้านอาหารทั้งหมด แต่ละรายการมี kind, dist, marker, reviews เพิ่มเข้าไป
let currentPlace = null;  // สถานที่ที่เปิดการ์ดอยู่

// ค่าตัวกรองปัจจุบัน
const filters = {
  kind: "all",    // all / dorm / food / fav
  q: "",          // คำค้นหา
  budget: 0,      // งบสูงสุด (0 = ไม่จำกัด)
  dormType: "",   // ชาย / หญิง / รวม ("" = ทั้งหมด)
  air: false,     // ต้องมีแอร์
  maxDist: 0      // ระยะสูงสุดเป็นเมตร (0 = ไม่จำกัด)
};

// ===== 2) เก็บข้อมูลในเครื่องผู้ใช้ (localStorage) =====
// ใช้กับรายการโปรดและค่าที่กรอกในเครื่องคำนวณ ไม่ต้องล็อกอิน
// ถ้าเบราว์เซอร์ไม่อนุญาต (เช่นโหมดไม่ระบุตัวตน) เว็บยังใช้งานได้ แค่ไม่จำค่า
function loadSaved(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ไม่เป็นไร */ }
}

const favs = new Set(loadSaved("udvc-favs", []));                 // เช่น "dorm-3", "food-1"
const usage = loadSaved("udvc-usage", { elec: 100, water: 5 });   // หน่วยไฟ / หน่วยน้ำ ต่อเดือน
let compareIds = [];                                              // id ของหอที่เลือกเปรียบเทียบ (สูงสุด 3)
const MAX_COMPARE = 3;

const keyOf = p => `${p.kind}-${p.id}`;

// ===== 3) ฟังก์ชันช่วยทั่วไป =====
// กันข้อความแปลกๆ (เช่นในรีวิว) ถูกแปลงเป็น HTML
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function makeIcon(kind) {
  return L.divIcon({
    className: "",
    html: `<div class="pin ${kind}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26]
  });
}

// ระยะทางและเวลาเดินโดยประมาณ (เดิน 80 เมตร/นาที)
function distanceText(meters) {
  const minutes = Math.max(1, Math.round(meters / 80));
  return `${Math.round(meters)} ม. · เดินประมาณ ${minutes} นาที`;
}

// ระยะแบบสั้นสำหรับรายการ เช่น 280 ม. หรือ 1.2 กม.
function shortDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} ม.` : `${(meters / 1000).toFixed(1)} กม.`;
}

function navLink(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// แปลงวันที่ 2026-10-22 เป็น 22/10/2569
function thaiDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}/${Number(m)}/${Number(y) + 543}`;
}

const baht = n => Math.round(n).toLocaleString();

// ===== 4) รีวิว: คะแนนเฉลี่ย =====
function rating(p) {
  const list = p.reviews || [];
  if (list.length === 0) return null;
  const avg = list.reduce((sum, r) => sum + r.stars, 0) / list.length;
  return { avg, count: list.length };
}

function starsText(n) {
  const full = Math.round(n);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

// ===== 5) ค่าใช้จ่ายต่อเดือนโดยประมาณ =====
// ค่าห้อง + ค่าไฟ (บาท/หน่วย x หน่วยที่ใช้) + ค่าน้ำ (ต่อหน่วย หรือ เหมาจ่าย)
function monthlyCost(p) {
  const elec = (p.electric || 0) * usage.elec;
  const water = p.water_unit === "เดือน" ? (p.water || 0) : (p.water || 0) * usage.water;
  return { room: p.price, elec, water, total: p.price + elec + water };
}

function costLine(p) {
  const c = monthlyCost(p);
  return `ค่าห้อง ${baht(c.room)} + ค่าไฟ ${baht(c.elec)} + ค่าน้ำ ${baht(c.water)}
          = <b>${baht(c.total)} บาท/เดือน</b>`;
}

// ===== 6) เนื้อหาการ์ด =====
function gallery(p) {
  if (!p.photos || p.photos.length === 0) return "";
  return `<div class="gallery">${p.photos
    .map((url, i) => `<img src="${esc(url)}" alt="${esc(p.name)} รูปที่ ${i + 1}" loading="lazy">`)
    .join("")}</div>`;
}

// ปุ่ม บันทึกเป็นรายการโปรด / เพิ่มในตารางเปรียบเทียบ
function cardActions(p) {
  const isFav = favs.has(keyOf(p));
  let compareBtn = "";
  if (p.kind === "dorm") {
    const inCompare = compareIds.includes(p.id);
    const full = !inCompare && compareIds.length >= MAX_COMPARE;
    compareBtn = `<button class="act ${inCompare ? "on" : ""}" data-action="compare" ${full ? "disabled" : ""}>
      ${inCompare ? "✓ อยู่ในตารางเทียบ" : full ? `เทียบได้สูงสุด ${MAX_COMPARE} หอ` : "⇄ เปรียบเทียบ"}</button>`;
  }
  return `<div class="card-actions">
      <button class="act ${isFav ? "on fav" : ""}" data-action="fav" aria-pressed="${isFav}">
        ${isFav ? "♥ บันทึกแล้ว" : "♡ บันทึก"}</button>
      ${compareBtn}
    </div>`;
}

function ratingBadge(p) {
  const r = rating(p);
  return r ? `<span class="rating">★ ${r.avg.toFixed(1)} <span class="muted">(${r.count})</span></span>` : "";
}

function dormCard(p) {
  const vacant = p.vacant > 0
    ? `<span class="vacant-yes">ว่าง ${p.vacant} ห้อง</span>`
    : `<span class="vacant-no">เต็ม</span>`;
  return `
    ${gallery(p)}
    <h2>${esc(p.name)}</h2>
    <p class="sub">ที่พัก${esc(p.type)} · ${vacant} ${ratingBadge(p)}</p>
    ${cardActions(p)}
    <dl>
      <dt>ค่าห้อง</dt><dd>${p.price.toLocaleString()} บาท/เดือน</dd>
      <dt>ค่าไฟ</dt><dd>${p.electric ?? "-"} บาท/หน่วย</dd>
      <dt>ค่าน้ำ</dt><dd>${p.water ?? "-"} บาท/${esc(p.water_unit)}</dd>
      <dt>มัดจำ</dt><dd>${esc(p.deposit || "-")}</dd>
      <dt>ปิดหอ</dt><dd>${esc(p.curfew || "-")}</dd>
      <dt>ระยะจากวิทยาลัย</dt><dd>${distanceText(p.dist)}</dd>
      <dt>โทร</dt><dd>${esc(p.phone || "-")}</dd>
    </dl>
    <div class="tags">${p.facilities.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>

    <section class="calc">
      <h3>ค่าใช้จ่ายต่อเดือนโดยประมาณ</h3>
      <div class="calc-inputs">
        <label>ใช้ไฟ <input type="number" min="0" step="1" inputmode="numeric" data-usage="elec" value="${usage.elec}"> หน่วย</label>
        ${p.water_unit === "หน่วย"
          ? `<label>ใช้น้ำ <input type="number" min="0" step="1" inputmode="numeric" data-usage="water" value="${usage.water}"> หน่วย</label>`
          : `<span class="muted">ค่าน้ำเหมาจ่าย ${p.water ?? 0} บาท/เดือน</span>`}
      </div>
      <p class="calc-total">${costLine(p)}</p>
      <p class="hint">โดยทั่วไป ห้องพัดลมใช้ไฟ 50–80 หน่วย/เดือน ห้องแอร์ 120–200 หน่วย/เดือน</p>
    </section>

    ${reviewSection(p)}
    <a class="btn-nav" href="${navLink(p.lat, p.lng)}" target="_blank" rel="noopener">นำทางด้วย Google Maps</a>
    <p class="updated">อัปเดตล่าสุด ${thaiDate(p.updated_at)}</p>`;
}

function foodCard(p) {
  return `
    ${gallery(p)}
    <h2>${esc(p.name)}</h2>
    <p class="sub">${esc(p.category)} · ${esc(p.price_range || "")} ${ratingBadge(p)}</p>
    ${cardActions(p)}
    <dl>
      <dt>เวลาเปิด</dt><dd>${esc(p.open_hours || "-")}</dd>
      <dt>ระยะจากวิทยาลัย</dt><dd>${distanceText(p.dist)}</dd>
    </dl>
    <strong>เมนูเด่น</strong>
    <ul>${p.menu.map(m => `<li>${esc(m)} บาท</li>`).join("")}</ul>
    ${p.student_deal ? `<div class="deal">โปรนักศึกษา: ${esc(p.student_deal)}</div>` : ""}
    ${reviewSection(p)}
    <a class="btn-nav" href="${navLink(p.lat, p.lng)}" target="_blank" rel="noopener">นำทางด้วย Google Maps</a>
    <p class="updated">อัปเดตล่าสุด ${thaiDate(p.updated_at)}</p>`;
}

// ส่วนรีวิวในการ์ด: รายการรีวิว + ฟอร์มเขียนรีวิว
function reviewSection(p) {
  const r = rating(p);
  const list = (p.reviews || []).map(rv => `
    <li class="review">
      <div class="review-head">
        <span class="stars" aria-label="${rv.stars} ดาว">${starsText(rv.stars)}</span>
        <span class="who">${esc(rv.author_name)}</span>
        <span class="when">${thaiDate(rv.created_at)}</span>
      </div>
      <p>${esc(rv.comment)}</p>
    </li>`).join("");

  const starInputs = [5, 4, 3, 2, 1].map(n => `
    <input type="radio" name="stars" id="star-${n}" value="${n}">
    <label for="star-${n}" title="${n} ดาว">★</label>`).join("");

  return `
    <section class="reviews">
      <h3>รีวิว ${r ? `<span class="rating">★ ${r.avg.toFixed(1)}</span> <span class="muted">จาก ${r.count} รีวิว</span>` : ""}</h3>
      ${list ? `<ul class="review-list">${list}</ul>` : `<p class="muted">ยังไม่มีรีวิว เป็นคนแรกที่รีวิวได้เลย</p>`}
      <details class="review-box">
        <summary>✎ เขียนรีวิว</summary>
        <form class="review-form">
          <fieldset class="star-pick" aria-label="ให้คะแนน">
            ${starInputs}
          </fieldset>
          <input name="author" maxlength="40" placeholder="ชื่อเล่น (เว้นว่างได้)" autocomplete="nickname">
          <textarea name="comment" rows="3" minlength="5" maxlength="500" required
            placeholder="เล่าประสบการณ์ เช่น ความสะอาด ความปลอดภัย รสชาติ ความคุ้มค่า"></textarea>
          <button type="submit" class="btn-send">ส่งรีวิว</button>
          <p class="form-msg" aria-live="polite"></p>
        </form>
      </details>
    </section>`;
}

// ===== 7) แสดง/ซ่อนการ์ด =====
const card = document.getElementById("card");
const cardBody = document.getElementById("card-body");

function showCard(p) {
  currentPlace = p;
  cardBody.innerHTML = p.kind === "dorm" ? dormCard(p) : foodCard(p);
  card.hidden = false;
  card.scrollTop = 0;
}

// วาดการ์ดใหม่โดยไม่เลื่อนกลับขึ้นบนสุด (ใช้หลังกดปุ่มในการ์ด)
function refreshCard() {
  if (!currentPlace || card.hidden) return;
  const top = card.scrollTop;
  cardBody.innerHTML = currentPlace.kind === "dorm" ? dormCard(currentPlace) : foodCard(currentPlace);
  card.scrollTop = top;
}

function closeCard() {
  card.hidden = true;
  currentPlace = null;
}
document.getElementById("card-close").addEventListener("click", closeCard);
map.on("click", closeCard);

// ปุ่มในการ์ด (ใช้ event delegation เพราะเนื้อหาการ์ดถูกสร้างใหม่บ่อย)
cardBody.addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn || !currentPlace) return;
  if (btn.dataset.action === "fav") toggleFav(currentPlace);
  if (btn.dataset.action === "compare") toggleCompare(currentPlace.id);
});

// กรอกหน่วยไฟ/น้ำ แล้วคำนวณใหม่ทันที (อัปเดตเฉพาะบรรทัดผลรวม ช่องกรอกจะได้ไม่หลุดโฟกัส)
cardBody.addEventListener("input", e => {
  const field = e.target.dataset.usage;
  if (!field || !currentPlace) return;
  usage[field] = Math.max(0, Number(e.target.value) || 0);
  save("udvc-usage", usage);
  cardBody.querySelector(".calc-total").innerHTML = costLine(currentPlace);
  renderCompare();
});

cardBody.addEventListener("submit", e => {
  if (e.target.matches(".review-form")) {
    e.preventDefault();
    submitReview(e.target, currentPlace);
  }
});

// ===== 8) ส่งรีวิว =====
async function submitReview(form, p) {
  const msg = form.querySelector(".form-msg");
  const stars = Number(form.stars.value);
  const comment = form.comment.value.trim();

  if (!stars) { msg.textContent = "กรุณาให้ดาว 1–5 ดวง"; return; }
  if (comment.length < 5) { msg.textContent = "กรุณาเขียนรีวิวอย่างน้อย 5 ตัวอักษร"; return; }

  // กันกดส่งรัวๆ: ส่งได้ 1 รีวิวต่อ 1 นาที ต่อเครื่อง
  const last = loadSaved("udvc-last-review", 0);
  if (Date.now() - last < 60 * 1000) { msg.textContent = "ส่งรีวิวถี่เกินไป กรุณารอ 1 นาที"; return; }

  const button = form.querySelector("button");
  button.disabled = true;
  msg.textContent = "กำลังส่ง...";

  const { error } = await db.from("reviews").insert({
    dorm_id: p.kind === "dorm" ? p.id : null,
    restaurant_id: p.kind === "food" ? p.id : null,
    author_name: form.author.value.trim() || "ไม่ระบุชื่อ",
    stars,
    comment
  });

  if (error) {
    console.error(error);
    button.disabled = false;
    msg.textContent = "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง";
    return;
  }

  save("udvc-last-review", Date.now());
  form.innerHTML = `<p class="form-ok">ขอบคุณสำหรับรีวิว! 🙏<br>รีวิวจะแสดงหลังจากแอดมินตรวจสอบแล้ว</p>`;
}

// ===== 9) รายการโปรด =====
function toggleFav(p) {
  const key = keyOf(p);
  if (favs.has(key)) favs.delete(key);
  else favs.add(key);
  save("udvc-favs", [...favs]);
  refreshCard();
  render();
}

// ===== 10) เปรียบเทียบหอ =====
const compareBar = document.getElementById("compare-bar");
const compareDialog = document.getElementById("compare-dialog");

function toggleCompare(id) {
  if (compareIds.includes(id)) compareIds = compareIds.filter(x => x !== id);
  else if (compareIds.length < MAX_COMPARE) compareIds.push(id);
  refreshCard();
  renderCompare();
}

function renderCompare() {
  const dorms = compareIds.map(id => places.find(p => p.kind === "dorm" && p.id === id)).filter(Boolean);

  // แถบด้านบนแผนที่
  compareBar.hidden = dorms.length === 0;
  document.getElementById("compare-count").textContent = `เปรียบเทียบ ${dorms.length} หอ`;

  if (dorms.length === 0) {
    if (compareDialog.open) compareDialog.close();
    return;
  }

  // หาค่าที่ดีที่สุดในแต่ละแถว เพื่อไฮไลต์
  const best = (values, pick) => {
    const nums = values.filter(v => typeof v === "number");
    return nums.length > 1 ? pick(...nums) : null;
  };

  const costs = dorms.map(d => monthlyCost(d).total);
  const ratings = dorms.map(d => (rating(d) ? rating(d).avg : null));

  // แต่ละแถว: [หัวข้อ, ค่าที่ใช้เทียบ, ข้อความที่แสดง, ใช้ค่าน้อยสุดหรือมากสุดเป็น "ดีที่สุด"]
  const rows = [
    ["ประเภท", dorms.map(() => null), dorms.map(d => `หอ${esc(d.type)}`)],
    ["ค่าห้อง/เดือน", dorms.map(d => d.price), dorms.map(d => `${baht(d.price)} บ.`), Math.min],
    ["ค่าไฟ/หน่วย", dorms.map(d => d.electric), dorms.map(d => `${d.electric ?? "-"} บ.`), Math.min],
    ["ค่าน้ำ", dorms.map(() => null), dorms.map(d => `${d.water ?? "-"} บ./${esc(d.water_unit)}`)],
    ["รวมต่อเดือน (ประมาณ)", costs, costs.map(c => `<b>${baht(c)} บ.</b>`), Math.min],
    ["มัดจำ", dorms.map(() => null), dorms.map(d => esc(d.deposit || "-"))],
    ["ห้องว่าง", dorms.map(d => d.vacant), dorms.map(d => (d.vacant > 0 ? `${d.vacant} ห้อง` : "เต็ม")), Math.max],
    ["ระยะจากวิทยาลัย", dorms.map(d => d.dist), dorms.map(d => shortDistance(d.dist)), Math.min],
    ["ปิดหอ", dorms.map(() => null), dorms.map(d => esc(d.curfew || "-"))],
    ["คะแนนรีวิว", ratings, dorms.map((d, i) => (ratings[i] ? `★ ${ratings[i].toFixed(1)} (${rating(d).count})` : "ยังไม่มี")), Math.max]
  ];

  // สิ่งอำนวยความสะดวกทั้งหมดที่มีในหอที่เลือก
  const allFacilities = [...new Set(dorms.flatMap(d => d.facilities))];

  const head = `<tr><th></th>${dorms.map(d => `
      <th>${esc(d.name)}
        <button class="remove" data-remove="${d.id}" aria-label="เอา ${esc(d.name)} ออก">✕</button>
      </th>`).join("")}</tr>`;

  const body = rows.map(([label, values, texts, pick]) => {
    const target = pick ? best(values, pick) : null;
    return `<tr><th>${label}</th>${texts.map((t, i) =>
      `<td class="${target !== null && values[i] === target ? "best" : ""}">${t}</td>`).join("")}</tr>`;
  }).join("") + allFacilities.map(f => `<tr><th>${esc(f)}</th>${dorms.map(d =>
      d.facilities.includes(f) ? `<td class="yes">✓</td>` : `<td class="no">–</td>`).join("")}</tr>`).join("");

  document.getElementById("compare-table").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  document.getElementById("compare-usage").textContent =
    `ค่าใช้จ่ายรวมคิดจากการใช้ไฟ ${usage.elec} หน่วย และน้ำ ${usage.water} หน่วยต่อเดือน (แก้ได้ในการ์ดของแต่ละหอ)`;
  document.getElementById("compare-hint").hidden = dorms.length > 1;
}

document.getElementById("compare-open").addEventListener("click", () => {
  renderCompare();
  compareDialog.showModal();
});
document.getElementById("compare-clear").addEventListener("click", () => {
  compareIds = [];
  refreshCard();
  renderCompare();
});
document.getElementById("compare-close").addEventListener("click", () => compareDialog.close());
document.getElementById("compare-table").addEventListener("click", e => {
  const id = e.target.closest("[data-remove]")?.dataset.remove;
  if (id) toggleCompare(Number(id));
});

// ===== 11) ตรวจว่าสถานที่หนึ่งผ่านตัวกรองทั้งหมดหรือไม่ =====
function matches(p) {
  if (filters.kind === "fav") {
    if (!favs.has(keyOf(p))) return false;
  } else if (filters.kind !== "all" && p.kind !== filters.kind) {
    return false;
  }
  if (filters.maxDist && p.dist > filters.maxDist) return false;

  // ค้นหาจากชื่อ ประเภท หมวดร้าน เมนู และสิ่งอำนวยความสะดวก
  if (filters.q) {
    const text = [p.name, p.type, p.category, ...(p.menu || []), ...(p.facilities || [])]
      .join(" ")
      .toLowerCase();
    if (!text.includes(filters.q)) return false;
  }

  // ตัวกรองเฉพาะที่พัก (ร้านอาหารไม่ถูกกรองด้วยเงื่อนไขเหล่านี้)
  if (p.kind === "dorm") {
    if (filters.budget && p.price > filters.budget) return false;
    if (filters.dormType && p.type !== filters.dormType) return false;
    if (filters.air && !p.facilities.includes("แอร์")) return false;
  }
  return true;
}

// ===== 12) แสดงผล: หมุดบนแผนที่ + รายการด้านข้าง =====
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("count");

function render() {
  const shown = places.filter(matches).sort((a, b) => a.dist - b.dist);

  markerLayer.clearLayers();
  shown.forEach(p => markerLayer.addLayer(p.marker));

  document.getElementById("fav-count").textContent = favs.size ? ` ${favs.size}` : "";
  countEl.textContent = `พบ ${shown.length} แห่ง`;
  resultsEl.innerHTML = "";

  if (shown.length === 0) {
    resultsEl.innerHTML = filters.kind === "fav" && favs.size === 0
      ? `<li class="empty">ยังไม่มีรายการโปรด<br>เปิดการ์ดแล้วกด "♡ บันทึก" เพื่อเก็บไว้ดูทีหลัง</li>`
      : `<li class="empty">ไม่พบสถานที่ที่ตรงกับเงื่อนไข<br>ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา</li>`;
    return;
  }

  shown.forEach(p => {
    const r = rating(p);
    const meta = p.kind === "dorm"
      ? `หอ${esc(p.type)} · ${p.price.toLocaleString()} บาท/เดือน · ${p.vacant > 0 ? `ว่าง ${p.vacant} ห้อง` : "เต็ม"}`
      : `${esc(p.category)} · ${esc(p.price_range || "")}`;

    const li = document.createElement("li");
    li.innerHTML = `
      <button class="result">
        <span class="dot ${p.kind}"></span>
        <span class="name">${esc(p.name)}${favs.has(keyOf(p)) ? ` <span class="fav-mark" aria-label="รายการโปรด">♥</span>` : ""}</span>
        <span class="dist">${shortDistance(p.dist)}</span>
        <span class="meta">${meta}${r ? ` · <span class="rating">★ ${r.avg.toFixed(1)}</span>` : ""}</span>
      </button>`;
    li.querySelector("button").addEventListener("click", () => focusPlace(p));
    resultsEl.appendChild(li);
  });
}

// กดรายการแล้วเลื่อนแผนที่ไปที่สถานที่นั้นและเปิดการ์ด
function focusPlace(p) {
  setPanelOpen(false); // บนมือถือ ปิดแผงเพื่อให้เห็นแผนที่
  showCard(p);
  map.invalidateSize(); // กันกรณีเปิดหน้าเว็บในแท็บเบื้องหลัง แผนที่ยังไม่รู้ขนาดจริง
  // เลื่อนจุดกึ่งกลางลงล่างเล็กน้อย ให้หมุดอยู่ช่วงบนของจอ ไม่โดนการ์ดบัง
  const zoom = 17;
  const shifted = map.project([p.lat, p.lng], zoom).add([0, map.getSize().y * 0.25]);
  map.flyTo(map.unproject(shifted, zoom), zoom, { duration: 0.6 });
  p.marker.openTooltip();
}

// ===== 13) หมุดวิทยาลัย + วงรัศมี 500 ม. และ 1 กม. =====
L.marker([COLLEGE.lat, COLLEGE.lng], { icon: makeIcon("college") })
  .addTo(map)
  .bindTooltip(COLLEGE.name, { direction: "top", offset: [0, -24] });
L.circle([COLLEGE.lat, COLLEGE.lng], { radius: 500, color: "#0f5f8c", weight: 1, fillOpacity: 0.04 }).addTo(map);
L.circle([COLLEGE.lat, COLLEGE.lng], { radius: 1000, color: "#0f5f8c", weight: 1, dashArray: "4 6", fill: false }).addTo(map);

// ===== 14) โหลดข้อมูลจาก Supabase แล้วสร้างหมุด =====
async function loadPlaces() {
  countEl.textContent = "กำลังโหลดข้อมูล...";

  const [dormsRes, foodRes, reviewsRes] = await Promise.all([
    db.from("dorms").select("*"),
    db.from("restaurants").select("*"),
    db.from("reviews")
      .select("dorm_id, restaurant_id, author_name, stars, comment, created_at")
      .eq("approved", true)
      .order("created_at", { ascending: false })
  ]);

  if (dormsRes.error || foodRes.error) {
    console.error(dormsRes.error || foodRes.error);
    countEl.textContent = "";
    resultsEl.innerHTML = `<li class="empty">โหลดข้อมูลไม่สำเร็จ<br>ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองรีเฟรชหน้าเว็บ</li>`;
    return;
  }

  // จัดกลุ่มรีวิวตามสถานที่ (ถ้าโหลดรีวิวไม่สำเร็จ ก็ยังแสดงแผนที่ได้)
  const reviewsByPlace = {};
  (reviewsRes.data || []).forEach(r => {
    const key = r.dorm_id ? `dorm-${r.dorm_id}` : `food-${r.restaurant_id}`;
    (reviewsByPlace[key] ||= []).push(r);
  });

  const all = [
    ...dormsRes.data.map(p => ({ ...p, kind: "dorm" })),
    ...foodRes.data.map(p => ({ ...p, kind: "food" }))
  ];

  places = all.map(p => {
    p.dist = map.distance([COLLEGE.lat, COLLEGE.lng], [p.lat, p.lng]);
    p.reviews = reviewsByPlace[keyOf(p)] || [];
    p.marker = L.marker([p.lat, p.lng], { icon: makeIcon(p.kind) })
      .bindTooltip(p.name, { direction: "top", offset: [0, -24] })
      .on("click", () => showCard(p));
    return p;
  });

  // ลบรายการโปรดที่สถานที่ถูกลบไปแล้ว
  const existing = new Set(places.map(keyOf));
  [...favs].forEach(k => { if (!existing.has(k)) favs.delete(k); });
  save("udvc-favs", [...favs]);

  render();
}

loadPlaces();

// ===== 15) เชื่อมช่องค้นหาและตัวกรองเข้ากับ render() =====
const qInput = document.getElementById("q");
const budgetSel = document.getElementById("budget");
const dormTypeSel = document.getElementById("dorm-type");
const distSel = document.getElementById("max-dist");
const airChk = document.getElementById("air");
const dormFields = document.querySelectorAll('[data-for="dorm"]');

qInput.addEventListener("input", () => {
  filters.q = qInput.value.trim().toLowerCase();
  render();
});
budgetSel.addEventListener("change", () => { filters.budget = Number(budgetSel.value); render(); });
dormTypeSel.addEventListener("change", () => { filters.dormType = dormTypeSel.value; render(); });
distSel.addEventListener("change", () => { filters.maxDist = Number(distSel.value); render(); });
airChk.addEventListener("change", () => { filters.air = airChk.checked; render(); });

// ปุ่มเลือกหมวด: ทั้งหมด / ที่พัก / ร้านอาหาร / รายการโปรด
const chips = document.querySelectorAll(".chip");

function setKind(kind) {
  filters.kind = kind;
  chips.forEach(b => b.classList.toggle("active", b.dataset.filter === kind));
  // ซ่อนตัวกรองของที่พักเมื่อดูเฉพาะร้านอาหาร
  dormFields.forEach(el => { el.hidden = kind === "food"; });
  closeCard();
  render();
}
chips.forEach(btn => btn.addEventListener("click", () => setKind(btn.dataset.filter)));

// ปุ่มล้างตัวกรอง
document.getElementById("reset").addEventListener("click", () => {
  qInput.value = "";
  budgetSel.value = "0";
  dormTypeSel.value = "";
  distSel.value = "0";
  airChk.checked = false;
  Object.assign(filters, { q: "", budget: 0, dormType: "", air: false, maxDist: 0 });
  setKind("all");
});

// ===== 16) มือถือ: ปุ่มสลับระหว่างรายการกับแผนที่ =====
const panel = document.getElementById("panel");
const toggleBtn = document.getElementById("toggle-view");

function setPanelOpen(open) {
  panel.classList.toggle("open", open);
  toggleBtn.textContent = open ? "🗺 แผนที่" : "☰ รายการ";
  toggleBtn.setAttribute("aria-expanded", open);
}
toggleBtn.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open")));
