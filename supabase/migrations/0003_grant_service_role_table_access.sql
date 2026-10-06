-- The server uses the service-role key for catalog and availability reads.
-- RLS bypass does not grant PostgreSQL table privileges to tables created by
-- the migration owner, so grant only the required public-schema access.
grant usage on schema public to service_role;
grant usage on type reservation_status, reservation_source to service_role;
grant select, insert, update, delete on table
  stores,
  customers,
  staff,
  services,
  staff_services,
  business_hours,
  reservations,
  availability_blocks
to service_role;
