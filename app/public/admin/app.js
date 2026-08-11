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
  const ESTADO_META = {
    pendiente: { label: 'Pendiente', cls: 'status-pendiente' },
    pagado: { label: 'Pagado', cls: 'status-pagado' },
    renovar: { label: 'A renovar', cls: 'status-renovar' }
  };

  const root = document.getElementById('root');

  const emptyForm = () => ({ nombre: '', barrio: '', tramos: '', mail: '', telefono: '', monto: '', estado: 'pendiente', fecha: '', tipoViaje: 'ambos', dias: [], horarioIda: '', horarioVuelta: '', horariosDias: {} });

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
    filterTramosDia: 'todos',
    filterTramosHoraFrom: '',
    filterTramosHoraTo: '',
    form: emptyForm(),
    formError: '',
    savedFlash: false,
    editingContact: null,
    deletingContact: null,
    viewingContact: null,
    tramosZeroConfirm: null,
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
      ${renderTabs()}
      ${state.view === 'form' ? renderFormView() : ''}
      ${state.view === 'tramos' ? renderTramosView() : ''}
      ${state.view === 'list' ? renderListView() : ''}
    </div>
    ${state.editingContact ? renderEditDialog() : ''}
    ${state.deletingContact ? renderDeleteDialog() : ''}
    ${state.viewingContact ? renderDetailDialog() : ''}
    ${state.accountOpen ? renderAccountDialog() : ''}
    ${state.tramosZeroConfirm ? renderTramosZeroDialog() : ''}`;
  }

  function renderNav() {
    return `
    <div class="app-nav">
      <div class="mark">T</div>
      <div style="flex:1;min-width:0">
        <div class="title">Traslados Privados</div>
        <div class="subtitle">${esc(state.user ? state.user.displayName : '')}</div>
      </div>
      <button type="button" data-action="open-account" class="btn btn-secondary">Cuenta</button>
    </div>`;
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
        <div style="display:flex;gap:12px">
          <div class="field" style="flex:1"><label>Horario de ida (general)</label><input id="f-horario-ida" type="time" class="input" data-bind="form.horarioIda" value="${esc(f.horarioIda)}" /></div>
          <div class="field" style="flex:1"><label>Horario de vuelta (general)</label><input id="f-horario-vuelta" type="time" class="input" data-bind="form.horarioVuelta" value="${esc(f.horarioVuelta)}" /></div>
        </div>
        ${renderDiaSchedule('form', f)}
        <div class="field"><label>Tipo de viaje</label><div class="seg">
          ${segOpt('form', 'tipoViaje', 'ida', 'Ida', f.tipoViaje)}
          ${segOpt('form', 'tipoViaje', 'vuelta', 'Vuelta', f.tipoViaje)}
          ${segOpt('form', 'tipoViaje', 'ambos', 'Ambos', f.tipoViaje)}
        </div></div>
        <div class="field"><label>Estado</label><div class="seg">
          ${segOpt('form', 'estado', 'pendiente', 'Pendiente', f.estado)}
          ${segOpt('form', 'estado', 'pagado', 'Pagado', f.estado)}
          ${segOpt('form', 'estado', 'renovar', 'A renovar', f.estado)}
        </div></div>
        ${state.formError ? `<div class="error-msg">${esc(state.formError)}</div>` : ''}
        ${state.savedFlash ? '<div class="flash">Cliente guardado correctamente.</div>' : ''}
        <button type="submit" class="btn btn-primary">Guardar cliente</button>
      </form>
    </div>`;
  }

  function getTramosFiltered() {
    let rows = state.contacts.filter(c => c.enTramos !== false);
    const dia = state.filterTramosDia !== 'todos' ? state.filterTramosDia : '';
    const from = state.filterTramosHoraFrom;
    const to = state.filterTramosHoraTo;
    if (dia) rows = rows.filter(c => (c.dias || []).includes(dia));
    if (from || to) {
      rows = rows.filter(c => {
        const diasToCheck = dia ? [dia] : (c.dias || []);
        if (!diasToCheck.length) return false;
        return diasToCheck.some(d => {
          const eff = horarioEfectivo(c, d);
          const times = [eff.ida, eff.vuelta].filter(Boolean);
          return times.some(t => (!from || t >= from) && (!to || t <= to));
        });
      });
    }
    return rows;
  }

  function renderTramosView() {
    const rows = getTramosFiltered();
    const totalEnTramos = state.contacts.filter(c => c.enTramos !== false).length;
    const filterActive = state.filterTramosDia !== 'todos' || !!state.filterTramosHoraFrom || !!state.filterTramosHoraTo;
    return `
    <div class="view-pad">
      <div>
        <div style="font-family:var(--font-heading);font-weight:600;font-size:20px">Tramos por cliente</div>
        <div class="text-muted" style="font-size:12.5px">Ajustá con + y − la cantidad de tramos contratados por cada cliente.</div>
      </div>
      <div class="filter-box">
        <div class="filter-head">
          <span>Filtrar por día y horario</span>
          ${filterActive ? '<button type="button" data-action="clear-tramos-filter" class="btn btn-ghost" style="font-size:11.5px;padding:0">Quitar filtro</button>' : ''}
        </div>
        <div class="seg" style="align-self:stretch;flex-wrap:wrap">
          ${segOpt('filterTramos', 'dia', 'todos', 'Todos', state.filterTramosDia)}
          ${DIAS.map(d => segOpt('filterTramos', 'dia', d.key, DIA_LABELS[d.key], state.filterTramosDia)).join('')}
        </div>
        <div class="filter-row">
          <div class="field"><label>Desde</label><input id="filter-tramos-from" type="time" class="input" data-bind="filterTramosHoraFrom" value="${esc(state.filterTramosHoraFrom)}" /></div>
          <div class="field"><label>Hasta</label><input id="filter-tramos-to" type="time" class="input" data-bind="filterTramosHoraTo" value="${esc(state.filterTramosHoraTo)}" /></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map(c => `
        <div class="tramos-row">
          <div style="min-width:0">
            <div class="name">${esc(c.nombre)}</div>
            <div class="barrio">${esc(c.barrio)}</div>
            <div class="text-muted" style="font-size:11.5px;margin-top:2px">${esc(diaHorarioResumen(c))}</div>
          </div>
          <div class="stepper">
            <button type="button" data-action="adjust-tramos" data-id="${c.id}" data-delta="-1">&minus;</button>
            <div class="val">${c.tramos}</div>
            <button type="button" data-action="adjust-tramos" data-id="${c.id}" data-delta="1">+</button>
          </div>
        </div>`).join('')}
      </div>
      ${rows.length === 0 ? `<div class="empty-note">${totalEnTramos === 0 ? 'Todavía no cargaste clientes.' : 'Ningún cliente coincide con el filtro.'}</div>` : ''}
      ${renderTramosRemovedSection()}
    </div>`;
  }

  function renderTramosRemovedSection() {
    const removed = state.contacts.filter(c => c.enTramos === false);
    if (!removed.length) return '';
    return `
    <div class="tramos-removed">
      <div class="tramos-removed-title">Sacados de Tramos (siguen guardados en Contactos)</div>
      ${removed.map(c => `
      <div class="tramos-removed-row">
        <div style="min-width:0">
          <div class="name" style="font-size:13.5px;font-weight:500">${esc(c.nombre)}</div>
          <div class="text-muted" style="font-size:11px">${esc(c.barrio)}</div>
        </div>
        <button type="button" class="btn btn-secondary" data-action="restore-to-tramos" data-id="${c.id}">Reactivar en Tramos</button>
      </div>`).join('')}
    </div>`;
  }

  function renderTramosZeroDialog() {
    const c = state.tramosZeroConfirm;
    return `
    <div class="dialog-backdrop">
      <div class="dialog blueprint">
        ${corners()}
        <div class="dialog-title">${esc(c.nombre)} llegó a 0 tramos</div>
        <div class="dialog-body">¿Querés sacar a ${esc(c.nombre)} de la pestaña Tramos? Va a seguir guardado en Contactos, marcado como <strong>"A renovar"</strong>, y podés reactivarlo cuando quieras.</div>
        <div class="dialog-actions">
          <button type="button" data-action="keep-in-tramos" class="btn btn-secondary">Dejarlo en Tramos</button>
          <button type="button" data-action="remove-from-tramos" data-id="${c.id}" class="btn btn-primary">Sacar de Tramos</button>
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
  function diasLabel(dias) { return (dias || []).map(d => DIA_LABELS[d] || d).join(', '); }

  // Falls back to the contact's general horarioIda/horarioVuelta when a
  // given day has no specific override saved.
  function horarioEfectivo(c, dia) {
    const override = c.horariosDias && c.horariosDias[dia];
    return {
      ida: (override && override.ida) || c.horarioIda || '',
      vuelta: (override && override.vuelta) || c.horarioVuelta || ''
    };
  }

  function diaHorarioResumen(c) {
    if (!c.dias || !c.dias.length) return 'Sin días asignados';
    return c.dias.map(d => {
      const eff = horarioEfectivo(c, d);
      const t = [eff.ida, eff.vuelta].filter(Boolean).join('/');
      return DIA_LABELS[d] + (t ? ' ' + t : '');
    }).join(' · ');
  }

  function renderDiaSchedule(scope, obj) {
    const dias = obj.dias || [];
    if (!dias.length) return '';
    return `
    <div class="field">
      <label>Horarios por día (opcional — si lo dejás vacío se usa el horario general de arriba)</label>
      <div class="dia-schedule">
        ${dias.map(k => {
          const entry = (obj.horariosDias && obj.horariosDias[k]) || { ida: '', vuelta: '' };
          return `
          <div class="dia-schedule-row">
            <span class="dia-schedule-label">${DIA_LABELS[k]}</span>
            <input type="time" class="input" data-bind="${scope}.horariosDias.${k}.ida" value="${esc(entry.ida)}" />
            <input type="time" class="input" data-bind="${scope}.horariosDias.${k}.vuelta" value="${esc(entry.vuelta)}" />
          </div>`;
        }).join('')}
      </div>
    </div>`;
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
              <td style="font-weight:500;white-space:nowrap">${esc(c.nombre)}${c.enTramos === false ? '<div class="text-muted" style="font-size:10px;font-weight:400">Fuera de Tramos</div>' : ''}</td>
              <td style="white-space:nowrap">${esc(c.barrio)}</td>
              <td style="text-align:center">${c.tramos}</td>
              <td style="text-align:right;white-space:nowrap">${fmtMoney(c.monto)}</td>
              <td style="white-space:nowrap">${fmtFecha(c.fecha)}</td>
              <td style="white-space:nowrap">${tipoLabel(c.tipoViaje)}</td>
              <td><span class="status-pill ${(ESTADO_META[c.estado] || ESTADO_META.pendiente).cls}" data-action="toggle-estado" data-id="${c.id}">${(ESTADO_META[c.estado] || ESTADO_META.pendiente).label}</span></td>
              <td><div class="row-actions">
                <button type="button" class="edit" data-action="edit-contact" data-id="${c.id}">Editar</button>
                ${c.enTramos === false ? `<button type="button" class="edit" data-action="restore-to-tramos" data-id="${c.id}">Reactivar tramos</button>` : ''}
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
        <div style="display:flex;gap:12px">
          <div class="field" style="flex:1"><label>Horario de ida (general)</label><input id="e-horario-ida" type="time" class="input" data-bind="editingContact.horarioIda" value="${esc(ec.horarioIda)}" /></div>
          <div class="field" style="flex:1"><label>Horario de vuelta (general)</label><input id="e-horario-vuelta" type="time" class="input" data-bind="editingContact.horarioVuelta" value="${esc(ec.horarioVuelta)}" /></div>
        </div>
        ${renderDiaSchedule('editingContact', ec)}
        <div class="field"><label>Tipo de viaje</label><div class="seg">
          ${segOpt('edit', 'tipoViaje', 'ida', 'Ida', ec.tipoViaje)}
          ${segOpt('edit', 'tipoViaje', 'vuelta', 'Vuelta', ec.tipoViaje)}
          ${segOpt('edit', 'tipoViaje', 'ambos', 'Ambos', ec.tipoViaje)}
        </div></div>
        <div class="field"><label>Estado</label><div class="seg">
          ${segOpt('edit', 'estado', 'pendiente', 'Pendiente', ec.estado)}
          ${segOpt('edit', 'estado', 'pagado', 'Pagado', ec.estado)}
          ${segOpt('edit', 'estado', 'renovar', 'A renovar', ec.estado)}
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
          ${row('Estado', esc((ESTADO_META[c.estado] || ESTADO_META.pendiente).label))}
          ${row('En pestaña Tramos', c.enTramos === false ? 'No' : 'Sí')}
          ${row('Email', esc(c.mail) || '—')}
          ${row('Teléfono', esc(c.telefono) || '—')}
          ${row('Fecha', fmtFecha(c.fecha))}
          ${row('Tipo de viaje', tipoLabel(c.tipoViaje))}
          ${row('Horario general de ida', esc(c.horarioIda) || '—')}
          ${row('Horario general de vuelta', esc(c.horarioVuelta) || '—')}
        </div>
        ${c.dias && c.dias.length ? `
        <div style="padding-top:6px">
          <div class="text-muted" style="font-size:12px;margin-bottom:6px">Días y horarios de traslado</div>
          <div style="display:flex;flex-direction:column;gap:3px">
            ${c.dias.map(d => {
              const eff = horarioEfectivo(c, d);
              return `<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:4px 0;border-bottom:1px solid var(--color-divider)"><span>${esc(DIA_LABELS[d])}</span><span style="font-weight:500">${esc(eff.ida) || '—'} / ${esc(eff.vuelta) || '—'}</span></div>`;
            }).join('')}
          </div>
        </div>` : `<div class="text-muted" style="font-size:13px">Sin días asignados</div>`}
        <div class="dialog-actions">
          <button type="button" data-action="close-detail" class="btn btn-secondary">Cerrar</button>
          <button type="button" data-action="edit-from-detail" data-id="${c.id}" class="btn btn-primary">Editar</button>
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
    const horariosDias = obj.horariosDias || (obj.horariosDias = {});
    const idx = dias.indexOf(key);
    if (idx >= 0) {
      dias.splice(idx, 1);
      delete horariosDias[key];
    } else {
      dias.push(key);
      if (!horariosDias[key]) horariosDias[key] = { ida: '', vuelta: '' };
    }
  }

  function openEdit(id) {
    const c = state.contacts.find(x => String(x.id) === String(id));
    if (!c) return;
    const dias = (c.dias || []).slice();
    const horariosDias = {};
    dias.forEach(k => {
      const src = (c.horariosDias && c.horariosDias[k]) || {};
      horariosDias[k] = { ida: src.ida || '', vuelta: src.vuelta || '' };
    });
    state.editingContact = Object.assign({}, c, { dias, horariosDias });
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

  async function handleNewContact() {
    state.formError = '';
    const f = state.form;
    if (!f.nombre || !f.nombre.trim()) { state.formError = 'El nombre es obligatorio.'; render(); return; }
    const payload = Object.assign({}, f, { nombre: f.nombre.trim(), barrio: (f.barrio || '').trim(), tramos: Number(f.tramos) || 0, monto: Number(f.monto) || 0 });
    try {
      const data = await api('/contacts', { method: 'POST', body: JSON.stringify(payload) });
      state.contacts = [data.contact, ...state.contacts];
      state.form = emptyForm();
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
      if (delta < 0 && data.contact.tramos === 0 && data.contact.enTramos !== false) {
        state.tramosZeroConfirm = data.contact;
      }
      render();
    } catch (err) { console.error(err); }
  }

  async function removeFromTramos(id) {
    try {
      const data = await api('/contacts/' + id + '/en-tramos', { method: 'PATCH', body: JSON.stringify({ enTramos: false, estado: 'renovar' }) });
      state.contacts = state.contacts.map(c => c.id === data.contact.id ? data.contact : c);
      state.tramosZeroConfirm = null;
      render();
    } catch (err) { console.error(err); }
  }

  async function restoreToTramos(id) {
    try {
      const data = await api('/contacts/' + id + '/en-tramos', { method: 'PATCH', body: JSON.stringify({ enTramos: true }) });
      state.contacts = state.contacts.map(c => c.id === data.contact.id ? data.contact : c);
      render();
    } catch (err) { console.error(err); }
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

  function setSort(key) {
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = 'asc'; }
    render();
  }

  function exportExcel() {
    const header = ['Nombre', 'Barrio', 'Tramos', 'Email', 'Teléfono', 'Monto abonado', 'Fecha', 'Viaje', 'Días', 'Estado'];
    const data = getFilteredSorted().map(c => [
      c.nombre, c.barrio, c.tramos, c.mail, c.telefono, Number(c.monto) || 0, c.fecha || '', tipoLabel(c.tipoViaje), diasLabel(c.dias),
      (ESTADO_META[c.estado] || ESTADO_META.pendiente).label
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 9 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 9 }, { wch: 18 }, { wch: 11 }];
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
      case 'adjust-tramos': adjustTramos(btn.dataset.id, Number(btn.dataset.delta)); break;
      case 'keep-in-tramos': state.tramosZeroConfirm = null; render(); break;
      case 'remove-from-tramos': removeFromTramos(btn.dataset.id); break;
      case 'restore-to-tramos': restoreToTramos(btn.dataset.id); break;
      case 'sort': setSort(btn.dataset.key); break;
      case 'clear-date-filter': state.filterFrom = ''; state.filterTo = ''; render(); break;
      case 'clear-tramos-filter': state.filterTramosDia = 'todos'; state.filterTramosHoraFrom = ''; state.filterTramosHoraTo = ''; render(); break;
      case 'export-excel': exportExcel(); break;
      case 'install-app': installApp(); break;
      case 'enable-push': enablePush(); break;
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('input[data-action="seg"]')) {
      const scope = t.dataset.scope, field = t.dataset.field, value = t.value;
      if (scope === 'form') state.form[field] = value;
      else if (scope === 'edit') state.editingContact[field] = value;
      else if (scope === 'filter' && field === 'tipo') state.filterTipo = value;
      else if (scope === 'filterTramos' && field === 'dia') state.filterTramosDia = value;
      render();
    }
  });

  const NO_RERENDER_FIELDS = ['nombre', 'barrio', 'mail', 'telefono', 'tramos', 'monto', 'horarioIda', 'horarioVuelta', 'ida', 'vuelta'];
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
    if (v === 'tramos' || v === 'list' || v === 'form') state.view = v;

    if (state.token) {
      try {
        const data = await api('/auth/me');
        state.user = data.user;
        state.workspace = data.workspace;
        state.screen = 'app';
        await loadContacts();
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
