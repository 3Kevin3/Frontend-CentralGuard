import { useEffect, useState } from 'react'
import { supabase } from '../../supabase/client'
import Swal from 'sweetalert2'

const ESTADO = {
  programado: { texto: 'Programado', clase: 'bg-secondary' },
  aceptado: { texto: 'En curso', clase: 'bg-info text-dark' },
  terminado: { texto: 'Terminado', clase: 'bg-success' },
  cerrado: { texto: 'Cerrado', clase: 'bg-dark' }
}

const dia = (f) => String(f || '').slice(0, 10)
const hora = (h) => String(h || '').slice(0, 5)
const horaLocal = (f) => f ? new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''

export default function LibroRondas({ usuario }) {
  const idUsuario = usuario?.idusuario

  // Turnos que el supervisor le asignó a ESTE vigilante
  const [turnos, setTurnos] = useState([])
  const [error, setError] = useState('')
  const hoyStr = new Date().toLocaleDateString('en-CA')

  // Turnos de hoy en adelante, más los que aceptó y todavía no termina (aunque sean de días anteriores)
  const cargarTurnos = async () => {
    if (!idUsuario) return
    const { data, error } = await supabase.from('turnos').select('*')
      .eq('idusuario', idUsuario)
      .or(`fecha.gte.${hoyStr},estado.eq.aceptado`)
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true })
    setError(error ? 'No se pudieron cargar los turnos. Avisa al administrador para que ejecute el SQL pendiente. (' + error.message + ')' : '')
    setTurnos(data || [])
  }

  useEffect(() => {
    if (!idUsuario) return
    cargarTurnos()
    // Sin filtro en el canal: Supabase no envía los DELETE cuando hay filtro,
    // y así el turno desaparece al instante si el supervisor lo elimina.
    const canal = supabase.channel(`turnos-${idUsuario}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'turnos' },
        (payload) => {
          cargarTurnos()
          if (payload.eventType === 'INSERT' && String(payload.new?.idusuario) === String(idUsuario)) {
            Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Tu supervisor te asignó un nuevo turno', timer: 4000, showConfirmButton: false })
          }
        })
      .subscribe()
    const t = setInterval(cargarTurnos, 15000) // respaldo por si el tiempo real no está activo
    return () => { clearInterval(t); supabase.removeChannel(canal) }
  }, [idUsuario])

  const formatoFecha = (f) => {
    try {
      return new Date(dia(f) + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    } catch { return dia(f) }
  }

  // Solo se cambia si el turno sigue en el estado que el vigilante estaba viendo
  // (por ejemplo, si el administrador lo cerró mientras tanto, no se pisa)
  const cambiar = async (t, cambios, mensajeOk) => {
    const { data, error } = await supabase.from('turnos').update(cambios)
      .eq('id', t.id).eq('idusuario', idUsuario).eq('estado', t.estado || 'programado').select()

    if (error) return Swal.fire('Error', error.message, 'error')
    if (!data || data.length === 0) {
      await cargarTurnos()
      return Swal.fire('El turno cambió', 'Este turno ya fue modificado (quizá lo cerró el administrador). Se actualizó la lista.', 'info')
    }
    setTurnos(prev => prev.map(x => x.id === t.id ? data[0] : x))
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: mensajeOk, timer: 2500, showConfirmButton: false })
  }

  const aceptar = async (t) => {
    const r = await Swal.fire({
      title: '¿Aceptar este turno?',
      text: `${formatoFecha(t.fecha)} · ${hora(t.hora_inicio)} - ${hora(t.hora_fin)} · ${t.puesto}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, aceptar',
      cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return
    await cambiar(t, { estado: 'aceptado', fecha_aceptacion: new Date().toISOString() }, 'Turno aceptado. ¡Buen servicio!')
  }

  const terminar = async (t) => {
    const r = await Swal.fire({
      title: '¿Terminar este turno?',
      text: `${formatoFecha(t.fecha)} · ${hora(t.hora_inicio)} - ${hora(t.hora_fin)} · ${t.puesto}`,
      input: 'textarea',
      inputLabel: 'Nota de entrega del puesto (opcional)',
      inputPlaceholder: 'Ej: Entregué el puesto sin novedades',
      showCancelButton: true,
      confirmButtonText: 'Sí, terminar turno',
      cancelButtonText: 'Cancelar'
    })
    if (!r.isConfirmed) return
    await cambiar(t, {
      estado: 'terminado',
      fecha_terminado: new Date().toISOString(),
      nota_terminado: (r.value || '').trim() || null
    }, 'Turno terminado. El administrador lo revisará y cerrará.')
  }

  return (
    <div className="p-4">
      <div className="d-flex align-items-center justify-content-between p-4 mb-4 rounded-4 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%)' }}>
        <div className="d-flex align-items-center">
          <div className="bg-white bg-opacity-20 p-3 rounded-3 me-3 fs-2 d-flex align-items-center justify-content-center" style={{ width: '60px', height: '60px' }}>
            <i className="bi bi-journal-check"></i>
          </div>
          <div>
            <h3 className="fw-bold mb-0">Libro de Rondas Digital</h3>
            <small className="text-white-50">Control de recorrido y supervisiones en tiempo real</small>
          </div>
        </div>
        <span className="badge bg-white text-primary px-3 py-2 rounded-pill fw-bold shadow-sm">
          <i className="bi bi-patch-check-fill me-1"></i> Módulo Activo
        </span>
      </div>

      <div className="card border-0 shadow-sm rounded-4 mb-4 overflow-hidden">
        <div className="card-body p-4 bg-white">
          <h6 className="fw-bold text-muted text-uppercase mb-3 small tracking-wide">
            <i className="bi bi-calendar-check-fill text-primary me-2"></i>
            Mis turnos asignados
          </h6>

          {error && <div className="alert alert-warning border-0 small">{error}</div>}

          {turnos.length === 0 ? (
            <p className="text-muted small mb-0">No tienes turnos programados por tu supervisor.</p>
          ) : (
            <div className="row g-3">
              {turnos.map(t => {
                const estado = t.estado || 'programado'
                const est = ESTADO[estado] || ESTADO.programado
                const esHoy = dia(t.fecha) === hoyStr
                const esFuturo = dia(t.fecha) > hoyStr
                return (
                  <div className="col-md-6 col-lg-4" key={t.id}>
                    <div className={`border rounded-4 p-3 h-100 text-dark d-flex flex-column ${estado === 'aceptado' ? 'border-info bg-info bg-opacity-10' : esHoy ? 'border-primary bg-primary bg-opacity-10' : 'bg-light'}`}>
                      <div className="d-flex justify-content-between align-items-start mb-2 gap-2">
                        <strong className="text-capitalize">{formatoFecha(t.fecha)}</strong>
                        <div className="d-flex gap-1 flex-wrap justify-content-end">
                          {esHoy && estado === 'programado' && <span className="badge bg-primary">HOY</span>}
                          <span className={`badge ${est.clase}`}>{est.texto}</span>
                        </div>
                      </div>
                      <div className="small mb-1"><i className="bi bi-clock me-2 text-primary"></i>{hora(t.hora_inicio)} - {hora(t.hora_fin)}</div>
                      <div className="small mb-1"><i className="bi bi-geo-alt-fill me-2 text-primary"></i>{t.puesto}</div>
                      {t.observaciones && <div className="small text-secondary mt-2"><i className="bi bi-chat-left-text me-2"></i>{t.observaciones}</div>}

                      {t.fecha_aceptacion && <div className="small text-secondary mt-2">Aceptado a las {horaLocal(t.fecha_aceptacion)}</div>}
                      {t.fecha_terminado && <div className="small text-secondary">Terminado a las {horaLocal(t.fecha_terminado)}</div>}

                      <div className="mt-auto pt-3">
                        {estado === 'programado' && (
                          esFuturo
                            ? <small className="text-muted">Podrás aceptarlo el día del turno.</small>
                            : <button className="btn btn-primary btn-sm w-100 fw-bold" onClick={() => aceptar(t)}>✓ Aceptar turno</button>
                        )}
                        {estado === 'aceptado' && (
                          <button className="btn btn-success btn-sm w-100 fw-bold" onClick={() => terminar(t)}>■ Terminar turno</button>
                        )}
                        {estado === 'terminado' && <small className="text-muted">Esperando el cierre del administrador.</small>}
                        {estado === 'cerrado' && <small className="text-muted">Turno cerrado por el administrador.</small>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}