import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase/client'
import Swal from 'sweetalert2'

const normalizarPlaca = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const toast = (title) => Swal.fire({ toast: true, position: 'top-end', icon: 'success', title, timer: 2000, showConfirmButton: false })
const hora = (f) => f ? new Date(f).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null

export default function ControlAccesos({ usuario }) {
  const idUsuario = usuario?.idusuario
  const [accesos, setAccesos] = useState([])
  const [nombre, setNombre] = useState('')
  const [destino, setDestino] = useState('')
  const [placa, setPlaca] = useState('')
  const [editId, setEditId] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // Parqueaderos
  const [fijos, setFijos] = useState([])     // vehículos fijos activos
  const [cupo, setCupo] = useState(null)     // límite de visitantes (null = sin límite)
  const [dentro, setDentro] = useState([])   // vehículos que están dentro ahora (de todos los vigilantes)

  const cargarAccesos = async () => {
    if (!idUsuario) return
    const { data } = await supabase.from('accesos').select('*')
      .eq('idusuario', idUsuario)
      .order('id', { ascending: false })
    setAccesos(data || [])
  }

  // Si las tablas nuevas aún no existen, simplemente no hay límite ni vehículos fijos
  const cargarParqueadero = async () => {
    const [f, c, d] = await Promise.all([
      supabase.from('vehiculos_fijos').select('placa, propietario, destino, parqueadero, estado'),
      supabase.from('parqueaderos_config').select('cupo_visitantes').eq('id', 1).maybeSingle(),
      supabase.from('accesos').select('*').is('fecha_salida', null)
    ])
    setFijos((f.data || []).filter(x => x.estado !== 'inactivo'))
    setCupo(c.data?.cupo_visitantes ?? null)
    setDentro((d.data || []).filter(a => normalizarPlaca(a.placa)))
  }

  const recargar = async () => { await Promise.all([cargarAccesos(), cargarParqueadero()]) }

  useEffect(() => {
    recargar()
    // Mantiene al día quién está dentro cuando otro vigilante o el supervisor registra ingresos/salidas
    const canal = supabase.channel(`vig-accesos-${idUsuario}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accesos' }, () => recargar())
      .subscribe()
    const t = setInterval(recargar, 15000)
    return () => { clearInterval(t); supabase.removeChannel(canal) }
  }, [idUsuario])

  const fijasMap = useMemo(() => new Map(fijos.map(f => [normalizarPlaca(f.placa), f])), [fijos])
  const ocupados = dentro.filter(a => !fijasMap.has(normalizarPlaca(a.placa))).length
  const disponibles = cupo === null ? null : Math.max(cupo - ocupados, 0)
  const lleno = cupo !== null && ocupados >= cupo
  const placaFija = fijasMap.get(normalizarPlaca(placa))

  // Mis registros + los vehículos que siguen adentro aunque los haya registrado otro vigilante
  const lista = useMemo(() => {
    const m = new Map(accesos.map(a => [a.id, a]))
    dentro.forEach(a => { if (!m.has(a.id)) m.set(a.id, a) })
    return [...m.values()].sort((a, b) => b.id - a.id)
  }, [accesos, dentro])

  // Si la placa es de un vehículo fijo, se completan los datos del propietario
  useEffect(() => {
    if (placaFija && !editId) {
      setNombre(n => n || placaFija.propietario || '')
      setDestino(d => d || placaFija.destino || '')
    }
  }, [placaFija?.placa])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const placaNorm = normalizarPlaca(placa)

    if (placaNorm) {
      // Se consulta de nuevo la base de datos: otro vigilante o el supervisor pudo haberlo ingresado hace un momento
      const { data: frescos } = await supabase.from('accesos').select('id, placa').is('fecha_salida', null)
      const adentroAhora = (frescos || []).filter(a => normalizarPlaca(a.placa))
      if (adentroAhora.some(a => normalizarPlaca(a.placa) === placaNorm && a.id !== editId)) {
        await cargarParqueadero()
        return Swal.fire('Vehículo ya está dentro', `La placa ${placaNorm} ya figura dentro del conjunto. No se puede ingresar de nuevo hasta registrar su salida.`, 'warning')
      }
      if (!editId && !placaFija) {
        const ocupadosAhora = adentroAhora.filter(a => !fijasMap.has(normalizarPlaca(a.placa))).length
        if (cupo !== null && ocupadosAhora >= cupo) {
          await cargarParqueadero()
          return Swal.fire('Parqueaderos llenos', `El límite de parqueaderos para visitantes es ${cupo} y todos están ocupados. Registra la salida de un vehículo antes de dejar ingresar otro.`, 'warning')
        }
      }
    }

    const datos = { nombre_visitante: nombre, destino, placa: placa.trim() ? placa.trim().toUpperCase() : null }
    setGuardando(true)

    if (editId) {
      const { error } = await supabase.from('accesos').update(datos).eq('id', editId).eq('idusuario', idUsuario)
      setGuardando(false)
      if (error) return Swal.fire(error.code === '23505' ? 'Vehículo ya está dentro' : 'Error', error.code === '23505' ? 'Esa placa ya figura dentro del conjunto.' : error.message, error.code === '23505' ? 'warning' : 'error')
      Swal.fire({ icon: 'success', title: '¡Actualizado!', text: 'Acceso modificado', timer: 1500, showConfirmButton: false })
      setEditId(null)
    } else {
      const { error } = await supabase.from('accesos').insert([{ ...datos, idusuario: idUsuario }])
      setGuardando(false)
      if (error) return Swal.fire(error.code === '23505' ? 'Vehículo ya está dentro' : 'Error', error.code === '23505' ? 'Esa placa ya figura dentro del conjunto.' : error.message, error.code === '23505' ? 'warning' : 'error')
      Swal.fire({
        icon: 'success',
        title: '¡Ingreso Autorizado!',
        text: placaFija ? `Vehículo fijo de ${placaFija.propietario}` : 'Visitante registrado en portería',
        timer: 1500, showConfirmButton: false
      })
    }
    setNombre(''); setDestino(''); setPlaca('')
    await recargar()
  }

  const registrarSalida = async (a) => {
    const r = await Swal.fire({
      title: '¿Registrar salida?',
      text: `Sale el vehículo ${a.placa} (${a.nombre_visitante}).`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, registrar salida',
      cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return

    const { data, error } = await supabase.from('accesos')
      .update({ fecha_salida: new Date().toISOString() })
      .eq('id', a.id).is('fecha_salida', null).select()
    if (error) return Swal.fire('Error', error.message, 'error')
    if (!data || data.length === 0) {
      await recargar()
      return Swal.fire('Ya estaba registrada', 'La salida de este vehículo ya fue registrada.', 'info')
    }
    toast('Salida registrada')
    await recargar()
  }

  const prepararEdicion = (item) => {
    setEditId(item.id)
    setNombre(item.nombre_visitante)
    setDestino(item.destino)
    setPlaca(item.placa || '')
  }

  const claseCupo = lleno ? 'alert-danger' : (disponibles !== null && disponibles <= 2) ? 'alert-warning' : 'alert-success'

  return (
    <div className="p-4">
      <div className="d-flex align-items-center justify-content-between p-4 mb-4 rounded-4 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #198754 0%, #146c43 100%)' }}>
        <div className="d-flex align-items-center">
          <div className="bg-white bg-opacity-20 p-3 rounded-3 me-3 fs-2 d-flex align-items-center justify-content-center" style={{ width: '60px', height: '60px' }}>
            <i className="bi bi-car-front-fill"></i>
          </div>
          <div>
            <h3 className="fw-bold mb-0">Control de Accesos</h3>
            <small className="text-white-50">Registro peatonal, visitantes y vehículos</small>
          </div>
        </div>
        <span className="badge bg-white text-success px-3 py-2 rounded-pill fw-bold shadow-sm">
          <i className="bi bi-shield-check me-1"></i> Monitoreo de Entrada
        </span>
      </div>

      {cupo !== null && (
        <div className={`alert ${claseCupo} border-0 shadow-sm rounded-4 d-flex align-items-center justify-content-between flex-wrap gap-2`}>
          <span>
            <i className="bi bi-p-square-fill me-2"></i>
            <strong>Parqueaderos de visitantes:</strong> {ocupados} ocupados de {cupo}
          </span>
          <strong>{lleno ? 'LLENO: no pueden ingresar más vehículos de visitantes' : `${disponibles} disponible(s)`}</strong>
        </div>
      )}

      <div className="card border-0 shadow-sm rounded-4 mb-4 overflow-hidden">
        <div className="card-body p-4 bg-white">
          <h6 className="fw-bold text-muted text-uppercase mb-3 small tracking-wide">
            <i className="bi bi-person-plus-fill text-success me-2"></i>
            {editId ? 'Editar Registro de Visitante' : 'Registrar Ingreso de Visitante / Vehículo'}
          </h6>
          <form onSubmit={handleSubmit} className="row g-3">
            <div className="col-md-4">
              <label className="form-label fw-semibold small text-secondary">Nombre del Visitante</label>
              <div className="input-group">
                <span className="input-group-text bg-light border-end-0 text-muted"><i className="bi bi-person-badge-fill"></i></span>
                <input className="form-control bg-light border-start-0 ps-0" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} required />
              </div>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold small text-secondary">Destino / Apto</label>
              <div className="input-group">
                <span className="input-group-text bg-light border-end-0 text-muted"><i className="bi bi-house-door-fill"></i></span>
                <input className="form-control bg-light border-start-0 ps-0" placeholder="Ej: Apto 501" value={destino} onChange={e => setDestino(e.target.value)} required />
              </div>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold small text-secondary">Placa (Opcional)</label>
              <div className="input-group">
                <span className="input-group-text bg-light border-end-0 text-muted"><i className="bi bi-card-heading"></i></span>
                <input className="form-control bg-light border-start-0 ps-0" placeholder="Ej: ABC-123" value={placa} onChange={e => setPlaca(e.target.value)} />
              </div>
              {placaFija && !editId && (
                <small className="text-success fw-semibold">
                  <i className="bi bi-patch-check-fill me-1"></i>
                  Vehículo fijo de {placaFija.propietario}{placaFija.parqueadero ? ` · Parq. ${placaFija.parqueadero}` : ''}
                </small>
              )}
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button className={`btn w-100 py-2 fw-bold rounded-3 shadow-sm ${editId ? 'btn-warning text-dark' : 'btn-success'}`} disabled={guardando}>
                <i className={`bi ${editId ? 'bi-save' : 'bi-arrow-right-circle-fill'} me-2`}></i>
                {guardando ? '...' : editId ? 'Guardar' : 'Ingresar'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card border-0 shadow-sm rounded-4 overflow-hidden">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="bg-light text-secondary border-bottom">
              <tr className="small text-uppercase tracking-wider">
                <th className="py-3 ps-4">Hora de Ingreso</th>
                <th className="py-3">Visitante</th>
                <th className="py-3">Destino</th>
                <th className="py-3">Placa Vehículo</th>
                <th className="py-3">Estado</th>
                <th className="py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="border-0">
              {lista.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-5 text-muted">
                    <i className="bi bi-shield-slash fs-1 d-block mb-2 text-opacity-50"></i>
                    No hay ingresos activos registrados.
                  </td>
                </tr>
              ) : (
                lista.map(a => {
                  const tieneVehiculo = !!normalizarPlaca(a.placa)
                  const adentro = tieneVehiculo && !a.fecha_salida
                  const esFijo = tieneVehiculo && fijasMap.has(normalizarPlaca(a.placa))
                  const esMio = String(a.idusuario) === String(idUsuario)
                  return (
                    <tr key={a.id}>
                      <td className="ps-4 fw-medium text-dark">
                        <i className="bi bi-clock-history me-2 text-success"></i>
                        {hora(a.fecha_ingreso) || 'Reciente'}
                      </td>
                      <td className="fw-bold text-dark">{a.nombre_visitante}</td>
                      <td><span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-20 px-3 py-2 rounded-3">{a.destino}</span></td>
                      <td>
                        {tieneVehiculo ? <span className="badge bg-dark px-3 py-2">{a.placa}</span> : <span className="text-muted small">Peatonal</span>}
                        {esFijo && <span className="badge bg-primary ms-2">Fijo</span>}
                      </td>
                      <td>
                        {tieneVehiculo
                          ? (adentro
                              ? <span className="badge bg-success">Dentro</span>
                              : <span className="badge bg-secondary">Salió {hora(a.fecha_salida)}</span>)
                          : <span className="text-muted small">—</span>}
                      </td>
                      <td className="text-center">
                        {adentro && (
                          <button className="btn btn-sm btn-outline-success rounded-3 px-3 shadow-sm me-2" onClick={() => registrarSalida(a)}>
                            <i className="bi bi-box-arrow-right me-1"></i> Salida
                          </button>
                        )}
                        {esMio && (
                          <button className="btn btn-sm btn-outline-warning rounded-3 px-3 shadow-sm" onClick={() => prepararEdicion(a)}>
                            <i className="bi bi-pencil-square me-1"></i> Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}