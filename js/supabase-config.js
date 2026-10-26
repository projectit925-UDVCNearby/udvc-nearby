// ===== ค่าเชื่อมต่อ Supabase =====
// publishable key เปิดเผยในหน้าเว็บได้ ความปลอดภัยมาจากกฎ RLS ในฐานข้อมูล
// ห้ามใส่ secret key / service_role key ในไฟล์นี้เด็ดขาด
const SUPABASE_URL = "https://qefnjtofeazkiqaxwcjf.supabase.co";
const SUPABASE_KEY = "sb_publishable_sZD0QXvqNiXCC-oSAoOWQw_TtbQEI4Z";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ตำแหน่งวิทยาลัย (จุดกลางพื้นที่วิทยาลัยจาก OpenStreetMap)
const COLLEGE = {
  name: "วิทยาลัยอาชีวศึกษาอุดรธานี",
  lat: 17.41058,
  lng: 102.77959
};
