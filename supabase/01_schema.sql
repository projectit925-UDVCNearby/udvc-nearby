-- ===== UDVC Nearby: โครงสร้างฐานข้อมูล (Supabase / PostgreSQL) =====
-- ตาราง dorms (ที่พัก), restaurants (ร้านอาหาร), admins (รายชื่อแอดมิน)
-- กฎความปลอดภัย: ทุกคนอ่านได้ / เพิ่ม แก้ ลบ ได้เฉพาะผู้ที่อยู่ในตาราง admins

-- ---------- ตารางที่พัก ----------
create table public.dorms (
  id          bigint generated always as identity primary key,
  name        text not null,                                   -- ชื่อหอ
  lat         double precision not null,                       -- ละติจูด
  lng         double precision not null,                       -- ลองจิจูด
  type        text not null check (type in ('ชาย', 'หญิง', 'รวม')), -- ประเภทหอ
  price       integer not null check (price >= 0),             -- ค่าห้อง บาท/เดือน
  electric    numeric(6,2),                                    -- ค่าไฟ บาท/หน่วย
  water       numeric(6,2),                                    -- ค่าน้ำ
  water_unit  text not null default 'หน่วย' check (water_unit in ('หน่วย', 'เดือน')), -- ค่าน้ำคิดต่อหน่วยหรือเหมาจ่ายต่อเดือน
  deposit     text,                                            -- ค่ามัดจำ
  vacant      integer not null default 0 check (vacant >= 0),  -- จำนวนห้องว่าง
  facilities  text[] not null default '{}',                    -- สิ่งอำนวยความสะดวก
  curfew      text,                                            -- เวลาปิดหอ
  phone       text,                                            -- เบอร์ติดต่อ
  photos      text[] not null default '{}',                    -- ลิงก์รูปภาพ
  updated_at  date not null default current_date,              -- วันที่อัปเดตข้อมูลล่าสุด
  created_at  timestamptz not null default now()
);

-- ---------- ตารางร้านอาหาร ----------
create table public.restaurants (
  id            bigint generated always as identity primary key,
  name          text not null,                 -- ชื่อร้าน
  lat           double precision not null,
  lng           double precision not null,
  category      text not null,                 -- ประเภทอาหาร
  price_range   text,                          -- ช่วงราคา เช่น 40–60 บาท
  menu          text[] not null default '{}',  -- เมนูเด่น + ราคา
  open_hours    text,                          -- เวลาเปิด-ปิด
  student_deal  text,                          -- โปรนักศึกษา
  photos        text[] not null default '{}',
  updated_at    date not null default current_date,
  created_at    timestamptz not null default now()
);

-- ---------- ตารางแอดมิน ----------
create table public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------- ฟังก์ชันตรวจว่าเป็นแอดมินหรือไม่ (อยู่ใน schema private ไม่เปิดออก API) ----------
create schema if not exists private;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- ---------- เปิด Row Level Security ----------
alter table public.dorms       enable row level security;
alter table public.restaurants enable row level security;
alter table public.admins      enable row level security;

-- ---------- สิทธิ์การเข้าถึงผ่าน Data API ----------
grant select on public.dorms, public.restaurants to anon, authenticated;
grant insert, update, delete on public.dorms, public.restaurants to authenticated;
grant select on public.admins to authenticated;

-- ---------- กฎ (policies) ----------
-- ทุกคนอ่านข้อมูลที่พักและร้านอาหารได้
create policy "ทุกคนอ่านที่พักได้" on public.dorms
  for select to anon, authenticated using (true);
create policy "ทุกคนอ่านร้านอาหารได้" on public.restaurants
  for select to anon, authenticated using (true);

-- เฉพาะแอดมินเพิ่ม แก้ ลบ ได้
create policy "แอดมินเพิ่มที่พัก" on public.dorms
  for insert to authenticated with check ((select private.is_admin()));
create policy "แอดมินแก้ที่พัก" on public.dorms
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "แอดมินลบที่พัก" on public.dorms
  for delete to authenticated using ((select private.is_admin()));

create policy "แอดมินเพิ่มร้านอาหาร" on public.restaurants
  for insert to authenticated with check ((select private.is_admin()));
create policy "แอดมินแก้ร้านอาหาร" on public.restaurants
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "แอดมินลบร้านอาหาร" on public.restaurants
  for delete to authenticated using ((select private.is_admin()));

-- ผู้ใช้ที่ล็อกอินแล้วดูได้แค่ว่าตัวเองเป็นแอดมินหรือไม่ (เพิ่มแอดมินทำผ่าน SQL Editor เท่านั้น)
create policy "ดูสถานะแอดมินของตัวเอง" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------- ที่เก็บรูป (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy "แอดมินอัปโหลดรูป" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and (select private.is_admin()));
create policy "แอดมินแก้รูป" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and (select private.is_admin()));
create policy "แอดมินลบรูป" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and (select private.is_admin()));

-- ---------- ปิดช่องโหว่ที่ Security Advisor เตือน ----------
-- ฟังก์ชัน rls_auto_enable ถูกสร้างโดย Supabase เมื่อติ๊ก "Enable automatic RLS"
-- ไม่ต้องให้คนภายนอกเรียกผ่าน API (event trigger ยังทำงานตามปกติ)
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
