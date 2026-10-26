// ===== UDVC Nearby: แผนที่ที่พักและร้านอาหาร =====
// ขั้นตอน: สร้างแผนที่ -> โหลดข้อมูลจาก Supabase -> สร้างหมุด
//          -> กรองตามที่ผู้ใช้เลือก -> แสดงหมุดและรายการที่ผ่านตัวกรอง
// (ค่า db และ COLLEGE มาจากไฟล์ js/supabase-config.js)

// 1) สร้างแผนที่ ตรงกลางที่วิทยาลัย
const map = L.map("map").setView([COLLEGE.lat, COLLEGE.lng], 16);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; ผู้ร่วมพัฒนา OpenStreetMap"
}).addTo(map);

// กลุ่มหมุดที่ผ่านตัวกรอง (ล้างแล้วใส่ใหม่ทุกครั้งที่ตัวกรองเปลี่ยน)
const markerLayer = L.layerGroup().addTo(map);

let places = []; // ที่พัก + ร้านอาหารทั้งหมด แต่ละรายการมี kind, dist, marker เพิ่มเข้าไป

// ค่าตัวกรองปัจจุบัน
const filters = {
  kind: "all",    // all / dorm / food
  q: "",          // คำค้นหา
  budget: 0,      // งบสูงสุด (0 = ไม่จำกัด)
  dormType: "",   // ชาย / หญิง / รวม ("" = ทั้งหมด)
  air: false,     // ต้องมีแอร์
  maxDist: 0      // ระยะสูงสุดเป็นเมตร (0 = ไม่จำกัด)
};

// 2) สร้างไอคอนหมุดตามประเภท (dorm / food / college)
function makeIcon(kind) {
  return L.divIcon({
    className: "",
    html: `<div class="pin ${kind}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26]
  });
}

// 3) ข้อความระยะทางและเวลาเดินโดยประมาณ (เดิน 80 เมตร/นาที)
function distanceText(meters) {
  const minutes = Math.max(1, Math.round(meters / 80));
  return `${Math.round(meters)} ม. · เดินประมาณ ${minutes} นาที`;
}

// ระยะแบบสั้นสำหรับรายการ เช่น 280 ม. หรือ 1.2 กม.
function shortDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} ม.` : `${(meters / 1000).toFixed(1)} กม.`;
}

// ลิงก์เปิด Google Maps นำทาง
function navLink(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// แปลงวันที่ 2026-10-22 เป็น 22/10/2569
function thaiDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${Number(y) + 543}`;
}

// แถบรูปภาพด้านบนการ์ด (ถ้ามีรูป)
function gallery(p) {
  if (!p.photos || p.photos.length === 0) return "";
  return `<div class="gallery">${p.photos
    .map((url, i) => `<img src="${url}" alt="${p.name} รูปที่ ${i + 1}" loading="lazy">`)
    .join("")}</div>`;
}

// 4) สร้างเนื้อหาการ์ดของที่พัก
function dormCard(p) {
  const vacant = p.vacant > 0
    ? `<span class="vacant-yes">ว่าง ${p.vacant} ห้อง</span>`
    : `<span class="vacant-no">เต็ม</span>`;
  return `
    ${gallery(p)}
    <h2>${p.name}</h2>
    <p class="sub">ที่พัก${p.type} · ${vacant}</p>
    <dl>
      <dt>ค่าห้อง</dt><dd>${p.price.toLocaleString()} บาท/เดือน</dd>
      <dt>ค่าไฟ</dt><dd>${p.electric} บาท/หน่วย</dd>
      <dt>ค่าน้ำ</dt><dd>${p.water} บาท/${p.water_unit}</dd>
      <dt>มัดจำ</dt><dd>${p.deposit}</dd>
      <dt>ปิดหอ</dt><dd>${p.curfew}</dd>
      <dt>ระยะจากวิทยาลัย</dt><dd>${distanceText(p.dist)}</dd>
      <dt>โทร</dt><dd>${p.phone}</dd>
    </dl>
    <div class="tags">${p.facilities.map(f => `<span class="tag">${f}</span>`).join("")}</div>
    <a class="btn-nav" href="${navLink(p.lat, p.lng)}" target="_blank" rel="noopener">นำทางด้วย Google Maps</a>
    <p class="updated">อัปเดตล่าสุด ${thaiDate(p.updated_at)}</p>`;
}

// 5) สร้างเนื้อหาการ์ดของร้านอาหาร
function foodCard(p) {
  return `
    ${gallery(p)}
    <h2>${p.name}</h2>
    <p class="sub">${p.category} · ${p.price_range}</p>
    <dl>
      <dt>เวลาเปิด</dt><dd>${p.open_hours}</dd>
      <dt>ระยะจากวิทยาลัย</dt><dd>${distanceText(p.dist)}</dd>
    </dl>
    <strong>เมนูเด่น</strong>
    <ul>${p.menu.map(m => `<li>${m} บาท</li>`).join("")}</ul>
    ${p.student_deal ? `<div class="deal">โปรนักศึกษา: ${p.student_deal}</div>` : ""}
    <a class="btn-nav" href="${navLink(p.lat, p.lng)}" target="_blank" rel="noopener">นำทางด้วย Google Maps</a>
    <p class="updated">อัปเดตล่าสุด ${thaiDate(p.updated_at)}</p>`;
}

// แสดง/ซ่อนการ์ด
const card = document.getElementById("card");
const cardBody = document.getElementById("card-body");

function showCard(p) {
  cardBody.innerHTML = p.kind === "dorm" ? dormCard(p) : foodCard(p);
  card.hidden = false;
  card.scrollTop = 0;
}
document.getElementById("card-close").addEventListener("click", () => { card.hidden = true; });
map.on("click", () => { card.hidden = true; });

// 6) ตรวจว่าสถานที่หนึ่งผ่านตัวกรองทั้งหมดหรือไม่
function matches(p) {
  if (filters.kind !== "all" && p.kind !== filters.kind) return false;
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

// 7) แสดงผล: หมุดบนแผนที่ + รายการด้านข้าง
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("count");

function render() {
  const shown = places.filter(matches).sort((a, b) => a.dist - b.dist);

  markerLayer.clearLayers();
  shown.forEach(p => markerLayer.addLayer(p.marker));

  countEl.textContent = `พบ ${shown.length} แห่ง`;
  resultsEl.innerHTML = "";

  if (shown.length === 0) {
    resultsEl.innerHTML = `<li class="empty">ไม่พบสถานที่ที่ตรงกับเงื่อนไข<br>ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา</li>`;
    return;
  }

  shown.forEach(p => {
    const meta = p.kind === "dorm"
      ? `หอ${p.type} · ${p.price.toLocaleString()} บาท/เดือน · ${p.vacant > 0 ? `ว่าง ${p.vacant} ห้อง` : "เต็ม"}`
      : `${p.category} · ${p.price_range}`;

    const li = document.createElement("li");
    li.innerHTML = `
      <button class="result">
        <span class="dot ${p.kind}"></span>
        <span class="name">${p.name}</span>
        <span class="dist">${shortDistance(p.dist)}</span>
        <span class="meta">${meta}</span>
      </button>`;
    li.querySelector("button").addEventListener("click", () => focusPlace(p));
    resultsEl.appendChild(li);
  });
}

// กดรายการแล้วเลื่อนแผนที่ไปที่สถานที่นั้นและเปิดการ์ด
function focusPlace(p) {
  setPanelOpen(false); // บนมือถือ ปิดแผงเพื่อให้เห็นแผนที่
  // เลื่อนจุดกึ่งกลางลงล่างเล็กน้อย ให้หมุดอยู่ช่วงบนของจอ ไม่โดนการ์ดบัง
  const zoom = 17;
  const shifted = map.project([p.lat, p.lng], zoom).add([0, map.getSize().y * 0.25]);
  map.flyTo(map.unproject(shifted, zoom), zoom, { duration: 0.6 });
  p.marker.openTooltip();
  showCard(p);
}

// 8) หมุดวิทยาลัย + วงรัศมี 500 ม. และ 1 กม.
L.marker([COLLEGE.lat, COLLEGE.lng], { icon: makeIcon("college") })
  .addTo(map)
  .bindTooltip(COLLEGE.name, { direction: "top", offset: [0, -24] });
L.circle([COLLEGE.lat, COLLEGE.lng], { radius: 500, color: "#0f5f8c", weight: 1, fillOpacity: 0.04 }).addTo(map);
L.circle([COLLEGE.lat, COLLEGE.lng], { radius: 1000, color: "#0f5f8c", weight: 1, dashArray: "4 6", fill: false }).addTo(map);

// โหลดข้อมูลที่พักและร้านอาหารจาก Supabase แล้วสร้างหมุด
async function loadPlaces() {
  countEl.textContent = "กำลังโหลดข้อมูล...";

  const [dormsRes, foodRes] = await Promise.all([
    db.from("dorms").select("*"),
    db.from("restaurants").select("*")
  ]);

  if (dormsRes.error || foodRes.error) {
    console.error(dormsRes.error || foodRes.error);
    countEl.textContent = "";
    resultsEl.innerHTML = `<li class="empty">โหลดข้อมูลไม่สำเร็จ<br>ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองรีเฟรชหน้าเว็บ</li>`;
    return;
  }

  const all = [
    ...dormsRes.data.map(p => ({ ...p, kind: "dorm" })),
    ...foodRes.data.map(p => ({ ...p, kind: "food" }))
  ];

  places = all.map(p => {
    p.dist = map.distance([COLLEGE.lat, COLLEGE.lng], [p.lat, p.lng]);
    p.marker = L.marker([p.lat, p.lng], { icon: makeIcon(p.kind) })
      .bindTooltip(p.name, { direction: "top", offset: [0, -24] })
      .on("click", () => showCard(p));
    return p;
  });

  render();
}

loadPlaces();

// 9) เชื่อมช่องค้นหาและตัวกรองเข้ากับ render()
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

// ปุ่มเลือกหมวด: ทั้งหมด / ที่พัก / ร้านอาหาร
const chips = document.querySelectorAll(".chip");

function setKind(kind) {
  filters.kind = kind;
  chips.forEach(b => b.classList.toggle("active", b.dataset.filter === kind));
  // ซ่อนตัวกรองของที่พักเมื่อดูเฉพาะร้านอาหาร
  dormFields.forEach(el => { el.hidden = kind === "food"; });
  card.hidden = true;
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

// 10) มือถือ: ปุ่มสลับระหว่างรายการกับแผนที่
const panel = document.getElementById("panel");
const toggleBtn = document.getElementById("toggle-view");

function setPanelOpen(open) {
  panel.classList.toggle("open", open);
  toggleBtn.textContent = open ? "🗺 แผนที่" : "☰ รายการ";
  toggleBtn.setAttribute("aria-expanded", open);
}
toggleBtn.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open")));
