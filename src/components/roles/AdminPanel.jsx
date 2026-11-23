import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase/client'
import Swal from 'sweetalert2'
import AdminChat from './AdminChat'

// Se piden solo estas columnas: la contraseña (hash y salt) nunca debe llegar al navegador
const COLUMNAS_USUARIO = 'idusuario, idroles, usuario, nombre, apellido, estado_registro'

// Escapa texto antes de meterlo en el HTML de SweetAlert (evita que un nombre con <script> se ejecute)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const nombreDe = (u) => `${u.nombre || ''} ${u.apellido || ''}`.trim() || 'Sin nombre'
const estadoDe = (u) => u.estado_registro || 'aprobado'
const hoy = () => new Date().toLocaleDateString('en-CA')
const dia = (f) => String(f || '').slice(0, 10)
const hora = (h) => String(h || '').slice(0, 5)

const claseEstadoCuenta = (e) => e === 'pendiente' ? 'bg-warning text-dark' : e === 'rechazado' ? 'bg-danger' : 'bg-success'

// Ciclo de un turno: programado → aceptado (lo acepta el vigilante) → terminado (lo termina el vigilante) → cerrado (lo cierra el administrador)
const estadoTurno = (t) => {
  if (t.estado === 'cerrado') return 'cerrado'
  if (t.estado === 'terminado') return 'terminado'
  if (t.estado === 'aceptado') return 'aceptado'
  return dia(t.fecha) < hoy() ? 'vencido' : 'programado'
}
// Campo de búsqueda con lupa, texto descriptivo y botón para borrar
function CampoBusqueda({ value, onChange, etiqueta, ayuda, placeholder }) {
  return (
    <div className="search-field">
      <label className="search-label">{etiqueta}</label>
      <div className="search-box">
        <i className="bi bi-search" aria-hidden="true"></i>
        <input
          type="search"
          className="form-control"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={`${etiqueta}. ${ayuda}`}
        />
        {value && (
          <button type="button" className="search-clear" onClick={() => onChange('')} title="Borrar búsqueda" aria-label="Borrar búsqueda">
            <i className="bi bi-x-lg"></i>
          </button>
        )}
      </div>
      <small className="search-help">{ayuda}</small>
    </div>
  )
}

const ETIQUETA_TURNO = {
  programado: { texto: 'Programado', clase: 'bg-primary' },
  aceptado: { texto: 'En curso', clase: 'bg-info text-dark' },
  terminado: { texto: 'Terminado', clase: 'bg-success' },
  vencido: { texto: 'Sin aceptar', clase: 'bg-warning text-dark' },
  cerrado: { texto: 'Cerrado', clase: 'bg-secondary' }
}

// Las placas se comparan sin guiones ni espacios (igual que en el control de accesos del vigilante)
const placaNorm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const fechaHora = (f) => f ? new Date(f).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const toast = (title) => Swal.fire({ toast: true, position: 'top-end', icon: 'success', timer: 2000, showConfirmButton: false, title })

// `usuario` es quien inició sesión (App.jsx debe pasarlo: <AdminPanel usuario={usuario} />)
export default function AdminPanel({ usuario: yo }) {
  const [tab, setTab] = useState('usuarios') // usuarios | turnos | puestos | parqueaderos | vehiculos | conjuntos | personal | chat
  const [usuarios, setUsuarios] = useState([])
  const [roles, setRoles] = useState([])
  const [personal, setPersonal] = useState([])
  const [conjuntos, setConjuntos] = useState([])
  const [puestos, setPuestos] = useState([])
  const [turnos, setTurnos] = useState([])
  const [vehiculos, setVehiculos] = useState([])
  const [cupo, setCupo] = useState(null) // límite de parqueaderos para visitantes (null = sin límite)
  const [dentro, setDentro] = useState([]) // vehículos que están dentro del conjunto ahora
  const [busquedaVehiculo, setBusquedaVehiculo] = useState('')

  const [busqueda, setBusqueda] = useState('')
  const [filtroRol, setFiltroRol] = useState('Todos')
  const [busquedaConjunto, setBusquedaConjunto] = useState('')
  const [busquedaPuesto, setBusquedaPuesto] = useState('')
  const [busquedaTurno, setBusquedaTurno] = useState('')
  const [filtroTurno, setFiltroTurno] = useState('abiertos') // abiertos | cerrados | todos
  const [filtroFechaTurno, setFiltroFechaTurno] = useState('')

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [errorConjuntos, setErrorConjuntos] = useState('')
  const [errorPuestos, setErrorPuestos] = useState('')
  const [errorTurnos, setErrorTurnos] = useState('')
  const [errorParqueo, setErrorParqueo] = useState('')

  const cargar = async () => {
    setCargando(true)
    setError(''); setErrorConjuntos(''); setErrorPuestos(''); setErrorTurnos(''); setErrorParqueo('')

    const [u, r, p, c, pu, t, vf, cfg, ac] = await Promise.all([
      supabase.from('usuarios').select(COLUMNAS_USUARIO).order('idusuario', { ascending: false }),
      supabase.from('roles').select('*'),
      supabase.from('personal').select('*'),
      supabase.from('conjuntos').select('*').order('nombre', { ascending: true }),
      supabase.from('puestos').select('*').order('nombre', { ascending: true }),
      supabase.from('turnos').select('*').order('fecha', { ascending: false }).order('hora_inicio', { ascending: false }),
      supabase.from('vehiculos_fijos').select('*').order('placa', { ascending: true }),
      supabase.from('parqueaderos_config').select('cupo_visitantes').eq('id', 1).maybeSingle(),
      supabase.from('accesos').select('*').is('fecha_salida', null)
    ])

    if (u.error) setError(`Error al cargar datos principales: ${u.error.message}`)
    if (c.error) setErrorConjuntos(mensajeBD(c.error, 'conjuntos'))
    if (pu.error) setErrorPuestos(mensajeBD(pu.error, 'puestos'))
    if (t.error) setErrorTurnos(mensajeBD(t.error, 'turnos'))
    if (vf.error) setErrorParqueo(mensajeBD(vf.error, 'vehiculos_fijos'))
    else if (cfg.error) setErrorParqueo(mensajeBD(cfg.error, 'parqueaderos_config'))

    setUsuarios(u.data || [])
    setRoles(r.data || [])
    setPersonal(p.data || [])
    setConjuntos(c.data || [])
    setPuestos(pu.data || [])
    setTurnos(t.data || [])
    setVehiculos(vf.data || [])
    setCupo(cfg.data?.cupo_visitantes ?? null)
    setDentro((ac.data || []).filter(a => placaNorm(a.placa)))
    setCargando(false)
  }

  // Refrescos parciales (los usa el tiempo real, para no recargar todo el panel)
  const recargarTurnos = async () => {
    const { data } = await supabase.from('turnos').select('*').order('fecha', { ascending: false }).order('hora_inicio', { ascending: false })
    if (data) setTurnos(data)
  }
  const recargarAccesos = async () => {
    const { data } = await supabase.from('accesos').select('*').is('fecha_salida', null)
    if (data) setDentro(data.filter(a => placaNorm(a.placa)))
  }

  useEffect(() => {
    cargar()
    // Cuando un vigilante acepta o termina un turno, o registra una entrada o salida, el panel se actualiza solo
    const canal = supabase.channel('admin-panel-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' }, () => recargarTurnos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accesos' }, () => recargarAccesos())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  const rolNombre = (idroles) => {
    const rol = roles.find(r => String(r.idroles) === String(idroles))
    return rol?.nombre_rol || rol?.nombre || 'Sin rol'
  }

  const conjuntoNombre = (id) => conjuntos.find(c => String(c.id) === String(id))?.nombre || '—'

  // ---------------- Personal ----------------
  const eliminarRegistro = async (tabla, id, nombreItem) => {
    const confirmacion = await Swal.fire({
      title: '¿Estás seguro?',
      text: `Se eliminará permanentemente "${nombreItem}".`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    })

    if (confirmacion.isConfirmed) {
      const { error } = await supabase.from(tabla).delete().eq('id', id)
      if (error) {
        Swal.fire('Error', error.message, 'error')
      } else {
        Swal.fire('Eliminado', 'El registro fue eliminado correctamente.', 'success')
        cargar()
      }
    }
  }

  const crearEmpleado = async () => {
    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Empleado',
      html:
        '<input id="swal-nombre" class="swal2-input" placeholder="Nombre completo">' +
        '<input id="swal-doc" class="swal2-input" placeholder="Documento de identidad">' +
        '<input id="swal-cargo" class="swal2-input" placeholder="Cargo">' +
        '<input id="swal-tel" class="swal2-input" placeholder="Teléfono">' +
        '<input id="swal-dir" class="swal2-input" placeholder="Dirección">',
      focusConfirm: false,
      showCancelButton: true,
      preConfirm: () => ({
        nombre_completo: document.getElementById('swal-nombre').value,
        documento: document.getElementById('swal-doc').value,
        cargo: document.getElementById('swal-cargo').value,
        telefono: document.getElementById('swal-tel').value,
        direccion: document.getElementById('swal-dir').value,
        fecha_ingreso: new Date().toISOString().split('T')[0]
      })
    })

    if (formValues) {
      const { error } = await supabase.from('personal').insert([formValues])
      if (error) Swal.fire('Error', error.message, 'error')
      else { Swal.fire('Éxito', 'Empleado registrado', 'success'); cargar() }
    }
  }

  // ---------------- Cuentas: ver y eliminar ----------------
  const verCuenta = (u) => {
    const fila = (etiqueta, valor) =>
      `<tr><th style="text-align:left;padding:6px 12px 6px 0;color:#6c757d;white-space:nowrap">${etiqueta}</th><td style="padding:6px 0">${valor}</td></tr>`

    Swal.fire({
      title: 'Información de la cuenta',
      html: `<table style="margin:0 auto;text-align:left;font-size:.95rem">
        ${fila('ID', esc(u.idusuario))}
        ${fila('Nombre', esc(u.nombre) || '—')}
        ${fila('Apellido', esc(u.apellido) || '—')}
        ${fila('Usuario / correo', esc(u.usuario) || '—')}
        ${fila('Rol', esc(rolNombre(u.idroles)))}
        ${fila('Estado del registro', esc(estadoDe(u)))}
      </table>`,
      confirmButtonText: 'Cerrar'
    })
  }

  const eliminarCuenta = async (u) => {
    if (yo?.idusuario != null && String(u.idusuario) === String(yo.idusuario)) {
      return Swal.fire('No permitido', 'No puedes eliminar tu propia cuenta.', 'warning')
    }
    const admins = usuarios.filter(x => String(x.idroles) === '1')
    if (String(u.idroles) === '1' && admins.length <= 1) {
      return Swal.fire('No permitido', 'Es el único administrador. Si lo eliminas nadie podría gestionar el sistema.', 'warning')
    }

    const conf = await Swal.fire({
      title: '¿Eliminar cuenta?',
      text: `Se eliminará la cuenta de "${nombreDe(u)}" (${u.usuario || 'sin usuario'}). Esta acción no se puede deshacer.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (!conf.isConfirmed) return

    const { data, error } = await supabase.from('usuarios').delete().eq('idusuario', u.idusuario).select('idusuario')

    if (error) {
      const msg = error.code === '23503'
        ? 'Esta cuenta tiene registros asociados (turnos, novedades, accesos, etc.) y no se puede eliminar mientras existan.'
        : error.message
      return Swal.fire('No se pudo eliminar', msg, 'error')
    }
    if (!data || data.length === 0) {
      return Swal.fire('No se pudo eliminar', 'La base de datos no permitió borrar la cuenta. Revisa los permisos (RLS) de la tabla usuarios.', 'error')
    }

    setUsuarios(prev => prev.filter(x => x.idusuario !== u.idusuario))
    window.dispatchEvent(new Event('registros-actualizados')) // refresca el globito de pendientes
    toast('Cuenta eliminada')
  }

  // ---------------- Turnos: cerrar, reabrir y ver detalle ----------------
  // El vigilante acepta y termina su turno; el administrador lo revisa y lo cierra.
  const cerrarTurno = async (t) => {
    const est = estadoTurno(t)
    const forzado = est !== 'terminado'
    const r = await Swal.fire({
      title: forzado ? '¿Forzar el cierre?' : '¿Cerrar turno?',
      html: `<div style="text-align:left;font-size:.95rem">
        <p>${esc(t.vigilante || 'Vigilante')} · ${esc(dia(t.fecha))} · ${esc(hora(t.hora_inicio))}-${esc(hora(t.hora_fin))} · ${esc(t.puesto || 'sin puesto')}</p>
        ${t.nota_terminado ? `<p><b>Nota de entrega del vigilante:</b> ${esc(t.nota_terminado)}</p>` : ''}
        ${forzado ? `<p class="text-danger">El vigilante todavía no terminó este turno (estado: ${esc(ETIQUETA_TURNO[est].texto)}). Si lo cierras ahora, queda cerrado sin su confirmación.</p>` : ''}
      </div>`,
      input: 'textarea',
      inputLabel: 'Observación de cierre (opcional)',
      inputPlaceholder: 'Ej: Entregó el puesto sin novedades',
      showCancelButton: true,
      confirmButtonText: forzado ? 'Sí, forzar cierre' : 'Sí, cerrar turno',
      confirmButtonColor: forzado ? '#d33' : '#198754',
      cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return

    await actualizarTurno(t, {
      estado: 'cerrado',
      fecha_cierre: new Date().toISOString(),
      cerrado_por: yo?.nombre || 'Administrador',
      observacion_cierre: (r.value || '').trim() || null
    }, forzado ? 'Turno cerrado (forzado)' : 'Turno cerrado')
  }

  const reabrirTurno = async (t) => {
    // Vuelve al estado en el que estaba antes de cerrarse, para no perder lo que hizo el vigilante
    const previo = t.fecha_terminado ? 'terminado' : t.fecha_aceptacion ? 'aceptado' : 'programado'
    const r = await Swal.fire({
      title: '¿Reabrir turno?',
      text: `El turno volverá al estado "${ETIQUETA_TURNO[previo].texto}".`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, reabrir',
      cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return

    await actualizarTurno(t, { estado: previo, fecha_cierre: null, cerrado_por: null, observacion_cierre: null }, 'Turno reabierto')
  }

  // Solo cambia el turno si sigue en el estado que el admin estaba viendo
  // (si el vigilante lo modificó mientras tanto, no se pisa su cambio)
  const actualizarTurno = async (t, cambios, mensajeOk) => {
    let consulta = supabase.from('turnos').update(cambios).eq('id', t.id)
    consulta = t.estado ? consulta.eq('estado', t.estado) : consulta.is('estado', null)
    const { data, error } = await consulta.select()
    if (error) return Swal.fire('Error', mensajeBD(error, 'turnos'), 'error')
    if (!data || data.length === 0) {
      await recargarTurnos()
      return Swal.fire('El turno cambió', 'Este turno fue modificado mientras lo revisabas (quizá el vigilante lo aceptó o lo terminó), o la base de datos no permitió el cambio (revisa los permisos RLS de turnos). Se actualizó la lista: revísalo y vuelve a intentar.', 'info')
    }
    setTurnos(prev => prev.map(x => x.id === t.id ? data[0] : x))
    toast(mensajeOk)
  }

  const verDetalle = (t) => {
    const est = estadoTurno(t)
    const fila = (k, v) => `<tr><th style="text-align:left;padding:4px 12px 4px 0;color:#6c757d;white-space:nowrap;vertical-align:top">${k}</th><td style="padding:4px 0">${v}</td></tr>`
    Swal.fire({
      title: 'Detalle del turno',
      html: `<table style="margin:0 auto;text-align:left;font-size:.95rem">
        ${fila('Vigilante', esc(t.vigilante) || '—')}
        ${fila('Puesto', esc(t.puesto) || '—')}
        ${fila('Fecha y horario', `${esc(dia(t.fecha))} · ${esc(hora(t.hora_inicio))}-${esc(hora(t.hora_fin))}`)}
        ${fila('Asignado por', esc(t.supervisor) || '—')}
        ${t.observaciones ? fila('Instrucciones', esc(t.observaciones)) : ''}
        ${fila('Estado', esc(ETIQUETA_TURNO[est].texto))}
        ${fila('Aceptado', esc(fechaHora(t.fecha_aceptacion)))}
        ${fila('Terminado', esc(fechaHora(t.fecha_terminado)))}
        ${fila('Nota de entrega', esc(t.nota_terminado) || 'Sin nota')}
        ${t.estado === 'cerrado'
          ? fila('Cerrado por', esc(t.cerrado_por) || '—') + fila('Fecha de cierre', esc(fechaHora(t.fecha_cierre))) + fila('Observación de cierre', esc(t.observacion_cierre) || 'Sin observación')
          : ''}
      </table>`,
      confirmButtonText: 'Cerrar'
    })
  }

  // ---------------- Puestos: crear, editar, eliminar ----------------
  const formularioPuesto = async (p = {}) => {
    const opcionesConjunto = conjuntos
      .filter(c => c.estado !== 'inactivo' || String(c.id) === String(p.idconjunto))
      .map(c => `<option value="${esc(c.id)}" ${String(c.id) === String(p.idconjunto) ? 'selected' : ''}>${esc(c.nombre)}</option>`)
      .join('')

    const { value } = await Swal.fire({
      title: p.id ? 'Editar puesto' : 'Nuevo puesto',
      html:
        `<input id="pu-nombre" class="swal2-input" placeholder="Nombre del puesto *" value="${esc(p.nombre)}">` +
        `<input id="pu-desc" class="swal2-input" placeholder="Descripción (opcional)" value="${esc(p.descripcion)}">` +
        `<select id="pu-conjunto" class="swal2-select" style="display:flex;margin:1em auto">
           <option value="">Sin conjunto asignado</option>${opcionesConjunto}
         </select>` +
        `<select id="pu-estado" class="swal2-select" style="display:flex;margin:1em auto">
           <option value="activo" ${p.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
           <option value="inactivo" ${p.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
         </select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = document.getElementById('pu-nombre').value.trim()
        if (!nombre) {
          Swal.showValidationMessage('El nombre del puesto es obligatorio')
          return false
        }
        return {
          nombre,
          descripcion: document.getElementById('pu-desc').value.trim() || null,
          idconjunto: document.getElementById('pu-conjunto').value || null,
          estado: document.getElementById('pu-estado').value
        }
      }
    })
    return value
  }

  const crearPuesto = async () => {
    const datos = await formularioPuesto()
    if (!datos) return
    const { error } = await supabase.from('puestos').insert([datos])
    if (error) return Swal.fire('Error', mensajeBD(error, 'puestos'), 'error')
    toast('Puesto agregado')
    cargar()
  }

  const editarPuesto = async (p) => {
    const datos = await formularioPuesto(p)
    if (!datos) return
    const { data, error } = await supabase.from('puestos').update(datos).eq('id', p.id).select()
    if (error) return Swal.fire('Error', mensajeBD(error, 'puestos'), 'error')
    if (!data || data.length === 0) return Swal.fire('No se pudo guardar', 'La base de datos no permitió modificar el puesto.', 'error')

    // Los turnos guardan el nombre del puesto como texto: si lo renombras, se actualizan también
    if (datos.nombre !== p.nombre) await supabase.from('turnos').update({ puesto: datos.nombre }).eq('puesto', p.nombre)

    toast('Puesto actualizado')
    cargar()
  }

  const eliminarPuesto = async (p) => {
    const { count } = await supabase.from('turnos').select('id', { count: 'exact', head: true }).eq('puesto', p.nombre)
    const usados = count || 0

    const conf = await Swal.fire({
      title: '¿Eliminar puesto?',
      text: usados > 0
        ? `"${p.nombre}" se usa en ${usados} turno(s). Los turnos conservarán el nombre, pero el puesto ya no aparecerá en la lista. Si solo quieres dejar de usarlo, mejor márcalo como inactivo.`
        : `Se eliminará "${p.nombre}" permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (!conf.isConfirmed) return

    const { data, error } = await supabase.from('puestos').delete().eq('id', p.id).select('id')
    if (error) return Swal.fire('No se pudo eliminar', mensajeBD(error, 'puestos'), 'error')
    if (!data || data.length === 0) return Swal.fire('No se pudo eliminar', 'La base de datos no permitió borrar el puesto.', 'error')
    setPuestos(prev => prev.filter(x => x.id !== p.id))
    toast('Puesto eliminado')
  }

  // ---------------- Conjuntos: crear, editar y eliminar ----------------
  const formularioConjunto = async (c = {}) => {
    const { value } = await Swal.fire({
      title: c.id ? 'Editar conjunto' : 'Nuevo conjunto',
      html:
        `<input id="cj-nombre" class="swal2-input" placeholder="Nombre del conjunto *" value="${esc(c.nombre)}">` +
        `<input id="cj-nit" class="swal2-input" placeholder="NIT" value="${esc(c.nit)}">` +
        `<input id="cj-ciudad" class="swal2-input" placeholder="Ciudad" value="${esc(c.ciudad)}">` +
        `<input id="cj-dir" class="swal2-input" placeholder="Dirección" value="${esc(c.direccion)}">` +
        `<input id="cj-tel" class="swal2-input" placeholder="Teléfono" value="${esc(c.telefono)}">` +
        `<select id="cj-estado" class="swal2-select" style="display:flex;margin:1em auto">
           <option value="activo" ${c.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
           <option value="inactivo" ${c.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
         </select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = document.getElementById('cj-nombre').value.trim()
        if (!nombre) {
          Swal.showValidationMessage('El nombre del conjunto es obligatorio')
          return false
        }
        return {
          nombre,
          nit: document.getElementById('cj-nit').value.trim() || null,
          ciudad: document.getElementById('cj-ciudad').value.trim() || null,
          direccion: document.getElementById('cj-dir').value.trim() || null,
          telefono: document.getElementById('cj-tel').value.trim() || null,
          estado: document.getElementById('cj-estado').value
        }
      }
    })
    return value
  }

  const crearConjunto = async () => {
    const datos = await formularioConjunto()
    if (!datos) return
    const { error } = await supabase.from('conjuntos').insert([datos])
    if (error) return Swal.fire('Error', mensajeBD(error, 'conjuntos'), 'error')
    toast('Conjunto agregado')
    cargar()
  }

  const editarConjunto = async (c) => {
    const datos = await formularioConjunto(c)
    if (!datos) return
    const { data, error } = await supabase.from('conjuntos').update(datos).eq('id', c.id).select()
    if (error) return Swal.fire('Error', mensajeBD(error, 'conjuntos'), 'error')
    if (!data || data.length === 0) return Swal.fire('No se pudo guardar', 'La base de datos no permitió modificar el conjunto.', 'error')
    setConjuntos(prev => prev.map(x => x.id === c.id ? data[0] : x))
    toast('Conjunto actualizado')
  }

  const eliminarConjunto = async (c) => {
    const conf = await Swal.fire({
      title: '¿Eliminar conjunto?',
      text: `Se eliminará "${c.nombre}" permanentemente. Los puestos que tenía asignados quedarán sin conjunto.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (!conf.isConfirmed) return

    const { data, error } = await supabase.from('conjuntos').delete().eq('id', c.id).select('id')
    if (error) return Swal.fire('No se pudo eliminar', mensajeBD(error, 'conjuntos'), 'error')
    if (!data || data.length === 0) return Swal.fire('No se pudo eliminar', 'La base de datos no permitió borrar el conjunto.', 'error')
    setConjuntos(prev => prev.filter(x => x.id !== c.id))
    toast('Conjunto eliminado')
    cargar()
  }

  // ---------------- Parqueaderos: límite para visitantes ----------------
  // Los vehículos fijos activos no ocupan cupo de visitantes
  const placasFijas = useMemo(() => new Set(vehiculos.filter(v => v.estado !== 'inactivo').map(v => placaNorm(v.placa))), [vehiculos])
  const placasDentro = useMemo(() => new Set(dentro.map(a => placaNorm(a.placa))), [dentro])
  const dentroVisitantes = useMemo(() => dentro.filter(a => !placasFijas.has(placaNorm(a.placa))), [dentro, placasFijas])
  const dentroFijos = useMemo(() => dentro.filter(a => placasFijas.has(placaNorm(a.placa))), [dentro, placasFijas])
  const ocupados = dentroVisitantes.length
  const disponibles = cupo === null ? null : Math.max(cupo - ocupados, 0)
  const lleno = cupo !== null && ocupados >= cupo

  const guardarCupo = async (valor) => {
    const { data, error } = await supabase.from('parqueaderos_config').upsert({ id: 1, cupo_visitantes: valor }).select()
    if (error) { Swal.fire('Error', mensajeBD(error, 'parqueaderos_config'), 'error'); return false }
    if (!data || data.length === 0) {
      Swal.fire('No se pudo guardar', 'La base de datos no permitió modificar el límite. Revisa los permisos (RLS) de la tabla parqueaderos_config.', 'error')
      return false
    }
    setCupo(data[0].cupo_visitantes ?? null)
    toast(valor === null ? 'Límite quitado' : 'Límite actualizado')
    return true
  }

  const configurarCupo = async () => {
    const r = await Swal.fire({
      title: 'Límite de parqueaderos para visitantes',
      text: 'Máximo de vehículos de visitantes que pueden estar dentro al mismo tiempo. Los vehículos fijos no cuentan.',
      input: 'number',
      inputValue: cupo ?? '',
      inputAttributes: { min: 0, step: 1 },
      inputPlaceholder: 'Ej: 20',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => {
        const n = Number(v)
        if (v === '' || !Number.isInteger(n) || n < 0 || n > 9999) return 'Escribe un número entero entre 0 y 9999'
      }
    })
    if (!r.isConfirmed) return
    const nuevo = Number(r.value)
    const ok = await guardarCupo(nuevo)
    if (ok && nuevo < ocupados) {
      Swal.fire('Límite por debajo de la ocupación', `Ahora hay ${ocupados} vehículo(s) de visitantes dentro y el límite es ${nuevo}. No entrarán más hasta que salgan.`, 'info')
    }
  }

  const quitarCupo = async () => {
    const r = await Swal.fire({
      title: '¿Quitar el límite?',
      text: 'Los vigilantes podrán registrar vehículos de visitantes sin restricción de cupo.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar límite',
      cancelButtonText: 'Cancelar'
    })
    if (r.isConfirmed) await guardarCupo(null)
  }

  // ---------------- Vehículos fijos: crear, editar, eliminar ----------------
  const formularioVehiculo = async (v = {}) => {
    const { value } = await Swal.fire({
      title: v.id ? 'Editar vehículo fijo' : 'Nuevo vehículo fijo',
      html:
        `<input id="vf-placa" class="swal2-input" placeholder="Placa * (Ej: ABC123)" maxlength="10" value="${esc(v.placa)}">` +
        `<input id="vf-prop" class="swal2-input" placeholder="Propietario *" value="${esc(v.propietario)}">` +
        `<input id="vf-destino" class="swal2-input" placeholder="Destino (Ej: Torre 2 · Apto 501)" value="${esc(v.destino)}">` +
        `<input id="vf-parq" class="swal2-input" placeholder="Parqueadero asignado (Ej: P-14)" value="${esc(v.parqueadero)}">` +
        `<select id="vf-estado" class="swal2-select" style="display:flex;margin:1em auto">
           <option value="activo" ${v.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
           <option value="inactivo" ${v.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
         </select>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const placa = document.getElementById('vf-placa').value.trim().toUpperCase()
        const propietario = document.getElementById('vf-prop').value.trim()
        const norm = placaNorm(placa)
        if (norm.length < 5 || norm.length > 7) {
          Swal.showValidationMessage('La placa debe tener entre 5 y 7 letras o números')
          return false
        }
        if (!propietario) {
          Swal.showValidationMessage('El propietario es obligatorio')
          return false
        }
        if (vehiculos.some(x => x.id !== v.id && placaNorm(x.placa) === norm)) {
          Swal.showValidationMessage('Ya existe un vehículo fijo con esa placa')
          return false
        }
        return {
          placa,
          propietario,
          destino: document.getElementById('vf-destino').value.trim() || null,
          parqueadero: document.getElementById('vf-parq').value.trim() || null,
          estado: document.getElementById('vf-estado').value
        }
      }
    })
    return value
  }

  const crearVehiculo = async () => {
    const datos = await formularioVehiculo()
    if (!datos) return
    const { error } = await supabase.from('vehiculos_fijos').insert([datos])
    if (error) return Swal.fire('Error', mensajeBD(error, 'vehiculos_fijos'), 'error')
    toast('Vehículo fijo agregado')
    cargar()
  }

  const editarVehiculo = async (v) => {
    const datos = await formularioVehiculo(v)
    if (!datos) return
    const { data, error } = await supabase.from('vehiculos_fijos').update(datos).eq('id', v.id).select()
    if (error) return Swal.fire('Error', mensajeBD(error, 'vehiculos_fijos'), 'error')
    if (!data || data.length === 0) return Swal.fire('No se pudo guardar', 'La base de datos no permitió modificar el vehículo.', 'error')
    setVehiculos(prev => prev.map(x => x.id === v.id ? data[0] : x))
    toast('Vehículo actualizado')
  }

  const eliminarVehiculo = async (v) => {
    const conf = await Swal.fire({
      title: '¿Eliminar vehículo fijo?',
      text: `Se eliminará la placa ${v.placa} (${v.propietario}). Si solo quieres que deje de entrar como fijo, mejor márcalo como inactivo. Si está dentro ahora, pasará a contar como visitante.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (!conf.isConfirmed) return

    const { data, error } = await supabase.from('vehiculos_fijos').delete().eq('id', v.id).select('id')
    if (error) return Swal.fire('No se pudo eliminar', mensajeBD(error, 'vehiculos_fijos'), 'error')
    if (!data || data.length === 0) return Swal.fire('No se pudo eliminar', 'La base de datos no permitió borrar el vehículo.', 'error')
    setVehiculos(prev => prev.filter(x => x.id !== v.id))
    toast('Vehículo eliminado')
  }

  const vehiculosVisibles = useMemo(() => {
    const q = busquedaVehiculo.trim().toLowerCase()
    const qp = placaNorm(busquedaVehiculo)
    return vehiculos.filter(v =>
      `${v.placa || ''} ${v.propietario || ''} ${v.destino || ''} ${v.parqueadero || ''}`.toLowerCase().includes(q) ||
      (qp && placaNorm(v.placa).includes(qp)))
  }, [vehiculos, busquedaVehiculo])

  // ---------------- Filtros ----------------
  const usuariosVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return usuarios.filter(u =>
      (filtroRol === 'Todos' || String(u.idroles) === filtroRol) &&
      `${u.nombre || ''} ${u.apellido || ''} ${u.usuario || ''}`.toLowerCase().includes(q))
  }, [usuarios, busqueda, filtroRol])

  const conjuntosVisibles = useMemo(() => {
    const q = busquedaConjunto.trim().toLowerCase()
    return conjuntos.filter(c => `${c.nombre || ''} ${c.nit || ''} ${c.ciudad || ''} ${c.direccion || ''}`.toLowerCase().includes(q))
  }, [conjuntos, busquedaConjunto])

  const puestosVisibles = useMemo(() => {
    const q = busquedaPuesto.trim().toLowerCase()
    return puestos.filter(p => `${p.nombre || ''} ${p.descripcion || ''} ${conjuntoNombre(p.idconjunto)}`.toLowerCase().includes(q))
  }, [puestos, busquedaPuesto, conjuntos])

  const turnosVisibles = useMemo(() => {
    const q = busquedaTurno.trim().toLowerCase()
    return turnos.filter(t => {
      const est = estadoTurno(t)
      const estOk = filtroTurno === 'todos'
        || (filtroTurno === 'cerrados' && est === 'cerrado')
        || (filtroTurno === 'por_cerrar' && est === 'terminado')
        || (filtroTurno === 'abiertos' && est !== 'cerrado')
      const fecOk = !filtroFechaTurno || dia(t.fecha) === filtroFechaTurno
      const txtOk = !q || `${t.vigilante || ''} ${t.puesto || ''} ${t.supervisor || ''}`.toLowerCase().includes(q)
      return estOk && fecOk && txtOk
    })
  }, [turnos, filtroTurno, filtroFechaTurno, busquedaTurno])

  const turnosAbiertos = turnos.filter(t => t.estado !== 'cerrado').length
  const turnosPorCerrar = turnos.filter(t => estadoTurno(t) === 'terminado').length

  const btnTab = (id, texto) => (
    <button className={`btn ${tab === id ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setTab(id)}>{texto}</button>
  )

  return (
    <div className="role-panel">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Panel de Administrador</h1>
          <p className="text-muted mb-0">Control de cuentas, turnos, puestos, conjuntos, información laboral y comunicación con el supervisor en CentralGuard.</p>
        </div>
        <button className="btn btn-dark rounded-pill px-4 btn-refresh" onClick={cargar} disabled={cargando} title="Volver a consultar usuarios, turnos, puestos y demás datos">
          <i className={`bi bi-arrow-clockwise me-2 ${cargando ? 'spin' : ''}`}></i>
          {cargando ? 'Actualizando...' : 'Actualizar datos'}
        </button>
      </div>

      {error && <div className="alert alert-warning border-0 shadow-sm">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card"><span className="stat-icon"></span><div><small>Usuarios</small><strong>{usuarios.length}</strong></div></div>
        <div className="stat-card"><span className="stat-icon"></span><div><small>Turnos abiertos</small><strong>{turnosAbiertos}</strong></div></div>
        <div className="stat-card"><span className="stat-icon"></span><div><small>Puestos</small><strong>{puestos.length}</strong></div></div>
        <div className="stat-card"><span className="stat-icon"></span><div><small>Conjuntos</small><strong>{conjuntos.length}</strong></div></div>
        <div className="stat-card"><span className="stat-icon"></span><div><small>Parq. visitantes</small><strong>{ocupados} / {cupo ?? '∞'}</strong></div></div>
        <div className="stat-card"><span className="stat-icon"></span><div><small>Personal</small><strong>{personal.length}</strong></div></div>
      </div>

      <div className="admin-tabs d-flex gap-2 my-3 flex-wrap">
        {btnTab('usuarios', 'Cuentas')}
        {btnTab('turnos', `Turnos${turnosPorCerrar ? ` (${turnosPorCerrar} por cerrar)` : ''}`)}
        {btnTab('puestos', 'Puestos')}
        {btnTab('parqueaderos', lleno ? 'Parqueaderos (llenos)' : 'Parqueaderos')}
        {btnTab('vehiculos', 'Vehículos fijos')}
        {btnTab('conjuntos', 'Conjuntos')}
        {btnTab('personal', 'Información laboral')}
        {btnTab('chat', 'Chat con Supervisor')}
      </div>

      {tab === 'usuarios' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Usuarios del sistema</h3>
              <p>Consulta y administración de las cuentas registradas.</p>
            </div>
            <div className="toolbar-actions d-flex gap-2 flex-wrap">
              <select className="form-select" style={{ width: 'auto' }} value={filtroRol} onChange={e => setFiltroRol(e.target.value)}>
                <option value="Todos">Todos los roles</option>
                {roles.map(r => <option key={r.idroles} value={String(r.idroles)}>{r.nombre_rol || r.nombre}</option>)}
              </select>
              <CampoBusqueda value={busqueda} onChange={setBusqueda} etiqueta="Buscar usuario" ayuda="Escribe un nombre, apellido o usuario" placeholder="Ej: Juan Pérez" />
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Nombre</th><th>Usuario / correo</th><th>Rol</th><th>Estado</th><th>ID</th><th className="text-end">Acciones</th></tr></thead>
              <tbody>
                {usuariosVisibles.map((u, i) => (
                  <tr key={u.idusuario || i}>
                    <td className="fw-semibold">{nombreDe(u)}</td>
                    <td>{u.usuario || '—'}</td>
                    <td><span className="badge rounded-pill text-bg-light border">{rolNombre(u.idroles)}</span></td>
                    <td><span className={`badge ${claseEstadoCuenta(estadoDe(u))}`}>{estadoDe(u)}</span></td>
                    <td className="text-muted">{u.idusuario ?? '—'}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-info me-2" onClick={() => verCuenta(u)}>👁 Ver</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarCuenta(u)}>🗑️ Eliminar</button>
                    </td>
                  </tr>
                ))}
                {!usuariosVisibles.length && <tr><td colSpan="6" className="text-center py-4">No hay usuarios para mostrar.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'turnos' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Turnos programados</h3>
              <p>El vigilante acepta y termina su turno. Cuando aparezca como Terminado, revísalo y ciérralo.</p>
            </div>
          </div>

          {errorTurnos && <div className="alert alert-warning border-0">{errorTurnos}</div>}

          <div className="filters-bar mb-3">
            <div>
              <label>Mostrar</label>
              <select className="form-select form-select-sm" value={filtroTurno} onChange={e => setFiltroTurno(e.target.value)}>
                <option value="abiertos">Abiertos</option>
                <option value="por_cerrar">Terminados (por cerrar)</option>
                <option value="cerrados">Cerrados</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <div>
              <label>Fecha</label>
              <input type="date" className="form-control form-control-sm" value={filtroFechaTurno} onChange={e => setFiltroFechaTurno(e.target.value)} />
            </div>
            <div>
              <CampoBusqueda value={busquedaTurno} onChange={setBusquedaTurno} etiqueta="Buscar turno" ayuda="Por vigilante, puesto o supervisor" placeholder="Ej: Carlos, Portería 2" />
            </div>
            <button className="btn btn-outline-secondary btn-sm align-self-end" onClick={() => { setFiltroTurno('abiertos'); setFiltroFechaTurno(''); setBusquedaTurno('') }}>
              Limpiar filtros
            </button>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Fecha</th><th>Horario</th><th>Vigilante</th><th>Puesto</th><th>Asignado por</th><th>Estado</th><th className="text-end">Acciones</th></tr></thead>
              <tbody>
                {turnosVisibles.map(t => {
                  const est = ETIQUETA_TURNO[estadoTurno(t)]
                  return (
                    <tr key={t.id}>
                      <td>{dia(t.fecha)}</td>
                      <td>{hora(t.hora_inicio)} - {hora(t.hora_fin)}</td>
                      <td className="fw-semibold">{t.vigilante || '—'}</td>
                      <td>{t.puesto || '—'}</td>
                      <td>{t.supervisor || '—'}</td>
                      <td><span className={`badge ${est.clase}`}>{est.texto}</span></td>
                      <td className="text-end">
                        <button className="btn btn-sm btn-outline-info me-2" onClick={() => verDetalle(t)}>👁 Detalle</button>
                        {t.estado === 'cerrado' ? (
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => reabrirTurno(t)}>↺ Reabrir</button>
                        ) : estadoTurno(t) === 'terminado' ? (
                          <button className="btn btn-sm btn-success" onClick={() => cerrarTurno(t)}>✓ Cerrar turno</button>
                        ) : (
                          <button className="btn btn-sm btn-outline-warning" onClick={() => cerrarTurno(t)} title="El vigilante todavía no terminó este turno">Forzar cierre</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {!turnosVisibles.length && (
                  <tr><td colSpan="7" className="text-center py-4">{cargando ? 'Cargando...' : 'No hay turnos para mostrar.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'puestos' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Gestión de puestos</h3>
              <p>Puestos de trabajo disponibles para programar turnos.</p>
            </div>
            <div className="toolbar-actions d-flex gap-2 flex-wrap">
              <CampoBusqueda value={busquedaPuesto} onChange={setBusquedaPuesto} etiqueta="Buscar puesto" ayuda="Por nombre, descripción o conjunto" placeholder="Ej: Portería principal" />
              <button className="btn btn-success" onClick={crearPuesto} disabled={!!errorPuestos}>+ Agregar Puesto</button>
            </div>
          </div>

          {errorPuestos && <div className="alert alert-warning border-0">{errorPuestos}</div>}

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Puesto</th><th>Conjunto</th><th>Descripción</th><th>Estado</th><th className="text-end">Acciones</th></tr></thead>
              <tbody>
                {puestosVisibles.map(p => (
                  <tr key={p.id}>
                    <td className="fw-semibold">{p.nombre}</td>
                    <td>{conjuntoNombre(p.idconjunto)}</td>
                    <td>{p.descripcion || '—'}</td>
                    <td><span className={`badge ${p.estado === 'inactivo' ? 'bg-secondary' : 'bg-success'}`}>{p.estado || 'activo'}</span></td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-warning me-2" onClick={() => editarPuesto(p)}>✏️ Editar</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarPuesto(p)}>🗑️ Eliminar</button>
                    </td>
                  </tr>
                ))}
                {!puestosVisibles.length && (
                  <tr><td colSpan="5" className="text-center py-4">{cargando ? 'Cargando...' : 'No hay puestos registrados.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'conjuntos' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Gestión de conjuntos</h3>
              <p>Registra, edita y elimina los conjuntos atendidos.</p>
            </div>
            <div className="toolbar-actions d-flex gap-2 flex-wrap">
              <CampoBusqueda value={busquedaConjunto} onChange={setBusquedaConjunto} etiqueta="Buscar conjunto" ayuda="Por nombre, NIT, ciudad o dirección" placeholder="Ej: Torres del Parque" />
              <button className="btn btn-success" onClick={crearConjunto} disabled={!!errorConjuntos}>+ Agregar Conjunto</button>
            </div>
          </div>

          {errorConjuntos && <div className="alert alert-warning border-0">{errorConjuntos}</div>}

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Nombre</th><th>NIT</th><th>Ciudad</th><th>Dirección</th><th>Teléfono</th><th>Estado</th><th className="text-end">Acciones</th></tr></thead>
              <tbody>
                {conjuntosVisibles.map(c => (
                  <tr key={c.id}>
                    <td className="fw-semibold">{c.nombre}</td>
                    <td>{c.nit || '—'}</td>
                    <td>{c.ciudad || '—'}</td>
                    <td>{c.direccion || '—'}</td>
                    <td>{c.telefono || '—'}</td>
                    <td><span className={`badge ${c.estado === 'inactivo' ? 'bg-secondary' : 'bg-success'}`}>{c.estado || 'activo'}</span></td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-warning me-2" onClick={() => editarConjunto(c)}>✏️ Editar</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarConjunto(c)}>🗑️ Eliminar</button>
                    </td>
                  </tr>
                ))}
                {!conjuntosVisibles.length && (
                  <tr><td colSpan="7" className="text-center py-4">{cargando ? 'Cargando...' : 'No hay conjuntos registrados.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'personal' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Información Laboral de Trabajadores</h3>
              <p>Datos laborales e historial de empleados.</p>
            </div>
            <button className="btn btn-success" onClick={crearEmpleado}>+ Agregar Empleado</button>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Documento</th><th>Nombre</th><th>Cargo</th><th>Teléfono</th><th>Ingreso</th><th className="text-end">Acciones</th></tr></thead>
              <tbody>
                {personal.map((p, i) => (
                  <tr key={p.id || i}>
                    <td>{p.documento}</td>
                    <td className="fw-semibold">{p.nombre_completo}</td>
                    <td><span className="badge bg-secondary">{p.cargo}</span></td>
                    <td>{p.telefono}</td>
                    <td>{p.fecha_ingreso}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarRegistro('personal', p.id, p.nombre_completo)}>🗑️ Eliminar</button>
                    </td>
                  </tr>
                ))}
                {!personal.length && <tr><td colSpan="6" className="text-center py-4">No hay personal registrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'parqueaderos' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Parqueaderos de visitantes</h3>
              <p>Define cuántos vehículos de visitantes pueden estar dentro a la vez. Los vehículos fijos no ocupan cupo.</p>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              <button className="btn btn-success" onClick={configurarCupo} disabled={!!errorParqueo}>{cupo === null ? 'Definir límite' : 'Cambiar límite'}</button>
              {cupo !== null && <button className="btn btn-outline-secondary" onClick={quitarCupo}>Quitar límite</button>}
            </div>
          </div>

          {errorParqueo && <div className="alert alert-warning border-0">{errorParqueo}</div>}
          {lleno && <div className="alert alert-danger border-0">Parqueaderos llenos: los vigilantes no podrán registrar más vehículos de visitantes hasta que salga alguno.</div>}

          <div className="stats-grid mb-3">
            <div className="stat-card"><span className="stat-icon"></span><div><small>Límite visitantes</small><strong>{cupo ?? 'Sin límite'}</strong></div></div>
            <div className="stat-card"><span className="stat-icon"></span><div><small>Ocupados</small><strong>{ocupados}</strong></div></div>
            <div className="stat-card"><span className="stat-icon"></span><div><small>Disponibles</small><strong>{disponibles ?? '—'}</strong></div></div>
            <div className="stat-card"><span className="stat-icon"></span><div><small>Fijos dentro</small><strong>{dentroFijos.length}</strong></div></div>
          </div>

          <h5 className="mb-2">Vehículos dentro ahora</h5>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Placa</th><th>Tipo</th><th>Nombre</th><th>Destino</th><th>Ingreso</th></tr></thead>
              <tbody>
                {dentro.map(a => (
                  <tr key={a.id}>
                    <td><span className="badge bg-dark">{a.placa}</span></td>
                    <td>{placasFijas.has(placaNorm(a.placa)) ? <span className="badge bg-primary">Fijo</span> : <span className="badge bg-secondary">Visitante</span>}</td>
                    <td className="fw-semibold">{a.nombre_visitante || '—'}</td>
                    <td>{a.destino || '—'}</td>
                    <td>{fechaHora(a.fecha_ingreso)}</td>
                  </tr>
                ))}
                {!dentro.length && <tr><td colSpan="5" className="text-center py-4">{cargando ? 'Cargando...' : 'No hay vehículos dentro en este momento.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'vehiculos' && (
        <div className="panel-card">
          <div className="panel-toolbar">
            <div>
              <h3>Vehículos fijos</h3>
              <p>Vehículos de residentes o del personal. Al ingresar su placa, el vigilante ve los datos del propietario y no ocupan cupo de visitantes.</p>
            </div>
            <div className="toolbar-actions d-flex gap-2 flex-wrap">
              <CampoBusqueda value={busquedaVehiculo} onChange={setBusquedaVehiculo} etiqueta="Buscar vehículo" ayuda="Por placa, propietario, destino o parqueadero" placeholder="Ej: ABC123" />
              <button className="btn btn-success" onClick={crearVehiculo} disabled={!!errorParqueo}>+ Agregar Vehículo</button>
            </div>
          </div>

          {errorParqueo && <div className="alert alert-warning border-0">{errorParqueo}</div>}

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Placa</th><th>Propietario</th><th>Destino</th><th>Parqueadero</th><th>Estado</th><th>En el conjunto</th><th className="text-end">Acciones</th></tr></thead>
              <tbody>
                {vehiculosVisibles.map(v => (
                  <tr key={v.id}>
                    <td><span className="badge bg-dark">{v.placa}</span></td>
                    <td className="fw-semibold">{v.propietario}</td>
                    <td>{v.destino || '—'}</td>
                    <td>{v.parqueadero || '—'}</td>
                    <td><span className={`badge ${v.estado === 'inactivo' ? 'bg-secondary' : 'bg-success'}`}>{v.estado || 'activo'}</span></td>
                    <td>{placasDentro.has(placaNorm(v.placa)) ? <span className="badge bg-success">Dentro</span> : <span className="text-muted small">Fuera</span>}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-warning me-2" onClick={() => editarVehiculo(v)}>✏️ Editar</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarVehiculo(v)}>🗑️ Eliminar</button>
                    </td>
                  </tr>
                ))}
                {!vehiculosVisibles.length && (
                  <tr><td colSpan="7" className="text-center py-4">{cargando ? 'Cargando...' : 'No hay vehículos fijos registrados.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'chat' && <AdminChat />}
    </div>
  )
}

// Traduce los errores de Supabase a mensajes entendibles
function mensajeBD(error, recurso) {
  const texto = error.message || ''
  if (error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist|Could not find the table/i.test(texto)) {
    return `La tabla "${recurso}" no existe todavía en Supabase. Ejecuta el archivo sql/admin_parqueaderos_y_turnos.sql en el SQL Editor de Supabase y pulsa Actualizar.`
  }
  if (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|Could not find the .* column/i.test(texto)) {
    return `Faltan columnas en la tabla "${recurso}". Ejecuta el archivo sql/admin_parqueaderos_y_turnos.sql en el SQL Editor de Supabase y pulsa Actualizar.`
  }
  if (error.code === '23505') return recurso === 'vehiculos_fijos' ? 'Ya existe un vehículo fijo con esa placa.' : `Ya existe un registro con ese nombre en "${recurso}".`
  if (error.code === '23503') return `Este registro tiene datos asociados y no se puede eliminar.`
  return texto
}