-- ===== ตารางรีวิว =====
-- ผู้ใช้ทั่วไป (ไม่ต้องล็อกอิน) เขียนรีวิวได้ แต่รีวิวจะแสดงเมื่อแอดมินอนุมัติแล้วเท่านั้น
-- 1 รีวิวผูกกับที่พัก หรือ ร้านอาหาร อย่างใดอย่างหนึ่ง

create table public.reviews (
  id             bigint generated always as identity primary key,
  dorm_id        bigint references public.dorms (id) on delete cascade,       -- รีวิวที่พัก
  restaurant_id  bigint references public.restaurants (id) on delete cascade, -- หรือรีวิวร้านอาหาร
  author_name    text not null default 'ไม่ระบุชื่อ' check (char_length(author_name) between 1 and 40),
  stars          smallint not null check (stars between 1 and 5),             -- ให้ดาว 1–5
  comment        text not null check (char_length(comment) between 5 and 500),
  approved       boolean not null default false,                              -- แอดมินอนุมัติแล้วหรือยัง
  created_at     timestamptz not null default now(),
  constraint reviews_one_place check (num_nonnulls(dorm_id, restaurant_id) = 1)
);

create index reviews_dorm_id_idx on public.reviews (dorm_id);
create index reviews_restaurant_id_idx on public.reviews (restaurant_id);

alter table public.reviews enable row level security;

-- สิทธิ์: ทุกคนอ่านและเขียนรีวิวใหม่ได้ (เขียนได้เฉพาะบางคอลัมน์ ตั้ง approved เองไม่ได้)
grant select on public.reviews to anon, authenticated;
grant insert (dorm_id, restaurant_id, author_name, stars, comment) on public.reviews to anon, authenticated;
grant update (approved), delete on public.reviews to authenticated;

-- ผู้ใช้ทั่วไปเห็นเฉพาะรีวิวที่อนุมัติแล้ว
create policy "ทุกคนอ่านรีวิวที่อนุมัติแล้ว" on public.reviews
  for select to anon using (approved);
-- ผู้ที่ล็อกอิน: เห็นรีวิวที่อนุมัติแล้ว ส่วนแอดมินเห็นทั้งหมด
create policy "อ่านรีวิว (แอดมินเห็นทั้งหมด)" on public.reviews
  for select to authenticated using (approved or (select private.is_admin()));

-- ส่งรีวิวใหม่ได้ แต่ต้องยังไม่อนุมัติ
create policy "ทุกคนส่งรีวิวได้" on public.reviews
  for insert to anon, authenticated with check (approved = false);

-- แอดมินอนุมัติ / ซ่อน / ลบรีวิว
create policy "แอดมินอนุมัติรีวิว" on public.reviews
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "แอดมินลบรีวิว" on public.reviews
  for delete to authenticated using ((select private.is_admin()));

-- ---------- รีวิวตัวอย่าง (อนุมัติแล้ว) ----------
insert into public.reviews (dorm_id, author_name, stars, comment, approved)
select id, 'นักศึกษาปี 1 (ตัวอย่าง)', 5, 'ห้องสะอาด เจ้าของใจดี เดินไปวิทยาลัยใกล้มาก', true from public.dorms where name = 'หอพักตัวอย่าง A'
union all
select id, 'รุ่นพี่ ปวส. (ตัวอย่าง)', 4, 'ราคาโอเค แต่ช่วงเย็นน้ำไหลเบาไปหน่อย', true from public.dorms where name = 'หอพักตัวอย่าง A'
union all
select id, 'ไม่ระบุชื่อ', 3, 'ถูกดี แต่ห้องร้อนเพราะไม่มีแอร์', true from public.dorms where name = 'หอพักตัวอย่าง B';
insert into public.reviews (restaurant_id, author_name, stars, comment, approved)
select id, 'นักศึกษา IT (ตัวอย่าง)', 5, 'กะเพราอร่อย ให้เยอะ ราคานักศึกษา', true from public.restaurants where name = 'ร้านข้าวตัวอย่าง 1';
