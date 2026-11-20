/**
 * ENTIDADES LÓGICAS  <->  TABLAS DEL ESQUEMA MYSQL (en Supabase)
 * ------------------------------------------------------------------
 * Las páginas del frontend se escribieron para un esquema "plano" de
 * Supabase (productos, ordenes_compra, garantias con observaciones JSON,
 * etc.). Ahora los datos viven en el esquema MySQL, que está normalizado
 * (inventarios + marcas + categorias, ventas + detalleVentas, usuarios +
 * proveedores + direcciones ...).
 *
 * En vez de reescribir cada pantalla, este archivo define, para cada
 * entidad que las páginas conocen, cómo:
 *   - leer     -> arma filas con la FORMA ANTIGUA (mismos nombres de campo)
 *   - insertar -> reparte una fila antigua entre las tablas nuevas
 *   - actualizar / eliminar
 *
 * Resumen de equivalencias:
 *
 *   productos        -> inventarios (+ categorias, marcas, unidadVentas)
 *   categorias       -> categorias
 *   movimientos      -> movimientos (+ inventarios, usuarios)
 *   proveedores      -> proveedores (+ usuarios, direcciones)
 *   ordenes_compra   -> ordenesCompra (origen "interno")
 *                       UNION detalleVentas + ventas (origen "cliente")
 *   garantias        -> garantias (+ garantiaBitacoras para observaciones/bitácora)
 *   perfiles         -> usuarios (+ direcciones)
 *
 * `reportes_generados` NO existe en el esquema MySQL; se sigue usando tal
 * cual (el parche SQL la crea).
 */

import { TablaFisica, aBytea, crearError, deBytea } from "./nucleo";

/* --------------------------- usuario en sesión -------------------------- */

/** La sesión vive en FastAPI (no en Supabase Auth); AuthContext avisa aquí quién es. */
export const sesion = { usuarioId: null };
export const fijarUsuarioActual = (identificacion) => {
  sesion.usuarioId = identificacion ?? null;
};

/* ---------------------------- tablas físicas --------------------------- */

const OPC = { opcional: true };

export const T = {
  categorias: new TablaFisica("categorias", {
    idCategoria: {},
    nombreCategoria: {},
    descripcion: OPC, // extensión (parche SQL)
    icono: OPC, // extensión (parche SQL)
  }),
  marcas: new TablaFisica("marcas", { idMarca: {}, nombreMarca: {} }),
  unidadVentas: new TablaFisica("unidadVentas", { idUnidadVenta: {}, nombreUnidadMedida: {} }),
  roles: new TablaFisica("roles", { idRol: {}, nombreRol: {} }),
  direcciones: new TablaFisica("direcciones", {
    idDireccion: {},
    barrio: {},
    ciudad: {},
    localidad: {},
    direccionCompleta: {},
  }),
  usuarios: new TablaFisica("usuarios", {
    identificacion: {},
    nombre: {},
    apellidos: {},
    correoElectronico: {},
    telefono: {},
    contrasena: { soloEscritura: true }, // el hash NUNCA se lee desde el navegador
    rol_idRol: {},
    direccion_idDireccion: {},
    activo: OPC,
  }),
  clientes: new TablaFisica("clientes", {
    idCliente: {},
    carritoActivo: {},
    usuario_identificacion: {},
  }),
  proveedores: new TablaFisica("proveedores", {
    idProveedor: {},
    tipoProducto: {},
    usuario_identificacion: {},
  }),
  inventarios: new TablaFisica("inventarios", {
    id: {},
    codigo: {},
    nombre: {},
    stock: {},
    umbralMinimo: {},
    precioVenta: {},
    modelo: {},
    imagenProducto: { soloEscritura: true, opcional: true },
    unidadMedida_idUnidadMedida: {},
    marca_idMarca: {},
    categoria_idCategoria: {},
    ubicacion: OPC, // extensión (parche SQL)
  }),
  ordenesCompra: new TablaFisica("ordenesCompra", {
    idOrdenesCompra: {},
    codigo: {},
    fechaOrden: {},
    cantidad: {},
    precioUnitario: {},
    estado: {},
    proveedor_idProveedor: {},
    inventario_codInventario: {},
    observacion: OPC, // extensión (parche SQL)
  }),
  ventas: new TablaFisica("ventas", {
    idVenta: {},
    descuento: {},
    fechaVenta: {},
    estado: {},
    totalVenta: {},
    comprobantePago: {},
    metodoPago: {},
    cliente_idCliente: {},
    observacion: OPC, // extensión (parche SQL)
  }),
  detalleVentas: new TablaFisica("detalleVentas", {
    idDetalleVenta: {},
    subTotal: {},
    cantidad: {},
    precioUnitario: {},
    venta_idVenta: {},
    inventario_codInventario: {},
  }),
  garantias: new TablaFisica("garantias", {
    idGarantia: {},
    fechaInicio: {},
    fechaFin: {},
    estado: {},
    observacion: {},
    motivo: {},
    tipoFalla: {},
    evidenciaImg: OPC,
    detalleventa_idDetalleVenta: OPC,
    ordencompra_idOrdenesCompra: OPC, // extensión (parche SQL)
    clienteNombre: OPC, // extensión (parche SQL)
    correo: OPC, // extensión (parche SQL)
  }),
  garantiaBitacoras: new TablaFisica("garantiaBitacoras", {
    idBitacoras: {},
    fechaRegistro: {},
    estado: {},
    comentario: {},
    garantia_idGarantia: {},
  }),
  movimientos: new TablaFisica("movimientos", {
    idMovimiento: {},
    fechaMovimiento: {},
    precioUnitario: {},
    cantidad: {},
    subtotal: {},
    tipoMovimiento: {},
    usuario_identificacion: {},
    inventario_codInventario: {},
    detalleVenta_idDetalleVenta: OPC,
    motivo: OPC, // extensión (parche SQL)
    responsable: OPC, // extensión (parche SQL)
  }),
};

/* ------------------------------- utilidades ----------------------------- */

const ahora = () => new Date().toISOString();
const num = (valor) => (valor === null || valor === undefined || valor === "" ? 0 : Number(valor));
const mapa = (filas, pk) => new Map(filas.map((f) => [String(f[pk]), f]));
const nombreCompleto = (u) => (u ? `${u.nombre ?? ""} ${u.apellidos ?? ""}`.trim() : "");
const claveTexto = (texto) =>
  String(texto ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const SIN_CATEGORIA = "Sin categoría";
const DIAS_GARANTIA = 90;

/** Hash que NO corresponde a ninguna contraseña: el proveedor registrado desde el panel aún no puede iniciar sesión. */
const CONTRASENA_SIN_ACCESO = "!SIN_ACCESO_PENDIENTE_DE_ACTIVAR";

/** Busca por nombre (sin tildes/mayúsculas) o crea la fila. Devuelve su id. */
async function asegurarPorNombre(tabla, colId, colNombre, nombre) {
  const limpio = String(nombre ?? "").trim();
  const filas = await tabla.leer();
  const hallada = filas.find((f) => claveTexto(f[colNombre]) === claveTexto(limpio));
  if (hallada) return hallada[colId];
  const nueva = await tabla.insertarAuto({ [colNombre]: limpio }, colId);
  return nueva[colId];
}

const asegurarCategoria = (nombre) =>
  asegurarPorNombre(T.categorias, "idCategoria", "nombreCategoria", nombre || SIN_CATEGORIA);
const asegurarMarca = (nombre) => asegurarPorNombre(T.marcas, "idMarca", "nombreMarca", nombre || "Genérica");
const asegurarUnidad = (nombre) =>
  asegurarPorNombre(T.unidadVentas, "idUnidadVenta", "nombreUnidadMedida", nombre || "Pieza");

async function asegurarRol(idRol, nombreRol) {
  const roles = await T.roles.leer([["idRol", idRol]]);
  if (roles.length === 0) await T.roles.insertar({ idRol, nombreRol }, { devolver: false });
}

/** Cliente (tabla `clientes`) asociado a un usuario; lo crea si no existe. */
async function asegurarCliente(usuarioIdentificacion) {
  if (usuarioIdentificacion === null || usuarioIdentificacion === undefined) {
    throw crearError("No hay un cliente identificado para registrar la compra. Inicia sesión.");
  }
  const existentes = await T.clientes.leer([["usuario_identificacion", usuarioIdentificacion]]);
  if (existentes.length > 0) return existentes[0].idCliente;
  const nuevo = await T.clientes.insertarAuto(
    { carritoActivo: false, usuario_identificacion: usuarioIdentificacion },
    "idCliente"
  );
  return nuevo.idCliente;
}

/** "oc-12" -> { tipo: "oc", n: 12 } ; "dv-5" -> { tipo: "dv", n: 5 } */
function parsearIdOrden(id) {
  const coincidencia = /^(oc|dv)-(\d+)$/.exec(String(id ?? ""));
  return coincidencia ? { tipo: coincidencia[1], n: Number(coincidencia[2]) } : null;
}

/** Suma/resta stock con comparación (evita pisar a otro usuario que compra a la vez). */
async function ajustarStock(productoId, delta) {
  for (let intento = 0; intento < 5; intento++) {
    const [producto] = await T.inventarios.leer([["id", productoId]]);
    if (!producto) throw crearError("El producto ya no existe en el inventario.");
    const nuevo = num(producto.stock) + delta;
    if (nuevo < 0) {
      throw crearError(
        `Stock insuficiente de "${producto.nombre}": solo hay ${num(producto.stock)} disponible(s).`,
        "KRONOS_STOCK"
      );
    }
    const filas = await T.inventarios.actualizar({ stock: nuevo }, { id: productoId, stock: producto.stock });
    if (filas.length > 0) return { producto, nuevoStock: nuevo };
  }
  throw crearError("No se pudo actualizar el stock porque otro usuario lo modificó a la vez. Intenta de nuevo.");
}

async function registrarMovimiento({ productoId, tipo, cantidad, motivo, responsable, detalleVentaId, usuarioId }) {
  const usuario = usuarioId ?? sesion.usuarioId;
  if (usuario === null || usuario === undefined) {
    throw crearError("No hay una sesión activa para registrar el movimiento. Inicia sesión de nuevo.");
  }
  const [producto] = await T.inventarios.leer([["id", productoId]]);
  const precio = producto ? num(producto.precioVenta) : 0;
  await T.movimientos.insertarAuto(
    {
      fechaMovimiento: ahora(),
      precioUnitario: precio,
      cantidad,
      subtotal: precio * cantidad,
      tipoMovimiento: tipo === "entrada" ? 1 : 2,
      usuario_identificacion: usuario,
      inventario_codInventario: productoId,
      detalleVenta_idDetalleVenta: detalleVentaId ?? undefined,
      motivo,
      responsable,
    },
    "idMovimiento",
    { devolver: false }
  );
}

const buscarPorId = async (entidad, id) =>
  (await entidad.leer()).find((fila) => String(fila.id) === String(id)) ?? null;

/* ============================== PRODUCTOS ============================== */

async function leerProductos() {
  const [inv, cats, marcas, unidades] = await Promise.all([
    T.inventarios.leer(),
    T.categorias.leer(),
    T.marcas.leer(),
    T.unidadVentas.leer(),
  ]);
  const porCat = mapa(cats, "idCategoria");
  const porMarca = mapa(marcas, "idMarca");
  const porUnidad = mapa(unidades, "idUnidadVenta");

  return inv.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    categoria: porCat.get(String(p.categoria_idCategoria))?.nombreCategoria ?? SIN_CATEGORIA,
    stock_actual: num(p.stock),
    umbral_minimo: num(p.umbralMinimo),
    ubicacion: p.ubicacion ?? null,
    precio: num(p.precioVenta),
    modelo: p.modelo ?? "",
    marca: porMarca.get(String(p.marca_idMarca))?.nombreMarca ?? "",
    unidad: porUnidad.get(String(p.unidadMedida_idUnidadMedida))?.nombreUnidadMedida ?? "",
    creado_en: null,
  }));
}

const productos = {
  fisicas: ["inventarios", "categorias"],
  leer: leerProductos,

  async insertar(o) {
    const nombre = String(o.nombre ?? "").trim();
    if (!nombre) throw crearError("El nombre del material es obligatorio.");
    const [categoria, marca, unidad] = await Promise.all([
      asegurarCategoria(o.categoria),
      asegurarMarca(o.marca),
      asegurarUnidad(o.unidad),
    ]);
    const fila = await T.inventarios.insertarAuto(
      {
        codigo: String(o.codigo || "").trim() || `P-${Date.now().toString().slice(-8)}`,
        nombre,
        stock: num(o.stock_actual),
        umbralMinimo: o.umbral_minimo === undefined ? 5 : num(o.umbral_minimo),
        precioVenta: num(o.precio),
        modelo: String(o.modelo ?? o.codigo ?? ""),
        imagenProducto: aBytea(""),
        unidadMedida_idUnidadMedida: unidad,
        marca_idMarca: marca,
        categoria_idCategoria: categoria,
        ubicacion: o.ubicacion ?? undefined,
      },
      "id"
    );
    return buscarPorId(productos, fila.id);
  },

  async actualizar(fila, c) {
    const cambios = {};
    if ("codigo" in c) cambios.codigo = c.codigo ?? "";
    if ("nombre" in c) cambios.nombre = c.nombre;
    if ("stock_actual" in c) cambios.stock = num(c.stock_actual);
    if ("umbral_minimo" in c) cambios.umbralMinimo = num(c.umbral_minimo);
    if ("precio" in c) cambios.precioVenta = num(c.precio);
    if ("ubicacion" in c) cambios.ubicacion = c.ubicacion ?? "";
    if ("modelo" in c) cambios.modelo = c.modelo ?? "";
    if ("categoria" in c) cambios.categoria_idCategoria = await asegurarCategoria(c.categoria);
    if ("marca" in c) cambios.marca_idMarca = await asegurarMarca(c.marca);
    if ("unidad" in c) cambios.unidadMedida_idUnidadMedida = await asegurarUnidad(c.unidad);
    await T.inventarios.actualizar(cambios, { id: fila.id });
    return buscarPorId(productos, fila.id);
  },

  async eliminar(fila) {
    await T.inventarios.eliminar({ id: fila.id });
  },
};

/* ============================== CATEGORÍAS ============================= */

const categorias = {
  fisicas: ["categorias"],

  async leer() {
    const filas = await T.categorias.leer();
    return filas.map((c) => ({
      id: c.idCategoria,
      nombre: c.nombreCategoria,
      descripcion: c.descripcion ?? null,
      icono: c.icono ?? null,
      creado_en: null,
    }));
  },

  async insertar(o) {
    const fila = await T.categorias.insertarAuto(
      {
        nombreCategoria: String(o.nombre ?? "").trim(),
        descripcion: o.descripcion ?? undefined,
        icono: o.icono ?? undefined,
      },
      "idCategoria"
    );
    return buscarPorId(categorias, fila.idCategoria);
  },

  async actualizar(fila, c) {
    const cambios = {};
    if ("nombre" in c) cambios.nombreCategoria = c.nombre;
    if ("descripcion" in c) cambios.descripcion = c.descripcion;
    if ("icono" in c) cambios.icono = c.icono;
    await T.categorias.actualizar(cambios, { idCategoria: fila.id });
    return buscarPorId(categorias, fila.id);
  },

  async eliminar(fila) {
    await T.categorias.eliminar({ idCategoria: fila.id });
  },
};

/**
 * Sustituye a la función SQL `eliminar_categoria` del esquema viejo:
 * pasa TODOS los productos de la categoría a "Sin categoría" y borra la categoría.
 */
async function rpcEliminarCategoria({ p_categoria_id }) {
  if (p_categoria_id === null || p_categoria_id === undefined) return 0;
  const idSin = await asegurarCategoria(SIN_CATEGORIA);
  if (String(idSin) === String(p_categoria_id)) {
    throw crearError('La categoría "Sin categoría" es automática y no se puede eliminar.');
  }
  const afectados = await T.inventarios.leer([["categoria_idCategoria", p_categoria_id]]);
  for (const producto of afectados) {
    await T.inventarios.actualizar({ categoria_idCategoria: idSin }, { id: producto.id });
  }
  const borradas = await T.categorias.eliminar({ idCategoria: p_categoria_id });
  if (borradas === 0) throw crearError("No se eliminó la categoría: no existe o no hay permiso de borrado.");
  return afectados.length;
}

/* ============================== MOVIMIENTOS ============================ */

const movimientos = {
  fisicas: ["movimientos"],

  async leer() {
    const [movs, usuarios] = await Promise.all([T.movimientos.leer(), T.usuarios.leer()]);
    const porUsuario = mapa(usuarios, "identificacion");
    return movs.map((m) => ({
      id: m.idMovimiento,
      producto_id: m.inventario_codInventario,
      tipo: num(m.tipoMovimiento) === 1 ? "entrada" : "salida",
      cantidad: num(m.cantidad),
      motivo: m.motivo ?? "",
      responsable: m.responsable || nombreCompleto(porUsuario.get(String(m.usuario_identificacion))) || "",
      precio_unitario: num(m.precioUnitario),
      subtotal: num(m.subtotal),
      fecha: m.fechaMovimiento,
    }));
  },

  async insertar(o) {
    await registrarMovimiento({
      productoId: o.producto_id,
      tipo: o.tipo,
      cantidad: num(o.cantidad),
      motivo: o.motivo ?? "",
      responsable: o.responsable ?? "",
    });
    const todos = await movimientos.leer();
    return todos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] ?? null;
  },

  async actualizar() {
    throw crearError("Los movimientos de inventario no se editan: son un registro histórico.");
  },

  async eliminar(fila) {
    await T.movimientos.eliminar({ idMovimiento: fila.id });
  },
};

/* ============================== PROVEEDORES ============================ */

async function leerProveedores() {
  const [provs, usuarios, dirs] = await Promise.all([T.proveedores.leer(), T.usuarios.leer(), T.direcciones.leer()]);
  const porUsuario = mapa(usuarios, "identificacion");
  const porDir = mapa(dirs, "idDireccion");
  return provs.map((p) => {
    const u = porUsuario.get(String(p.usuario_identificacion));
    const d = u ? porDir.get(String(u.direccion_idDireccion)) : null;
    return {
      id: p.idProveedor,
      nombre: nombreCompleto(u),
      nit: u ? String(u.identificacion) : "",
      telefono: u?.telefono ?? "",
      direccion: d?.direccionCompleta ?? "",
      correo: u?.correoElectronico ?? "",
      tipo_producto: p.tipoProducto ?? "",
      activo: u?.activo === undefined || u?.activo === null ? true : Boolean(u.activo),
      perfil_id: p.usuario_identificacion,
      creado_en: null,
    };
  });
}

/** El NIT/cédula es la llave de `usuarios.identificacion` (entero de 32 bits). */
function identificacionDesdeNit(nit) {
  const digitos = String(nit ?? "").replace(/\D/g, "");
  const valor = Number(digitos);
  if (!digitos || !Number.isSafeInteger(valor) || valor <= 0 || valor > 2147483647) {
    throw crearError(
      "El NIT o cédula debe ser numérico y de máximo 10 dígitos (no mayor a 2.147.483.647). Escríbelo sin puntos ni dígito de verificación."
    );
  }
  return valor;
}

const proveedores = {
  fisicas: ["proveedores", "usuarios"],
  leer: leerProveedores,

  async insertar(o) {
    const identificacion = identificacionDesdeNit(o.nit);
    const correo = String(o.correo ?? "").trim().toLowerCase();
    const nombre = String(o.nombre ?? "").trim();
    if (!nombre || !correo) throw crearError("El nombre y el correo del proveedor son obligatorios.");

    const usuarios = await T.usuarios.leer();
    if (usuarios.some((u) => String(u.identificacion) === String(identificacion))) {
      throw crearError(`Ya existe un usuario con la identificación ${identificacion}.`, "23505");
    }
    if (usuarios.some((u) => String(u.correoElectronico).toLowerCase() === correo)) {
      throw crearError(`Ya existe un usuario con el correo ${correo}.`, "23505");
    }

    await asegurarRol(2, "Proveedor");
    const dir = await T.direcciones.insertarAuto(
      {
        barrio: "No especificado",
        ciudad: "Bogotá",
        localidad: "No especificado",
        direccionCompleta: String(o.direccion || "").trim() || "No especificado",
      },
      "idDireccion"
    );

    try {
      await T.usuarios.insertar(
        {
          identificacion,
          nombre,
          apellidos: "",
          correoElectronico: correo,
          telefono: String(o.telefono ?? "").trim(),
          contrasena: CONTRASENA_SIN_ACCESO,
          rol_idRol: 2,
          direccion_idDireccion: dir.idDireccion,
          activo: o.activo === false ? false : true,
        },
        { devolver: false }
      );
      const prov = await T.proveedores.insertarAuto(
        { tipoProducto: String(o.tipo_producto ?? "").trim(), usuario_identificacion: identificacion },
        "idProveedor"
      );
      return buscarPorId(proveedores, prov.idProveedor);
    } catch (error) {
      // Deshace lo creado para no dejar usuarios/direcciones huérfanos.
      await T.usuarios.eliminar({ identificacion }).catch(() => {});
      await T.direcciones.eliminar({ idDireccion: dir.idDireccion }).catch(() => {});
      throw error;
    }
  },

  async actualizar(fila, c) {
    const usuarioId = fila.perfil_id;
    const [usuario] = await T.usuarios.leer([["identificacion", usuarioId]]);
    const cambiosUsuario = {};
    if ("nombre" in c) {
      cambiosUsuario.nombre = String(c.nombre ?? "").trim();
      cambiosUsuario.apellidos = "";
    }
    if ("telefono" in c) cambiosUsuario.telefono = c.telefono ?? "";
    if ("correo" in c) cambiosUsuario.correoElectronico = String(c.correo ?? "").trim().toLowerCase();
    if ("activo" in c) cambiosUsuario.activo = Boolean(c.activo);
    await T.usuarios.actualizar(cambiosUsuario, { identificacion: usuarioId });

    if ("direccion" in c && usuario) {
      await T.direcciones.actualizar(
        { direccionCompleta: String(c.direccion || "").trim() || "No especificado" },
        { idDireccion: usuario.direccion_idDireccion }
      );
    }
    if ("tipo_producto" in c) {
      await T.proveedores.actualizar({ tipoProducto: c.tipo_producto ?? "" }, { idProveedor: fila.id });
    }
    return buscarPorId(proveedores, fila.id);
  },

  async eliminar(fila) {
    const [usuario] = await T.usuarios.leer([["identificacion", fila.perfil_id]]);
    await T.proveedores.eliminar({ idProveedor: fila.id });
    // Si el proveedor ya no se usa, se limpia también su usuario y dirección (si no se puede, se deja).
    await T.usuarios.eliminar({ identificacion: fila.perfil_id }).catch(() => {});
    if (usuario) await T.direcciones.eliminar({ idDireccion: usuario.direccion_idDireccion }).catch(() => {});
  },
};

/* ============================ ÓRDENES DE COMPRA ======================== */

async function leerOrdenes() {
  const [oc, dv, ve, cl, us, inv, pr] = await Promise.all([
    T.ordenesCompra.leer(),
    T.detalleVentas.leer(),
    T.ventas.leer(),
    T.clientes.leer(),
    T.usuarios.leer(),
    T.inventarios.leer(),
    T.proveedores.leer(),
  ]);
  const porProducto = mapa(inv, "id");
  const porUsuario = mapa(us, "identificacion");
  const porProveedor = mapa(pr, "idProveedor");
  const porVenta = mapa(ve, "idVenta");
  const porCliente = mapa(cl, "idCliente");

  const internas = oc.map((o) => {
    const proveedor = porProveedor.get(String(o.proveedor_idProveedor));
    const usuarioProveedor = proveedor ? porUsuario.get(String(proveedor.usuario_identificacion)) : null;
    return {
      id: `oc-${o.idOrdenesCompra}`,
      codigo: o.codigo,
      producto_id: o.inventario_codInventario,
      producto_nombre: porProducto.get(String(o.inventario_codInventario))?.nombre ?? "",
      cantidad: num(o.cantidad),
      proveedor_id: o.proveedor_idProveedor,
      proveedor_nombre: nombreCompleto(usuarioProveedor),
      cliente_id: null,
      cliente_nombre: null,
      precio_unitario: num(o.precioUnitario),
      origen: "interno",
      estado: o.estado,
      observacion: o.observacion ?? "",
      fecha: o.fechaOrden,
    };
  });

  const deClientes = dv.map((d) => {
    const venta = porVenta.get(String(d.venta_idVenta));
    const cliente = venta ? porCliente.get(String(venta.cliente_idCliente)) : null;
    const usuario = cliente ? porUsuario.get(String(cliente.usuario_identificacion)) : null;
    return {
      id: `dv-${d.idDetalleVenta}`,
      codigo: venta?.comprobantePago ?? `VENTA-${d.venta_idVenta}`,
      producto_id: d.inventario_codInventario,
      producto_nombre: porProducto.get(String(d.inventario_codInventario))?.nombre ?? "",
      cantidad: num(d.cantidad),
      proveedor_id: null,
      proveedor_nombre: null,
      cliente_id: cliente?.usuario_identificacion ?? null,
      cliente_nombre: nombreCompleto(usuario),
      precio_unitario: num(d.precioUnitario),
      origen: "cliente",
      estado: venta?.estado ?? "pendiente",
      observacion: venta?.observacion ?? "",
      fecha: venta?.fechaVenta ?? null,
      venta_id: d.venta_idVenta,
    };
  });

  return [...internas, ...deClientes];
}

const ordenes = {
  fisicas: ["ordenesCompra", "ventas", "detalleVentas"],
  leer: leerOrdenes,

  async insertar(o) {
    const cantidad = num(o.cantidad);
    if (cantidad <= 0) throw crearError("La cantidad debe ser mayor a cero.");
    const [producto] = await T.inventarios.leer([["id", o.producto_id]]);
    if (!producto) throw crearError("El producto de la orden no existe en el inventario.");
    const precio = o.precio_unitario !== undefined && o.precio_unitario !== null ? num(o.precio_unitario) : num(producto.precioVenta);
    const estado = o.estado || "pendiente";

    /* ---- Orden interna: el jefe le pide material a un proveedor ---- */
    if (o.origen !== "cliente") {
      if (o.proveedor_id === null || o.proveedor_id === undefined) {
        throw crearError("Selecciona un proveedor para cada material antes de generar la orden.");
      }
      const fila = await T.ordenesCompra.insertarAuto(
        {
          codigo: o.codigo,
          fechaOrden: ahora(),
          cantidad,
          precioUnitario: precio,
          estado,
          proveedor_idProveedor: o.proveedor_id,
          inventario_codInventario: o.producto_id,
          observacion: o.observacion ?? undefined,
        },
        "idOrdenesCompra"
      );
      return buscarPorId(ordenes, `oc-${fila.idOrdenesCompra}`);
    }

    /* ---- Pedido de cliente: venta + detalle + salida de stock ---- */
    const idCliente = await asegurarCliente(o.cliente_id);
    const venta = await T.ventas.insertarAuto(
      {
        descuento: 0,
        fechaVenta: ahora(),
        estado,
        totalVenta: precio * cantidad,
        comprobantePago: o.codigo,
        metodoPago: "Pendiente",
        cliente_idCliente: idCliente,
        observacion: o.observacion ?? undefined,
      },
      "idVenta"
    );
    let detalle = null;
    try {
      detalle = await T.detalleVentas.insertarAuto(
        {
          subTotal: precio * cantidad,
          cantidad,
          precioUnitario: precio,
          venta_idVenta: venta.idVenta,
          inventario_codInventario: o.producto_id,
        },
        "idDetalleVenta"
      );
      // Antes lo hacía un trigger SQL (salida-automatica.sql): ahora se hace aquí.
      await ajustarStock(o.producto_id, -cantidad);
    } catch (error) {
      if (detalle) await T.detalleVentas.eliminar({ idDetalleVenta: detalle.idDetalleVenta }).catch(() => {});
      await T.ventas.eliminar({ idVenta: venta.idVenta }).catch(() => {});
      throw error;
    }
    await registrarMovimiento({
      productoId: o.producto_id,
      tipo: "salida",
      cantidad,
      motivo: `Venta en línea · Pedido ${o.codigo} · ${producto.nombre}`,
      responsable: `Cliente: ${o.cliente_nombre || "sin nombre"}`,
      detalleVentaId: detalle.idDetalleVenta,
      usuarioId: o.cliente_id,
    });
    return buscarPorId(ordenes, `dv-${detalle.idDetalleVenta}`);
  },

  async actualizar(fila, c) {
    const ref = parsearIdOrden(fila.id);
    if (!ref) throw crearError("Identificador de orden no válido.");
    const cambios = {};
    if ("estado" in c) cambios.estado = c.estado;
    if ("observacion" in c) cambios.observacion = c.observacion ?? "";

    if (ref.tipo === "oc") {
      await T.ordenesCompra.actualizar(cambios, { idOrdenesCompra: ref.n });
      return buscarPorId(ordenes, fila.id);
    }

    await T.ventas.actualizar(cambios, { idVenta: fila.venta_id });
    // Igual que los triggers antiguos: rechazar devuelve el stock; reactivar lo vuelve a descontar.
    if ("estado" in c && c.estado === "rechazada" && fila.estado !== "rechazada") {
      await ajustarStock(fila.producto_id, +fila.cantidad);
      await registrarMovimiento({
        productoId: fila.producto_id,
        tipo: "entrada",
        cantidad: fila.cantidad,
        motivo: `Pedido rechazado · devolución de stock · ${fila.codigo}`,
        responsable: "Sistema",
        detalleVentaId: ref.n,
      });
    } else if ("estado" in c && fila.estado === "rechazada" && c.estado !== "rechazada") {
      await ajustarStock(fila.producto_id, -fila.cantidad);
      await registrarMovimiento({
        productoId: fila.producto_id,
        tipo: "salida",
        cantidad: fila.cantidad,
        motivo: `Pedido reactivado · ${fila.codigo}`,
        responsable: "Sistema",
        detalleVentaId: ref.n,
      });
    }
    return buscarPorId(ordenes, fila.id);
  },

  async eliminar(fila) {
    const ref = parsearIdOrden(fila.id);
    if (!ref) return;
    if (ref.tipo === "oc") {
      await T.ordenesCompra.eliminar({ idOrdenesCompra: ref.n });
    } else {
      await T.detalleVentas.eliminar({ idDetalleVenta: ref.n });
      await T.ventas.eliminar({ idVenta: fila.venta_id }).catch(() => {});
    }
  },
};

/* ============================== GARANTÍAS ============================== */

/** Guarda en `comentario` (texto) el JSON de la entrada para no perder autor, acción, etc. */
function entradaABitacora(tipo, entrada) {
  return JSON.stringify({ t: tipo, ...entrada });
}

function bitacoraAEntradas(filas) {
  const observaciones = [];
  const bitacora = [];
  for (const b of filas) {
    let json = null;
    const texto = typeof b.comentario === "string" ? b.comentario.trim() : "";
    if (texto.startsWith("{")) {
      try {
        json = JSON.parse(texto);
      } catch {
        json = null;
      }
    }
    if (json && json.t === "obs") {
      const { t, ...resto } = json;
      observaciones.push({ ...resto, id: resto.id ?? `bd-${b.idBitacoras}`, fecha: resto.fecha ?? b.fechaRegistro });
    } else if (json && json.t === "bit") {
      const { t, ...resto } = json;
      bitacora.push({ ...resto, id: resto.id ?? `bd-${b.idBitacoras}`, fecha: resto.fecha ?? b.fechaRegistro });
    } else {
      // Registro creado fuera del frontend: se muestra como un seguimiento simple.
      bitacora.push({
        id: `bd-${b.idBitacoras}`,
        accion: "Seguimiento",
        estado: b.estado,
        fecha: b.fechaRegistro,
        observacion: texto,
        detalle: texto,
      });
    }
  }
  return { observaciones, bitacora };
}

async function guardarEntradasNuevas(idGarantia, yaExistentes, observaciones, bitacora, estadoActual) {
  const ids = new Set(yaExistentes.map((e) => String(e.id)));
  const nuevas = [
    ...(observaciones || []).map((e) => ["obs", e]),
    ...(bitacora || []).map((e) => ["bit", e]),
  ].filter(([, e]) => e && !ids.has(String(e.id)));

  for (const [tipo, entrada] of nuevas) {
    await T.garantiaBitacoras.insertarAuto(
      {
        fechaRegistro: entrada.fecha || ahora(),
        estado: entrada.estado || estadoActual || "pendiente",
        comentario: entradaABitacora(tipo, entrada),
        garantia_idGarantia: idGarantia,
      },
      "idBitacoras",
      { devolver: false }
    );
  }
}

async function leerGarantias() {
  const [gars, bits, ords] = await Promise.all([T.garantias.leer(), T.garantiaBitacoras.leer(), leerOrdenes()]);
  const porOrden = new Map(ords.map((o) => [o.id, o]));
  const bitsPorGarantia = new Map();
  for (const b of bits) {
    const clave = String(b.garantia_idGarantia);
    if (!bitsPorGarantia.has(clave)) bitsPorGarantia.set(clave, []);
    bitsPorGarantia.get(clave).push(b);
  }

  return gars.map((g) => {
    const ordenId =
      g.detalleventa_idDetalleVenta !== null && g.detalleventa_idDetalleVenta !== undefined
        ? `dv-${g.detalleventa_idDetalleVenta}`
        : g.ordencompra_idOrdenesCompra !== null && g.ordencompra_idOrdenesCompra !== undefined
        ? `oc-${g.ordencompra_idOrdenesCompra}`
        : null;
    const orden = ordenId ? porOrden.get(ordenId) : null;
    const entradas = (bitsPorGarantia.get(String(g.idGarantia)) || []).sort((a, b) =>
      String(a.fechaRegistro).localeCompare(String(b.fechaRegistro))
    );
    const { observaciones, bitacora } = bitacoraAEntradas(entradas);
    const cliente = g.clienteNombre || orden?.cliente_nombre || "";
    return {
      id: g.idGarantia,
      orden_id: ordenId,
      numero_orden: orden?.codigo ?? "",
      cliente_id: orden?.cliente_id ?? null,
      cliente_nombre: cliente,
      cliente_destino: cliente,
      producto: orden?.producto_nombre ?? "",
      motivo: g.motivo ?? "",
      tipo_falla: g.tipoFalla ?? "",
      observacion: g.observacion ?? "",
      correo: g.correo ?? "",
      imagen_nombre: deBytea(g.evidenciaImg),
      estado: g.estado,
      fecha: g.fechaInicio,
      fecha_fin: g.fechaFin,
      observaciones,
      bitacora,
    };
  });
}

const garantias = {
  fisicas: ["garantias", "garantiaBitacoras"],
  leer: leerGarantias,

  async insertar(o) {
    const ref = parsearIdOrden(o.orden_id);
    const inicio = o.fecha || ahora();
    const fin = new Date(new Date(inicio).getTime() + DIAS_GARANTIA * 86400000).toISOString();
    const motivo = String(o.motivo ?? "");
    const estado = o.estado || "pendiente";

    const fila = await T.garantias.insertarAuto(
      {
        fechaInicio: inicio,
        fechaFin: fin,
        estado,
        observacion: o.observacion ?? "",
        motivo,
        tipoFalla: motivo.includes(":") ? motivo.split(":")[0].trim() : "",
        evidenciaImg: aBytea(o.imagen_nombre || ""),
        detalleventa_idDetalleVenta: ref?.tipo === "dv" ? ref.n : undefined,
        ordencompra_idOrdenesCompra: ref?.tipo === "oc" ? ref.n : undefined,
        clienteNombre: o.cliente_nombre ?? o.cliente_destino ?? undefined,
        correo: o.correo ?? undefined,
      },
      "idGarantia",
      { obligatorias: ref?.tipo === "oc" ? ["ordencompra_idOrdenesCompra"] : [] }
    );
    await guardarEntradasNuevas(fila.idGarantia, [], o.observaciones, o.bitacora, estado);
    return buscarPorId(garantias, fila.idGarantia);
  },

  async actualizar(fila, c) {
    const cambios = {};
    if ("estado" in c) cambios.estado = c.estado;
    if ("observacion" in c) cambios.observacion = c.observacion ?? "";
    if ("motivo" in c) cambios.motivo = c.motivo ?? "";
    if ("imagen_nombre" in c) cambios.evidenciaImg = aBytea(c.imagen_nombre || "");
    if ("correo" in c) cambios.correo = c.correo ?? "";
    await T.garantias.actualizar(cambios, { idGarantia: fila.id });

    if ("observaciones" in c || "bitacora" in c) {
      await guardarEntradasNuevas(
        fila.id,
        [...(fila.observaciones || []), ...(fila.bitacora || [])],
        c.observaciones,
        c.bitacora,
        c.estado ?? fila.estado
      );
    }
    return buscarPorId(garantias, fila.id);
  },

  async eliminar(fila) {
    await T.garantiaBitacoras.eliminar({ garantia_idGarantia: fila.id });
    await T.garantias.eliminar({ idGarantia: fila.id });
  },
};

/* =============================== PERFILES ============================== */

const perfiles = {
  fisicas: ["usuarios"],

  async leer() {
    const [usuarios, dirs] = await Promise.all([T.usuarios.leer(), T.direcciones.leer()]);
    const porDir = mapa(dirs, "idDireccion");
    return usuarios.map((u) => {
      const d = porDir.get(String(u.direccion_idDireccion));
      return {
        id: u.identificacion,
        nombre: u.nombre,
        apellido: u.apellidos,
        telefono: u.telefono ?? "",
        direccion: d?.direccionCompleta ?? "",
        localidad: d?.localidad ?? "",
        barrio: d?.barrio ?? "",
        rol: u.rol_idRol,
      };
    });
  },

  async insertar() {
    throw crearError("El registro de usuarios se hace desde el backend (FastAPI), no desde el navegador.");
  },

  async actualizar(fila, c) {
    const [usuario] = await T.usuarios.leer([["identificacion", fila.id]]);
    if (!usuario) throw crearError("No se encontró tu usuario.");
    const cambiosUsuario = {};
    if ("nombre" in c) cambiosUsuario.nombre = c.nombre;
    if ("apellido" in c) cambiosUsuario.apellidos = c.apellido;
    if ("telefono" in c) cambiosUsuario.telefono = c.telefono;
    await T.usuarios.actualizar(cambiosUsuario, { identificacion: fila.id });

    const cambiosDir = {};
    if ("direccion" in c) cambiosDir.direccionCompleta = c.direccion || "No especificado";
    if ("localidad" in c) cambiosDir.localidad = c.localidad || "No especificado";
    if ("barrio" in c) cambiosDir.barrio = c.barrio || "No especificado";
    await T.direcciones.actualizar(cambiosDir, { idDireccion: usuario.direccion_idDireccion });
    return buscarPorId(perfiles, fila.id);
  },

  async eliminar() {
    throw crearError("Eliminar usuarios no está permitido desde el navegador.");
  },
};

/* ------------------------------- registro ------------------------------- */

/** Nombre lógico (el que usan las páginas) -> definición. */
export const ENTIDADES = {
  productos,
  categorias,
  movimientos,
  proveedores,
  ordenes_compra: ordenes,
  garantias,
  perfiles,
};

/** Funciones que antes eran `supabase.rpc(...)` en SQL. */
export const RPC_LOCALES = {
  eliminar_categoria: rpcEliminarCategoria,
};
