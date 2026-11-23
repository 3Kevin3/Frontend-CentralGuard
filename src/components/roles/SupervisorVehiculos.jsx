import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase/client'
import Swal from 'sweetalert2'

const normalizarPlaca = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nombreDe = (v) => `${v.nombre || ''} ${v.apellido || ''}`.trim() || v.usuario
const hora = (f) => f ? new Date(f).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const toast = (title) => Swal.fire({ toast: true, position: 'top-end', icon: 'success', title, timer: 2000, showConfirmButton: false })

// El supervisor registra el ingreso y la salida de vehículos de visitantes.
// Usa la misma tabla `accesos` que el vigilante, así que el vehículo aparece en su control de accesos
// y cuenta para el límite de parqueaderos de visitantes.
export default function SupervisorVehiculos({ usuario, vigilantes = [] }) {
  const idUsuario = usuario?.idusuario
  const [accesos, setAccesos] = useState([])
  const [fijos, setFijos] = useState([])
  const [cupo, setCupo] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const [nombre, setNombre] = useState('')
  const [destino, setDestino] = useState('')
  const [placa, setPlaca] = useState('')

  const [verFiltro, setVerFiltro] = useState('dentro')
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    const [a, f, c] = await Promise.all([
      supabase.from('accesos').select('*').not('placa', 'is', null).order('id', { ascending: false }).limit(300),
      supabase.from('vehiculos_fijos').select('placa, propietario, destino, parqueadero, estado'),
      supabase.from('parqueaderos_config').select('cupo_visitantes').eq('id', 1).maybeSingle()
    ])
    setError(a.error ? a.error.message : '')
    setAccesos((a.data || []).filter(x => normalizarPlaca(x.placa)))
    setFijos((f.data || []).filter(x => x.estado !== 'inactivo'))
    setCupo(c.data?.cupo_visitantes ?? null)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    const canal = supabase.channel('supervisor-vehiculos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accesos' }, () => cargar())
      .subscribe()
    const t = setInterval(cargar, 15000)
    return () => { clearInterval(t); supabase.removeChannel(canal) }
  }, [cargar])

  const fijasMap = useMemo(() => new Map(fijos.map(f => [normalizarPlaca(f.placa), f])), [fijos])
  const dentro = useMemo(() => accesos.filter(a => !a.fecha_salida), [accesos])
  const ocupados = dentro.filter(a => !fijasMap.has(normalizarPlaca(a.placa))).length
  const disponibles = cupo === null ? null : Math.max(cupo - ocupados, 0)
  const lleno = cupo !== null && ocupados >= cupo
  const placaFija = fijasMap.get(normalizarPlaca(placa))

  const nombrePorId = useMemo(() => {
    const m = {}
    vigilantes.forEach(v => { m[String(v.idusuario)] = nombreDe(v) })
    return m
  }, [vigilantes])
  const quien = (a) => String(a.idusuario) === String(idUsuario) ? 'Tú (supervisor)' : (nombrePorId[String(a.idusuario)] || (a.idusuario ? `Usuario #${a.idusuario}` : '—'))

  // Si la placa es de un vehículo fijo, se completan los datos del propietario
  useEffect(() => {
    if (placaFija) {
      setNombre(n => n || placaFija.propietario || '')
      setDestino(d => d || placaFija.destino || '')
    }
  }, [placaFija?.placa])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const placaNorm = normalizarPlaca(placa)
    if (!placaNorm) return Swal.fire('Falta la placa', 'Escribe la placa del vehículo del visitante.', 'warning')

    // Se consulta de nuevo la base de datos: un vigilante pudo haberlo ingresado hace un momento
    const { data: frescos } = await supabase.from('accesos').select('id, placa').is('fecha_salida', null)
    const adentroAhora = (frescos || []).filter(a => normalizarPlaca(a.placa))
    if (adentroAhora.some(a => normalizarPlaca(a.placa) === placaNorm)) {
      await cargar()
      return Swal.fire('Vehículo ya está dentro', `La placa ${placaNorm} ya figura dentro del conjunto. No se puede ingresar de nuevo hasta registrar su salida.`, 'warning')
    }
    if (!placaFija) {
      const ocupadosAhora = adentroAhora.filter(a => !fijasMap.has(normalizarPlaca(a.placa))).length
      if (cupo !== null && ocupadosAhora >= cupo) {
        await cargar()
        return Swal.fire('Parqueaderos llenos', `El límite de parqueaderos para visitantes es ${cupo} y todos están ocupados. Registra la salida de un vehículo antes de dejar ingresar otro.`, 'warning')
      }
    }

    setGuardando(true)
    const { error } = await supabase.from('accesos').insert([{
      nombre_visitante: nombre.trim(),
      destino: destino.trim(),
      placa: placa.trim().toUpperCase(),
      idusuario: idUsuario
    }])
    setGuardando(false)
    if (error) return Swal.fire(error.code === '23505' ? 'Vehículo ya está dentro' : 'Error', error.code === '23505' ? 'Esa placa ya figura dentro del conjunto.' : error.message, error.code === '23505' ? 'warning' : 'error')

    toast(placaFija ? `Vehículo fijo de ${placaFija.propietario}` : 'Vehículo de visitante registrado')
    setNombre(''); setDestino(''); setPlaca('')
    await cargar()
  }

  const registrarSalida = async (a) => {
    const r = await Swal.fire({
      title: '¿Registrar salida?',
      text: `Sale el vehículo ${a.placa} (${a.nombre_visitante}).`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sí, registrar salida', cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return
    const { data, error } = await supabase.from('accesos')
      .update({ fecha_salida: new Date().toISOString() })
      .eq('id', a.id).is('fecha_salida', null).select()
    if (error) return Swal.fire('Error', error.message, 'error')
    if (!data || data.length === 0) {
      await cargar()
      return Swal.fire('Ya estaba registrada', 'La salida de este vehículo ya fue registrada.', 'info')
    }
    toast('Salida registrada')
    await cargar()
  }

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const qp = normalizarPlaca(busqueda)
    return accesos.filter(a => {
      const estOk = verFiltro === 'todos' || !a.fecha_salida
      const txtOk = !q || `${a.nombre_visitante || ''} ${a.destino || ''} ${a.placa || ''}`.toLowerCase().includes(q) || (qp && normalizarPlaca(a.placa).includes(qp))
      return estOk && txtOk
    })
  }, [accesos, verFiltro, busqueda])

  const claseCupo = lleno ? 'alert-danger' : (disponibles !== null && disponibles <= 2) ? 'alert-warning' : 'alert-success'

  return (
    <section className="panel-section">
      {cupo !== null && (
        <div className={`alert ${claseCupo} border-0 shadow-sm d-flex align-items-center justify-content-between flex-wrap gap-2`}>
          <span><i className="bi bi-p-square-fill me-2"></i><strong>Parqueaderos de visitantes:</strong> {ocupados} ocupados de {cupo}</span>
          <strong>{lleno ? 'LLENO: no pueden ingresar más vehículos de visitantes' : `${disponibles} disponible(s)`}</strong>
        </div>
      )}

      <div className="panel-card">
        <span className="eyebrow">VEHÍCULOS DE VISITANTES</span>
        <h3 className="h5 mb-3">Registrar ingreso de un vehículo</h3>
        <form onSubmit={handleSubmit} className="row g-3">
          <div className="col-md-3">
            <label className="form-label fw-semibold small">Placa</label>
            <input className="form-control" placeholder="Ej: ABC123" value={placa} onChange={e => setPlaca(e.target.value)} required />
            {placaFija && (
              <small className="text-success fw-semibold d-block mt-1">
                <i className="bi bi-patch-check-fill me-1"></i>Vehículo fijo de {placaFija.propietario}{placaFija.parqueadero ? ` · Parq. ${placaFija.parqueadero}` : ''}
              </small>
            )}
          </div>
          <div className="col-md-4">
            <label className="form-label fw-semibold small">Nombre del visitante</label>
            <input className="form-control" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} required />
          </div>
          <div className="col-md-3">
            <label className="form-label fw-semibold small">Destino / Apto</label>
            <input className="form-control" placeholder="Ej: Apto 501" value={destino} onChange={e => setDestino(e.target.value)} required />
          </div>
          <div className="col-md-2 d-flex align-items-end">
            <button className="btn btn-primary w-100" disabled={guardando}>
              <i className="bi bi-arrow-right-circle-fill me-2"></i>{guardando ? '...' : 'Ingresar'}
            </button>
          </div>
        </form>
      </div>

      <div className="panel-card mt-4">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <h3 className="h5 mb-0">Vehículos registrados</h3>
          <div className="d-flex gap-2 flex-wrap">
            <span className="badge bg-success">Dentro: {dentro.length}</span>
            <span className="badge bg-secondary">Cargados: {accesos.length}</span>
          </div>
        </div>

        {error && <div className="alert alert-warning border-0">{error}</div>}

        <div className="filters-bar mb-3">
          <div>
            <label>Mostrar</label>
            <select className="form-select form-select-sm" value={verFiltro} onChange={e => setVerFiltro(e.target.value)}>
              <option value="dentro">Solo los que están dentro</option>
              <option value="todos">Todos (con salidas)</option>
            </select>
          </div>
          <div>
            <label>Buscar</label>
            <input className="form-control form-control-sm" placeholder="Placa, visitante o destino..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead><tr><th>Ingreso</th><th>Placa</th><th>Visitante</th><th>Destino</th><th>Registrado por</th><th>Estado</th><th className="text-end">Acciones</th></tr></thead>
            <tbody>
              {visibles.map(a => {
                const adentro = !a.fecha_salida
                const esFijo = fijasMap.has(normalizarPlaca(a.placa))
                return (
                  <tr key={a.id}>
                    <td>{hora(a.fecha_ingreso)}</td>
                    <td><span className="badge bg-dark">{a.placa}</span>{esFijo && <span className="badge bg-primary ms-2">Fijo</span>}</td>
                    <td className="fw-semibold">{a.nombre_visitante}</td>
                    <td>{a.destino}</td>
                    <td>{quien(a)}</td>
                    <td>{adentro ? <span className="badge bg-success">Dentro</span> : <span className="badge bg-secondary">Salió {hora(a.fecha_salida)}</span>}</td>
                    <td className="text-end">
                      {adentro && <button className="btn btn-sm btn-outline-primary" onClick={() => registrarSalida(a)}><i className="bi bi-box-arrow-right me-1"></i>Salida</button>}
                    </td>
                  </tr>
                )
              })}
              {!visibles.length && (
                <tr><td colSpan="7" className="text-center py-4 text-muted">{cargando ? 'Cargando...' : 'No hay vehículos para mostrar.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}