-- ============================================================================
-- KRONOS · PARCHE PARA EL ESQUEMA MYSQL EN SUPABASE
-- ----------------------------------------------------------------------------
-- Cómo usarlo: Supabase > SQL Editor > pegar TODO este archivo > Run.
-- Es IDEMPOTENTE: se puede ejecutar varias veces sin dañar nada.
--
-- Por qué existe:
--   Las tablas de Supabase ahora son las del esquema MySQL (inventarios,
--   ordenesCompra, proveedores, garantias, ...). Tal como vienen de MySQL,
--   tienen límites que el frontend no puede respetar y les falta algo mínimo:
--
--   1) varchar(45) en observacion, motivo, comentario, nombres, etc.  -> text
--   2) columnas NOT NULL que el flujo real deja vacías:
--        movimientos.detalleVenta_idDetalleVenta  (una ENTRADA no tiene venta)
--        garantias.detalleventa_idDetalleVenta    (garantía contra un proveedor)
--        garantias.evidenciaImg / inventarios.imagenProducto
--   3) columnas que el esquema MySQL no trae y las pantallas sí usan:
--        inventarios.ubicacion, movimientos.motivo/responsable,
--        ordenesCompra.observacion, ventas.observacion,
--        garantias.ordencompra_idOrdenesCompra / clienteNombre / correo,
--        categorias.descripcion / icono
--   4) tabla reportes_generados (historial de reportes; no existe en MySQL)
--   5) RLS / permisos: el login ahora lo hace FastAPI, no Supabase Auth, así
--      que las políticas viejas (auth.uid(), perfiles) ya no sirven. Se abren
--      las tablas al rol anon/authenticated. Ver ADVERTENCIA al final.
--   6) Realtime: se agregan las tablas a la publicación supabase_realtime.
--
-- NO depende de cómo se llamen tus tablas: encuentra "ordenesCompra",
-- "ordenescompra" u "ordenes_compra" sin importar mayúsculas ni guiones bajos.
-- ============================================================================

-- ---------- utilidades temporales (viven solo durante esta ejecución) -------

create or replace function pg_temp.tn(p_canon text) returns text
language sql stable as $f$
  select t.table_name::text
    from information_schema.tables t
   where t.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and lower(replace(t.table_name, '_', '')) = lower(replace(p_canon, '_', ''))
   limit 1
$f$;

create or replace function pg_temp.cn(p_tabla text, p_canon text) returns text
language sql stable as $f$
  select c.column_name::text
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_tabla
     and lower(replace(c.column_name, '_', '')) = lower(replace(p_canon, '_', ''))
   limit 1
$f$;

-- Nombre para una columna nueva, siguiendo el estilo de la tabla (camelCase o minúsculas).
create or replace function pg_temp.nuevo(p_tabla text, p_camel text) returns text
language sql immutable as $f$
  select case when p_tabla <> lower(p_tabla) then p_camel else lower(p_camel) end
$f$;

create or replace function pg_temp.k_texto(p_t text, p_c text) returns void
language plpgsql as $f$
declare
  t text := pg_temp.tn(p_t);
  c text;
begin
  if t is null then return; end if;
  c := pg_temp.cn(t, p_c);
  if c is null then return; end if;
  execute format('alter table public.%I alter column %I type text', t, c);
end
$f$;

create or replace function pg_temp.k_nulo(p_t text, p_c text) returns void
language plpgsql as $f$
declare
  t text := pg_temp.tn(p_t);
  c text;
begin
  if t is null then return; end if;
  c := pg_temp.cn(t, p_c);
  if c is null then return; end if;
  execute format('alter table public.%I alter column %I drop not null', t, c);
end
$f$;

create or replace function pg_temp.k_agregar(p_t text, p_c text, p_tipo text) returns void
language plpgsql as $f$
declare
  t text := pg_temp.tn(p_t);
begin
  if t is null then return; end if;
  if pg_temp.cn(t, p_c) is not null then return; end if;
  execute format('alter table public.%I add column %I %s', t, pg_temp.nuevo(t, p_c), p_tipo);
end
$f$;

create or replace function pg_temp.k_abrir(p_t text) returns void
language plpgsql as $f$
declare
  t text := pg_temp.tn(p_t);
begin
  if t is null then return; end if;
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists kronos_acceso_total on public.%I', t);
  execute format(
    'create policy kronos_acceso_total on public.%I for all to anon, authenticated using (true) with check (true)', t);
  execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
end
$f$;

-- ============================================================================
-- 0) Diagnóstico: avisa si falta alguna tabla del esquema MySQL
-- ============================================================================
do $d$
declare
  n text;
begin
  foreach n in array array[
    'categorias','direcciones','marcas','roles','unidadVentas','inventarios','usuarios',
    'alertas','clientes','proveedores','ordenesCompra','ventas','detalleVentas',
    'garantias','movimientos','garantiaBitacoras'
  ] loop
    if pg_temp.tn(n) is null then
      raise warning 'KRONOS: no existe la tabla "%" en el esquema public. Créala (ver migración de Alembic).', n;
    end if;
  end loop;
end
$d$;

-- ============================================================================
-- 1) varchar(45) -> text
-- ============================================================================
do $d$
begin
  perform pg_temp.k_texto('inventarios','codigo');
  perform pg_temp.k_texto('inventarios','nombre');
  perform pg_temp.k_texto('inventarios','modelo');
  perform pg_temp.k_texto('categorias','nombreCategoria');
  perform pg_temp.k_texto('marcas','nombreMarca');
  perform pg_temp.k_texto('ordenesCompra','codigo');
  perform pg_temp.k_texto('ordenesCompra','estado');
  perform pg_temp.k_texto('ventas','estado');
  perform pg_temp.k_texto('ventas','comprobantePago');
  perform pg_temp.k_texto('ventas','metodoPago');
  perform pg_temp.k_texto('garantias','estado');
  perform pg_temp.k_texto('garantias','observacion');
  perform pg_temp.k_texto('garantias','motivo');
  perform pg_temp.k_texto('garantias','tipoFalla');
  perform pg_temp.k_texto('garantiaBitacoras','estado');
  perform pg_temp.k_texto('garantiaBitacoras','comentario');
  perform pg_temp.k_texto('alertas','mensaje');
  perform pg_temp.k_texto('proveedores','tipoProducto');
  perform pg_temp.k_texto('usuarios','nombre');
  perform pg_temp.k_texto('usuarios','apellidos');
  perform pg_temp.k_texto('usuarios','correoElectronico');
  perform pg_temp.k_texto('direcciones','barrio');
  perform pg_temp.k_texto('direcciones','ciudad');
  perform pg_temp.k_texto('direcciones','localidad');
  perform pg_temp.k_texto('direcciones','direccionCompleta');
end
$d$;

-- ============================================================================
-- 2) Columnas que deben aceptar vacío
-- ============================================================================
do $d$
begin
  perform pg_temp.k_nulo('movimientos','detalleVenta_idDetalleVenta');
  perform pg_temp.k_nulo('garantias','detalleventa_idDetalleVenta');
  perform pg_temp.k_nulo('garantias','evidenciaImg');
  perform pg_temp.k_nulo('inventarios','imagenProducto');
end
$d$;

-- ============================================================================
-- 3) Columnas nuevas que usan las pantallas
-- ============================================================================
do $d$
begin
  perform pg_temp.k_agregar('inventarios','ubicacion','text');
  perform pg_temp.k_agregar('movimientos','motivo','text');
  perform pg_temp.k_agregar('movimientos','responsable','text');
  perform pg_temp.k_agregar('ordenesCompra','observacion','text');
  perform pg_temp.k_agregar('ventas','observacion','text');
  perform pg_temp.k_agregar('garantias','ordencompra_idOrdenesCompra','integer');
  perform pg_temp.k_agregar('garantias','clienteNombre','text');
  perform pg_temp.k_agregar('garantias','correo','text');
  perform pg_temp.k_agregar('categorias','descripcion','text');
  perform pg_temp.k_agregar('categorias','icono','text');
end
$d$;

-- ============================================================================
-- 4) Tabla de reportes generados (historial de reportes del jefe)
-- ============================================================================
create table if not exists public.reportes_generados (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,
  categoria   text,
  cantidad    integer,
  filtros     jsonb,
  valor_total numeric,
  fecha       timestamptz default now()
);
alter table public.reportes_generados add column if not exists filtros jsonb;
alter table public.reportes_generados add column if not exists valor_total numeric;

-- ============================================================================
-- 5) Roles base (los necesita crear proveedores desde el panel)
-- ============================================================================
do $d$
declare
  t text := pg_temp.tn('roles');
  c_id text;
  c_nom text;
  r record;
begin
  if t is null then return; end if;
  c_id := pg_temp.cn(t, 'idRol');
  c_nom := pg_temp.cn(t, 'nombreRol');
  if c_id is null or c_nom is null then return; end if;
  for r in
    select * from (values (1,'Cliente'),(2,'Proveedor'),(3,'Jefe'),(4,'Empleado'),(5,'Super administrador')) v(id, nom)
  loop
    execute format(
      'insert into public.%I (%I, %I) select $1::int, $2::text where not exists (select 1 from public.%I where %I = $1::int)',
      t, c_id, c_nom, t, c_id
    ) using r.id, r.nom;
  end loop;
end
$d$;

-- ============================================================================
-- 6) RLS y permisos
-- ============================================================================
do $d$
declare
  n text;
  t text;
  columnas text;
begin
  foreach n in array array[
    'categorias','direcciones','marcas','roles','unidadVentas','inventarios',
    'alertas','clientes','proveedores','ordenesCompra','ventas','detalleVentas',
    'garantias','movimientos','garantiaBitacoras','reportes_generados'
  ] loop
    perform pg_temp.k_abrir(n);
  end loop;

  -- usuarios: se puede leer/escribir TODO menos el hash de la contraseña.
  t := pg_temp.tn('usuarios');
  if t is not null then
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists kronos_acceso_total on public.%I', t);
    execute format(
      'create policy kronos_acceso_total on public.%I for all to anon, authenticated using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    select string_agg(format('%I', c.column_name), ', ')
      into columnas
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = t
       and lower(replace(c.column_name, '_', '')) <> 'contrasena';
    execute format('grant select (%s) on public.%I to anon, authenticated', columnas, t);
    execute format('grant insert, update, delete on public.%I to anon, authenticated', t);
  end if;

  -- sesionesUsuario (tokens del backend): NADIE desde el navegador.
  t := pg_temp.tn('sesionesUsuario');
  if t is not null then
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists kronos_acceso_total on public.%I', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end if;
end
$d$;

-- Los autonuméricos (serial/identity) necesitan permiso sobre su secuencia.
grant usage, select on all sequences in schema public to anon, authenticated;

-- ============================================================================
-- 7) Realtime
-- ============================================================================
do $d$
declare
  n text;
  t text;
begin
  foreach n in array array[
    'categorias','inventarios','movimientos','proveedores','usuarios',
    'ordenesCompra','ventas','detalleVentas','garantias','garantiaBitacoras','reportes_generados'
  ] loop
    t := pg_temp.tn(n);
    if t is not null and not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when others then
        raise warning 'KRONOS: no se pudo agregar % a supabase_realtime (%)', t, sqlerrm;
      end;
    end if;
  end loop;
end
$d$;

-- ============================================================================
-- 8) Limpieza: funciones del esquema viejo (los triggers murieron con las tablas viejas)
--    Ahora el descuento/devolución de stock lo hace el frontend (src/api/db).
-- ============================================================================
drop function if exists public.registrar_salida_pedido_cliente() cascade;
drop function if exists public.revertir_salida_pedido_rechazado() cascade;
drop function if exists public.eliminar_categoria(text, uuid[]);

-- ============================================================================
-- 9) Que PostgREST vea los cambios ya
-- ============================================================================
notify pgrst, 'reload schema';

-- ============================================================================
-- ADVERTENCIA DE SEGURIDAD
--   Con este parche, quien tenga la anon key (está dentro del JavaScript del
--   navegador) puede leer y escribir estas tablas. Sirve para desarrollo y
--   demostración. Para producción, el siguiente paso es mover las lecturas y
--   escrituras a endpoints de FastAPI (que sí valida el JWT) y volver a cerrar
--   las tablas. El hash de contraseñas (usuarios.contrasena) y las sesiones
--   (sesionesUsuario) YA quedan sin acceso desde el navegador.
-- ============================================================================
