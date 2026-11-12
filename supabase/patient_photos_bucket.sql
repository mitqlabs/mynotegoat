-- Patient photos for the patient-as-folder preview.
--
-- DO NOT run this on the production project ywmxnyacponabxgxjzed.
-- Apply it only on a Supabase branch or another disposable database.
--
-- The cropped square the office sees is stored on the person record in
-- workspace_kv (casemate.patient-folders.v1), so every case for that person
-- shows the same photo even before this bucket exists. This bucket is the
-- optional binary copy. Files are private and scoped to the signed-in user:
-- {auth.uid}/patient-photos/{folderId}.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-photos',
  'patient-photos',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "patient_photos_select_own" on storage.objects;
create policy "patient_photos_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "patient_photos_insert_own" on storage.objects;
create policy "patient_photos_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "patient_photos_update_own" on storage.objects;
create policy "patient_photos_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "patient_photos_delete_own" on storage.objects;
create policy "patient_photos_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
