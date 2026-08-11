(function () {
  'use strict';

  const DIAS = [
    { key: 'lun', label: 'L' },
    { key: 'mar', label: 'M' },
    { key: 'mie', label: 'M' },
    { key: 'jue', label: 'J' },
    { key: 'vie', label: 'V' }
  ];
  const DIA_LABELS = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie' };

  const root = document.getElementById('root');

  const emptyAsientoLeg = () => ({ horarioKey: '', seats: [], excOpen: false, exceptions: {} });
  const emptyForm = () => ({
    nombre: '', barrio: '', tramos: '', mail: '', telefono: '', monto: '', estado: 'pendiente', fecha: '',
    tipoViaje: 'ambos', dias: [], horarios: {},
    asientos: { ida: emptyAsientoLeg(), vuelta: emptyAsientoLeg() }
  });

  const state = {
    screen: 'loading', // loading | auth | app
    authMode: 'login', // login | register | join
    authError: '',
    authBusy: false,
    token: localStorage.getItem('traslados_token') || '',
    user: null,
    workspace: null,
    view: 'form', // form | tramos | list
    contacts: [],
    search: '',
    sortKey: 'nombre',
    sortDir: 'asc',
    filterFrom: '',
    filterTo: '',
    filterTipo: 'todos',
    tramosFilterDia: '',
    tramosFilterHora: '',
    form: emptyForm(),
    formError: '',
    savedFlash: false,
    editingContact: null,
    deletingContact: null,
    viewingContact: null,
    confirmZeroTramos: null,
    seatMaps: [],
    seatMapView: '',
    seatMapDia: '', // '' = ocupacion general (todos los dias); 'lun'..'vie' = ver ese dia puntual
    accountOpen: false,
    deferredInstallPrompt: null,
    pushState: 'unknown', // unknown | unsupported | default | denied | subscribed
    syncStatus: ''
  };

  let pollTimer = null;

  // ---------- API ----------
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) {
      logout();
      throw new Error((data && data.error) || 'Sesión expirada.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Error de red.');
    return data;
  }

  function setPath(path, value) {
    const parts = path.split('.');
    let obj = state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
  }

  // ---------- render ----------
  function render() {
    const active = document.activeElement;
    const activeId = active && active.id;
    let selStart = null, selEnd = null;
    if (active && 'selectionStart' in active) {
      try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) {}
    }
    const scrollY = window.scrollY;
    root.innerHTML = state.screen === 'auth' ? renderAuth() : state.screen === 'app' ? renderApp() : renderLoading();
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (selStart !== null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
        }
      }
    }
    window.scrollTo(0, scrollY);
  }

  function corners() {
    return '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function segOpt(scope, field, value, label, current) {
    const checked = current === value ? 'checked' : '';
    return `<label class="seg-opt"><input type="radio" name="${scope}-${field}" value="${value}" data-action="seg" data-scope="${scope}" data-field="${field}" ${checked}/>${label}</label>`;
  }

  function horarioPorDia(scope, obj) {
    const dias = obj.dias || [];
    if (!dias.length) return '';
    const path = scope === 'form' ? 'form.horarios' : 'editingContact.horarios';
    const selected = DIAS.filter(d => dias.includes(d.key));
    return `
    <div class="field">
      <label>Horario por día</label>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${selected.map(d => {
          const h = (obj.horarios && obj.horarios[d.key]) || { ida: '', vuelta: '' };
          return `
          <div style="display:flex;gap:8px;align-items:center">
            <span style="width:32px;font-size:12.5px;font-weight:600;flex-shrink:0">${DIA_LABELS[d.key]}</span>
            <input type="time" class="input" data-bind="${path}.${d.key}.ida" value="${esc(h.ida)}" placeholder="Ida" style="flex:1;min-width:0" />
            <input type="time" class="input" data-bind="${path}.${d.key}.vuelta" value="${esc(h.vuelta)}" placeholder="Vuelta" style="flex:1;min-width:0" />
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // ---------- seat picker (shared shape with the public landing page) ----------
  function legPrefix(leg) { return leg === 'ida' ? 'ingreso' : 'salida'; }
  function seatMapsFor(prefix) { return state.seatMaps.filter(m => m.horarioKey.indexOf(prefix) === 0); }
  function seatMapByKey(key) { return state.seatMaps.find(m => m.horarioKey === key); }

  function ensureFormAsientoDefaults() {
    ['ida', 'vuelta'].forEach((leg) => {
      const a = state.form.asientos[leg];
      if (!a.horarioKey) {
        const maps = seatMapsFor(legPrefix(leg));
        if (maps.length) a.horarioKey = maps[0].horarioKey;
      }
    });
  }

  // ---------- day-accurate occupancy (computed from contacts, not the
  // shared seat_maps.occupied flag which doesn't know about days) ----------
  function contactSeatsForDay(contact, horarioKey, dia) {
    const ids = new Set();
    if (!contact.dias || !contact.dias.includes(dia)) return ids;
    const asientos = contact.asientos || {};
    ['ida', 'vuelta'].forEach((leg) => {
      const a = asientos[leg];
      if (!a) return;
      const ex = a.exceptions && a.exceptions[dia];
      if (ex) {
        if (ex.horarioKey === horarioKey) (ex.seats || []).forEach((s) => ids.add(s));
      } else if (a.horarioKey === horarioKey) {
        (a.seats || []).forEach((s) => ids.add(s));
      }
    });
    return ids;
  }

  function occupantsForDay(horarioKey, dia) {
    const list = [];
    state.contacts.forEach((c) => {
      if (c.activoTramos === false) return;
      const seats = contactSeatsForDay(c, horarioKey, dia);
      if (seats.size) list.push({ nombre: c.nombre, seats: Array.from(seats).sort((a, b) => Number(a) - Number(b)) });
    });
    return list;
  }

  function occupiedSeatIdsForDay(horarioKey, dia) {
    const ids = new Set();
    occupantsForDay(horarioKey, dia).forEach((o) => o.seats.forEach((s) => ids.add(s)));
    return ids;
  }

  function vanOutlineSvg() {
    return `<svg class="van-outline" viewBox="0 0 260 360" preserveAspectRatio="none" aria-hidden="true">
      <path class="van-body" d="M75,0 L185,0 A75,75 0 0 1 260,75 L260,344 A16,16 0 0 1 244,360 L16,360 A16,16 0 0 1 0,344 L0,75 A75,75 0 0 1 75,0 Z"/>
      <path class="van-windshield" d="M16,54 Q130,32 244,54"/>
      <rect class="van-mirror" x="-12" y="62" width="12" height="24" rx="4"/>
      <rect class="van-mirror" x="260" y="62" width="12" height="24" rx="4"/>
    </svg>`;
  }

  // Which seats are already taken for a horario, across a specific set of
  // days — not just the flat horario-wide flag — so picking a seat for a
  // new client only blocks seats actually taken on the day(s) they travel.
  function computeLegOccupied(map, days) {
    if (!map) return new Set();
    if (!days || !days.length) {
      return new Set(map.seats.filter((s) => s.occupied).map((s) => s.id));
    }
    const ids = new Set();
    days.forEach((dia) => occupiedSeatIdsForDay(map.horarioKey, dia).forEach((s) => ids.add(s)));
    return ids;
  }

  function pickSeatButton(s, selectedIds, scope, occupiedIds) {
    const isSelected = selectedIds.includes(s.id);
    const isOccupied = occupiedIds.has(s.id);
    const cls = ['seat'];
    if (isSelected) cls.push('selected');
    else if (isOccupied) cls.push('occupied');
    const disabled = (isOccupied && !isSelected) ? 'disabled' : '';
    return `<button type="button" class="${cls.join(' ')}" data-action="pick-seat" data-scope="${esc(scope)}" data-seat="${esc(s.id)}" ${disabled}>${esc(s.id)}</button>`;
  }

  function renderSeatPlan(map, selectedIds, scope, occupiedIds) {
    if (!map) return '<p class="text-muted" style="font-size:13px;margin:4px 0 0">Cargando asientos…</p>';
    occupiedIds = occupiedIds || new Set(map.seats.filter((s) => s.occupied).map((s) => s.id));
    const byRow = {};
    map.seats.forEach((s) => { (byRow[s.row] = byRow[s.row] || []).push(s); });
    const rowNums = Object.keys(byRow).map(Number).sort((a, b) => a - b);
    return `
    <div class="van-plan">
      ${vanOutlineSvg()}
      <div class="van-plan-label">Frente</div>
      <div class="van-seats">
        ${rowNums.map((r) => `
        <div class="van-row" data-row="${r}">
          ${r === rowNums[0] ? '<div class="van-driver">Conductor</div>' : ''}
          ${byRow[r].slice().sort((a, b) => a.col - b.col).map((s) => pickSeatButton(s, selectedIds, scope, occupiedIds)).join('')}
        </div>`).join('')}
      </div>
    </div>`;
  }

  function resolveAsientoTarget(scope) {
    const [leg, dia] = scope.split(':');
    const a = state.form.asientos[leg];
    if (!a) return null;
    if (!dia) return a;
    return a.exceptions[dia] || null;
  }

  function renderAsientoLeg(leg, label) {
    const f = state.form;
    const a = f.asientos[leg];
    const maps = seatMapsFor(legPrefix(leg));
    if (!maps.length) {
      return `<div class="field"><label>${esc(label)}</label><p class="text-muted" style="font-size:13px">Cargando horarios…</p></div>`;
    }
    const current = seatMapByKey(a.horarioKey);
    const excDays = DIAS.filter((d) => (f.dias || []).includes(d.key));
    const mainDays = excDays.filter((d) => !a.exceptions[d.key]).map((d) => d.key);
    const occupiedIds = computeLegOccupied(current, mainDays.length ? mainDays : (f.dias || []));
    return `
    <div class="field">
      <label>${esc(label)}</label>
      <div class="van-tabs">
        ${maps.map((m) => `<button type="button" data-action="pick-horario" data-scope="${leg}" data-key="${esc(m.horarioKey)}" class="${m.horarioKey === a.horarioKey ? 'active' : ''}">${esc(m.horarioLabel)}</button>`).join('')}
      </div>
      ${renderSeatPlan(current, a.seats, leg, occupiedIds)}
      <div class="van-legend">
        <span><i class="van-dot free"></i>Libre</span>
        <span><i class="van-dot selected"></i>Seleccionado</span>
        <span><i class="van-dot occupied"></i>Ocupado</span>
      </div>
      ${excDays.length > 1 ? `
      <button type="button" class="btn btn-ghost" data-action="toggle-asiento-exc" data-leg="${leg}" style="align-self:flex-start;font-size:13px;padding-left:0">
        ${a.excOpen ? '– Ocultar asiento distinto por día' : '+ Asiento distinto algún día'}
      </button>
      ${a.excOpen ? renderAsientoExceptions(leg, excDays) : ''}` : ''}
    </div>`;
  }

  function renderAsientoExceptions(leg, excDays) {
    const f = state.form;
    const a = f.asientos[leg];
    const maps = seatMapsFor(legPrefix(leg));
    return `
    <div class="asiento-exceptions">
      <div class="van-tabs">
        ${excDays.map((d) => `<button type="button" data-action="toggle-exc-day" data-leg="${leg}" data-dia="${d.key}" class="${a.exceptions[d.key] ? 'active' : ''}">${esc(DIA_LABELS[d.key])}</button>`).join('')}
      </div>
      ${excDays.filter((d) => a.exceptions[d.key]).map((d) => {
        const ex = a.exceptions[d.key];
        const scope = leg + ':' + d.key;
        const exMap = seatMapByKey(ex.horarioKey);
        const occupiedIds = computeLegOccupied(exMap, [d.key]);
        return `
        <div class="asiento-exception-day">
          <div class="asiento-exception-day-title">${esc(DIA_LABELS[d.key])}</div>
          <div class="van-tabs">
            ${maps.map((m) => `<button type="button" data-action="pick-horario" data-scope="${scope}" data-key="${esc(m.horarioKey)}" class="${m.horarioKey === ex.horarioKey ? 'active' : ''}">${esc(m.horarioLabel)}</button>`).join('')}
          </div>
          ${renderSeatPlan(exMap, ex.seats, scope, occupiedIds)}
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderLoading() {
    return '<div class="auth-wrap"><div class="text-muted">Cargando…</div></div>';
  }

  // ---------- auth screen ----------
  function renderAuth() {
    const m = state.authMode;
    return `
    <div class="auth-wrap">
      <div class="auth-card card blueprint elev-md" style="padding:var(--space-6)">
        ${corners()}
        <div style="font-family:var(--font-heading);font-weight:600;font-size:22px;margin-bottom:4px">Traslados Privados</div>
        <div class="text-muted" style="font-size:12.5px;margin-bottom:16px">Carga de clientes de traslado — web y celular, sincronizado con tu asistente.</div>
        <div class="auth-switch">
          <button type="button" data-action="auth-mode" data-mode="login" class="${m === 'login' ? 'active' : ''}">Iniciar sesión</button>
          <button type="button" data-action="auth-mode" data-mode="register" class="${m === 'register' ? 'active' : ''}">Crear cuenta</button>
          <button type="button" data-action="auth-mode" data-mode="join" class="${m === 'join' ? 'active' : ''}">Unirme con código</button>
        </div>
        <form data-form="auth" style="display:flex;flex-direction:column;gap:12px">
          ${m !== 'login' ? '<div class="field"><label>Tu nombre</label><input id="a-name" class="input" placeholder="Ej: Martina" required /></div>' : ''}
          <div class="field"><label>Email</label><input id="a-email" type="email" class="input" placeholder="nombre@mail.com" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required /></div>
          <div class="field"><label>Contraseña</label><input id="a-password" type="password" class="input" placeholder="Mínimo 8 caracteres" required minlength="8" /></div>
          ${m === 'register' ? '<div class="field"><label>Nombre del espacio de trabajo</label><input id="a-workspace" class="input" placeholder="Ej: Traslados Privados" /></div>' : ''}
          ${m === 'join' ? '<div class="field"><label>Código de invitación</label><input id="a-code" class="input" placeholder="Ej: TRASLADOS-8K3F" required /></div>' : ''}
          ${state.authError ? `<div class="error-msg">${esc(state.authError)}</div>` : ''}
          <button type="submit" class="btn btn-primary btn-block" ${state.authBusy ? 'disabled' : ''}>${m === 'login' ? 'Entrar' : m === 'register' ? 'Crear cuenta' : 'Unirme'}</button>
        </form>
        ${m === 'register' ? '<div class="text-muted" style="font-size:11.5px;margin-top:10px">Vas a recibir un código para compartir con tu asistente y que cargue contactos desde su computadora.</div>' : ''}
        ${m === 'join' ? '<div class="text-muted" style="font-size:11.5px;margin-top:10px">Pedile el código de invitación a quien ya creó el espacio de trabajo.</div>' : ''}
      </div>
    </div>`;
  }

  // ---------- app screen ----------
  function renderApp() {
    const listClass = state.view === 'list' ? 'is-list' : '';
    return `
    <div class="shell ${listClass}">
      ${renderNav()}
      ${renderNotifBanner()}
      <div class="admin-body">
        ${renderTabs()}
        <div class="admin-content">
          ${state.view === 'form' ? renderFormView() : ''}
          ${state.view === 'tramos' ? renderTramosView() : ''}
          ${state.view === 'asientos' ? renderAsientosView() : ''}
          ${state.view === 'list' ? renderListView() : ''}
        </div>
      </div>
    </div>
    ${state.editingContact ? renderEditDialog() : ''}
    ${state.deletingContact ? renderDeleteDialog() : ''}
    ${state.viewingContact ? renderDetailDialog() : ''}
    ${state.confirmZeroTramos ? renderConfirmZeroDialog() : ''}
    ${state.accountOpen ? renderAccountDialog() : ''}`;
  }

  function renderNav() {
    return `
    <div class="app-nav">
      <div class="mark">T</div>
      <div style="flex:1;min-width:0">
        <div class="title">Traslados Privados</div>
        <div class="subtitle">${esc(state.user ? state.user.displayName : '')}</div>
      </div>
      <button type="button" data-action="toggle-theme" class="btn btn-icon btn-secondary" aria-label="Cambiar tema claro/oscuro">${themeIcon()}</button>
      <button type="button" data-action="open-account" class="btn btn-secondary">Cuenta</button>
    </div>`;
  }

  function themeIcon() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return isLight
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  }

  function renderNotifBanner() {
    if (state.pushState === 'subscribed' || state.pushState === 'unsupported' || state.pushState === 'unknown') return '';
    if (state.pushState === 'denied') {
      return '<div class="notif-banner"><span>Notificaciones bloqueadas por el navegador. Activalas en la configuración del sitio para recibir avisos.</span></div>';
    }
    return `
    <div class="notif-banner">
      <span>Activá las notificaciones para enterarte cuando tu asistente cargue un cliente nuevo.</span>
      <button type="button" data-action="enable-push" class="btn btn-primary">Activar</button>
    </div>`;
  }

  function renderTabs() {
    const v = state.view;
    return `
    <div class="tab-bar">
      <button type="button" data-action="set-view" data-view="form" class="${v === 'form' ? 'active' : ''}">Nuevo cliente</button>
      <button type="button" data-action="set-view" data-view="tramos" class="${v === 'tramos' ? 'active' : ''}">Tramos</button>
      <button type="button" data-action="set-view" data-view="asientos" class="${v === 'asientos' ? 'active' : ''}">Asientos</button>
      <button type="button" data-action="set-view" data-view="list" class="${v === 'list' ? 'active' : ''}">Contactos (${state.contacts.length})</button>
    </div>`;
  }

  function renderFormView() {
    const f = state.form;
    return `
    <div class="view-pad">
      <form data-form="new-contact" class="card blueprint elev-md" style="padding:18px 16px;display:flex;flex-direction:column;gap:14px">
        ${corners()}
        <div style="font-family:var(--font-heading);font-weight:600;font-size:20px">Nuevo cliente</div>
        <div class="field"><label>Nombre y apellido</label><input id="f-nombre" class="input" data-bind="form.nombre" value="${esc(f.nombre)}" placeholder="Ej: Martina Ibáñez" required /></div>
        <div class="field"><label>Barrio</label><input id="f-barrio" class="input" data-bind="form.barrio" value="${esc(f.barrio)}" placeholder="Ej: Nordelta" /></div>
        <div style="display:flex;gap:12px">
          <div class="field" style="flex:1"><label>Cantidad de tramos</label><input id="f-tramos" type="text" inputmode="numeric" pattern="[0-9]*" class="input" data-bind="form.tramos" value="${esc(f.tramos)}" placeholder="0" /></div>
          <div class="field" style="flex:1"><label>Monto abonado</label>
            <div style="position:relative">
              <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:13px;color:color-mix(in srgb, var(--color-text) 55%, transparent)">$</span>
              <input id="f-monto" type="text" inputmode="decimal" class="input" style="padding-left:24px" data-bind="form.monto" value="${esc(f.monto)}" placeholder="0" />
            </div>
          </div>
        </div>
        <div class="field"><label>Email</label><input id="f-mail" type="email" class="input" data-bind="form.mail" value="${esc(f.mail)}" placeholder="nombre@mail.com" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" /></div>
        <div class="field"><label>Teléfono</label><input id="f-telefono" type="tel" class="input" data-bind="form.telefono" value="${esc(f.telefono)}" placeholder="11 1234-5678" /></div>
        <div class="field"><label>Fecha</label><input id="f-fecha" type="date" class="input" data-bind="form.fecha" value="${esc(f.fecha)}" /></div>
        <div class="field">
          <label>Días de traslado</label>
          <div class="day-picker">
            ${DIAS.map(d => `<button type="button" class="day-circle ${f.dias.includes(d.key) ? 'active' : ''}" data-action="toggle-dia" data-key="${d.key}">${d.label}</button>`).join('')}
          </div>
        </div>
        ${horarioPorDia('form', f)}
        <div class="field"><label>Tipo de viaje</label><div class="seg">
          ${segOpt('form', 'tipoViaje', 'ida', 'Ida', f.tipoViaje)}
          ${segOpt('form', 'tipoViaje', 'vuelta', 'Vuelta', f.tipoViaje)}
          ${segOpt('form', 'tipoViaje', 'ambos', 'Ambos', f.tipoViaje)}
        </div></div>
        ${f.tipoViaje !== 'vuelta' ? renderAsientoLeg('ida', 'Asiento de ida') : ''}
        ${f.tipoViaje !== 'ida' ? renderAsientoLeg('vuelta', 'Asiento de vuelta') : ''}
        <div class="field"><label>Estado</label><div class="seg">
          ${segOpt('form', 'estado', 'pendiente', 'Pendiente', f.estado)}
          ${segOpt('form', 'estado', 'pagado', 'Pagado', f.estado)}
          ${segOpt('form', 'estado', 'sin_tramos', 'Sin tramos', f.estado)}
        </div></div>
        ${state.formError ? `<div class="error-msg">${esc(state.formError)}</div>` : ''}
        ${state.savedFlash ? '<div class="flash">Cliente guardado correctamente.</div>' : ''}
        <button type="submit" class="btn btn-primary">Guardar cliente</button>
      </form>
    </div>`;
  }

  function horarioLineForContact(c) {
    if (!c.dias || !c.dias.length) return 'Sin días asignados';
    return DIAS.filter(d => c.dias.includes(d.key)).map(d => {
      const h = (c.horarios && c.horarios[d.key]) || {};
      const tiempo = (h.ida || h.vuelta) ? ` ${h.ida || '—'}/${h.vuelta || '—'}` : '';
      return `${DIA_LABELS[d.key]}${tiempo}`;
    }).join(' · ');
  }

  function getTramosFiltered() {
    let rows = state.contacts.filter(c => c.activoTramos !== false);
    if (state.tramosFilterDia) {
      rows = rows.filter(c => c.dias && c.dias.includes(state.tramosFilterDia));
      if (state.tramosFilterHora) {
        rows = rows.filter(c => {
          const h = (c.horarios && c.horarios[state.tramosFilterDia]) || {};
          return h.ida === state.tramosFilterHora || h.vuelta === state.tramosFilterHora;
        });
      }
    }
    return rows;
  }

  function renderTramosView() {
    const rows = getTramosFiltered();
    return `
    <div class="view-pad">
      <div>
        <div style="font-family:var(--font-heading);font-weight:600;font-size:20px">Tramos por cliente</div>
        <div class="text-muted" style="font-size:12.5px">Ajustá con + y − la cantidad de tramos contratados por cada cliente.</div>
      </div>
      <div class="filter-box">
        <div class="filter-head"><span>Filtrar por día y horario</span>
          ${(state.tramosFilterDia || state.tramosFilterHora) ? '<button type="button" data-action="clear-tramos-filter" class="btn btn-ghost" style="font-size:11.5px;padding:0">Quitar filtro</button>' : ''}
        </div>
        <div class="seg" style="align-self:stretch">
          ${segOpt('tramosfiltro', 'dia', '', 'Todos', state.tramosFilterDia)}
          ${DIAS.map(d => segOpt('tramosfiltro', 'dia', d.key, d.label, state.tramosFilterDia)).join('')}
        </div>
        ${state.tramosFilterDia ? `<div class="filter-row"><div class="field" style="flex:1"><label>Horario exacto (opcional)</label><input id="tramos-filter-hora" type="time" class="input" data-bind="tramosFilterHora" value="${esc(state.tramosFilterHora)}" /></div></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map(c => `
        <div class="tramos-row">
          <div style="min-width:0">
            <div class="name">${esc(c.nombre)}</div>
            <div class="barrio">${esc(c.barrio)}</div>
            <div class="text-muted" style="font-size:11.5px;margin-top:2px">${esc(horarioLineForContact(c))}</div>
          </div>
          <div class="stepper">
            <button type="button" data-action="adjust-tramos" data-id="${c.id}" data-delta="-1">&minus;</button>
            <div class="val">${c.tramos}</div>
            <button type="button" data-action="adjust-tramos" data-id="${c.id}" data-delta="1">+</button>
          </div>
        </div>`).join('')}
      </div>
      ${rows.length === 0 ? `<div class="empty-note">${state.contacts.length === 0 ? 'Todavía no cargaste clientes.' : 'No hay contactos que coincidan con el filtro.'}</div>` : ''}
    </div>`;
  }

  function seatButton(horarioKey, s) {
    const cls = ['seat'];
    if (s.occupied) cls.push('occupied');
    return `<button type="button" class="${cls.join(' ')}" data-action="toggle-seat" data-key="${esc(horarioKey)}" data-seat="${esc(s.id)}" data-occupied="${s.occupied ? '1' : ''}">${esc(s.id)}</button>`;
  }

  function seatButtonReadOnly(s, occupiedIds) {
    const cls = ['seat'];
    if (occupiedIds.has(s.id)) cls.push('occupied');
    return `<button type="button" class="${cls.join(' ')}" disabled>${esc(s.id)}</button>`;
  }

  function renderAsientosView() {
    const maps = state.seatMaps;
    if (!maps.length) {
      return '<div class="view-pad"><div class="empty-note">Cargando asientos…</div></div>';
    }
    const current = maps.find(m => m.horarioKey === state.seatMapView) || maps[0];
    const dia = state.seatMapDia;
    const byRow = {};
    current.seats.forEach(s => { (byRow[s.row] = byRow[s.row] || []).push(s); });
    const rowNums = Object.keys(byRow).map(Number).sort((a, b) => a - b);

    const occupiedIds = dia ? occupiedSeatIdsForDay(current.horarioKey, dia) : null;
    const libres = dia ? current.seats.filter(s => !occupiedIds.has(s.id)).length : current.seats.filter(s => !s.occupied).length;
    const occupants = dia ? occupantsForDay(current.horarioKey, dia) : [];

    return `
    <div class="view-pad">
      <div>
        <div style="font-family:var(--font-heading);font-weight:600;font-size:20px">Asientos</div>
        <div class="text-muted" style="font-size:12.5px">${dia ? 'Vista de solo lectura: quién tiene asiento asignado ese día, calculado a partir de los clientes cargados.' : 'Tocá un asiento para marcarlo ocupado o libre. Se actualiza al instante en la página pública.'}</div>
      </div>
      <div class="van-tabs">
        ${maps.map(m => `<button type="button" data-action="set-seatmap" data-key="${esc(m.horarioKey)}" class="${m.horarioKey === current.horarioKey ? 'active' : ''}">${esc(m.horarioLabel)}</button>`).join('')}
      </div>
      <div class="field" style="margin:0">
        <label>Ver ocupación</label>
        <div class="van-tabs">
          <button type="button" data-action="set-seat-dia" data-dia="" class="${!dia ? 'active' : ''}">General</button>
          ${DIAS.map(d => `<button type="button" data-action="set-seat-dia" data-dia="${d.key}" class="${dia === d.key ? 'active' : ''}">${esc(DIA_LABELS[d.key])}</button>`).join('')}
        </div>
      </div>
      <div class="van-wrap">
        <div class="van-plan">
          ${vanOutlineSvg()}
          <div class="van-plan-label">Frente</div>
          <div class="van-seats">
            ${rowNums.map(r => `
            <div class="van-row" data-row="${r}">
              ${r === rowNums[0] ? '<div class="van-driver">Conductor</div>' : ''}
              ${byRow[r].slice().sort((a, b) => a.col - b.col).map(s => dia ? seatButtonReadOnly(s, occupiedIds) : seatButton(current.horarioKey, s)).join('')}
            </div>`).join('')}
          </div>
        </div>
        <div class="van-side">
          <div class="van-legend">
            <span><i class="van-dot free"></i>Libre</span>
            <span><i class="van-dot occupied"></i>Ocupado</span>
          </div>
          <p class="text-muted" style="font-size:13px;margin:0">${libres} de ${current.seats.length} libres para "${esc(current.horarioLabel)}"${dia ? ' el ' + esc(DIA_LABELS[dia]) : ''}.</p>
          ${dia ? `
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
            ${occupants.length
              ? occupants.map(o => `<div style="font-size:13px"><strong>${esc(o.nombre)}</strong> — asiento ${esc(o.seats.join(', '))}</div>`).join('')
              : '<p class="text-muted" style="font-size:13px;margin:0">Nadie tiene asiento asignado este día en este horario.</p>'}
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function getFilteredSorted() {
    const q = state.search.trim().toLowerCase();
    let list = state.contacts;
    if (q) list = list.filter(c => c.nombre.toLowerCase().includes(q) || (c.barrio || '').toLowerCase().includes(q));
    if (state.filterFrom) list = list.filter(c => c.fecha && c.fecha >= state.filterFrom);
    if (state.filterTo) list = list.filter(c => c.fecha && c.fecha <= state.filterTo);
    if (state.filterTipo !== 'todos') list = list.filter(c => (c.tipoViaje || 'ambos') === state.filterTipo);
    const key = state.sortKey, dir = state.sortDir;
    return list.slice().sort((a, b) => {
      let av = a[key], bv = b[key];
      if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function fmtMoney(n) { return '$ ' + Number(n || 0).toLocaleString('es-AR'); }
  function fmtFecha(f) { return f ? f.split('-').reverse().join('/') : '—'; }
  function tipoLabel(v) { return v === 'ida' ? 'Ida' : v === 'vuelta' ? 'Vuelta' : 'Ambos'; }
  function estadoInfo(estado) {
    if (estado === 'pagado') return { label: 'Pagado', bg: 'var(--color-accent-100)', fg: 'var(--color-accent-800)' };
    if (estado === 'sin_tramos') return { label: 'Sin tramos', bg: 'var(--color-accent-2-100)', fg: 'var(--color-accent-2-800)' };
    return { label: 'Pendiente', bg: 'var(--color-neutral-100)', fg: 'var(--color-neutral-800)' };
  }

  function renderListView() {
    const rows = getFilteredSorted();
    const total = state.contacts.length;
    const totalMonto = state.contacts.reduce((s, c) => s + (Number(c.monto) || 0), 0);
    const pendientes = state.contacts.filter(c => c.estado !== 'pagado').length;
    const arrow = (key) => state.sortKey === key ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    return `
    <div class="view-pad">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:var(--font-heading);font-weight:600;font-size:20px">Contactos</div>
        <button type="button" data-action="export-excel" class="btn btn-secondary">Exportar Excel</button>
      </div>
      ${state.deferredInstallPrompt ? '<button type="button" data-action="install-app" class="btn btn-primary btn-block">Instalar app (acceso directo a Tramos)</button>' : ''}
      <div class="stat-grid">
        <div class="card blueprint elev-sm">${corners()}<div class="card-kicker">Contactos</div><div class="card-title">${total}</div></div>
        <div class="card blueprint elev-sm">${corners()}<div class="card-kicker">Total abonado</div><div class="card-title stat-money">${fmtMoney(totalMonto)}</div></div>
        <div class="card blueprint elev-sm">${corners()}<div class="card-kicker">Pendientes</div><div class="card-title">${pendientes}</div></div>
      </div>
      <input id="search" class="input" data-bind="search" value="${esc(state.search)}" placeholder="Buscar por nombre o barrio" />
      <div class="filter-box">
        <div class="filter-head">
          <span>Filtrar por fecha</span>
          ${(state.filterFrom || state.filterTo) ? '<button type="button" data-action="clear-date-filter" class="btn btn-ghost" style="font-size:11.5px;padding:0">Quitar filtro</button>' : ''}
        </div>
        <div class="filter-row">
          <div class="field"><label>Desde</label><input id="filter-from" type="date" class="input" data-bind="filterFrom" value="${esc(state.filterFrom)}" /></div>
          <div class="field"><label>Hasta</label><input id="filter-to" type="date" class="input" data-bind="filterTo" value="${esc(state.filterTo)}" /></div>
        </div>
        <div class="seg" style="align-self:stretch">
          ${segOpt('filter', 'tipo', 'todos', 'Todos', state.filterTipo)}
          ${segOpt('filter', 'tipo', 'ida', 'Ida', state.filterTipo)}
          ${segOpt('filter', 'tipo', 'vuelta', 'Vuelta', state.filterTipo)}
          ${segOpt('filter', 'tipo', 'ambos', 'Ambos', state.filterTipo)}
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th class="sortable" data-action="sort" data-key="nombre">Nombre${arrow('nombre')}</th>
            <th class="sortable" data-action="sort" data-key="barrio">Barrio${arrow('barrio')}</th>
            <th class="sortable" data-action="sort" data-key="tramos" style="text-align:center">Tramos${arrow('tramos')}</th>
            <th class="sortable" data-action="sort" data-key="monto" style="text-align:right">Monto${arrow('monto')}</th>
            <th class="sortable" data-action="sort" data-key="fecha">Fecha${arrow('fecha')}</th>
            <th>Viaje</th>
            <th>Estado</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${rows.map(c => `
            <tr data-action="view-contact" data-id="${c.id}" style="cursor:pointer">
              <td style="font-weight:500;white-space:nowrap">${esc(c.nombre)}</td>
              <td style="white-space:nowrap">${esc(c.barrio)}</td>
              <td style="text-align:center">${c.tramos}</td>
              <td style="text-align:right;white-space:nowrap">${fmtMoney(c.monto)}</td>
              <td style="white-space:nowrap">${fmtFecha(c.fecha)}</td>
              <td style="white-space:nowrap">${tipoLabel(c.tipoViaje)}</td>
              <td><span class="status-pill" data-action="toggle-estado" data-id="${c.id}" style="background:${estadoInfo(c.estado).bg};color:${estadoInfo(c.estado).fg}">${estadoInfo(c.estado).label}</span></td>
              <td><div class="row-actions">
                <button type="button" class="edit" data-action="edit-contact" data-id="${c.id}">Editar</button>
                <button type="button" class="delete" data-action="delete-contact" data-id="${c.id}">Eliminar</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length === 0 ? '<div class="empty-note">No se encontraron contactos.</div>' : ''}
      <div class="sync-status">${esc(state.syncStatus)}</div>
    </div>`;
  }

  function renderEditDialog() {
    const ec = state.editingContact;
    return `
    <div class="dialog-backdrop">
      <form data-form="edit-contact" class="dialog blueprint">
        ${corners()}
        <div class="dialog-title">Editar contacto</div>
        <div class="field"><label>Nombre y apellido</label><input id="e-nombre" class="input" data-bind="editingContact.nombre" value="${esc(ec.nombre)}" required /></div>
        <div class="field"><label>Barrio</label><input id="e-barrio" class="input" data-bind="editingContact.barrio" value="${esc(ec.barrio)}" /></div>
        <div style="display:flex;gap:12px">
          <div class="field" style="flex:1"><label>Tramos</label><input id="e-tramos" type="text" inputmode="numeric" pattern="[0-9]*" class="input" data-bind="editingContact.tramos" value="${esc(ec.tramos)}" /></div>
          <div class="field" style="flex:1"><label>Monto abonado</label><input id="e-monto" type="text" inputmode="decimal" class="input" data-bind="editingContact.monto" value="${esc(ec.monto)}" /></div>
        </div>
        <div class="field"><label>Email</label><input id="e-mail" type="email" class="input" data-bind="editingContact.mail" value="${esc(ec.mail)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" /></div>
        <div class="field"><label>Teléfono</label><input id="e-telefono" type="tel" class="input" data-bind="editingContact.telefono" value="${esc(ec.telefono)}" /></div>
        <div class="field"><label>Fecha</label><input id="e-fecha" type="date" class="input" data-bind="editingContact.fecha" value="${esc(ec.fecha)}" /></div>
        <div class="field">
          <label>Días de traslado</label>
          <div class="day-picker">
            ${DIAS.map(d => `<button type="button" class="day-circle ${(ec.dias || []).includes(d.key) ? 'active' : ''}" data-action="toggle-dia-edit" data-key="${d.key}">${d.label}</button>`).join('')}
          </div>
        </div>
        ${horarioPorDia('edit', ec)}
        <div class="field"><label>Tipo de viaje</label><div class="seg">
          ${segOpt('edit', 'tipoViaje', 'ida', 'Ida', ec.tipoViaje)}
          ${segOpt('edit', 'tipoViaje', 'vuelta', 'Vuelta', ec.tipoViaje)}
          ${segOpt('edit', 'tipoViaje', 'ambos', 'Ambos', ec.tipoViaje)}
        </div></div>
        <div class="field"><label>Estado</label><div class="seg">
          ${segOpt('edit', 'estado', 'pendiente', 'Pendiente', ec.estado)}
          ${segOpt('edit', 'estado', 'pagado', 'Pagado', ec.estado)}
          ${segOpt('edit', 'estado', 'sin_tramos', 'Sin tramos', ec.estado)}
        </div></div>
        ${state.formError ? `<div class="error-msg">${esc(state.formError)}</div>` : ''}
        <div class="dialog-actions">
          <button type="button" data-action="cancel-edit" class="btn btn-secondary">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar cambios</button>
        </div>
      </form>
    </div>`;
  }

  function renderDetailDialog() {
    const c = state.viewingContact;
    const row = (label, value) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--color-divider);font-size:13.5px"><span class="text-muted">${esc(label)}</span><span style="font-weight:500;text-align:right">${value}</span></div>`;
    return `
    <div class="dialog-backdrop">
      <div class="dialog blueprint">
        ${corners()}
        <div class="dialog-title">${esc(c.nombre)}</div>
        <div style="display:flex;flex-direction:column;gap:2px">
          ${row('Barrio', esc(c.barrio) || '—')}
          ${row('Tramos', c.tramos)}
          ${row('Monto abonado', fmtMoney(c.monto))}
          ${row('Estado', estadoInfo(c.estado).label)}
          ${row('Email', esc(c.mail) || '—')}
          ${row('Teléfono', esc(c.telefono) || '—')}
          ${row('Fecha', fmtFecha(c.fecha))}
          ${row('Tipo de viaje', tipoLabel(c.tipoViaje))}
          ${row('Días y horarios', esc(horarioLineForContact(c)))}
        </div>
        ${c.activoTramos === false ? '<div class="text-muted" style="font-size:12px">No aparece en la pestaña Tramos.</div>' : ''}
        <div class="dialog-actions">
          <button type="button" data-action="close-detail" class="btn btn-secondary">Cerrar</button>
          ${c.activoTramos === false ? `<button type="button" data-action="restore-tramos" data-id="${c.id}" class="btn btn-secondary">Volver a Tramos</button>` : ''}
          <button type="button" data-action="edit-from-detail" data-id="${c.id}" class="btn btn-primary">Editar</button>
        </div>
      </div>
    </div>`;
  }

  function renderConfirmZeroDialog() {
    const c = state.confirmZeroTramos;
    return `
    <div class="dialog-backdrop">
      <div class="dialog blueprint">
        ${corners()}
        <div class="dialog-title">${esc(c.nombre)} se quedó sin tramos</div>
        <div class="dialog-body">¿Sacarlo de la pestaña Tramos? Va a seguir estando en Contactos, marcado como "Sin tramos".</div>
        <div class="dialog-actions">
          <button type="button" data-action="zero-tramos-keep" class="btn btn-secondary">No, dejarlo</button>
          <button type="button" data-action="zero-tramos-remove" class="btn btn-primary">Sí, sacarlo</button>
        </div>
      </div>
    </div>`;
  }

  function renderDeleteDialog() {
    const c = state.deletingContact;
    return `
    <div class="dialog-backdrop">
      <div class="dialog blueprint">
        ${corners()}
        <div class="dialog-title">Eliminar contacto</div>
        <div class="dialog-body">¿Eliminar a ${esc(c.nombre)}? Esta acción no se puede deshacer.</div>
        <div class="dialog-actions">
          <button type="button" data-action="cancel-delete" class="btn btn-secondary">Cancelar</button>
          <button type="button" data-action="confirm-delete" class="btn btn-primary" style="background:var(--color-accent-800);border-color:var(--color-accent-800)">Eliminar</button>
        </div>
      </div>
    </div>`;
  }

  function renderAccountDialog() {
    const code = state.workspace ? state.workspace.inviteCode : '';
    return `
    <div class="dialog-backdrop">
      <div class="dialog blueprint">
        ${corners()}
        <div class="dialog-title">Tu cuenta</div>
        <div class="dialog-body">Sesión iniciada como <strong>${esc(state.user.displayName)}</strong> (${esc(state.user.email)}).</div>
        <div class="field">
          <label>Código de invitación — compartilo con tu asistente</label>
          <div class="invite-code-box">
            <code>${esc(code)}</code>
            <button type="button" data-action="copy-code" class="btn btn-ghost">Copiar</button>
          </div>
          <div class="text-muted" style="font-size:11.5px;margin-top:6px">Quien ingrese este código en "Unirme con código" va a ver y editar los mismos contactos, y vos vas a recibir una notificación cuando cargue uno nuevo.</div>
        </div>
        <div class="dialog-actions">
          <button type="button" data-action="close-account" class="btn btn-secondary">Cerrar</button>
          <button type="button" data-action="logout" class="btn btn-primary">Cerrar sesión</button>
        </div>
      </div>
    </div>`;
  }

  // ---------- actions ----------
  function toggleDia(obj, key) {
    const dias = obj.dias || (obj.dias = []);
    if (!obj.horarios) obj.horarios = {};
    const idx = dias.indexOf(key);
    if (idx >= 0) { dias.splice(idx, 1); delete obj.horarios[key]; }
    else { dias.push(key); obj.horarios[key] = obj.horarios[key] || { ida: '', vuelta: '' }; }
  }

  function openEdit(id) {
    const c = state.contacts.find(x => String(x.id) === String(id));
    if (!c) return;
    state.editingContact = Object.assign({}, c, { dias: (c.dias || []).slice(), horarios: JSON.parse(JSON.stringify(c.horarios || {})) });
    state.formError = '';
    render();
  }

  function openDelete(id) {
    const c = state.contacts.find(x => String(x.id) === String(id));
    if (!c) return;
    state.deletingContact = c;
    render();
  }

  function openView(id) {
    const c = state.contacts.find(x => String(x.id) === String(id));
    if (!c) return;
    state.viewingContact = c;
    render();
  }

  async function handleAuthSubmit() {
    const email = document.getElementById('a-email').value.trim();
    const password = document.getElementById('a-password').value;
    const nameEl = document.getElementById('a-name');
    const name = nameEl ? nameEl.value.trim() : '';
    const workspaceEl = document.getElementById('a-workspace');
    const workspaceName = workspaceEl ? workspaceEl.value.trim() : '';
    const codeEl = document.getElementById('a-code');
    const inviteCode = codeEl ? codeEl.value.trim() : '';

    state.authError = '';
    state.authBusy = true;
    render();
    try {
      let data;
      if (state.authMode === 'login') {
        data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      } else if (state.authMode === 'register') {
        data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName: name, workspaceName }) });
      } else {
        data = await api('/auth/join', { method: 'POST', body: JSON.stringify({ email, password, displayName: name, inviteCode }) });
      }
      onAuthSuccess(data);
    } catch (err) {
      state.authError = err.message;
    } finally {
      state.authBusy = false;
      render();
    }
  }

  function onAuthSuccess(data) {
    state.token = data.token;
    localStorage.setItem('traslados_token', data.token);
    state.user = data.user;
    state.workspace = data.workspace;
    state.screen = 'app';
    loadContacts();
    loadSeatMaps();
    setupPolling();
    checkPushState();
  }

  function logout() {
    state.token = '';
    state.user = null;
    state.workspace = null;
    state.contacts = [];
    localStorage.removeItem('traslados_token');
    stopPolling();
    state.screen = 'auth';
    state.accountOpen = false;
    render();
  }

  async function copyInviteCode() {
    try { await navigator.clipboard.writeText(state.workspace.inviteCode); } catch (e) {}
  }

  function toggleTheme() {
    const htmlEl = document.documentElement;
    const goingLight = htmlEl.getAttribute('data-theme') !== 'light';
    if (goingLight) htmlEl.setAttribute('data-theme', 'light');
    else htmlEl.removeAttribute('data-theme');
    try { localStorage.setItem('theme', goingLight ? 'light' : 'dark'); } catch (e) {}
    render();
  }

  function handlePickHorario(scope, horarioKey) {
    const target = resolveAsientoTarget(scope);
    if (!target) return;
    target.horarioKey = horarioKey;
    target.seats = [];
    render();
  }

  function handlePickSeat(scope, seatId) {
    const target = resolveAsientoTarget(scope);
    if (!target) return;
    const idx = target.seats.indexOf(seatId);
    if (idx >= 0) target.seats.splice(idx, 1); else target.seats.push(seatId);
    render();
  }

  function toggleAsientoExceptionDay(leg, dia) {
    const a = state.form.asientos[leg];
    if (a.exceptions[dia]) delete a.exceptions[dia];
    else a.exceptions[dia] = { horarioKey: a.horarioKey, seats: a.seats.slice() };
    render();
  }

  async function markSeatOccupied(horarioKey, seatId) {
    try {
      const data = await api('/seats/' + encodeURIComponent(horarioKey) + '/seat/' + encodeURIComponent(seatId), {
        method: 'PATCH',
        body: JSON.stringify({ occupied: true })
      });
      state.seatMaps = state.seatMaps.map(m => m.horarioKey === data.seatMap.horarioKey ? data.seatMap : m);
    } catch (err) { console.error(err); }
  }

  async function applyAsientoSelections(f) {
    const jobs = [];
    ['ida', 'vuelta'].forEach((leg) => {
      const a = f.asientos[leg];
      if (a.horarioKey && a.seats.length) {
        a.seats.forEach((seatId) => jobs.push(markSeatOccupied(a.horarioKey, seatId)));
      }
      Object.keys(a.exceptions).forEach((dia) => {
        const ex = a.exceptions[dia];
        if (ex.horarioKey && ex.seats.length) {
          ex.seats.forEach((seatId) => jobs.push(markSeatOccupied(ex.horarioKey, seatId)));
        }
      });
    });
    if (jobs.length) await Promise.all(jobs);
  }

  function shapeAsientosPayload(f) {
    const shapeLeg = (leg) => {
      const a = f.asientos[leg];
      const exceptions = {};
      Object.keys(a.exceptions).forEach((dia) => {
        const ex = a.exceptions[dia];
        exceptions[dia] = { horarioKey: ex.horarioKey, seats: ex.seats.slice() };
      });
      return { horarioKey: a.horarioKey, seats: a.seats.slice(), exceptions };
    };
    return { ida: shapeLeg('ida'), vuelta: shapeLeg('vuelta') };
  }

  async function handleNewContact() {
    state.formError = '';
    const f = state.form;
    if (!f.nombre || !f.nombre.trim()) { state.formError = 'El nombre es obligatorio.'; render(); return; }
    const payload = Object.assign({}, f, {
      nombre: f.nombre.trim(), barrio: (f.barrio || '').trim(), tramos: Number(f.tramos) || 0, monto: Number(f.monto) || 0,
      asientos: shapeAsientosPayload(f)
    });
    try {
      const data = await api('/contacts', { method: 'POST', body: JSON.stringify(payload) });
      await applyAsientoSelections(f);
      state.contacts = [data.contact, ...state.contacts];
      state.form = emptyForm();
      ensureFormAsientoDefaults();
      state.savedFlash = true;
      render();
      setTimeout(() => { state.savedFlash = false; render(); }, 2200);
    } catch (err) {
      state.formError = err.message;
      render();
    }
  }

  async function handleEditSubmit() {
    state.formError = '';
    const ec = state.editingContact;
    if (!ec.nombre || !ec.nombre.trim()) { state.formError = 'El nombre es obligatorio.'; render(); return; }
    try {
      const data = await api('/contacts/' + ec.id, { method: 'PUT', body: JSON.stringify(ec) });
      state.contacts = state.contacts.map(c => c.id === data.contact.id ? data.contact : c);
      state.editingContact = null;
      render();
    } catch (err) {
      state.formError = err.message;
      render();
    }
  }

  async function toggleEstado(id) {
    try {
      const data = await api('/contacts/' + id + '/estado', { method: 'PATCH' });
      state.contacts = state.contacts.map(c => c.id === data.contact.id ? data.contact : c);
      render();
    } catch (err) { console.error(err); }
  }

  async function adjustTramos(id, delta) {
    try {
      const data = await api('/contacts/' + id + '/tramos', { method: 'PATCH', body: JSON.stringify({ delta }) });
      state.contacts = state.contacts.map(c => c.id === data.contact.id ? data.contact : c);
      render();
    } catch (err) { console.error(err); }
  }

  function handleTramosButton(id, delta) {
    const c = state.contacts.find(x => String(x.id) === String(id));
    if (!c) return;
    if (delta < 0 && c.tramos + delta <= 0 && c.activoTramos !== false) {
      state.confirmZeroTramos = c;
      render();
      return;
    }
    adjustTramos(id, delta);
  }

  async function setActivoTramos(id, activo) {
    try {
      const data = await api('/contacts/' + id + '/activo-tramos', { method: 'PATCH', body: JSON.stringify({ activo }) });
      state.contacts = state.contacts.map(c => c.id === data.contact.id ? data.contact : c);
      if (state.viewingContact && state.viewingContact.id === data.contact.id) state.viewingContact = data.contact;
    } catch (err) { console.error(err); }
    render();
  }

  async function confirmZeroTramosRemove() {
    const c = state.confirmZeroTramos;
    state.confirmZeroTramos = null;
    if (!c) return;
    await adjustTramos(c.id, -1);
    await setActivoTramos(c.id, false);
  }

  async function confirmZeroTramosKeep() {
    const c = state.confirmZeroTramos;
    state.confirmZeroTramos = null;
    if (!c) return;
    await adjustTramos(c.id, -1);
  }

  async function confirmDelete() {
    const id = state.deletingContact.id;
    try {
      await api('/contacts/' + id, { method: 'DELETE' });
      state.contacts = state.contacts.filter(c => c.id !== id);
      state.deletingContact = null;
      render();
    } catch (err) {
      state.formError = err.message;
      render();
    }
  }

  async function loadSeatMaps() {
    try {
      const data = await api('/seats');
      state.seatMaps = data.seatMaps;
      if (!state.seatMapView && state.seatMaps.length) state.seatMapView = state.seatMaps[0].horarioKey;
      ensureFormAsientoDefaults();
      render();
    } catch (err) { console.error(err); }
  }

  async function toggleSeat(horarioKey, seatId, currentlyOccupied) {
    try {
      const data = await api('/seats/' + encodeURIComponent(horarioKey) + '/seat/' + encodeURIComponent(seatId), {
        method: 'PATCH',
        body: JSON.stringify({ occupied: !currentlyOccupied })
      });
      state.seatMaps = state.seatMaps.map(m => m.horarioKey === data.seatMap.horarioKey ? data.seatMap : m);
      render();
    } catch (err) { console.error(err); }
  }

  function setSort(key) {
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = 'asc'; }
    render();
  }

  function exportExcel() {
    const header = ['Nombre', 'Barrio', 'Tramos', 'Email', 'Teléfono', 'Monto abonado', 'Fecha', 'Viaje', 'Días y horarios', 'Estado'];
    const data = getFilteredSorted().map(c => [
      c.nombre, c.barrio, c.tramos, c.mail, c.telefono, Number(c.monto) || 0, c.fecha || '', tipoLabel(c.tipoViaje), horarioLineForContact(c),
      c.estado === 'pagado' ? 'Pagado' : 'Pendiente'
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 9 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 9 }, { wch: 30 }, { wch: 11 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
    XLSX.writeFile(wb, 'contactos_traslado.xlsx');
  }

  async function installApp() {
    const evt = state.deferredInstallPrompt;
    if (!evt) return;
    evt.prompt();
    await evt.userChoice;
    state.deferredInstallPrompt = null;
    render();
  }

  // ---------- sync ----------
  async function loadContacts() {
    try {
      const data = await api('/contacts');
      state.contacts = data.contacts;
      state.syncStatus = 'Sincronizado ' + new Date().toLocaleTimeString('es-AR');
    } catch (err) {
      state.syncStatus = 'No se pudo sincronizar.';
    }
    const active = document.activeElement;
    if (active && active.dataset && active.dataset.bind) return;
    render();
  }
  function setupPolling() {
    stopPolling();
    pollTimer = setInterval(loadContacts, 15000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // ---------- push ----------
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function checkPushState() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      state.pushState = 'unsupported'; render(); return;
    }
    if (Notification.permission === 'denied') { state.pushState = 'denied'; render(); return; }
    if (Notification.permission === 'granted') {
      await subscribePush();
      return;
    }
    state.pushState = 'default';
    render();
  }

  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { state.pushState = perm === 'denied' ? 'denied' : 'default'; render(); return; }
      await subscribePush();
    } catch (err) { console.error(err); }
  }

  async function subscribePush() {
    try {
      const keyData = await api('/push/public-key');
      if (!keyData.enabled) { state.pushState = 'unsupported'; render(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) });
      }
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
      state.pushState = 'subscribed';
      render();
    } catch (err) {
      console.error('No se pudo suscribir a las notificaciones push', err);
    }
  }

  // ---------- event delegation ----------
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'auth-mode': state.authMode = btn.dataset.mode; state.authError = ''; render(); break;
      case 'set-view': state.view = btn.dataset.view; render(); break;
      case 'toggle-dia': toggleDia(state.form, btn.dataset.key); render(); break;
      case 'toggle-dia-edit': toggleDia(state.editingContact, btn.dataset.key); render(); break;
      case 'open-account': state.accountOpen = true; render(); break;
      case 'close-account': state.accountOpen = false; render(); break;
      case 'logout': logout(); break;
      case 'copy-code': copyInviteCode(); break;
      case 'edit-contact': openEdit(btn.dataset.id); break;
      case 'cancel-edit': state.editingContact = null; state.formError = ''; render(); break;
      case 'delete-contact': openDelete(btn.dataset.id); break;
      case 'cancel-delete': state.deletingContact = null; render(); break;
      case 'confirm-delete': confirmDelete(); break;
      case 'view-contact': openView(btn.dataset.id); break;
      case 'close-detail': state.viewingContact = null; render(); break;
      case 'edit-from-detail': state.viewingContact = null; openEdit(btn.dataset.id); break;
      case 'toggle-estado': toggleEstado(btn.dataset.id); break;
      case 'adjust-tramos': handleTramosButton(btn.dataset.id, Number(btn.dataset.delta)); break;
      case 'zero-tramos-keep': confirmZeroTramosKeep(); break;
      case 'zero-tramos-remove': confirmZeroTramosRemove(); break;
      case 'restore-tramos': setActivoTramos(btn.dataset.id, true); break;
      case 'set-seatmap': state.seatMapView = btn.dataset.key; render(); break;
      case 'set-seat-dia': state.seatMapDia = btn.dataset.dia; render(); break;
      case 'toggle-seat': toggleSeat(btn.dataset.key, btn.dataset.seat, btn.dataset.occupied === '1'); break;
      case 'pick-horario': handlePickHorario(btn.dataset.scope, btn.dataset.key); break;
      case 'pick-seat': handlePickSeat(btn.dataset.scope, btn.dataset.seat); break;
      case 'toggle-asiento-exc': { const a = state.form.asientos[btn.dataset.leg]; a.excOpen = !a.excOpen; render(); break; }
      case 'toggle-exc-day': toggleAsientoExceptionDay(btn.dataset.leg, btn.dataset.dia); break;
      case 'sort': setSort(btn.dataset.key); break;
      case 'clear-date-filter': state.filterFrom = ''; state.filterTo = ''; render(); break;
      case 'clear-tramos-filter': state.tramosFilterDia = ''; state.tramosFilterHora = ''; render(); break;
      case 'export-excel': exportExcel(); break;
      case 'install-app': installApp(); break;
      case 'enable-push': enablePush(); break;
      case 'toggle-theme': toggleTheme(); break;
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('input[data-action="seg"]')) {
      const scope = t.dataset.scope, field = t.dataset.field, value = t.value;
      if (scope === 'form') state.form[field] = value;
      else if (scope === 'edit') state.editingContact[field] = value;
      else if (scope === 'filter' && field === 'tipo') state.filterTipo = value;
      else if (scope === 'tramosfiltro' && field === 'dia') { state.tramosFilterDia = value; state.tramosFilterHora = ''; }
      render();
    }
  });

  const NO_RERENDER_FIELDS = ['nombre', 'barrio', 'mail', 'telefono', 'tramos', 'monto', 'ida', 'vuelta'];
  root.addEventListener('input', (e) => {
    const bind = e.target.dataset.bind;
    if (!bind) return;
    setPath(bind, e.target.value);
    if (NO_RERENDER_FIELDS.includes(bind.split('.').pop())) return;
    render();
  });

  root.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'auth') handleAuthSubmit();
    else if (kind === 'new-contact') handleNewContact();
    else if (kind === 'edit-contact') handleEditSubmit();
  });

  // ---------- init ----------
  async function init() {
    render();
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/admin/service-worker.js'); } catch (e) { console.error(e); }
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      render();
    });

    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    if (v === 'tramos' || v === 'list' || v === 'form' || v === 'asientos') state.view = v;

    if (state.token) {
      try {
        const data = await api('/auth/me');
        state.user = data.user;
        state.workspace = data.workspace;
        state.screen = 'app';
        await loadContacts();
        await loadSeatMaps();
        setupPolling();
        checkPushState();
      } catch (e) {
        state.screen = 'auth';
      }
    } else {
      state.screen = 'auth';
    }
    render();
  }

  init();
})();
