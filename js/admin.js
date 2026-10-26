// ===== UDVC Nearby: หน้าแอดมิน =====
// ขั้นตอน: ล็อกอิน -> ตรวจว่าเป็นแอดมิน -> แสดงตารางข้อมูล -> เพิ่ม / แก้ไข / ลบ / อัปโหลดรูป
// (ค่า db และ COLLEGE มาจากไฟล์ js/supabase-config.js)
// กฎความปลอดภัยจริงอยู่ในฐานข้อมูล (RLS) หน้านี้แค่ช่วยให้กรอกข้อมูลได้สะดวก

const TABLES = { dorm: "dorms", food: "restaurants" };
const FACILITIES = ["แอร์", "พัดลม", "WiFi", "ที่จอดมอเตอร์ไซค์", "ที่จอดรถยนต์", "กล้องวงจรปิด",
                    "คีย์การ์ด", "เครื่องซักผ้า", "ตู้น้ำ", "ลิฟต์", "เฟอร์นิเจอร์"];
const BUCKET = "photos";

let currentKind = "dorm";   // ตารางที่กำลังดู
let rows = [];              // ข้อมูลในตารางปัจจุบัน
let editing = null;         // แถวที่กำลังแก้ (null = เพิ่มใหม่)
let photos = [];            // ลิงก์รูปในฟอร์ม
let removedPhotos = [];     // รูปที่กดลบในฟอร์ม (ลบจริงตอนกดบันทึก)

const $ = id => document.getElementById(id);

// กันข้อความแปลกๆ ถูกแปลงเป็น HTML
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setMsg(el, text, type = "") {
  el.textContent = text;
  el.className = "msg" + (type ? " " + type : "");
}

function today() {
  return new Date().toLocaleDateString("sv-SE"); // รูปแบบ YYYY-MM-DD ตามเวลาเครื่อง
}

function thaiDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${Number(y) + 543}`;
}

// ===== 1) ล็อกอิน / ออกจากระบบ =====
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  setMsg($("login-msg"), "กำลังเข้าสู่ระบบ...");
  const { error } = await db.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-password").value
  });
  if (error) {
    setMsg($("login-msg"), "อีเมลหรือรหัสผ่านไม่ถูกต้อง", "error");
    return;
  }
  $("login-password").value = "";
  await showView();
});

$("logout").addEventListener("click", async () => {
  await db.auth.signOut();
  await showView();
});

// ตรวจสถานะล็อกอินแล้วเลือกว่าจะแสดงหน้าไหน
async function showView() {
  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    $("login-view").hidden = false;
    $("admin-view").hidden = true;
    $("logout").hidden = true;
    return;
  }

  // ล็อกอินแล้ว แต่ต้องอยู่ในตาราง admins ด้วย
  const { data: admin } = await db.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
  if (!admin) {
    await db.auth.signOut();
    $("login-view").hidden = false;
    $("admin-view").hidden = true;
    $("logout").hidden = true;
    setMsg($("login-msg"), "บัญชีนี้ยังไม่ได้รับสิทธิ์แอดมิน ติดต่อหัวหน้าทีม", "error");
    return;
  }

  $("login-view").hidden = true;
  $("admin-view").hidden = false;
  $("logout").hidden = false;
  await loadRows();
  updatePendingCount();
}

// ===== 2) โหลดและแสดงตาราง =====
async function loadRows() {
  if (currentKind === "review") return loadReviews();
  setMsg($("list-msg"), "กำลังโหลด...");
  const { data, error } = await db.from(TABLES[currentKind]).select("*").order("name");
  if (error) {
    setMsg($("list-msg"), "โหลดข้อมูลไม่สำเร็จ: " + error.message, "error");
    return;
  }
  rows = data;
  setMsg($("list-msg"), "");
  renderRows();
}

function renderRows() {
  if (currentKind === "review") return renderReviews();
  const q = $("admin-q").value.trim().toLowerCase();
  const shown = rows.filter(r => r.name.toLowerCase().includes(q));

  $("list-head").innerHTML = currentKind === "dorm"
    ? `<tr><th>รูป</th><th>ชื่อหอ</th><th>ประเภท</th><th>ค่าห้อง</th><th>ห้องว่าง</th><th class="col-hide">อัปเดต</th><th></th></tr>`
    : `<tr><th>รูป</th><th>ชื่อร้าน</th><th>ประเภทอาหาร</th><th>ราคา</th><th class="col-hide">อัปเดต</th><th></th></tr>`;

  const body = $("list-body");
  if (shown.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty">ยังไม่มีข้อมูล กด "+ เพิ่มข้อมูล" เพื่อเริ่ม</td></tr>`;
    return;
  }

  body.innerHTML = shown.map(r => {
    const thumb = r.photos.length
      ? `<img class="thumb" src="${esc(r.photos[0])}" alt="">`
      : `<span class="thumb"></span>`;
    const cols = currentKind === "dorm"
      ? `<td>${esc(r.type)}</td><td class="num">${r.price.toLocaleString()} บ.</td><td class="num">${r.vacant}</td>`
      : `<td>${esc(r.category)}</td><td class="num">${esc(r.price_range)}</td>`;
    return `
      <tr>
        <td>${thumb}</td>
        <td>${esc(r.name)}</td>
        ${cols}
        <td class="num col-hide">${thaiDate(r.updated_at)}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">แก้ไข</button>
          <button class="btn small danger" data-delete="${r.id}">ลบ</button>
        </td>
      </tr>`;
  }).join("");
}

$("admin-q").addEventListener("input", renderRows);

// แท็บ ที่พัก / ร้านอาหาร
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    currentKind = tab.dataset.kind;
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
    $("admin-q").value = "";
    // แท็บรีวิว: ไม่มีปุ่มเพิ่มข้อมูล (รีวิวมาจากผู้ใช้)
    $("add-btn").hidden = currentKind === "review";
    $("admin-q").placeholder = currentKind === "review" ? "ค้นหาชื่อสถานที่ / ผู้รีวิว / ข้อความ" : "ค้นหาชื่อ";
    loadRows();
  });
});

// ปุ่มในตาราง: แก้ไข / ลบ / อนุมัติรีวิว / ซ่อนรีวิว / ลบรีวิว
$("list-body").addEventListener("click", e => {
  const d = e.target.dataset;
  const find = id => rows.find(r => r.id === Number(id));
  if (d.edit) openEditor(find(d.edit));
  if (d.delete) deleteRow(find(d.delete));
  if (d.approve) setApproved(find(d.approve), true);
  if (d.hide) setApproved(find(d.hide), false);
  if (d.deleteReview) deleteReview(find(d.deleteReview));
});

// ===== รีวิว: ตรวจ อนุมัติ ซ่อน ลบ =====
async function loadReviews() {
  setMsg($("list-msg"), "กำลังโหลด...");
  // ดึงชื่อที่พัก/ร้านมาด้วย (เชื่อมผ่าน foreign key)
  const { data, error } = await db.from("reviews")
    .select("*, dorms(name), restaurants(name)")
    .order("approved")                              // รอตรวจขึ้นก่อน
    .order("created_at", { ascending: false });     // ใหม่สุดก่อน
  if (error) {
    setMsg($("list-msg"), "โหลดรีวิวไม่สำเร็จ: " + error.message, "error");
    return;
  }
  rows = data;
  setMsg($("list-msg"), "");
  renderReviews();
  updatePendingCount();
}

function renderReviews() {
  const q = $("admin-q").value.trim().toLowerCase();
  const placeName = r => (r.dorms ? r.dorms.name : r.restaurants?.name) || "-";
  const shown = rows.filter(r =>
    [placeName(r), r.author_name, r.comment].join(" ").toLowerCase().includes(q));

  $("list-head").innerHTML =
    `<tr><th>สถานะ</th><th>สถานที่</th><th>ดาว</th><th>รีวิว</th><th class="col-hide">วันที่</th><th></th></tr>`;

  if (shown.length === 0) {
    $("list-body").innerHTML = `<tr><td colspan="6" class="empty">ยังไม่มีรีวิว</td></tr>`;
    return;
  }

  $("list-body").innerHTML = shown.map(r => `
    <tr class="${r.approved ? "" : "pending"}">
      <td>${r.approved ? `<span class="status ok">แสดงอยู่</span>` : `<span class="status wait">รอตรวจ</span>`}</td>
      <td>${r.dorms ? "🏠" : "🍜"} ${esc(placeName(r))}</td>
      <td class="num stars">${"★".repeat(r.stars)}<span class="dim">${"★".repeat(5 - r.stars)}</span></td>
      <td class="comment"><b>${esc(r.author_name)}</b><br>${esc(r.comment)}</td>
      <td class="num col-hide">${thaiDate(r.created_at.slice(0, 10))}</td>
      <td class="actions">
        ${r.approved
          ? `<button class="btn small" data-hide="${r.id}">ซ่อน</button>`
          : `<button class="btn small primary" data-approve="${r.id}">อนุมัติ</button>`}
        <button class="btn small danger" data-delete-review="${r.id}">ลบ</button>
      </td>
    </tr>`).join("");
}

async function setApproved(review, approved) {
  const { error } = await db.from("reviews").update({ approved }).eq("id", review.id);
  if (error) {
    setMsg($("list-msg"), "บันทึกไม่สำเร็จ: " + error.message, "error");
    return;
  }
  setMsg($("list-msg"), approved ? "อนุมัติรีวิวแล้ว แสดงบนหน้าเว็บ" : "ซ่อนรีวิวแล้ว", "ok");
  await loadReviews();
}

async function deleteReview(review) {
  if (!confirm(`ลบรีวิวของ "${review.author_name}" ใช่ไหม?\nลบแล้วกู้คืนไม่ได้`)) return;
  const { error } = await db.from("reviews").delete().eq("id", review.id);
  if (error) {
    setMsg($("list-msg"), "ลบไม่สำเร็จ: " + error.message, "error");
    return;
  }
  setMsg($("list-msg"), "ลบรีวิวแล้ว", "ok");
  await loadReviews();
}

// จำนวนรีวิวที่รอตรวจ แสดงเป็นตัวเลขบนแท็บ
async function updatePendingCount() {
  const { count } = await db.from("reviews").select("id", { count: "exact", head: true }).eq("approved", false);
  const badge = $("pending-count");
  badge.hidden = !count;
  badge.textContent = count || "";
}

// ===== 3) ลบข้อมูล =====
async function deleteRow(row) {
  if (!confirm(`ลบ "${row.name}" ใช่ไหม?\nลบแล้วกู้คืนไม่ได้`)) return;

  const { error } = await db.from(TABLES[currentKind]).delete().eq("id", row.id);
  if (error) {
    setMsg($("list-msg"), "ลบไม่สำเร็จ: " + error.message, "error");
    return;
  }
  await removeFromStorage(row.photos);
  setMsg($("list-msg"), `ลบ "${row.name}" แล้ว`, "ok");
  await loadRows();
}

// ===== 4) ฟอร์มเพิ่ม / แก้ไข =====
const form = $("edit-form");
const dialog = $("editor");

// แผนที่เล็กสำหรับเลือกตำแหน่ง
let pickMap = null;
let pickMarker = null;

function setPoint(lat, lng, pan = true) {
  form.lat.value = Number(lat).toFixed(6);
  form.lng.value = Number(lng).toFixed(6);
  if (pickMarker) pickMarker.setLatLng([lat, lng]);
  else pickMarker = L.marker([lat, lng], { draggable: true })
    .on("dragend", e => setPoint(e.target.getLatLng().lat, e.target.getLatLng().lng, false))
    .addTo(pickMap);
  if (pan) pickMap.setView([lat, lng], Math.max(pickMap.getZoom(), 17));
}

function initPickMap() {
  if (pickMap) return;
  pickMap = L.map("pick-map").setView([COLLEGE.lat, COLLEGE.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; ผู้ร่วมพัฒนา OpenStreetMap"
  }).addTo(pickMap);
  L.circleMarker([COLLEGE.lat, COLLEGE.lng], { radius: 6, color: "#0f5f8c" })
    .bindTooltip(COLLEGE.name).addTo(pickMap);
  pickMap.on("click", e => setPoint(e.latlng.lat, e.latlng.lng, false));
}

// วางพิกัดแบบ "17.41245, 102.77780" ที่คัดลอกจาก Google Maps
$("paste-coords").addEventListener("input", e => {
  const m = e.target.value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (m) setPoint(Number(m[1]), Number(m[2]));
});
["lat", "lng"].forEach(name => form[name].addEventListener("change", () => {
  if (form.lat.value && form.lng.value) setPoint(form.lat.value, form.lng.value);
}));

// สร้างช่องติ๊กสิ่งอำนวยความสะดวก
$("facility-checks").innerHTML = FACILITIES
  .map(f => `<label><input type="checkbox" value="${f}"> ${f}</label>`).join("");

function openEditor(row) {
  editing = row || null;
  removedPhotos = [];
  photos = row ? [...row.photos] : [];
  form.reset();
  setMsg($("edit-msg"), "");
  $("photo-input").value = "";
  $("paste-coords").value = "";

  const kindName = currentKind === "dorm" ? "ที่พัก" : "ร้านอาหาร";
  $("edit-title").textContent = row ? `แก้ไข${kindName}` : `เพิ่ม${kindName}`;

  // แสดงเฉพาะช่องของประเภทที่กำลังแก้ และตั้ง required ให้ถูกช่อง
  document.querySelectorAll(".fields").forEach(div => {
    const active = div.dataset.kind === currentKind;
    div.hidden = !active;
    div.querySelectorAll("input, select, textarea").forEach(el => { el.disabled = !active; });
  });
  form.price.required = currentKind === "dorm";
  form.category.required = currentKind === "food";

  // ใส่ค่าเดิมลงฟอร์ม
  if (row) {
    for (const [key, value] of Object.entries(row)) {
      const el = form.elements[key];
      if (!el || el instanceof RadioNodeList) continue;
      if (key === "menu") el.value = value.join("\n");
      else if (Array.isArray(value)) continue;
      else el.value = value ?? "";
    }
    if (currentKind === "dorm") {
      const extra = row.facilities.filter(f => !FACILITIES.includes(f));
      document.querySelectorAll("#facility-checks input").forEach(c => { c.checked = row.facilities.includes(c.value); });
      $("facility-extra").value = extra.join(", ");
    }
  } else {
    form.vacant.value = 0;
  }
  form.updated_at.value = today(); // บันทึกครั้งนี้ถือว่าข้อมูลอัปเดตวันนี้ (แก้ได้)

  renderPhotos();
  dialog.showModal();

  // แผนที่ต้องสร้างหลัง dialog แสดงแล้ว ไม่งั้นขนาดผิด
  initPickMap();
  pickMap.invalidateSize();
  if (row) setPoint(row.lat, row.lng);
  else {
    if (pickMarker) { pickMarker.remove(); pickMarker = null; }
    pickMap.setView([COLLEGE.lat, COLLEGE.lng], 16);
  }
}

$("add-btn").addEventListener("click", () => openEditor(null));
$("edit-cancel").addEventListener("click", () => dialog.close());

// ===== 5) รูปภาพ =====
function renderPhotos() {
  $("photo-list").innerHTML = photos.map((url, i) => `
    <div class="photo">
      <img src="${esc(url)}" alt="รูปที่ ${i + 1}">
      <button type="button" data-remove="${i}" aria-label="ลบรูปที่ ${i + 1}">✕</button>
    </div>`).join("");
}

$("photo-list").addEventListener("click", e => {
  const i = e.target.dataset.remove;
  if (i === undefined) return;
  removedPhotos.push(photos[i]);
  photos.splice(Number(i), 1);
  renderPhotos();
});

// เลือกไฟล์แล้วอัปโหลดทันที ได้ลิงก์มาเก็บใน photos
$("photo-input").addEventListener("change", async e => {
  const files = [...e.target.files];
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      setMsg($("edit-msg"), `"${file.name}" ใหญ่เกิน 5 MB`, "error");
      continue;
    }
    setMsg($("edit-msg"), `กำลังอัปโหลด ${file.name}...`);
    const ext = file.name.split(".").pop().toLowerCase();
    const path = `${TABLES[currentKind]}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (error) {
      setMsg($("edit-msg"), "อัปโหลดไม่สำเร็จ: " + error.message, "error");
      continue;
    }
    photos.push(db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    renderPhotos();
    setMsg($("edit-msg"), "อัปโหลดแล้ว อย่าลืมกดบันทึก", "ok");
  }
  e.target.value = "";
});

// แปลงลิงก์รูปเป็น path ใน bucket แล้วลบออกจาก Storage
async function removeFromStorage(urls) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const paths = urls.filter(u => u.includes(marker)).map(u => decodeURIComponent(u.split(marker)[1]));
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
}

// ===== 6) บันทึก =====
function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function readForm() {
  const f = form.elements;
  const common = {
    name: f.name.value.trim(),
    lat: Number(f.lat.value),
    lng: Number(f.lng.value),
    photos,
    updated_at: f.updated_at.value || today()
  };

  if (currentKind === "dorm") {
    const checked = [...document.querySelectorAll("#facility-checks input:checked")].map(c => c.value);
    const extra = $("facility-extra").value.split(",").map(s => s.trim()).filter(Boolean);
    return {
      ...common,
      type: f.type.value,
      price: Number(f.price.value),
      electric: numberOrNull(f.electric.value),
      water: numberOrNull(f.water.value),
      water_unit: f.water_unit.value,
      deposit: f.deposit.value.trim() || null,
      vacant: Number(f.vacant.value || 0),
      facilities: [...new Set([...checked, ...extra])],
      curfew: f.curfew.value.trim() || null,
      phone: f.phone.value.trim() || null
    };
  }

  return {
    ...common,
    category: f.category.value.trim(),
    price_range: f.price_range.value.trim() || null,
    open_hours: f.open_hours.value.trim() || null,
    student_deal: f.student_deal.value.trim() || null,
    menu: f.menu.value.split("\n").map(s => s.trim()).filter(Boolean)
  };
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!form.lat.value || !form.lng.value) {
    setMsg($("edit-msg"), "กรุณาเลือกตำแหน่งบนแผนที่", "error");
    return;
  }

  const record = readForm();
  $("save-btn").disabled = true;
  setMsg($("edit-msg"), "กำลังบันทึก...");

  const table = db.from(TABLES[currentKind]);
  const { error } = editing
    ? await table.update(record).eq("id", editing.id)
    : await table.insert(record);

  $("save-btn").disabled = false;
  if (error) {
    setMsg($("edit-msg"), "บันทึกไม่สำเร็จ: " + error.message, "error");
    return;
  }

  await removeFromStorage(removedPhotos);
  dialog.close();
  setMsg($("list-msg"), `บันทึก "${record.name}" แล้ว`, "ok");
  await loadRows();
});

// เริ่มต้น: ตรวจว่าล็อกอินค้างไว้หรือไม่
showView();
