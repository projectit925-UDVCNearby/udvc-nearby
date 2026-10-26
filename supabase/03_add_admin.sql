-- ===== เพิ่มแอดมิน =====
-- 1) สร้างผู้ใช้ใน Supabase: Authentication -> Users -> Add user (ติ๊ก Auto Confirm User)
-- 2) แก้อีเมลด้านล่างเป็นอีเมลของแอดมิน แล้วรันใน SQL Editor

insert into public.admins (user_id)
select id from auth.users where email = 'projectit925@gmail.com';
