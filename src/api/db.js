import { solicitar } from "./http";

/**
 * CAPA DE DATOS · Kronos (esquema V3, ver KRONOS_ESQUEMA_V3.sql)
 * ------------------------------------------------------------------
 * Las 16 tablas reales (nombres EXACTOS del diagrama):
 *   roles, usuarios, direcciones, clientes, proveedores, ordenesCompra,
 *   inventarios, alertas, movimientos, categorias, unidadVentas, marcas,
 *   ventas, detalleVentas, garantias, garantiaBitacoras
 *
 * Las páginas no hablan directo con esas tablas normalizadas: piden
 * "conjuntos" ya unidos (productos, movimientos, ordenes_compra,
 * pedidos_cliente, garantias, ...) con los campos que el front ya usaba.
 * Todo el JOIN vive aquí; y todas las ESCRITURAS también (más abajo).
 *
 * tipoMovimiento: 1 entrada manual · 2 salida manual · 3 entrada por orden
 * de compra · 4 salida por venta · 5 devolución por venta rechazada.
 */

export const TABLAS = {
  roles: "roles",
  usuarios: "usuarios",
  direcciones: "direcciones",
  clientes: "clientes",
  proveedores: "proveedores",
  ordenes: "ordenesCompra",
  inventarios: "inventarios",
  alertas: "alertas",
  movimientos: "movimientos",
  categorias: "categorias",
  unidades: "unidadVentas",
  marcas: "marcas",
  ventas: "ventas",
  detalles: "detalleVentas",
  garantias: "garantias",
  bitacoras: "garantiaBitacoras",
};

export const SIN_CATEGORIA = "Sin categoría";
export const TIPO_MOV = { ENTRADA: 1, SALIDA: 2, ENTRADA_ORDEN: 3, SALIDA_VENTA: 4, DEVOLUCION: 5 };

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const PAGINA = 1000;

/** Lee TODA una tabla (PostgREST devuelve 1000 filas por consulta). */
async function leerTodo(tabla) {
  let todas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase.from(tabla).select("*").range(desde, desde + PAGINA - 1);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < PAGINA) break;
  }
  return todas;
}

const mapaPor = (filas, clave) => new Map(filas.map((f) => [f[clave], f]));
const nombreCompleto = (u) => (u ? `${u.nombre || ""} ${u.apellidos || ""}`.trim() : "");
const aNumero = (v) => (v === null || v === undefined ? null : Number(v));
const limpiar = (v) => (typeof v === "string" ? v.trim() : v);
const vacioANull = (v) => {
  const t = limpiar(v);
  return t === "" || t === undefined ? null : t;
};

/** Solo dígitos de una cédula / NIT ("900.123.456-7" -> 9001234567). */
export function soloDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

function lanzar(error) {
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* LECTURAS (conjuntos ya unidos)                                      */
/* ------------------------------------------------------------------ */

/** inventarios + categorias + marcas + unidadVentas  ->  "productos" */
export async function cargarProductos() {
  const [inv, cats, marcas, unidades] = await Promise.all([
    leerTodo(TABLAS.inventarios),
    leerTodo(TABLAS.categorias),
    leerTodo(TABLAS.marcas),
    leerTodo(TABLAS.unidades),
  ]);
  const cat = mapaPor(cats, "idCategoria");
  const mar = mapaPor(marcas, "idMarca");
  const uni = mapaPor(unidades, "idUnidadVenta");

  return inv.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    nombre: i.nombre,
    categoria: cat.get(i.categoria_idCategoria)?.nombreCategoria || SIN_CATEGORIA,
    categoria_id: i.categoria_idCategoria,
    marca: mar.get(i.marca_idMarca)?.nombreMarca || "",
    marca_id: i.marca_idMarca,
    unidad: uni.get(i.unidadMedida_idUnidadMedida)?.nombreUnidadMedida || "",
    unidad_id: i.unidadMedida_idUnidadMedida,
    modelo: i.modelo || "",
    stock_actual: Number(i.stock ?? 0),
    umbral_minimo: Number(i.umbralMinimo ?? 0),
    precio: Number(i.precioVenta ?? 0),
    imagen: i.imagenProducto || null,
  }));
}

export async function cargarCategorias() {
  const cats = await leerTodo(TABLAS.categorias);
  return cats.map((c) => ({ id: c.idCategoria, nombre: c.nombreCategoria }));
}

export async function cargarMarcas() {
  const marcas = await leerTodo(TABLAS.marcas);
  return marcas.map((m) => ({ id: m.idMarca, nombre: m.nombreMarca }));
}

export async function cargarUnidades() {
  const unidades = await leerTodo(TABLAS.unidades);
  return unidades.map((u) => ({ id: u.idUnidadVenta, nombre: u.nombreUnidadMedida }));
}

/** Detalles de compra visibles para quien consulta (RPC con RLS por rol). */
async function cargarDetallesVisibles() {
  const { data, error } = await supabase.rpc("kronos_detalles_visibles");
  if (error) throw error;
  return data || [];
}

const codigoPedido = (idVenta) => `PED-${idVenta}`;

/** detalleVentas + ventas + clientes + usuarios  ->  "pedidos_cliente" (1 fila por producto) */
export async function cargarPedidosCliente() {
  const detalles = await cargarDetallesVisibles();
  return detalles.map((d) => ({
    id: d.idDetalleVenta,
    uid: `venta-${d.idDetalleVenta}`,
    origen: "cliente",
    venta_id: d.idVenta,
    codigo: codigoPedido(d.idVenta),
    producto_id: d.inventario,
    producto_nombre: d.nombreProducto,
    cantidad: Number(d.cantidad),
    precio_unitario: aNumero(d.precioUnitario),
    subtotal: aNumero(d.subTotal),
    cliente_id: d.idCliente,
    cliente_nombre: d.nombreCliente,
    cliente_correo: d.correoCliente,
    estado: d.estadoVenta,
    observacion: d.observacionVenta || "",
    metodo_pago: d.metodoPago,
    fecha: d.fechaVenta,
  }));
}

/** proveedores + usuarios + direcciones  ->  "proveedores" */
export async function cargarProveedores() {
  const [provs, usuarios, direcciones] = await Promise.all([
    leerTodo(TABLAS.proveedores),
    leerTodo(TABLAS.usuarios),
    leerTodo(TABLAS.direcciones),
  ]);
  const usu = mapaPor(usuarios, "identificacion");
  const dir = mapaPor(direcciones, "idDireccion");

  return provs.map((p) => {
    const u = usu.get(p.usuario_identificacion);
    const d = u ? dir.get(u.direccion_idDireccion) : null;
    return {
      id: p.idProveedor,
      usuario_id: p.usuario_identificacion,
      nombre: nombreCompleto(u) || "—",
      nombre_usuario: u?.nombre || "",
      apellidos_usuario: u?.apellidos || "",
      nit: String(p.usuario_identificacion),
      telefono: u?.telefono || "",
      direccion: d?.direccionCompleta || "",
      correo: u?.correoElectronico || "",
      tipo_producto: p.tipoProducto || "",
      tiene_cuenta: Boolean(u?.auth_id),
      activo: true,
    };
  });
}

/** ordenesCompra + inventarios + proveedores  ->  "ordenes_compra" (órdenes a proveedores) */
export async function cargarOrdenesCompra() {
  const [ordenes, inventarios, provs, usuarios] = await Promise.all([
    leerTodo(TABLAS.ordenes),
    leerTodo(TABLAS.inventarios),
    leerTodo(TABLAS.proveedores),
    leerTodo(TABLAS.usuarios),
  ]);
  const inv = mapaPor(inventarios, "id");
  const prov = mapaPor(provs, "idProveedor");
  const usu = mapaPor(usuarios, "identificacion");

  return ordenes.map((o) => {
    const p = prov.get(o.proveedor_idProveedor);
    return {
      id: o.idOrdenesCompra,
      uid: `orden-${o.idOrdenesCompra}`,
      origen: "interno",
      codigo: o.codigo,
      producto_id: o.inventario_codInventario,
      producto_nombre: inv.get(o.inventario_codInventario)?.nombre || "Material eliminado",
      cantidad: Number(o.cantidad),
      proveedor_id: o.proveedor_idProveedor,
      proveedor_nombre: p ? nombreCompleto(usu.get(p.usuario_identificacion)) : null,
      precio_unitario: aNumero(o.precioUnitario),
      estado: o.estado,
      observacion: o.observacion || "",
      fecha: o.fechaOrden,
    };
  });
}

/** Órdenes a proveedores + compras de clientes juntas  ->  "historial_compras" */
export async function cargarHistorialCompras() {
  const [ordenes, pedidos] = await Promise.all([cargarOrdenesCompra(), cargarPedidosCliente()]);
  return [...ordenes, ...pedidos];
}

const MOTIVO_POR_TIPO = {
  1: "Entrada de material",
  2: "Salida de material",
  3: "Entrada por orden de compra",
  4: "Venta en línea",
  5: "Devolución de stock (pedido rechazado)",
};

/** movimientos + inventarios + usuarios + detalleVentas  ->  "movimientos" */
export async function cargarMovimientos() {
  const [movs, inventarios, usuarios, detalles] = await Promise.all([
    leerTodo(TABLAS.movimientos),
    leerTodo(TABLAS.inventarios),
    leerTodo(TABLAS.usuarios),
    leerTodo(TABLAS.detalles),
  ]);
  const inv = mapaPor(inventarios, "id");
  const usu = mapaPor(usuarios, "identificacion");
  const det = mapaPor(detalles, "idDetalleVenta");

  return movs.map((m) => {
    const tipo = Number(m.tipoMovimiento);
    const detalle = m.detalleVenta_idDetalleVenta ? det.get(m.detalleVenta_idDetalleVenta) : null;
    const base = MOTIVO_POR_TIPO[tipo] || "Movimiento";
    const nombreProducto = inv.get(m.inventario_codInventario)?.nombre || "Material eliminado";
    const usuario = usu.get(m.usuario_identificacion);
    return {
      id: m.idMovimiento,
      producto_id: m.inventario_codInventario,
      producto_nombre: nombreProducto,
      tipo: [1, 3, 5].includes(tipo) ? "entrada" : "salida",
      tipo_movimiento: tipo,
      cantidad: Number(m.cantidad),
      precio_unitario: aNumero(m.precioUnitario),
      subtotal: aNumero(m.subtotal),
      motivo: detalle ? `${base} · ${codigoPedido(detalle.venta_idVenta)} · ${nombreProducto}` : `${base} · ${nombreProducto}`,
      responsable: usuario ? nombreCompleto(usuario) : "Sistema",
      fecha: m.fechaMovimiento,
    };
  });
}

/** alertas + inventarios  ->  "alertas" */
export async function cargarAlertas() {
  const [alertas, inventarios] = await Promise.all([leerTodo(TABLAS.alertas), leerTodo(TABLAS.inventarios)]);
  const inv = mapaPor(inventarios, "id");
  return alertas.map((a) => ({
    id: a.idalertas,
    estado: a.estado,
    mensaje: a.mensaje,
    fecha: a.fechaAlerta,
    producto_id: a["inventario_codInventario"],
    producto_nombre: inv.get(a["inventario_codInventario"])?.nombre || "Material eliminado",
  }));
}

/* ---- Garantías: comentario de bitácora con formato "[Autor] texto" ---- */

function parsearComentario(comentario) {
  const texto = String(comentario || "");
  const m = texto.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  return m ? { autor: m[1], resto: m[2] } : { autor: "Sistema", resto: texto };
}

/** garantias + garantiaBitacoras + detalleVentas...  ->  "garantias" */
export async function cargarGarantias() {
  const [garantias, bitacoras, detalles] = await Promise.all([
    leerTodo(TABLAS.garantias),
    leerTodo(TABLAS.bitacoras),
    cargarDetallesVisibles(),
  ]);
  const det = mapaPor(detalles, "idDetalleVenta");

  const bitPorGarantia = new Map();
  bitacoras.forEach((b) => {
    const lista = bitPorGarantia.get(b.garantia_idGarantia) || [];
    lista.push(b);
    bitPorGarantia.set(b.garantia_idGarantia, lista);
  });

  return garantias.map((g) => {
    const d = det.get(g.detalleventa_idDetalleVenta);
    const filas = (bitPorGarantia.get(g.idGarantia) || []).sort(
      (a, b) => new Date(a.fechaRegistro) - new Date(b.fechaRegistro)
    );

    const bitacora = filas.map((b) => {
      const { autor, resto } = parsearComentario(b.comentario);
      const esSistema = autor === "Sistema";
      const [accion, ...detalle] = esSistema ? resto.split(" · ") : [`Observación de ${autor}`, resto];
      return {
        id: `bit-${b.idBitacoras}`,
        accion,
        estado: b.estado,
        fecha: b.fechaRegistro,
        responsable: autor,
        detalle: detalle.join(" · "),
        observacion: detalle.join(" · "),
      };
    });

    const observaciones = filas
      .map((b) => ({ b, ...parsearComentario(b.comentario) }))
      .filter((x) => x.autor !== "Sistema")
      .map((x) => ({
        id: `obs-${x.b.idBitacoras}`,
        texto: x.resto,
        autor: x.autor,
        responsable: x.autor,
        estado: x.b.estado,
        fecha: x.b.fechaRegistro,
      }));

    return {
      id: g.idGarantia,
      orden_id: g.detalleventa_idDetalleVenta,
      venta_id: d?.idVenta ?? null,
      numero_orden: d ? codigoPedido(d.idVenta) : `DET-${g.detalleventa_idDetalleVenta}`,
      cliente_id: d?.idCliente ?? null,
      cliente_nombre: d?.nombreCliente || "—",
      correo: d?.correoCliente || "",
      producto: d?.nombreProducto || "—",
      producto_id: d?.inventario ?? null,
      motivo: g.motivo || "",
      tipo_falla: g.tipoFalla || "",
      observacion: g.observacion || "",
      estado: g.estado,
      fecha: filas[0]?.fechaRegistro || g.fechaInicio,
      fecha_inicio: g.fechaInicio,
      fecha_fin: g.fechaFin,
      imagen_nombre: g.evidenciaImg || "",
      observaciones,
      bitacora,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Registro de "conjuntos" para useRealtimeTable                       */
/* ------------------------------------------------------------------ */

/** nombre virtual -> { cargar, tablas reales que lo alimentan (realtime) } */
export const CONJUNTOS = {
  productos: { cargar: cargarProductos, tablas: [TABLAS.inventarios, TABLAS.categorias, TABLAS.marcas, TABLAS.unidades] },
  categorias: { cargar: cargarCategorias, tablas: [TABLAS.categorias] },
  marcas: { cargar: cargarMarcas, tablas: [TABLAS.marcas] },
  unidades: { cargar: cargarUnidades, tablas: [TABLAS.unidades] },
  movimientos: {
    cargar: cargarMovimientos,
    tablas: [TABLAS.movimientos, TABLAS.inventarios, TABLAS.usuarios, TABLAS.detalles],
  },
  alertas: { cargar: cargarAlertas, tablas: [TABLAS.alertas, TABLAS.inventarios] },
  proveedores: { cargar: cargarProveedores, tablas: [TABLAS.proveedores, TABLAS.usuarios, TABLAS.direcciones] },
  ordenes_compra: {
    cargar: cargarOrdenesCompra,
    tablas: [TABLAS.ordenes, TABLAS.inventarios, TABLAS.proveedores, TABLAS.usuarios],
  },
  pedidos_cliente: {
    cargar: cargarPedidosCliente,
    tablas: [TABLAS.ventas, TABLAS.detalles, TABLAS.inventarios, TABLAS.clientes, TABLAS.usuarios],
  },
  historial_compras: {
    cargar: cargarHistorialCompras,
    tablas: [TABLAS.ordenes, TABLAS.ventas, TABLAS.detalles, TABLAS.inventarios, TABLAS.proveedores, TABLAS.clientes, TABLAS.usuarios],
  },
  garantias: {
    cargar: cargarGarantias,
    tablas: [TABLAS.garantias, TABLAS.bitacoras, TABLAS.detalles, TABLAS.ventas],
  },
};

/* ------------------------------------------------------------------ */
/* PERFIL / SESIÓN  (usuarios + roles + direcciones + clientes + proveedores) */
/* ------------------------------------------------------------------ */

/** Devuelve el perfil con la forma que usa el front, o null si la cuenta aún no tiene fila en `usuarios`. */
/* ------------------------------------------------------------------ */
/* PERFIL / SESIÓN - FASTAPI                                           */
/* ------------------------------------------------------------------ */

import { solicitar } from "./http";

/** Devuelve el perfil del usuario autenticado desde FastAPI. */
export async function cargarPerfil() {
  const usuario = await solicitar("/auth/me");

  const nombresRoles = {
    1: "cliente",
    2: "proveedor",
    3: "jefe",
    4: "empleado",
    5: "administrador",
  };

  return {
    id: usuario.identificacion,
    identificacion: usuario.identificacion,
    nombre: usuario.nombre,
    apellido: usuario.apellidos,
    telefono: usuario.telefono || "",
    correo: usuario.correoElectronico,
    rol: nombresRoles[Number(usuario.rol)] || null,
    direccion: "",
    localidad: "",
    barrio: "",
    ciudad: "",
    direccion_id: null,
    cliente_id: null,
    carrito_activo: false,
    proveedor_id: null,
  };
}

/** Obtiene el rol del usuario autenticado. */
export async function cargarRol() {
  const perfil = await cargarPerfil();
  return perfil?.rol || null;
}

/** Rol (en minúsculas) del usuario autenticado, o null. */
export async function cargarRol(authUser) {
  const perfil = await cargarPerfil(authUser);
  return perfil?.rol || null;
}

/** ¿Se puede registrar esta identificación / correo? -> 'ok' | 'identificacion' | 'correo' */
export async function registroDisponible(identificacion, correo) {
  const { data, error } = await supabase.rpc("kronos_registro_disponible", {
    p_identificacion: Number(soloDigitos(identificacion)),
    p_correo: correo,
  });
  lanzar(error);
  return data;
}

/** "Mi perfil" del cliente: actualiza usuarios + direcciones. */
export async function actualizarPerfil(perfil, form) {
  let direccionId = perfil.direccion_id;
  const datosDireccion = {
    barrio: vacioANull(form.barrio),
    localidad: vacioANull(form.localidad),
    direccionCompleta: vacioANull(form.direccion),
  };

  if (direccionId) {
    const { error } = await supabase.from(TABLAS.direcciones).update(datosDireccion).eq("idDireccion", direccionId);
    lanzar(error);
  } else {
    const { data, error } = await supabase
      .from(TABLAS.direcciones)
      .insert({ ...datosDireccion, ciudad: "Bogotá" })
      .select()
      .single();
    lanzar(error);
    direccionId = data.idDireccion;
  }

  const { error } = await supabase
    .from(TABLAS.usuarios)
    .update({
      nombre: limpiar(form.nombre),
      apellidos: limpiar(form.apellido) || "",
      telefono: vacioANull(form.telefono),
      direccion_idDireccion: direccionId,
    })
    .eq("identificacion", perfil.identificacion);
  lanzar(error);
}

/** clientes.carritoActivo: true mientras el cliente tiene productos en el carrito. */
export async function marcarCarritoActivo(clienteId, activo) {
  if (!clienteId) return;
  const { error } = await supabase.from(TABLAS.clientes).update({ carritoActivo: activo }).eq("idCliente", clienteId);
  if (error) console.error("No se pudo actualizar carritoActivo:", error.message);
}

/* ------------------------------------------------------------------ */
/* ESCRITURAS · catálogo (categorías, marcas, unidades, inventario)     */
/* ------------------------------------------------------------------ */

/** Busca por nombre (sin importar mayúsculas) en categorias / marcas / unidadVentas; si no existe, la crea. */
async function idPorNombre(tabla, columnaId, columnaNombre, nombre) {
  const limpio = limpiar(nombre);
  if (!limpio) return null;
  const { data: existente, error } = await supabase
    .from(tabla)
    .select(columnaId)
    .ilike(columnaNombre, limpio.replace(/[%_]/g, "\\$&"))
    .limit(1);
  lanzar(error);
  if (existente && existente.length > 0) return existente[0][columnaId];

  const { data: creado, error: errorInsert } = await supabase
    .from(tabla)
    .insert({ [columnaNombre]: limpio })
    .select(columnaId)
    .single();
  lanzar(errorInsert);
  return creado[columnaId];
}

export const idCategoria = (nombre) =>
  idPorNombre(TABLAS.categorias, "idCategoria", "nombreCategoria", nombre || SIN_CATEGORIA);
export const idMarca = (nombre) => idPorNombre(TABLAS.marcas, "idMarca", "nombreMarca", nombre);
export const idUnidad = (nombre) => idPorNombre(TABLAS.unidades, "idUnidadVenta", "nombreUnidadMedida", nombre);

export async function crearCategoria(nombre) {
  const { data, error } = await supabase
    .from(TABLAS.categorias)
    .insert({ nombreCategoria: limpiar(nombre) })
    .select()
    .single();
  if (error) throw error;
  return { id: data.idCategoria, nombre: data.nombreCategoria };
}

/** Productos -> "Sin categoría" y borra la categoría, en una transacción (RPC). */
export async function eliminarCategoria(id) {
  const { data, error } = await supabase.rpc("eliminar_categoria", { p_categoria: id });
  lanzar(error);
  return data ?? 0;
}

/**
 * Registra un movimiento de inventario. El stock lo ajusta un trigger de la
 * base de datos (nunca se escribe `stock` a mano), así queda siempre cuadrado.
 */
export async function registrarMovimiento({ productoId, tipo, cantidad, precioUnitario = null }) {
  const tipoMovimiento = tipo === "salida" ? TIPO_MOV.SALIDA : TIPO_MOV.ENTRADA;
  const { error } = await supabase.from(TABLAS.movimientos).insert({
    inventario_codInventario: productoId,
    tipoMovimiento,
    cantidad,
    precioUnitario,
  });
  lanzar(error);
}

/** Alta de un material. El stock inicial entra como movimiento de entrada. */
export async function crearProducto({ nombre, codigo, categoria, marca, unidad, modelo, precio, umbral = 5, stock = 0, imagen = null }) {
  const [categoriaId, marcaId, unidadId] = await Promise.all([idCategoria(categoria), idMarca(marca), idUnidad(unidad)]);
  const { data, error } = await supabase
    .from(TABLAS.inventarios)
    .insert({
      nombre: limpiar(nombre),
      codigo: vacioANull(codigo),
      modelo: vacioANull(modelo),
      precioVenta: Number(precio) || 0,
      umbralMinimo: Number(umbral) || 0,
      stock: 0,
      imagenProducto: imagen,
      categoria_idCategoria: categoriaId,
      marca_idMarca: marcaId,
      unidadMedida_idUnidadMedida: unidadId,
    })
    .select()
    .single();
  lanzar(error);

  if (Number(stock) > 0) {
    await registrarMovimiento({ productoId: data.id, tipo: "entrada", cantidad: Number(stock), precioUnitario: Number(precio) || 0 });
  }
  return data.id;
}

/**
 * Edición de un material. Si cambió el stock, se registra como movimiento de
 * ajuste (entrada/salida por la diferencia) en vez de pisar el valor.
 */
export async function actualizarProducto(actual, cambios) {
  const campos = {};
  if (cambios.nombre !== undefined) campos.nombre = limpiar(cambios.nombre);
  if (cambios.codigo !== undefined) campos.codigo = vacioANull(cambios.codigo);
  if (cambios.modelo !== undefined) campos.modelo = vacioANull(cambios.modelo);
  if (cambios.precio !== undefined) campos.precioVenta = Number(cambios.precio) || 0;
  if (cambios.umbral_minimo !== undefined) campos.umbralMinimo = Number(cambios.umbral_minimo) || 0;
  if (cambios.imagen !== undefined) campos.imagenProducto = cambios.imagen;
  if (cambios.categoria !== undefined) campos.categoria_idCategoria = await idCategoria(cambios.categoria);
  if (cambios.marca !== undefined) campos.marca_idMarca = await idMarca(cambios.marca);
  if (cambios.unidad !== undefined) campos.unidadMedida_idUnidadMedida = await idUnidad(cambios.unidad);

  if (Object.keys(campos).length > 0) {
    const { error } = await supabase.from(TABLAS.inventarios).update(campos).eq("id", actual.id);
    lanzar(error);
  }

  if (cambios.stock_actual !== undefined) {
    const delta = Number(cambios.stock_actual) - Number(actual.stock_actual || 0);
    if (delta !== 0) {
      await registrarMovimiento({
        productoId: actual.id,
        tipo: delta > 0 ? "entrada" : "salida",
        cantidad: Math.abs(delta),
        precioUnitario: Number(cambios.precio ?? actual.precio) || 0,
      });
    }
  }
}

export async function eliminarProducto(id) {
  const { data, error } = await supabase.from(TABLAS.inventarios).delete().eq("id", id).select();
  lanzar(error);
  if (!data || data.length === 0) {
    throw new Error("La base de datos no borró nada. Revisa que tu usuario sea jefe/administrador/empleado.");
  }
}

export async function guardarUmbral(id, umbral) {
  const { error } = await supabase.from(TABLAS.inventarios).update({ umbralMinimo: Number(umbral) }).eq("id", id);
  lanzar(error);
}

/** Alertas de stock: el jefe puede marcarlas como atendidas. */
export async function resolverAlerta(id) {
  const { error } = await supabase.from(TABLAS.alertas).update({ estado: "resuelta" }).eq("idalertas", id);
  lanzar(error);
}

/* ------------------------------------------------------------------ */
/* ESCRITURAS · proveedores y órdenes de compra                         */
/* ------------------------------------------------------------------ */

function separarNombre(texto) {
  const limpio = String(texto || "").trim().replace(/\s+/g, " ");
  if (limpio.length <= 45) return { nombre: limpio, apellidos: "" };
  const corte = limpio.lastIndexOf(" ", 45);
  const i = corte > 0 ? corte : 45;
  return { nombre: limpio.slice(0, i), apellidos: limpio.slice(i).trim().slice(0, 45) };
}

function argsProveedor(form) {
  const identificacion = Number(soloDigitos(form.nit));
  if (!identificacion) throw new Error("Escribe el NIT o la cédula del proveedor (solo números).");
  const { nombre, apellidos } = separarNombre(form.nombre);
  return {
    p_identificacion: identificacion,
    p_nombre: nombre,
    p_apellidos: apellidos,
    p_correo: form.correo,
    p_telefono: form.telefono,
    p_direccion: form.direccion,
    p_tipo_producto: form.tipo_producto,
  };
}

export async function crearProveedor(form) {
  const { error } = await supabase.rpc("crear_proveedor", argsProveedor(form));
  if (error) {
    if (error.code === "23505") throw new Error("Ya existe un usuario con esa identificación o ese correo.");
    throw error;
  }
}

export async function actualizarProveedor(idProveedor, form) {
  const { error } = await supabase.rpc("actualizar_proveedor", { p_proveedor: idProveedor, ...argsProveedor(form) });
  if (error) {
    if (error.code === "23505") throw new Error("Ya existe un usuario con esa identificación o ese correo.");
    throw error;
  }
}

export async function eliminarProveedor(idProveedor) {
  const { error } = await supabase.rpc("eliminar_proveedor", { p_proveedor: idProveedor });
  lanzar(error);
}

/** filas: [{ codigo, producto_id, cantidad, proveedor_id, precio_unitario }] */
export async function crearOrdenesCompra(filas) {
  const { error } = await supabase.from(TABLAS.ordenes).insert(
    filas.map((f) => ({
      codigo: f.codigo,
      cantidad: f.cantidad,
      precioUnitario: f.precio_unitario ?? null,
      estado: "pendiente",
      proveedor_idProveedor: f.proveedor_id,
      inventario_codInventario: f.producto_id,
    }))
  );
  lanzar(error);
}

/**
 * Cambia el estado de una fila del historial:
 *   origen "interno" -> ordenesCompra · origen "cliente" -> ventas (toda la compra).
 * Devuelve true si la base de datos realmente modificó algo.
 */
export async function actualizarEstadoCompra(fila, estado, observacion = "") {
  const esCliente = fila.origen === "cliente";
  const consulta = esCliente
    ? supabase.from(TABLAS.ventas).update({ estado, observacion }).eq("idVenta", fila.venta_id)
    : supabase.from(TABLAS.ordenes).update({ estado, observacion }).eq("idOrdenesCompra", fila.id);
  const { data, error } = await consulta.select();
  lanzar(error);
  return Boolean(data && data.length > 0);
}

/* ------------------------------------------------------------------ */
/* ESCRITURAS · ventas del cliente                                      */
/* ------------------------------------------------------------------ */

/** items: [{ id, cantidad }]. Devuelve el id de la venta creada. */
export async function registrarVenta(items, metodoPago = "Contra entrega") {
  const { data, error } = await supabase.rpc("registrar_venta", {
    p_items: items.map((i) => ({ id: i.id, cantidad: i.cantidad })),
    p_metodo_pago: metodoPago,
    p_comprobante: null,
  });
  lanzar(error);
  return data;
}

/* ------------------------------------------------------------------ */
/* ESCRITURAS · garantías y bitácora                                    */
/* ------------------------------------------------------------------ */

/** Anota una observación en la bitácora de la garantía: "[Autor] texto". */
export async function anotarBitacora(idGarantia, autor, texto, estado) {
  const limpio = limpiar(texto);
  if (!limpio) return;
  const { error } = await supabase.from(TABLAS.bitacoras).insert({
    garantia_idGarantia: idGarantia,
    estado,
    comentario: `[${autor}] ${limpio}`,
  });
  lanzar(error);
}

export async function radicarGarantia({ detalleId, tipoFalla, motivo, observacion, evidencia, autor }) {
  const { data, error } = await supabase
    .from(TABLAS.garantias)
    .insert({
      detalleventa_idDetalleVenta: detalleId,
      tipoFalla: vacioANull(tipoFalla),
      motivo: vacioANull(motivo),
      observacion: vacioANull(observacion),
      evidenciaImg: vacioANull(evidencia),
      estado: "pendiente",
    })
    .select()
    .single();
  lanzar(error);
  await anotarBitacora(data.idGarantia, autor, observacion, "pendiente");
  return data.idGarantia;
}

/** cambios: { estado?, motivo?, observacion?, evidencia? } + nota opcional para la bitácora. */
export async function actualizarGarantia(id, cambios, { autor, nota } = {}) {
  const campos = {};
  if (cambios.estado !== undefined) campos.estado = cambios.estado;
  if (cambios.motivo !== undefined) campos.motivo = vacioANull(cambios.motivo);
  if (cambios.observacion !== undefined) campos.observacion = vacioANull(cambios.observacion);
  if (cambios.evidencia !== undefined) campos.evidenciaImg = vacioANull(cambios.evidencia);

  if (Object.keys(campos).length > 0) {
    const { data, error } = await supabase.from(TABLAS.garantias).update(campos).eq("idGarantia", id).select();
    lanzar(error);
    if (!data || data.length === 0) {
      throw new Error("La base de datos no aplicó el cambio (0 filas). Revisa tus permisos sobre la garantía.");
    }
  }
  if (nota) await anotarBitacora(id, autor || "Sistema", nota, cambios.estado);
}

export async function eliminarGarantia(id) {
  const { error } = await supabase.from(TABLAS.garantias).delete().eq("idGarantia", id);
  lanzar(error);
}
