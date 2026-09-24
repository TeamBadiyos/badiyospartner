ALTER TABLE public.courier_orders
  ADD COLUMN IF NOT EXISTS merchant_order_id uuid REFERENCES public.merchant_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'parcel';
CREATE INDEX IF NOT EXISTS courier_orders_merchant_order_idx ON public.courier_orders(merchant_order_id);

CREATE OR REPLACE FUNCTION public.courier_rider_offers()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _eid uuid;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'offer_id', f.id, 'order_id', o.id, 'order_code', o.order_code,
      'expires_at', f.expires_at, 'distance_to_pickup_km', round(f.distance_km,2),
      'pickup_area', split_part(o.pickup_address, ',', 1),
      'drop_area', split_part(o.drop_address, ',', 1),
      'trip_km', o.distance_km,
      'earning', round(o.base_amount + o.extra_fee - (o.base_amount + o.extra_fee) * o.commission_pct / 100, 2),
      'parcel', (select name from public.courier_types where id = o.courier_type_id),
      'source', o.source,
      'store_name', (select m.store_name from public.merchant_orders mo join public.merchants m on m.id = mo.merchant_id where mo.id = o.merchant_order_id),
      'item_count', (select coalesce(sum(i.quantity),0) from public.merchant_order_items i where i.order_id = o.merchant_order_id)
    ) order by f.expires_at)
    from public.courier_offers f
    join public.courier_orders o on o.id = f.order_id
    where f.expert_id = _eid and f.status = 'pending' and f.expires_at > now()
      and o.status = 'SEARCHING'
  ), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.courier_store_info(_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  select * into _o from public.courier_orders where id=_order_id;
  if _eid is null or _o.id is null or _o.assigned_expert_id is distinct from _eid then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if _o.merchant_order_id is null then return null; end if;
  return (select jsonb_build_object(
      'store_name', m.store_name,
      'order_number', mo.order_number,
      'item_count', (select coalesce(sum(i.quantity),0) from public.merchant_order_items i where i.order_id = mo.id))
    from public.merchant_orders mo join public.merchants m on m.id = mo.merchant_id
    where mo.id = _o.merchant_order_id);
end $function$;
REVOKE ALL ON FUNCTION public.courier_store_info(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.courier_store_info(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.courier_mirror_store_status()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.merchant_order_id is not null and new.status in ('DELIVERED','COMPLETED')
     and old.status is distinct from new.status then
    begin
      update public.merchant_orders set status='completed' where id=new.merchant_order_id and status <> 'completed';
    exception when others then
      raise warning 'store status mirror failed: %', sqlerrm;
    end;
  end if;
  return new;
end $function$;
DROP TRIGGER IF EXISTS courier_mirror_store_status ON public.courier_orders;
CREATE TRIGGER courier_mirror_store_status AFTER UPDATE OF status ON public.courier_orders
  FOR EACH ROW EXECUTE FUNCTION public.courier_mirror_store_status();