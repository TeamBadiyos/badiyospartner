create policy "courier proofs rider insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'courier-proofs'
  and exists (
    select 1 from public.courier_orders o
    where o.id::text = (storage.foldername(name))[1]
      and o.assigned_expert_id = public.get_expert_id_for_auth(auth.uid())
  )
);

create policy "courier proofs rider read"
on storage.objects for select to authenticated
using (
  bucket_id = 'courier-proofs'
  and exists (
    select 1 from public.courier_orders o
    where o.id::text = (storage.foldername(name))[1]
      and o.assigned_expert_id = public.get_expert_id_for_auth(auth.uid())
  )
);

create policy "courier proofs staff read"
on storage.objects for select to authenticated
using (bucket_id = 'courier-proofs' and public.courier_is_ops_staff());