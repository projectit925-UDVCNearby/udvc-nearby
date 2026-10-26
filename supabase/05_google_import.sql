-- ===== รองรับข้อมูลตั้งต้นจาก Google Maps (ดึงผ่าน Apify) =====
-- Google ไม่มีค่าห้อง ประเภทหอ หรือจำนวนห้องว่าง จึงให้ช่องเหล่านี้เว้นว่างได้
-- หน้าเว็บจะแสดง "รอข้อมูล" จนกว่าทีมจะกรอกผ่านหน้าแอดมิน

alter table public.dorms alter column price drop not null;      -- ว่าง = ยังไม่ทราบค่าห้อง
alter table public.dorms alter column type drop not null;       -- ว่าง = ยังไม่ทราบว่าเป็นหอชาย/หญิง/รวม
alter table public.dorms alter column vacant drop not null;     -- ว่าง = ยังไม่ทราบจำนวนห้องว่าง
alter table public.dorms alter column vacant drop default;

-- ร้านอาหารมีเบอร์โทรด้วย (หอพักมีอยู่แล้ว)
alter table public.restaurants add column phone text;

-- ที่มาของข้อมูล: 'google_maps' = ข้อมูลตั้งต้นจาก Google Maps (ใช้แสดงเครดิตรูป)
-- google_place_id ใช้กันนำเข้าซ้ำ
alter table public.dorms add column source text;
alter table public.dorms add column google_place_id text unique;
alter table public.restaurants add column source text;
alter table public.restaurants add column google_place_id text unique;
