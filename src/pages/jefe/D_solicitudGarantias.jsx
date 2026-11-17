import { useMemo, useState } from "react";
import { Modal } from "bootstrap";
import Swal from "sweetalert2";
import "../../assets/css/D_garantia-jefe.css";
import "../../assets/css/D_garantia-modales.css";
import logo from "../../assets/img/logo.png";
import pulidoraAzul from "../../assets/img/pulidoraazul.jpeg";
import { actualizarGarantia, eliminarGarantia, radicarGarantia } from "../../api/db";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";

/**
 * Garantías · Solicitudes — conectado en tiempo real a Supabase
 * (`garantias` + `garantiaBitacoras`, unidas con `detalleVentas`, `ventas`,
 * `clientes` e `inventarios`).
 *
 * RADICACIÓN DESDE EL JEFE: el jefe elige primero el CLIENTE y luego una de
 * SUS compras (un producto de `detalleVentas`, ya confirmada). El N.º de
 * orden y el producto salen de esa compra real y la garantía queda ligada a
 * ese detalle de venta (así el cliente la ve en su portal y el proveedor
 * que surte ese producto la ve en el suyo, por RLS).
 *
 * VIGENCIA: la garantía cubre GARANTIA_DIAS días desde la fecha de la venta
 * (la base de datos guarda ese rango en garantias.fechaInicio / fechaFin).
 * Si se vence, no se deja radicar. Para otra vigencia, ajusta esta constante
 * y el intervalo del trigger kronos_garantia_antes en el SQL.
 *
 * BITÁCORA: cada cambio de estado lo registra solo la base de datos; las
 * observaciones que escribe el jefe se anotan como "[Jefe] texto".
 */

const GARANTIA_DIAS = 90;

function calcularVigenciaGarantia(fechaOrden) {
  if (!fechaOrden) return { diasTranscurridos: null, diasRestantes: null, vigente: true };
  const transcurridoMs = Date.now() - new Date(fechaOrden).getTime();
  const diasTranscurridos = Math.floor(transcurridoMs / (1000 * 60 * 60 * 24));
  const diasRestantes = GARANTIA_DIAS - diasTranscurridos;
  return { diasTranscurridos, diasRestantes, vigente: diasRestantes >= 0 };
}

const ESTADOS = ["pendiente", "en_revision", "aprobada", "rechazada", "cancelada"];
const ETIQUETA_ESTADO = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelada: "Cancelada (por el cliente)",
  Pendiente: "Pendiente",
  "En revisión": "En revisión",
  Aprobado: "Aprobada",
  Rechazado: "Rechazada",
  "Enviado a Proveedor": "Enviado a Proveedor",
};

function D_solicitudGarantias() {
  // Conexión en tiempo real con Supabase (Archivo A_2)
  const { datos: solicitudes, cargando, error } = useRealtimeTable("garantias", {
    orderBy: "fecha",
    ascending: false,
  });

  // Compras de clientes ya existentes (ventas + detalleVentas), para radicar
  // la garantía contra datos reales en vez de texto libre.
  const { datos: compras } = useRealtimeTable("pedidos_cliente", {
    orderBy: "fecha",
    ascending: false,
  });

  const [seleccionada, setSeleccionada] = useState(null);
  const [estadoEdicion, setEstadoEdicion] = useState("pendiente");
  const [observacionEdicion, setObservacionEdicion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [activeTab, setActiveTab] = useState("info");

  // Estado para el formulario de Nueva Solicitud (Herencia del Archivo B_2)
  const [nuevoForm, setNuevoForm] = useState({
    cliente_id: "",
    orden_id: "",
    numero_orden: "",
    cliente_nombre: "",
    producto: "",
    motivo: "",
    tipo_falla: "",
    observacion: "",
    correo: "",
  });
  const [creando, setCreando] = useState(false);

  // Clientes con al menos una compra confirmada.
  const clientesConCompras = useMemo(() => {
    const mapa = new Map();
    compras
      .filter((c) => c.estado === "confirmada")
      .forEach((c) => mapa.set(String(c.cliente_id), c.cliente_nombre));
    return [...mapa.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [compras]);

  // Compras confirmadas del cliente seleccionado.
  const comprasDelCliente = useMemo(() => {
    if (!nuevoForm.cliente_id) return [];
    return compras.filter(
      (c) => String(c.cliente_id) === String(nuevoForm.cliente_id) && c.estado === "confirmada"
    );
  }, [compras, nuevoForm.cliente_id]);

  const compraSeleccionada = useMemo(
    () => comprasDelCliente.find((c) => String(c.id) === String(nuevoForm.orden_id)) || null,
    [comprasDelCliente, nuevoForm.orden_id]
  );

  const vigenciaSeleccionada = useMemo(
    () => (compraSeleccionada ? calcularVigenciaGarantia(compraSeleccionada.fecha) : null),
    [compraSeleccionada]
  );

  const alCambiarCliente = (clienteId) => {
    const cliente = clientesConCompras.find((c) => c.id === String(clienteId));
    setNuevoForm((actual) => ({
      ...actual,
      cliente_id: clienteId,
      cliente_nombre: cliente?.nombre || "",
      orden_id: "",
      numero_orden: "",
      producto: "",
    }));
  };

  const alCambiarCompra = (compraId) => {
    const compra = comprasDelCliente.find((c) => String(c.id) === String(compraId));
    setNuevoForm((actual) => ({
      ...actual,
      orden_id: compraId,
      numero_orden: compra?.codigo || "",
      producto: compra?.producto_nombre || "",
      correo: compra?.cliente_correo || "",
    }));
  };

  // --- ACCIONES CRUD ---

  const abrirDetalle = (solicitud) => {
    setSeleccionada(solicitud);
    setEstadoEdicion(solicitud.estado || "pendiente");
    setObservacionEdicion(solicitud.observacion || "");
    setActiveTab("info");
  };

  const guardarEstado = async () => {
    if (!seleccionada) return;
    setGuardando(true);
    try {
      // El cambio de estado lo anota solo la base de datos en garantiaBitacoras;
      // la observación del jefe queda como nota firmada.
      await actualizarGarantia(
        seleccionada.id,
        { estado: estadoEdicion, observacion: observacionEdicion },
        { autor: "Jefe", nota: observacionEdicion }
      );

      Swal.fire({
        icon: "success",
        title: "Solicitud actualizada",
        text: "El cliente verá el nuevo estado en su apartado de garantías.",
        confirmButtonColor: "#8d86c9",
      });
      Modal.getOrCreateInstance("#modalDetalleSolicitud").hide();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "No se pudo actualizar",
        text: err.message,
        confirmButtonColor: "#933c9e",
      });
    } finally {
      setGuardando(false);
    }
  };

  const crearSolicitud = async (e) => {
    e.preventDefault();

    if (!nuevoForm.cliente_id) {
      Swal.fire({
        icon: "warning",
        title: "Selecciona un cliente",
        text: "La garantía debe radicarse sobre la compra de un cliente registrado.",
        confirmButtonColor: "#8d86c9",
      });
      return;
    }

    if (!nuevoForm.orden_id || !compraSeleccionada) {
      Swal.fire({
        icon: "warning",
        title: "Selecciona una compra",
        text: "Elige la compra de ese cliente sobre la que aplica la garantía.",
        confirmButtonColor: "#8d86c9",
      });
      return;
    }

    if (vigenciaSeleccionada && !vigenciaSeleccionada.vigente) {
      Swal.fire({
        icon: "error",
        title: "Garantía vencida",
        text: `Esa compra se hizo hace ${vigenciaSeleccionada.diasTranscurridos} día(s), fuera de los ${GARANTIA_DIAS} días de garantía. No es posible radicar una solicitud contra ella.`,
        confirmButtonColor: "#933c9e",
      });
      return;
    }

    setCreando(true);
    try {
      await radicarGarantia({
        detalleId: Number(nuevoForm.orden_id),
        tipoFalla: nuevoForm.tipo_falla,
        motivo: nuevoForm.motivo,
        observacion: nuevoForm.observacion || "Solicitud creada.",
        evidencia: null,
        autor: "Jefe",
      });

      Swal.fire({
        icon: "success",
        title: "Solicitud radicada",
        text: "La solicitud ha sido creada con éxito.",
        confirmButtonColor: "#8d86c9",
      });

      setNuevoForm({
        cliente_id: "",
        orden_id: "",
        numero_orden: "",
        cliente_nombre: "",
        producto: "",
        motivo: "",
        tipo_falla: "",
        observacion: "",
        correo: "",
      });
      Modal.getOrCreateInstance("#modalNuevaSolicitud").hide();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error al crear",
        text: err.message,
        confirmButtonColor: "#933c9e",
      });
    } finally {
      setCreando(false);
    }
  };

  const eliminarSolicitud = async (id, orden) => {
    const res = await Swal.fire({
      title: "¿Eliminar solicitud?",
      text: `Esta acción no se puede deshacer para la orden #${orden}.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#6c757d",
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
    });

    if (res.isConfirmed) {
      try {
        await eliminarGarantia(id);

        Swal.fire({
          icon: "success",
          title: "Eliminada",
          text: "La solicitud ha sido eliminada.",
          confirmButtonColor: "#8d86c9",
        });
      } catch (err) {
        Swal.fire({
          icon: "error",
          title: "Error al eliminar",
          text: err.message,
          confirmButtonColor: "#933c9e",
        });
      }
    }
  };

  return (
    <>
      <section className="tabla-stock">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="titulo-alertasG m-0">Solicitudes de Garantías</h1>
          <button
            className="btn btn-dark fw-semibold"
            data-bs-toggle="modal"
            data-bs-target="#modalNuevaSolicitud"
          >
            <i className="fa-solid fa-plus me-2"></i>Nueva solicitud
          </button>
        </div>

        {error && <div className="alert alert-danger">No se pudo conectar con la tabla "garantias": {error}</div>}

        <div className="table-responsive">
          <table id="tablaGarantias" className="table table-hover table-bordered align-start">
            <thead>
              <tr>
                <th className="text-start">
                  <div className="d-inline-flex align-items-center">
                    <i className="fa-solid fa-cubes me-2" style={{ color: "var(--k-orange)" }}></i>
                    N° Orden
                  </div>
                </th>
                <th className="text-start">
                  <div className="d-inline-flex align-items-center">
                    <i className="fa-solid fa-address-card me-2" style={{ color: "var(--k-orange)", marginRight: 8 }}></i>
                    Cliente
                  </div>
                </th>
                <th className="text-start">
                  <div className="d-inline-flex align-items-center">
                    <i className="fa-solid fa-box" style={{ color: "var(--k-orange)", marginRight: 8 }}></i>
                    Producto
                  </div>
                </th>
                <th className="text-start">
                  <div className="d-inline-flex align-items-center">
                    <i className="fa-solid fa-calendar-days me-2" style={{ color: "var(--k-orange)", marginRight: 8 }}></i>
                    Fecha
                  </div>
                </th>
                <th className="text-start">
                  <div className="d-inline-flex align-items-center">
                    <i className="fa-solid fa-triangle-exclamation me-2" style={{ color: "var(--k-orange)", marginRight: 8 }}></i>
                    Estado
                  </div>
                </th>
                <th className="text-center">
                  <div className="d-inline-flex align-items-center">
                    <i className="fa-solid fa-gear me-2" style={{ color: "var(--k-orange)", marginRight: 8 }}></i>
                    Acciones
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {cargando ? (
                <tr><td colSpan={6} className="text-center py-4">Cargando solicitudes…</td></tr>
              ) : solicitudes.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted py-4">No hay solicitudes de garantía por el momento.</td></tr>
              ) : (
                solicitudes.map((solicitud) => (
                  <tr key={solicitud.id}>
                    <td className="text-start">{solicitud.numero_orden}</td>
                    <td>{solicitud.cliente_nombre || solicitud.cliente_destino}</td>
                    <td className="text-start">{solicitud.producto}</td>
                    <td className="text-start">{solicitud.fecha ? new Date(solicitud.fecha).toLocaleDateString("es-CO") : "—"}</td>
                    <td className="text-start">{ETIQUETA_ESTADO[solicitud.estado] || "Pendiente"}</td>
                    <td className="text-center">
                      <div className="d-flex justify-content-center gap-2">
                        <button
                          className="btn-detalle btn-ver-solicitud"
                          data-bs-toggle="modal"
                          data-bs-target="#modalDetalleSolicitud"
                          onClick={() => abrirDetalle(solicitud)}
                          title="Ver / Editar"
                        >
                          <i className="fa-solid fa-eye"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => eliminarSolicitud(solicitud.id, solicitud.numero_orden)}
                          title="Eliminar"
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* MODAL · NUEVA SOLICITUD (mismo diseño que los modales de Stock) */}
      <div className="modal fade modal-garantia" id="modalNuevaSolicitud" tabIndex="-1" aria-hidden="true">
        <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
          <form className="modal-content" onSubmit={crearSolicitud}>
            <div className="modal-header encabezado-ficha">
              <div className="titulo-ficha">
                <i className="bi bi-shield-plus"></i>
                <h2>Nueva solicitud de garantía</h2>
              </div>
              <img src={logo} alt="Logo" className="logo-modal" />
            </div>

            <div className="modal-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Cliente *</label>
                  <select
                    className="form-select"
                    required
                    value={nuevoForm.cliente_id}
                    onChange={(e) => alCambiarCliente(e.target.value)}
                  >
                    <option value="">
                      {clientesConCompras.length === 0 ? "No hay compras confirmadas" : "Selecciona un cliente…"}
                    </option>
                    {clientesConCompras.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Compra *</label>
                  <select
                    className="form-select"
                    required
                    disabled={!nuevoForm.cliente_id}
                    value={nuevoForm.orden_id}
                    onChange={(e) => alCambiarCompra(e.target.value)}
                  >
                    <option value="">
                      {nuevoForm.cliente_id ? "Selecciona una compra…" : "Primero elige un cliente"}
                    </option>
                    {comprasDelCliente.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.codigo} · {c.producto_nombre} · {c.fecha ? new Date(c.fecha).toLocaleDateString("es-CO") : "—"}
                      </option>
                    ))}
                  </select>
                  {compraSeleccionada && vigenciaSeleccionada && (
                    <div className={`gm-vigencia ${vigenciaSeleccionada.vigente ? "gm-vigencia--ok" : "gm-vigencia--vencida"}`}>
                      <i className={`bi ${vigenciaSeleccionada.vigente ? "bi-patch-check-fill" : "bi-exclamation-triangle-fill"}`}></i>
                      {vigenciaSeleccionada.vigente
                        ? `Garantía vigente · quedan ${vigenciaSeleccionada.diasRestantes} día(s) (de ${GARANTIA_DIAS})`
                        : `Garantía vencida hace ${Math.abs(vigenciaSeleccionada.diasRestantes)} día(s)`}
                    </div>
                  )}
                </div>

                <div className="col-md-6">
                  <label className="form-label">N.º de Orden / Factura</label>
                  <input type="text" className="form-control" readOnly value={nuevoForm.numero_orden} placeholder="Se completa al elegir la compra" />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Producto</label>
                  <input type="text" className="form-control" readOnly value={nuevoForm.producto} placeholder="Se completa al elegir la compra" />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Correo del cliente</label>
                  <input type="email" className="form-control" readOnly value={nuevoForm.correo} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Tipo de falla</label>
                  <select
                    className="form-select"
                    value={nuevoForm.tipo_falla}
                    onChange={(e) => setNuevoForm({ ...nuevoForm, tipo_falla: e.target.value })}
                  >
                    <option value="">Selecciona…</option>
                    {["Fallo de Fábrica", "Producto Defectuoso", "Avería en Transporte", "Faltan piezas"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label">Motivo del reclamo</label>
                  <textarea
                    className="form-control"
                    rows="2"
                    value={nuevoForm.motivo}
                    onChange={(e) => setNuevoForm({ ...nuevoForm, motivo: e.target.value })}
                  ></textarea>
                </div>
                <div className="col-12">
                  <label className="form-label">Observación inicial</label>
                  <textarea
                    className="form-control"
                    rows="2"
                    value={nuevoForm.observacion}
                    onChange={(e) => setNuevoForm({ ...nuevoForm, observacion: e.target.value })}
                  ></textarea>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="gm-btn-secundario" data-bs-dismiss="modal">
                Cancelar
              </button>
              <button type="submit" className="gm-btn-primario" disabled={creando}>
                <i className="bi bi-check2-circle me-2"></i>
                {creando ? "Creando…" : "Radicar solicitud"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* MODAL · DETALLE / EDITAR GARANTÍA (mismo diseño que los modales de Stock) */}
      <div className="modal fade modal-garantia" id="modalDetalleSolicitud" tabIndex="-1" aria-hidden="true">
        <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header encabezado-ficha">
              <div className="titulo-ficha">
                <i className="bi bi-file-earmark-text"></i>
                <h2>Detalle de la solicitud #{seleccionada?.numero_orden}</h2>
              </div>
              <img src={logo} alt="Logo" className="logo-modal" />
            </div>

            <div className="gm-tabs" role="tablist">
              {[
                ["info", "Información"],
                ["obs", "Observaciones"],
                ["bitacora", "Bitácora"],
              ].map(([clave, texto]) => (
                <button
                  key={clave}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === clave}
                  className={`gm-tab ${activeTab === clave ? "activa" : ""}`}
                  onClick={() => setActiveTab(clave)}
                >
                  {texto}
                </button>
              ))}
            </div>

            <div className="modal-body">
              {activeTab === "info" && (
                <>
                  <div className="gm-datos mb-3">
                    <div className="gm-dato">
                      <small>Cliente</small>
                      <span>{seleccionada?.cliente_nombre || seleccionada?.cliente_destino || "—"}</span>
                    </div>
                    <div className="gm-dato">
                      <small>Pedido</small>
                      <span>#{seleccionada?.numero_orden}</span>
                    </div>
                    {seleccionada?.correo && (
                      <div className="gm-dato">
                        <small>Correo</small>
                        <span>{seleccionada.correo}</span>
                      </div>
                    )}
                    <div className="gm-dato">
                      <small>Fecha de la solicitud</small>
                      <span>{seleccionada?.fecha ? new Date(seleccionada.fecha).toLocaleDateString("es-CO") : "—"}</span>
                    </div>
                  </div>

                  <div className="gm-caja gm-producto mb-3">
                    <img src={pulidoraAzul} alt={seleccionada?.producto || "Producto"} />
                    <div>
                      <small>Producto</small>
                      <h5>{seleccionada?.producto}</h5>
                    </div>
                  </div>

                  <div className="gm-caja mb-3">
                    <h6>Motivo del reclamo</h6>
                    <p className="mb-0">{seleccionada?.motivo || "—"}</p>
                  </div>

                  <div className="gm-caja gm-caja--acento">
                    <h6><i className="bi bi-sliders me-2"></i>Gestión (solo jefe/administrador)</h6>

                    <label className="form-label">Estado de la solicitud</label>
                    <select
                      className="form-select mb-3"
                      value={estadoEdicion}
                      onChange={(e) => setEstadoEdicion(e.target.value)}
                    >
                      {ESTADOS.map((estado) => (
                        <option key={estado} value={estado}>{ETIQUETA_ESTADO[estado]}</option>
                      ))}
                    </select>

                    <label className="form-label">Observación para el cliente</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      placeholder="Ej. Se aprueba el cambio, pasa por el punto de recolección más cercano."
                      value={observacionEdicion}
                      onChange={(e) => setObservacionEdicion(e.target.value)}
                    ></textarea>
                  </div>
                </>
              )}

              {activeTab === "obs" && (
                <div className="gm-caja">
                  <h6><i className="bi bi-chat-left-text me-2"></i>Historial de observaciones</h6>
                  {(!seleccionada?.observaciones || seleccionada.observaciones.length === 0) ? (
                    <p className="gm-vacio">
                      {seleccionada?.observacion || "Sin observaciones acumuladas."}
                    </p>
                  ) : (
                    [...seleccionada.observaciones].reverse().map((obs, idx) => (
                      <div key={obs.id || idx} className="gm-obs-item">
                        <div className="gm-cabecera-item">
                          <strong className="small">{obs.responsable || "Sistema"}</strong>
                          <span className="gm-fecha">
                            {obs.fecha ? new Date(obs.fecha).toLocaleDateString("es-CO") : "—"}
                          </span>
                        </div>
                        <p className="mb-0 small">{obs.texto}</p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "bitacora" && (
                <div className="gm-caja">
                  <h6><i className="bi bi-clock-history me-2"></i>Bitácora cronológica</h6>
                  {(!seleccionada?.bitacora || seleccionada.bitacora.length === 0) ? (
                    <p className="gm-vacio">Sin registros en la bitácora.</p>
                  ) : (
                    <ul className="gm-linea">
                      {seleccionada.bitacora.map((bit, idx) => (
                        <li key={bit.id || idx}>
                          <div className="gm-cabecera-item">
                            <strong className="small">{bit.accion}</strong>
                            <span className="gm-fecha">
                              {bit.fecha ? new Date(bit.fecha).toLocaleDateString("es-CO") : "—"}
                            </span>
                          </div>
                          {bit.observacion && (
                            <p className="mb-0 small text-muted">{bit.observacion}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="gm-btn-secundario" data-bs-dismiss="modal">
                Cerrar
              </button>
              {activeTab === "info" && (
                <button
                  type="button"
                  className="gm-btn-primario"
                  onClick={guardarEstado}
                  disabled={guardando}
                >
                  <i className="bi bi-check2-circle me-2"></i>
                  {guardando ? "Guardando…" : "Guardar cambios"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default D_solicitudGarantias;