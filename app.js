// Mis Finanzas — app instalable (PWA) con Firebase.
// Los datos se guardan primero en el dispositivo y se sincronizan solos cuando hay internet.
import { firebaseConfig } from "./firebase-config.js";
import { initLock, lockSettingsHTML, bindLockSettings } from "./lock.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const APP_VERSION = "1.1.0";

/* ============ Utilidades ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES3 = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const pad = n => String(n).padStart(2, "0");
const hoy = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const ymOf = f => String(f || "").slice(0, 7);
const addM = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + "-" + pad(m); };
const diffM = (a, b) => { const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number); return (by - ay) * 12 + (bm - am); };
const ymLabel = ym => { const [y, m] = ym.split("-").map(Number); return MESES[m - 1] + " " + y; };
const nf0 = new Intl.NumberFormat("es-AR", {maximumFractionDigits: 0});
const nf2 = new Intl.NumberFormat("es-AR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const money = (n, cur) => { n = Number(n) || 0; return cur === "USD" ? "US$ " + nf2.format(n) : "$ " + nf0.format(n); };
const short = n => { n = Number(n) || 0; const a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toLocaleString("es-AR", {maximumFractionDigits: 1}) + " M"; if (a >= 1e3) return nf0.format(n / 1e3) + " k"; return nf0.format(n); };
const pct = x => (isFinite(x) ? Math.round(x * 100) : 0) + "%";
function parseNum(s){ s = String(s ?? "").trim().replace(/\s|\$/g, ""); if (!s) return NaN; if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, ""); else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", ""); return Number(s); }
const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function toast(msg, ms){ const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms || 2600); }
function download(name, text, type){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const normName = s => String(s || "").trim().replace(/\s+/g, " ");

/* ============ Tipos y configuración por defecto ============ */
const TIPOS = {
  gasto:    {lbl:"Gasto", ic:"G", signo:-1},
  ingreso:  {lbl:"Ingreso", ic:"I", signo:1},
  transfer: {lbl:"Transferencia", ic:"⇄", signo:0},
  pagotc:   {lbl:"Pago de tarjeta", ic:"TC", signo:-1},
  prestamo: {lbl:"Préstamo dado", ic:"P", signo:-1},
  cobro:    {lbl:"Me devolvieron", ic:"P", signo:1},
  viatcob:  {lbl:"Viático cobrado", ic:"V", signo:1},
  viatgas:  {lbl:"Viático gastado", ic:"V", signo:-1},
};
const DEFAULT_CONFIG = {
  tc: 1550,
  cuentas: [
    {id:"santander", nombre:"Santander", clase:"banco", moneda:"ARS", activa:true},
    {id:"mercadopago", nombre:"Mercado Pago", clase:"billetera", moneda:"ARS", activa:true},
    {id:"patagonia", nombre:"Patagonia", clase:"banco", moneda:"ARS", activa:true},
    {id:"bbva", nombre:"BBVA", clase:"banco", moneda:"ARS", activa:true},
    {id:"efectivo", nombre:"Efectivo", clase:"efectivo", moneda:"ARS", activa:true},
    {id:"iol", nombre:"Invertir Online", clase:"inversion", moneda:"ARS", activa:true},
    {id:"santander-usd", nombre:"Santander USD", clase:"banco", moneda:"USD", activa:true},
    {id:"iol-usd", nombre:"Invertir Online USD", clase:"inversion", moneda:"USD", activa:true},
  ],
  tarjetas: [{id:"visa-santander", nombre:"Visa Santander"}, {id:"visa-patagonia", nombre:"Visa Patagonia"}],
  catGasto: ["Comida","Salidas","Viajes","Transporte","Regalos","Salud","Ropa","Vivienda","Familia","Suscripciones","Cursos","Malboro","Matemeister","Otros"].map(n => ({nombre:n, presupuesto:0})),
  catIngreso: ["Sueldo","Beneficios","Reintegros","Otros ingresos"],
};
const CLASES = {banco:"Banco", billetera:"Billetera", efectivo:"Efectivo", inversion:"Inversión"};

/* ============ Estado ============ */
const S = {config:null, movs:[], compras:[], cierres:{}, pend:{}, loaded:{config:false, movs:false, compras:false, cierres:false}, user:null, online:navigator.onLine};
let fb = null;          // módulos de Firebase cargados
let unsubs = [];
const cfg = () => S.config || DEFAULT_CONFIG;
const allLoaded = () => Object.values(S.loaded).every(Boolean);
const pendingCount = () => Object.values(S.pend).reduce((a, b) => a + b, 0);

function updateSync(){
  const el = $("#sync"), span = el.querySelector("span"), n = pendingCount();
  document.body.classList.toggle("anon", !S.user);
  el.style.visibility = S.user ? "visible" : "hidden";
  if (!S.user){ el.className = "sync"; span.textContent = ""; return; }
  if (!S.online){ el.className = "sync off"; span.textContent = n ? `Sin conexión · ${n} sin subir` : "Sin conexión · guardando en el equipo"; }
  else if (n){ el.className = "sync busy"; span.textContent = `Sincronizando ${n}…`; }
  else { el.className = "sync ok"; span.textContent = "Sincronizado"; }
}
window.addEventListener("online", () => { S.online = true; updateSync(); });
window.addEventListener("offline", () => { S.online = false; updateSync(); });

/* ============ Firebase ============ */
const configured = () => firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PEGAR");

async function loadFirebase(){
  const [app, auth, fs] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
  const a = app.initializeApp(firebaseConfig);
  const au = auth.initializeAuth(a, {persistence:[auth.indexedDBLocalPersistence, auth.browserLocalPersistence], popupRedirectResolver:auth.browserPopupRedirectResolver});
  let db;
  try { db = fs.initializeFirestore(a, {localCache: fs.persistentLocalCache({tabManager: fs.persistentMultipleTabManager()})}); }
  catch(e){ console.warn("Sin caché persistente", e); db = fs.getFirestore(a); }
  return {app, auth, fs, a, au, db};
}

function userCol(name){ return fb.fs.collection(fb.db, "users", S.user.uid, name); }
function userDoc(name, id){ return fb.fs.doc(fb.db, "users", S.user.uid, name, id); }

function subscribe(){
  unsubs.forEach(u => u()); unsubs = [];
  const opts = {includeMetadataChanges:true};
  const err = e => { console.warn(e); toast("Error de sincronización: " + (e.code || e.message)); };
  unsubs.push(fb.fs.onSnapshot(userDoc("meta", "config"), opts, s => {
    S.config = s.exists() ? s.data() : null; S.loaded.config = true; S.pend.config = s.metadata.hasPendingWrites ? 1 : 0; render(); updateSync();
  }, err));
  const coll = (name, apply) => unsubs.push(fb.fs.onSnapshot(userCol(name), opts, q => {
    apply(q); S.loaded[name] = true; S.pend[name] = q.docs.filter(d => d.metadata.hasPendingWrites).length; render(); updateSync();
  }, err));
  coll("movs", q => { S.movs = q.docs.map(d => ({id:d.id, ...d.data(), _p:d.metadata.hasPendingWrites})); });
  coll("compras", q => { S.compras = q.docs.map(d => ({id:d.id, ...d.data(), _p:d.metadata.hasPendingWrites})); });
  coll("cierres", q => { const o = {}; q.docs.forEach(d => o[d.id] = d.data()); S.cierres = o; });
}

// Escritura: se aplica al instante en el equipo; si no hay internet, Firebase la sube después.
function write(col, id, data){
  const ref = col === "meta" ? userDoc("meta", id) : userDoc(col, id);
  fb.fs.setDoc(ref, data).catch(e => { console.warn(e); toast("No se pudo guardar en la nube: " + (e.code || e.message), 4000); });
}
function remove(col, id){
  fb.fs.deleteDoc(userDoc(col, id)).catch(e => toast("No se pudo borrar: " + (e.code || e.message)));
}

async function init(){
  window.addEventListener("hashchange", render);
  $("#fab").addEventListener("click", () => openMov());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#modal").innerHTML) closeSheet(); });
  registerSW();
  initLock({onForgot: () => { if (fb) fb.auth.signOut(fb.au); }});
  if (!configured()){ updateSync(); $("#view").innerHTML = vSetup(); return; }
  try { fb = await loadFirebase(); }
  catch(e){ console.error(e); $("#view").innerHTML = `<div class="banner">No pude cargar la app. Si es la primera vez que la abrís, necesitás internet. Después funciona sin conexión.</div>`; return; }
  fb.auth.onAuthStateChanged(fb.au, user => {
    S.user = user;
    if (!user){ unsubs.forEach(u => u()); unsubs = []; Object.keys(S.loaded).forEach(k => S.loaded[k] = false); S.movs = []; S.compras = []; S.cierres = {}; S.config = null; $("#nav").hidden = true; $("#view").innerHTML = vLogin(); bindLogin(); updateSync(); return; }
    $("#nav").hidden = false; subscribe(); render(); updateSync();
  });
  fb.auth.getRedirectResult(fb.au).catch(e => loginError(e));
}

/* ============ Login ============ */
function vSetup(){
  return `<div class="login"><img class="logo" src="icons/icon-192.png" alt=""><h2>Falta conectar Firebase</h2>
  <div class="muted">Abrí el archivo <code>firebase-config.js</code> y pegá la configuración de tu proyecto de Firebase. La guía paso a paso está en el <code>LEEME.md</code>.</div></div>`;
}
function vLogin(){
  return `<form class="login card" id="loginForm">
    <img class="logo" src="icons/icon-192.png" alt="">
    <div><h2>Mis Finanzas</h2><div class="muted small">Entrá con tu cuenta para sincronizar entre el celular y la compu.</div></div>
    <button type="button" class="btn" id="lg-google">Entrar con Google</button>
    <div class="sep">o con email</div>
    <label class="f" for="lg-email">Email<input class="in" id="lg-email" type="email" autocomplete="email" required></label>
    <label class="f" for="lg-pass">Contraseña<input class="in" id="lg-pass" type="password" autocomplete="current-password" minlength="6" required></label>
    <div class="row"><button class="btn ghost" type="submit" style="flex:1">Entrar</button><button class="btn ghost" type="button" id="lg-new" style="flex:1">Crear cuenta</button></div>
    <div id="lg-err" class="bad small" role="alert"></div>
  </form>`;
}
function loginError(e){
  const el = $("#lg-err"); if (!el || !e) return;
  const map = {"auth/invalid-credential":"Email o contraseña incorrectos.","auth/wrong-password":"Contraseña incorrecta.","auth/user-not-found":"No hay una cuenta con ese email.","auth/email-already-in-use":"Ya existe una cuenta con ese email: tocá Entrar.","auth/weak-password":"La contraseña tiene que tener al menos 6 caracteres.","auth/network-request-failed":"Sin conexión. La primera vez necesitás internet para entrar.","auth/unauthorized-domain":"Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).","auth/operation-not-allowed":"Ese método de acceso no está activado en Firebase (Authentication → Método de acceso)."};
  el.textContent = map[e.code] || ("No se pudo entrar: " + (e.code || e.message));
}
function bindLogin(){
  $("#lg-google").onclick = async () => {
    const p = new fb.auth.GoogleAuthProvider();
    try { await fb.auth.signInWithPopup(fb.au, p); }
    catch(e){ if (["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request"].includes(e.code)) fb.auth.signInWithRedirect(fb.au, p); else if (e.code !== "auth/popup-closed-by-user") loginError(e); }
  };
  const creds = () => [$("#lg-email").value.trim(), $("#lg-pass").value];
  $("#loginForm").onsubmit = async e => { e.preventDefault(); try { await fb.auth.signInWithEmailAndPassword(fb.au, ...creds()); } catch(err){ loginError(err); } };
  $("#lg-new").onclick = async () => { if (!$("#loginForm").reportValidity()) return; try { await fb.auth.createUserWithEmailAndPassword(fb.au, ...creds()); } catch(err){ loginError(err); } };
}

/* ============ Service worker (instalación y modo sin conexión) ============ */
function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").then(reg => {
    const offer = w => { const b = document.createElement("div"); b.className = "toast"; b.innerHTML = `Hay una versión nueva. <button class="btn sm" style="margin-left:8px">Actualizar</button>`; b.querySelector("button").onclick = () => w.postMessage("skipWaiting"); document.body.appendChild(b); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); }); });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(e => console.warn("SW", e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded){ reloaded = true; location.reload(); } });
}

/* ============ Cálculos ============ */
const cuenta = id => cfg().cuentas.find(c => c.id === id);
const tarjeta = id => cfg().tarjetas.find(t => t.id === id);
const cuentaNom = id => (cuenta(id) || tarjeta(id) || {nombre:id || "—"}).nombre;
function tcOf(ym){ const c = S.cierres[ym]; if (c && c.tc) return Number(c.tc); const prev = Object.keys(S.cierres).filter(k => k <= ym && S.cierres[k].tc).sort().pop(); return prev ? Number(S.cierres[prev].tc) : Number(cfg().tc) || 1; }
const toARS = (monto, moneda, ym) => moneda === "USD" ? monto * tcOf(ym) : monto;
const monedaDe = id => (cuenta(id) || {}).moneda || "ARS";
function cuotaEn(c, ym){
  if (c.recurrente){ if (ym < c.primerMes) return 0; if (c.hasta && ym > c.hasta) return 0; return Number(c.total) || 0; }
  const n = Math.max(1, Number(c.cuotas) || 1); const i = diffM(c.primerMes, ym);
  return (i >= 0 && i < n) ? (Number(c.total) || 0) / n : 0;
}
const cuotaARS = (c, ym) => toARS(cuotaEn(c, ym), c.moneda || "ARS", ym);

function calcMes(M){
  const r = {M, ing:0, ingCat:{}, gasCash:0, cuotas:0, pagos:0, tsd:0, gasCat:{}, viatC:0, viatG:0, prestD:0, prestC:0, aportes:0, retiros:0, warnTc:false, n:0};
  const add = (o, k, v) => o[k] = (o[k] || 0) + v;
  for (const m of S.movs){
    if (ymOf(m.fecha) !== M) continue; r.n++;
    const v = toARS(Number(m.monto) || 0, monedaDe(m.cuenta), M);
    switch (m.tipo){
      case "ingreso": r.ing += v; add(r.ingCat, m.categoria || "Otros ingresos", v); break;
      case "gasto": r.gasCash += v; add(r.gasCat, m.categoria || "Otros", v); break;
      case "pagotc": r.pagos += v; break;
      case "viatcob": r.viatC += v; break;
      case "viatgas": r.viatG += v; break;
      case "prestamo": r.prestD += v; break;
      case "cobro": r.prestC += v; break;
      case "transfer": {
        const o = cuenta(m.cuenta), d = cuenta(m.destino);
        if (d && d.clase === "inversion" && !(o && o.clase === "inversion")) r.aportes += v;
        if (o && o.clase === "inversion" && !(d && d.clase === "inversion")) r.retiros += v;
      }
    }
  }
  for (const c of S.compras){ const q = cuotaARS(c, M); if (q > 0){ r.cuotas += q; add(r.gasCat, c.categoria || "Otros", q); } }
  if (r.pagos > r.cuotas){ r.tsd = r.pagos - r.cuotas; add(r.gasCat, "Tarjeta sin detalle", r.tsd); }
  else if (r.pagos > 0 && r.cuotas - r.pagos > 1) r.warnTc = true;
  r.gastos = r.gasCash + r.cuotas + r.tsd;
  r.ahorro = r.ing - r.gastos;
  r.tasa = r.ing > 0 ? r.ahorro / r.ing : 0;
  r.viatNeto = r.viatC - r.viatG;
  return r;
}
function deltaCuenta(m, id){
  const x = Number(m.monto) || 0;
  switch (m.tipo){
    case "ingreso": case "cobro": case "viatcob": return m.cuenta === id ? x : 0;
    case "gasto": case "pagotc": case "prestamo": case "viatgas": return m.cuenta === id ? -x : 0;
    case "transfer": { let d = 0; if (m.cuenta === id) d -= x; if (m.destino === id) d += (m.montoDestino != null && m.montoDestino !== "" ? Number(m.montoDestino) : x); return d; }
  }
  return 0;
}
function patrimonio(ym){
  const c = S.cierres[ym]; if (!c) return null;
  const tc = Number(c.tc) || tcOf(ym); let tot = 0, liq = 0, inv = 0, faltan = 0;
  for (const cu of cfg().cuentas){
    if (!cu.activa) continue;
    const s = c.saldos ? c.saldos[cu.id] : undefined;
    if (s == null || s === ""){ faltan++; continue; }
    const v = cu.moneda === "USD" ? Number(s) * tc : Number(s);
    tot += v; if (cu.clase === "inversion") inv += v; else liq += v;
  }
  return {tot, liq, inv, faltan, tc};
}
function conciliar(M){
  const ini = S.cierres[addM(M, -1)], fin = S.cierres[M]; if (!ini || !fin) return null;
  const movs = S.movs.filter(m => ymOf(m.fecha) === M);
  return cfg().cuentas.filter(c => c.activa).map(c => {
    const a = ini.saldos ? ini.saldos[c.id] : undefined, b = fin.saldos ? fin.saldos[c.id] : undefined;
    if (a == null || a === "" || b == null || b === "") return {c, falta:true};
    const mov = movs.reduce((s, m) => s + deltaCuenta(m, c.id), 0);
    const aport = movs.filter(m => m.tipo === "transfer").reduce((s, m) => s + Math.max(0, deltaCuenta(m, c.id)), 0);
    const esperado = Number(a) + mov, dif = Number(b) - esperado;
    return {c, ini:Number(a), fin:Number(b), mov, aport, esperado, dif};
  });
}
function saldosPrestamos(){
  const p = {};
  for (const m of S.movs){
    if (m.tipo !== "prestamo" && m.tipo !== "cobro") continue;
    const nombre = normName(m.persona) || "Sin nombre"; const k = nombre.toLowerCase();
    p[k] = p[k] || {nombre, dado:0, cobrado:0, movs:[]};
    const v = toARS(Number(m.monto) || 0, monedaDe(m.cuenta), ymOf(m.fecha));
    if (m.tipo === "prestamo") p[k].dado += v; else p[k].cobrado += v;
    p[k].movs.push(m);
  }
  return p;
}
const mesActual = () => ymOf(hoy());

/* ============ Render ============ */
let viewMonth = mesActual(), movFilter = "todos", movSearch = "", cierreMonth = null;
const route = () => (location.hash || "#resumen").slice(1) || "resumen";
function render(){
  if (!S.user) return;
  if (route() === "nuevo"){ history.replaceState(null, "", "#resumen"); setTimeout(() => openMov(), 0); }
  const r = route();
  document.querySelectorAll("nav.bottom a").forEach(a => {
    const on = a.dataset.v === r || (a.dataset.v === "mas" && ["mas","cierre","prestamos","ajustes","anual"].includes(r));
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const v = $("#view");
  if (!allLoaded() && !S.movs.length){ v.innerHTML = `<div class="empty">Cargando tus datos…</div>`; return; }
  const views = {resumen:vResumen, movimientos:vMovs, tarjeta:vTarjeta, mas:vMas, cierre:vCierre, prestamos:vPrestamos, ajustes:vAjustes, anual:vAnual};
  const keepScroll = window.scrollY;
  const active = document.activeElement && document.activeElement.id;
  v.innerHTML = (views[r] || vResumen)();
  bindView();
  if (active === "search"){ const n = $("#search"); if (n){ n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
  window.scrollTo(0, keepScroll);
}
const monthBar = () => `<div class="monthbar"><button class="iconbtn" data-act="prevM" aria-label="Mes anterior">‹</button><div class="lbl">${ymLabel(viewMonth)}</div><button class="iconbtn" data-act="nextM" aria-label="Mes siguiente">›</button></div>`;

function vResumen(){
  const M = viewMonth, r = calcMes(M), prev = calcMes(addM(M, -1));
  const pat = patrimonio(M) || patrimonio(addM(M, -1));
  const patLbl = patrimonio(M) ? "Cierre de " + MESES[+M.slice(5) - 1] : (pat ? "Cierre del mes anterior" : "Sin cierre cargado");
  const deltaG = prev.gastos > 0 ? (r.gastos - prev.gastos) / prev.gastos : 0;
  const budget = Object.fromEntries(cfg().catGasto.map(c => [c.nombre, Number(c.presupuesto) || 0]));
  const cats = Object.entries(r.gasCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(c => Math.max(c[1], budget[c[0]] || 0)));
  const bars = cats.map(([k, v]) => {
    const b = budget[k] || 0, ratio = b ? v / b : 0;
    const cls = b ? (ratio > 1 ? "over" : ratio > .85 ? "near" : "") : "";
    return `<div class="bar ${cls}"><div class="top"><span>${esc(k)}</span><span class="num">${money(v)}${b ? ` <span class="muted small">/ ${short(b)}</span>` : ""}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, v / maxCat * 100)}%"></div></div></div>`;
  }).join("");
  const conc = conciliar(M);
  let concHtml;
  if (conc){
    const liq = conc.filter(x => !x.falta && x.c.clase !== "inversion"), inv = conc.filter(x => !x.falta && x.c.clase === "inversion"), falt = conc.filter(x => x.falta);
    const tol = x => Math.abs(x.dif) <= Math.max(1000, Math.abs(x.fin) * 0.005);
    concHtml = `<div class="card"><div><h2>¿Cierra el mes?</h2><div class="muted small">Saldo real de cada cuenta contra lo que cargaste</div></div>
      <div class="list">${liq.map(x => `<div class="item wrap" style="cursor:default"><div class="txt"><div class="t1">${esc(x.c.nombre)}</div><div class="t2">Esperado ${money(x.esperado, x.c.moneda)} · Real ${money(x.fin, x.c.moneda)}</div></div>${tol(x) ? `<span class="pill">Cierra</span>` : `<span class="pill ${x.dif < 0 ? "bad" : "warn"}">${x.dif < 0 ? "Faltan " : "Sobran "}${money(Math.abs(x.dif), x.c.moneda)}</span>`}</div>`).join("")}</div>
      ${inv.length ? `<h3>Inversiones del mes</h3><div class="list">${inv.map(x => { const base = x.ini + x.aport; const p = base > 0 ? x.dif / base : 0; return `<div class="item wrap" style="cursor:default"><div class="txt"><div class="t1">${esc(x.c.nombre)}</div><div class="t2">Aportes netos ${money(x.mov, x.c.moneda)} · Valor ${money(x.fin, x.c.moneda)}</div></div><span class="pill ${x.dif < 0 ? "bad" : ""}">${x.dif >= 0 ? "+" : "−"}${money(Math.abs(x.dif), x.c.moneda)} · ${pct(p)}</span></div>`; }).join("")}</div>` : ""}
      ${falt.length ? `<div class="muted small">Sin saldo cargado en ${falt.map(x => esc(x.c.nombre)).join(", ")}.</div>` : ""}
      <div class="muted small">“Faltan” en efectivo o en una cuenta suele ser un gasto que no cargaste. En inversiones, la diferencia es la ganancia o pérdida real.</div></div>`;
  } else {
    concHtml = `<div class="card"><h2>¿Cierra el mes?</h2><div class="muted small">Para saber si cierra necesito el saldo de tus cuentas al final de ${MESES[+M.slice(5) - 1]} y del mes anterior.</div><a class="btn" href="#cierre" data-cierre="${M}">Cargar cierre de ${MESES[+M.slice(5) - 1]}</a></div>`;
  }
  const futuro = [0, 1, 2, 3, 4, 5].map(k => { const ym = addM(mesActual(), k); return [ym, S.compras.reduce((s, c) => s + cuotaARS(c, ym), 0)]; });
  const maxF = Math.max(1, ...futuro.map(f => f[1]));
  const extras = [];
  if (r.viatC || r.viatG) extras.push(`<div class="kv"><span>Viáticos (aparte)</span><span class="num ${r.viatNeto >= 0 ? "good" : "bad"}">${r.viatNeto >= 0 ? "Te sobraron " : "Pusiste "}${money(Math.abs(r.viatNeto))}</span></div>`);
  if (r.prestD || r.prestC) extras.push(`<div class="kv"><span>Préstamos del mes</span><span class="num">Diste ${money(r.prestD)} · Te devolvieron ${money(r.prestC)}</span></div>`);
  if (r.aportes || r.retiros) extras.push(`<div class="kv"><span>A inversiones</span><span class="num">Mandaste ${money(r.aportes)} · Sacaste ${money(r.retiros)}</span></div>`);
  if (r.warnTc) extras.push(`<div class="banner">Las cuotas cargadas del mes (${money(r.cuotas)}) superan lo que pagaste de tarjeta (${money(r.pagos)}). Revisá el mes de la primera cuota de tus compras.</div>`);
  const ultimos = S.movs.filter(m => ymOf(m.fecha) === M).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.creado || 0) - (a.creado || 0)).slice(0, 8);
  return `${monthBar()}
  <div class="tiles">
    <div class="tile"><span class="k">Ingresos</span><span class="v">${money(r.ing)}</span><span class="s">${Object.keys(r.ingCat).length} fuentes</span></div>
    <div class="tile"><span class="k">Gastos</span><span class="v">${money(r.gastos)}</span><span class="s">${prev.gastos ? (deltaG > 0 ? "▲ " : "▼ ") + pct(Math.abs(deltaG)) + " vs. mes anterior" : "&nbsp;"}</span></div>
    <div class="tile hl"><span class="k">Ahorro del mes</span><span class="v ${r.ahorro < 0 ? "bad" : ""}">${money(r.ahorro)}</span><span class="s">${r.ing ? pct(r.tasa) + " de lo que entró" : "Todavía sin ingresos"}</span></div>
    <div class="tile"><span class="k">Patrimonio</span><span class="v">${pat ? money(pat.tot) : "—"}</span><span class="s">${patLbl}${pat && pat.faltan ? " · incompleto" : ""}</span></div>
  </div>
  <div class="dash">
    <div class="col">
      <div class="card"><div class="row between"><h2>En qué se fue</h2><span class="muted small">incluye cuotas de tarjeta</span></div>
        ${cats.length ? `<div class="bars">${bars}</div>` : `<div class="empty">Todavía no hay gastos este mes. Tocá + para cargar el primero.</div>`}
        ${extras.length ? `<div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:12px">${extras.join("")}</div>` : ""}
      </div>
      ${concHtml}
    </div>
    <div class="col">
      <div class="card" style="padding:12px 14px"><div class="row between"><h2>Últimos movimientos</h2><a href="#movimientos" class="small" style="color:var(--accent)">Ver todos</a></div>
        ${ultimos.length ? `<div class="list">${ultimos.map(movRow).join("")}</div>` : `<div class="empty">Sin movimientos este mes.</div>`}</div>
      <div class="card"><div class="row between"><h2>Cuotas que vienen</h2><a href="#tarjeta" class="small" style="color:var(--accent)">Ver compras</a></div>
        <div class="bars">${futuro.map(([ym, v]) => `<div class="bar"><div class="top"><span style="text-transform:capitalize">${ymLabel(ym)}</span><span class="num">${money(v)}</span></div><div class="track"><div class="fill" style="width:${Math.max(1, v / maxF * 100)}%"></div></div></div>`).join("")}</div>
      </div>
    </div>
  </div>`;
}

function yearChart(rows){
  const W = 680, H = 200, pl = 44, pb = 22, pt = 10;
  const max = Math.max(1, ...rows.map(r => Math.max(r.ing, r.gastos)));
  const step = Math.pow(10, Math.floor(Math.log10(max))); const nice = Math.ceil(max / step) * step;
  const bw = (W - pl - 10) / rows.length; const y = v => pt + (H - pt - pb) * (1 - v / nice);
  let g = "";
  for (let i = 0; i <= 4; i++){ const v = nice * i / 4; g += `<line x1="${pl}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${short(v)}</text>`; }
  rows.forEach((r, i) => {
    const x = pl + i * bw + bw * .14, w = bw * .34;
    g += `<rect x="${x}" y="${y(r.ing)}" width="${w}" height="${Math.max(0, H - pb - y(r.ing))}" rx="2" fill="var(--accent)"/>`;
    g += `<rect x="${x + w + 2}" y="${y(r.gastos)}" width="${w}" height="${Math.max(0, H - pb - y(r.gastos))}" rx="2" fill="var(--bad)" opacity=".75"/>`;
    g += `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${MES3[+r.M.slice(5) - 1]}</text>`;
  });
  return `<div class="scroll"><svg class="svgchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ingresos y gastos por mes">${g}</svg></div>
  <div class="legend"><span><i style="background:var(--accent)"></i>Ingresos</span><span><i style="background:var(--bad);opacity:.75"></i>Gastos</span></div>`;
}
function vAnual(){
  const y = viewMonth.slice(0, 4);
  const rows = Array.from({length:12}, (_, i) => calcMes(y + "-" + pad(i + 1))).filter(r => r.n || r.cuotas || S.cierres[r.M]);
  const tot = rows.reduce((a, r) => ({ing:a.ing + r.ing, gastos:a.gastos + r.gastos}), {ing:0, gastos:0});
  const cats = {}; rows.forEach(r => Object.entries(r.gasCat).forEach(([k, v]) => cats[k] = (cats[k] || 0) + v));
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  return `<div class="monthbar"><button class="iconbtn" data-act="prevY" aria-label="Año anterior">‹</button><div class="lbl">Año ${y}</div><button class="iconbtn" data-act="nextY" aria-label="Año siguiente">›</button></div>
  <div class="tiles">
    <div class="tile"><span class="k">Ingresos del año</span><span class="v">${money(tot.ing)}</span></div>
    <div class="tile"><span class="k">Gastos del año</span><span class="v">${money(tot.gastos)}</span><span class="s">${rows.length ? "promedio " + money(tot.gastos / rows.length) + "/mes" : ""}</span></div>
    <div class="tile hl"><span class="k">Ahorro del año</span><span class="v">${money(tot.ing - tot.gastos)}</span><span class="s">${tot.ing ? pct((tot.ing - tot.gastos) / tot.ing) : ""}</span></div>
  </div>
  <div class="dash"><div class="col">
  <div class="card"><h2>Mes a mes</h2>${rows.length ? yearChart(rows) : `<div class="empty">Sin datos para ${y}.</div>`}
  <div class="scroll"><table class="t"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorro</th><th>%</th><th>Patrimonio</th></tr></thead><tbody>
  ${rows.map(r => { const p = patrimonio(r.M); return `<tr><td style="text-transform:capitalize">${MESES[+r.M.slice(5) - 1]}</td><td>${short(r.ing)}</td><td>${short(r.gastos)}</td><td class="${r.ahorro < 0 ? "bad" : ""}">${short(r.ahorro)}</td><td>${r.ing ? pct(r.tasa) : "—"}</td><td>${p ? short(p.tot) + (p.faltan ? "*" : "") : "—"}</td></tr>`; }).join("")}
  </tbody></table></div><div class="muted small">* Cierre incompleto: falta el saldo de alguna cuenta.</div></div></div>
  <div class="col"><div class="card"><h2>Gastos por categoría</h2><div class="scroll"><table class="t"><thead><tr><th>Categoría</th><th>Total</th><th>Por mes</th><th>%</th></tr></thead><tbody>
  ${catRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${money(v)}</td><td>${short(v / Math.max(1, rows.length))}</td><td>${pct(v / Math.max(1, tot.gastos))}</td></tr>`).join("")}
  </tbody></table></div></div></div></div>`;
}

function movRow(m){
  const t = TIPOS[m.tipo] || {lbl:m.tipo, ic:"?", signo:0};
  const cur = monedaDe(m.cuenta);
  let t1 = m.nota || m.categoria || t.lbl, t2 = "";
  if (m.tipo === "transfer"){ t1 = m.nota || "Transferencia"; t2 = cuentaNom(m.cuenta) + " → " + cuentaNom(m.destino); }
  else if (m.tipo === "pagotc"){ t1 = "Pago " + cuentaNom(m.tarjeta); t2 = "desde " + cuentaNom(m.cuenta); }
  else if (m.tipo === "prestamo" || m.tipo === "cobro"){ t1 = (m.tipo === "prestamo" ? "Préstamo a " : "Devolución de ") + (m.persona || "—"); t2 = (m.nota ? m.nota + " · " : "") + cuentaNom(m.cuenta); }
  else t2 = [m.nota && m.categoria ? m.categoria : (m.tipo.startsWith("viat") ? t.lbl : ""), cuentaNom(m.cuenta)].filter(Boolean).join(" · ");
  return `<button class="item" data-mov="${esc(m.id)}"><span class="ic ${esc(m.tipo)}">${t.ic}</span><span class="txt"><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></span><span class="amt ${t.signo > 0 ? "good" : ""}">${t.signo > 0 ? "+" : t.signo < 0 ? "−" : ""}${money(m.monto, cur)}${m._p ? `<div class="pend">sin subir</div>` : ""}</span></button>`;
}
function vMovs(){
  const M = viewMonth;
  const filtros = [["todos","Todos"],["gasto","Gastos"],["ingreso","Ingresos"],["transfer","Transferencias"],["pagotc","Pagos tarjeta"],["prestamo","Préstamos"],["viat","Viáticos"]];
  let list = S.movs.filter(m => ymOf(m.fecha) === M);
  if (movFilter === "prestamo") list = list.filter(m => m.tipo === "prestamo" || m.tipo === "cobro");
  else if (movFilter === "viat") list = list.filter(m => m.tipo.startsWith("viat"));
  else if (movFilter !== "todos") list = list.filter(m => m.tipo === movFilter);
  if (movSearch){ const q = movSearch.toLowerCase(); list = list.filter(m => [m.nota, m.categoria, m.persona, cuentaNom(m.cuenta)].join(" ").toLowerCase().includes(q)); }
  list.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.creado || 0) - (a.creado || 0));
  const comprasMes = S.compras.filter(c => ymOf(c.fecha) === M);
  let html = "", lastDay = "";
  for (const m of list){
    if (m.fecha !== lastDay){ lastDay = m.fecha; const d = new Date(m.fecha + "T12:00:00"); html += `<div class="daylbl">${isNaN(d) ? "Sin fecha" : d.toLocaleDateString("es-AR", {weekday:"long", day:"numeric", month:"long"})}</div>`; }
    html += movRow(m);
  }
  return `${monthBar()}
  <input class="in" id="search" type="search" placeholder="Buscar por detalle, categoría o persona" value="${esc(movSearch)}" aria-label="Buscar movimientos">
  <div class="chips">${filtros.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${movFilter === k}">${l}</button>`).join("")}</div>
  <div class="card" style="padding:6px 14px">${list.length ? `<div class="list">${html}</div>` : `<div class="empty">No hay movimientos con ese filtro en ${ymLabel(M)}.</div>`}</div>
  ${comprasMes.length && (movFilter === "todos" || movFilter === "gasto") ? `<div class="muted small">Además, este mes hiciste ${comprasMes.length} compra(s) con tarjeta: están en la pestaña Tarjeta.</div>` : ""}`;
}

function vTarjeta(){
  const now = mesActual(); const activas = [], terminadas = [];
  for (const c of S.compras){ const n = Math.max(1, Number(c.cuotas) || 1); const i = diffM(c.primerMes, now); if (c.recurrente ? !(c.hasta && c.hasta < now) : i < n) activas.push(c); else terminadas.push(c); }
  const byFecha = (a, b) => (b.fecha || "").localeCompare(a.fecha || "");
  activas.sort(byFecha); terminadas.sort(byFecha);
  const row = c => {
    const n = Math.max(1, Number(c.cuotas) || 1); const i = diffM(c.primerMes, now) + 1;
    const q = c.recurrente ? Number(c.total) : Number(c.total) / n;
    const prog = c.recurrente ? `Todos los meses desde ${ymLabel(c.primerMes)}` : (i < 1 ? `Primera cuota en ${ymLabel(c.primerMes)}` : i > n ? `Terminada` : `Cuota ${i} de ${n}`);
    const done = c.recurrente ? 0 : Math.min(1, Math.max(0, i / n));
    return `<button class="item" data-compra="${esc(c.id)}"><span class="ic">${c.recurrente ? "↻" : n + "c"}</span><span class="txt"><div class="t1">${esc(c.comercio || c.categoria)}</div><div class="t2">${esc(c.categoria || "")} · ${esc(cuentaNom(c.tarjeta))} · ${prog}</div>${c.recurrente ? "" : `<div class="prog"><b style="width:${done * 100}%"></b></div>`}</span><span class="amt">${money(q, c.moneda)}<div class="muted small" style="font-weight:400">${c.recurrente ? "por mes" : "por cuota"}</div>${c._p ? `<div class="pend">sin subir</div>` : ""}</span></button>`;
  };
  const meses = [0, 1, 2, 3, 4, 5].map(k => addM(now, k));
  const porTarjeta = cfg().tarjetas.map(t => ({t, vals:meses.map(ym => S.compras.filter(c => c.tarjeta === t.id).reduce((s, c) => s + cuotaARS(c, ym), 0))}));
  return `<div class="row between"><h2>Tarjetas de crédito</h2><button class="btn sm" data-act="newCompra">+ Compra con tarjeta</button></div>
  <div class="card"><h3>Lo que ya tenés comprometido</h3><div class="scroll"><table class="t"><thead><tr><th>Tarjeta</th>${meses.map(m => `<th>${MES3[+m.slice(5) - 1]}</th>`).join("")}</tr></thead><tbody>
  ${porTarjeta.map(p => `<tr><td>${esc(p.t.nombre)}</td>${p.vals.map(v => `<td>${v ? short(v) : "—"}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div><div class="muted small">Cuando pagues el resumen, cargalo como “Pago de tarjeta”. La diferencia con estas cuotas aparece como “Tarjeta sin detalle” (intereses, impuestos o compras que no cargaste).</div></div>
  <div class="card" style="padding:6px 14px"><div class="list">${activas.length ? activas.map(row).join("") : `<div class="empty">No tenés compras en cuotas activas.</div>`}</div></div>
  ${terminadas.length ? `<details class="card"><summary style="cursor:pointer;font-weight:600">Compras terminadas (${terminadas.length})</summary><div class="list">${terminadas.map(row).join("")}</div></details>` : ""}`;
}

function vMas(){
  return `<h2>Más</h2><div class="card menu" style="padding:4px 16px">
  <a href="#cierre"><span>Cierre de mes<div class="muted small" style="font-weight:400">Saldo real de cada cuenta y tipo de cambio</div></span><span>›</span></a>
  <a href="#prestamos"><span>Préstamos<div class="muted small" style="font-weight:400">Quién te debe y cuánto</div></span><span>›</span></a>
  <a href="#anual"><span>Resumen anual<div class="muted small" style="font-weight:400">Mes a mes y por categoría</div></span><span>›</span></a>
  <a href="#ajustes"><span>Ajustes y respaldo<div class="muted small" style="font-weight:400">Cuentas, categorías, presupuesto, importar y exportar</div></span><span>›</span></a>
  </div>
  <div class="card"><h3>Cómo cargar</h3><div class="small stack" style="gap:6px">
  <div><b>Gasto:</b> pagaste algo con cuenta, efectivo o tarjeta (con tarjeta podés poner las cuotas).</div>
  <div><b>Transferencia:</b> movés plata entre tus cuentas, mandás a Invertir Online, o le transferís a alguien que te da efectivo (destino: Efectivo).</div>
  <div><b>Pago de tarjeta:</b> pagás el resumen. No es un gasto nuevo: los gastos ya están en las cuotas.</div>
  <div><b>Préstamo / Me devolvieron:</b> plata que prestás o aportás y esperás recuperar.</div>
  <div><b>Viáticos:</b> se registran aparte y no cuentan en tu ahorro.</div>
  <div><b>Cierre de mes:</b> el último día del mes anotá el saldo real de cada cuenta.</div>
  <div><b>Sin internet:</b> cargá igual. Lo que todavía no se subió dice “sin subir” y se sincroniza solo cuando vuelve la conexión.</div>
  </div></div>`;
}

function vCierre(){
  if (!cierreMonth){ const now = mesActual(); cierreMonth = S.cierres[addM(now, -1)] ? now : addM(now, -1); }
  const M = cierreMonth, c = S.cierres[M] || {}, prevC = S.cierres[addM(M, -1)] || {};
  const tc = c.tc || prevC.tc || cfg().tc;
  const inv = cfg().cuentas.filter(x => x.clase === "inversion" && x.activa);
  const meses = Object.keys(S.cierres).sort().slice(-12);
  const invRows = meses.map(ym => { const cc = conciliar(ym); if (!cc) return null; const rows = cc.filter(x => !x.falta && x.c.clase === "inversion"); if (!rows.length) return null; const tcm = tcOf(ym); const k = x => x.c.moneda === "USD" ? tcm : 1; return {ym, dif:rows.reduce((s, x) => s + x.dif * k(x), 0), base:rows.reduce((s, x) => s + (x.ini + x.aport) * k(x), 0), ap:rows.reduce((s, x) => s + x.mov * k(x), 0)}; }).filter(Boolean);
  return `<div class="monthbar"><button class="iconbtn" data-act="prevC" aria-label="Mes anterior">‹</button><div class="lbl">Cierre de ${ymLabel(M)}</div><button class="iconbtn" data-act="nextC" aria-label="Mes siguiente">›</button></div>
  <div class="dash"><div class="col">
  <form class="card" id="cierreForm">
    <div class="muted small">Anotá cuánto había en cada cuenta al último día del mes. Dejá vacío lo que no sepas. ${S.cierres[M] ? `<span class="pill">Ya cargado</span>` : `<span class="pill muted">Sin cargar</span>`}</div>
    ${cfg().cuentas.filter(x => x.activa).map(x => { const v = c.saldos ? c.saldos[x.id] : ""; const pv = prevC.saldos ? prevC.saldos[x.id] : null; return `<label class="f" for="cs-${esc(x.id)}">${esc(x.nombre)} <span class="muted">(${x.moneda}${x.clase === "inversion" ? ", inversión" : ""})</span><input class="in num" id="cs-${esc(x.id)}" data-cuenta="${esc(x.id)}" inputmode="decimal" value="${v != null && v !== "" ? esc(String(v).replace(".", ",")) : ""}" placeholder="${pv != null && pv !== "" ? "Mes anterior: " + (x.moneda === "USD" ? nf2.format(pv) : nf0.format(pv)) : ""}"></label>`; }).join("")}
    <label class="f" for="cs-tc">Tipo de cambio del dólar ese día ($ por US$)<input class="in num" id="cs-tc" inputmode="decimal" value="${esc(String(tc).replace(".", ","))}"></label>
    <div class="row"><button type="button" class="btn ghost" data-act="copyPrev" style="flex:1">Copiar saldos del mes anterior</button><button class="btn" type="submit" style="flex:1">Guardar cierre</button></div>
  </form></div><div class="col">
  ${inv.length ? `<div class="card"><h2>¿Tus inversiones ganan?</h2>${invRows.length ? `<div class="scroll"><table class="t"><thead><tr><th>Mes</th><th>Aportes netos</th><th>Ganancia</th><th>Rendimiento</th></tr></thead><tbody>${invRows.map(r => `<tr><td style="text-transform:capitalize">${ymLabel(r.ym)}</td><td>${short(r.ap)}</td><td class="${r.dif < 0 ? "bad" : "good"}">${short(r.dif)}</td><td>${r.base > 0 ? pct(r.dif / r.base) : "—"}</td></tr>`).join("")}</tbody></table></div>
  <div class="muted small">Ganancia = valor final − valor inicial − lo que mandaste + lo que sacaste. Compará el rendimiento con la inflación del mes. Si mandaste plata y no la cargaste como transferencia, va a aparecer como ganancia.</div>` : `<div class="muted small">Cuando tengas dos cierres seguidos con el valor de tus inversiones, acá vas a ver la ganancia real de cada mes.</div>`}</div>` : ""}
  </div></div>`;
}

function vPrestamos(){
  const p = saldosPrestamos(); const ents = Object.values(p).sort((a, b) => (b.dado - b.cobrado) - (a.dado - a.cobrado));
  const total = ents.reduce((s, v) => s + v.dado - v.cobrado, 0);
  return `<h2>Préstamos</h2>
  <div class="tiles"><div class="tile hl"><span class="k">Te deben en total</span><span class="v">${money(total)}</span><span class="s">${ents.length} personas o proyectos</span></div></div>
  ${ents.length ? ents.map(v => { const s = v.dado - v.cobrado; return `<div class="card"><div class="row between"><h2>${esc(v.nombre)}</h2><span class="pill ${s <= 0 ? "muted" : "warn"}">${s <= 0 ? "Saldado" : "Debe " + money(s)}</span></div><div class="muted small">Prestado ${money(v.dado)} · Devuelto ${money(v.cobrado)}</div>
  <details><summary class="small" style="cursor:pointer;color:var(--accent)">Ver ${v.movs.length} movimientos</summary><div class="list">${v.movs.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).map(movRow).join("")}</div></details></div>`; }).join("") : `<div class="empty">No hay préstamos cargados. Usá + y elegí “Préstamo dado”.</div>`}`;
}

function vAjustes(){
  const c = cfg();
  return `<h2>Ajustes</h2>
  <div class="dash"><div class="col">
  <form class="stack" id="ajForm">
  <div class="card"><h3>Cuentas</h3>
    ${c.cuentas.map((x, i) => `<div class="grid2"><input class="in" id="cu-n-${i}" value="${esc(x.nombre)}" aria-label="Nombre de cuenta"><div class="row"><select class="in" id="cu-c-${i}" aria-label="Tipo">${Object.entries(CLASES).map(([k, l]) => `<option value="${k}" ${x.clase === k ? "selected" : ""}>${l}</option>`).join("")}</select><select class="in" id="cu-m-${i}" aria-label="Moneda" style="max-width:90px"><option ${x.moneda === "ARS" ? "selected" : ""}>ARS</option><option ${x.moneda === "USD" ? "selected" : ""}>USD</option></select><input type="checkbox" id="cu-a-${i}" ${x.activa ? "checked" : ""} aria-label="Activa" title="Activa"></div></div>`).join("")}
    <button type="button" class="btn ghost sm" data-act="addCuenta">+ Agregar cuenta</button>
  </div>
  <div class="card"><h3>Tarjetas</h3>
    ${c.tarjetas.map((t, i) => `<input class="in" id="tj-${i}" value="${esc(t.nombre)}" aria-label="Nombre de tarjeta">`).join("")}
    <button type="button" class="btn ghost sm" data-act="addTarjeta">+ Agregar tarjeta</button>
  </div>
  <div class="card"><h3>Categorías de gasto y presupuesto mensual</h3><div class="muted small">Poné 0 si no querés presupuesto. Dejá el nombre vacío para borrar la categoría.</div>
    ${c.catGasto.map((g, i) => `<div class="grid2"><input class="in" id="cg-n-${i}" value="${esc(g.nombre)}" aria-label="Categoría"><input class="in num" id="cg-p-${i}" inputmode="decimal" value="${g.presupuesto ? nf0.format(g.presupuesto) : ""}" placeholder="Presupuesto" aria-label="Presupuesto de ${esc(g.nombre)}"></div>`).join("")}
    <button type="button" class="btn ghost sm" data-act="addCat">+ Agregar categoría</button>
  </div>
  <div class="card"><h3>Categorías de ingreso</h3><input class="in" id="ci" value="${esc(c.catIngreso.join(", "))}" aria-label="Categorías de ingreso separadas por coma"></div>
  <div class="card"><h3>Dólar por defecto</h3><input class="in num" id="aj-tc" inputmode="decimal" value="${esc(String(c.tc).replace(".", ","))}" aria-label="Tipo de cambio por defecto"><div class="muted small">Se usa en los meses sin cierre.</div></div>
  <button class="btn" type="submit">Guardar ajustes</button>
  </form></div><div class="col">
  <div class="card"><h3>Respaldo</h3><div class="muted small">Descargá tus datos cuando quieras. El CSV se abre en Excel.</div>
    <div class="row"><button class="btn ghost" data-act="exportCsv" style="flex:1">Movimientos (Excel/CSV)</button><button class="btn ghost" data-act="exportJson" style="flex:1">Copia completa</button></div></div>
  <div class="card"><h3>Importar datos</h3><div class="muted small">Pegá la copia completa (la que copiaste desde la versión anterior con “Copiar mis datos”) o elegí un archivo de respaldo. Los registros con el mismo identificador se reemplazan, así que importar dos veces no duplica.</div>
    <textarea class="in" id="imp-text" rows="4" placeholder='{"config":…,"movs":[…]}'></textarea>
    <div class="row"><label class="btn ghost" style="flex:1" for="imp-file">Elegir archivo</label><input type="file" id="imp-file" accept=".json,application/json" hidden><button class="btn" data-act="import" style="flex:1">Importar</button></div>
    <div id="imp-msg" class="small" role="status"></div></div>
  <div class="card" id="lockCard"><h3>Bloqueo de la app</h3><div class="muted small">Cargando…</div></div>
  <div class="card"><h3>Cuenta</h3><div class="small">${esc(S.user.email || S.user.displayName || "")}</div><button class="btn ghost" data-act="logout">Cerrar sesión</button><div class="muted small">Versión ${APP_VERSION}</div></div>
  </div></div>`;
}

/* ============ Eventos ============ */
function bindView(){
  const v = $("#view");
  v.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", e => act(b.dataset.act, e)));
  v.querySelectorAll("[data-mov]").forEach(b => b.addEventListener("click", () => openMov(S.movs.find(m => m.id === b.dataset.mov))));
  v.querySelectorAll("[data-compra]").forEach(b => b.addEventListener("click", () => openCompra(S.compras.find(c => c.id === b.dataset.compra))));
  v.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => { movFilter = b.dataset.filter; render(); }));
  v.querySelectorAll("[data-cierre]").forEach(b => b.addEventListener("click", () => { cierreMonth = b.dataset.cierre; }));
  const s = $("#search"); if (s) s.addEventListener("input", () => { movSearch = s.value; render(); });
  const cf = $("#cierreForm"); if (cf) cf.addEventListener("submit", saveCierre);
  const af = $("#ajForm"); if (af) af.addEventListener("submit", saveAjustes);
  if ($("#lockCard")) fillLock();
  const fi = $("#imp-file"); if (fi) fi.addEventListener("change", async () => { const f = fi.files[0]; if (f) $("#imp-text").value = await f.text(); });
}
function fillLock(){
  lockSettingsHTML().then(h => { const c = $("#lockCard"); if (!c) return; c.innerHTML = h; bindLockSettings(fillLock, S.user && S.user.email); });
}
function act(a, e){
  if (e) e.preventDefault();
  const c = () => structuredClone(cfg());
  switch (a){
    case "prevM": viewMonth = addM(viewMonth, -1); return render();
    case "nextM": viewMonth = addM(viewMonth, 1); return render();
    case "prevY": viewMonth = addM(viewMonth, -12); return render();
    case "nextY": viewMonth = addM(viewMonth, 12); return render();
    case "prevC": cierreMonth = addM(cierreMonth, -1); return render();
    case "nextC": cierreMonth = addM(cierreMonth, 1); return render();
    case "newCompra": return openCompra();
    case "copyPrev": { const p = S.cierres[addM(cierreMonth, -1)]; if (!p) return toast("No hay cierre del mes anterior"); document.querySelectorAll("#cierreForm [data-cuenta]").forEach(i => { const v = p.saldos ? p.saldos[i.dataset.cuenta] : null; if (v != null) i.value = String(v).replace(".", ","); }); return; }
    case "addCuenta": { const x = c(); x.cuentas.push({id:uid("cu"), nombre:"Nueva cuenta", clase:"banco", moneda:"ARS", activa:true}); return write("meta", "config", x); }
    case "addTarjeta": { const x = c(); x.tarjetas.push({id:uid("tj"), nombre:"Nueva tarjeta"}); return write("meta", "config", x); }
    case "addCat": { const x = c(); x.catGasto.push({nombre:"Nueva categoría", presupuesto:0}); return write("meta", "config", x); }
    case "exportJson": { const clean = arr => arr.map(({_p, ...r}) => r); download(`mis-finanzas-${hoy()}.json`, JSON.stringify({config:cfg(), movs:clean(S.movs), compras:clean(S.compras), cierres:S.cierres}), "application/json"); return toast("Copia descargada"); }
    case "exportCsv": return exportCsv();
    case "import": return importData();
    case "logout": return fb.auth.signOut(fb.au);
  }
}
function exportCsv(){
  const q = v => { v = String(v ?? ""); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [["Fecha","Tipo","Categoría","Detalle","Persona","Cuenta","Destino","Monto","Moneda"]];
  [...S.movs].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")).forEach(m => rows.push([m.fecha, (TIPOS[m.tipo] || {}).lbl || m.tipo, m.categoria || "", m.nota || "", m.persona || "", cuentaNom(m.cuenta), m.destino ? cuentaNom(m.destino) : "", String(m.monto).replace(".", ","), monedaDe(m.cuenta)]));
  rows.push([]); rows.push(["Compras con tarjeta"]); rows.push(["Fecha","Comercio","Categoría","Tarjeta","Total","Cuotas","Primera cuota","Débito mensual","Moneda"]);
  S.compras.forEach(c => rows.push([c.fecha, c.comercio, c.categoria, cuentaNom(c.tarjeta), String(c.total).replace(".", ","), c.cuotas, c.primerMes, c.recurrente ? "Sí" : "No", c.moneda || "ARS"]));
  download(`movimientos-${hoy()}.csv`, "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  toast("Archivo descargado");
}
async function importData(){
  const msg = $("#imp-msg"); let data;
  try { data = JSON.parse($("#imp-text").value); } catch(e){ msg.className = "bad small"; msg.textContent = "Eso no es una copia válida. Pegá el texto completo, que empieza con {."; return; }
  const ops = [];
  if (data.config) ops.push([userDoc("meta", "config"), data.config]);
  for (const m of data.movs || []){ const {id, _p, ...r} = m; if (id) ops.push([userDoc("movs", id), r]); }
  for (const c of data.compras || []){ const {id, _p, ...r} = c; if (id) ops.push([userDoc("compras", id), r]); }
  for (const [k, v] of Object.entries(data.cierres || {})) ops.push([userDoc("cierres", k), v]);
  if (!ops.length){ msg.className = "bad small"; msg.textContent = "La copia no tiene datos."; return; }
  msg.className = "small muted"; msg.textContent = `Importando ${ops.length} registros…`;
  try {
    for (let i = 0; i < ops.length; i += 400){ const b = fb.fs.writeBatch(fb.db); ops.slice(i, i + 400).forEach(([ref, d]) => b.set(ref, d)); const p = b.commit(); if (S.online) await p; else p.catch(() => {}); }
    msg.className = "good small"; msg.textContent = `Listo: ${ops.length} registros importados${S.online ? "" : " (se suben cuando vuelva internet)"}.`;
    $("#imp-text").value = "";
  } catch(e){ msg.className = "bad small"; msg.textContent = "No se pudo importar: " + (e.code || e.message); }
}
function saveCierre(e){
  e.preventDefault();
  const saldos = {}; document.querySelectorAll("#cierreForm [data-cuenta]").forEach(i => { const n = parseNum(i.value); if (!isNaN(n)) saldos[i.dataset.cuenta] = n; });
  const tc = parseNum($("#cs-tc").value);
  write("cierres", cierreMonth, {saldos, tc:isNaN(tc) ? cfg().tc : tc, fecha:hoy()});
  toast("Cierre de " + ymLabel(cierreMonth) + " guardado");
}
function saveAjustes(e){
  e.preventDefault();
  const c = structuredClone(cfg());
  c.cuentas = c.cuentas.map((x, i) => ({...x, nombre:$("#cu-n-" + i).value.trim() || x.nombre, clase:$("#cu-c-" + i).value, moneda:$("#cu-m-" + i).value, activa:$("#cu-a-" + i).checked}));
  c.tarjetas = c.tarjetas.map((t, i) => ({...t, nombre:$("#tj-" + i).value.trim() || t.nombre}));
  c.catGasto = c.catGasto.map((g, i) => ({nombre:$("#cg-n-" + i).value.trim(), presupuesto:parseNum($("#cg-p-" + i).value) || 0})).filter(g => g.nombre);
  c.catIngreso = $("#ci").value.split(",").map(s => s.trim()).filter(Boolean);
  const tc = parseNum($("#aj-tc").value); if (!isNaN(tc)) c.tc = tc;
  write("meta", "config", c); toast("Ajustes guardados");
}

/* ============ Formulario de movimiento ============ */
let F = null;
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
const cuentaOpts = (sel, extra) => opts(cfg().cuentas.filter(c => c.activa || c.id === sel).map(c => [c.id, c.nombre + (c.moneda === "USD" ? " (USD)" : "")]).concat(extra || []), sel);
function lastCuenta(){ try { return JSON.parse(localStorage.getItem("mf-last") || "{}").cuenta; } catch(e){ return null; } }
function openMov(m){
  F = m ? {...m, _edit:true} : {tipo:"gasto", fecha:hoy(), monto:"", cuenta:lastCuenta() || "mercadopago", categoria:"", nota:"", cuotas:1};
  renderSheet();
}
function renderSheet(){
  const t = F.tipo, c = cfg();
  const tipos = F._edit ? [[t, TIPOS[t].lbl]] : Object.entries(TIPOS).map(([k, v]) => [k, v.lbl]);
  const esTC = String(F.cuenta || "").startsWith("tc:");
  let fields = "";
  if (t === "gasto"){
    fields += `<label class="f" for="fm-cuenta">Cómo pagaste<select class="in" id="fm-cuenta">${cuentaOpts(F.cuenta, F._edit ? [] : c.tarjetas.map(x => ["tc:" + x.id, "💳 " + x.nombre]))}</select></label>`;
    if (esTC) fields += `<div class="grid2"><label class="f" for="fm-cuotas">Cuotas<input class="in num" id="fm-cuotas" inputmode="numeric" value="${esc(F.cuotas || 1)}"></label><label class="f" for="fm-primer">Primera cuota en<input class="in" type="month" id="fm-primer" value="${esc(F.primerMes || addM(ymOf(F.fecha || hoy()), 1))}"></label></div>`;
    fields += `<div class="f" style="color:var(--muted);font-size:13px">Categoría<div class="chips" id="fm-cats">${c.catGasto.map(g => `<button type="button" class="chip" data-cat="${esc(g.nombre)}" aria-pressed="${F.categoria === g.nombre}">${esc(g.nombre)}</button>`).join("")}</div></div>`;
  } else if (t === "ingreso"){
    fields += `<label class="f" for="fm-cuenta">Entró en<select class="in" id="fm-cuenta">${cuentaOpts(F.cuenta)}</select></label>`;
    fields += `<div class="f" style="color:var(--muted);font-size:13px">Categoría<div class="chips" id="fm-cats">${c.catIngreso.map(g => `<button type="button" class="chip" data-cat="${esc(g)}" aria-pressed="${F.categoria === g}">${esc(g)}</button>`).join("")}</div></div>`;
  } else if (t === "transfer"){
    const dif = monedaDe(F.cuenta) !== monedaDe(F.destino || "efectivo");
    fields += `<div class="grid2"><label class="f" for="fm-cuenta">Desde<select class="in" id="fm-cuenta">${cuentaOpts(F.cuenta)}</select></label><label class="f" for="fm-destino">Hacia<select class="in" id="fm-destino">${cuentaOpts(F.destino || "efectivo")}</select></label></div>`;
    if (dif) fields += `<label class="f" for="fm-montod">Monto que llegó (${monedaDe(F.destino || "efectivo")})<input class="in num" id="fm-montod" inputmode="decimal" value="${F.montoDestino != null ? esc(String(F.montoDestino).replace(".", ",")) : ""}"></label>`;
    fields += `<div class="muted small">Ejemplos: Santander → Invertir Online (aporte), Mercado Pago → Efectivo (alguien te dio efectivo), pesos → dólares.</div>`;
  } else if (t === "pagotc"){
    fields += `<div class="grid2"><label class="f" for="fm-tarjeta">Tarjeta<select class="in" id="fm-tarjeta">${opts(c.tarjetas.map(x => [x.id, x.nombre]), F.tarjeta || (c.tarjetas[0] || {}).id)}</select></label><label class="f" for="fm-cuenta">Pagaste desde<select class="in" id="fm-cuenta">${cuentaOpts(F.cuenta)}</select></label></div>`;
  } else if (t === "prestamo" || t === "cobro"){
    const personas = Object.values(saldosPrestamos()).map(p => p.nombre);
    fields += `<div class="grid2"><label class="f" for="fm-persona">${t === "prestamo" ? "A quién" : "Quién"}<input class="in" id="fm-persona" list="fm-pers" value="${esc(F.persona || "")}" autocomplete="off"><datalist id="fm-pers">${personas.map(p => `<option value="${esc(p)}">`).join("")}</datalist></label><label class="f" for="fm-cuenta">${t === "prestamo" ? "Salió de" : "Entró en"}<select class="in" id="fm-cuenta">${cuentaOpts(F.cuenta)}</select></label></div>`;
    if (personas.length) fields += `<div class="chips">${personas.slice(0, 8).map(p => `<button type="button" class="chip" data-persona="${esc(p)}">${esc(p)}</button>`).join("")}</div>`;
  } else {
    fields += `<label class="f" for="fm-cuenta">Cuenta<select class="in" id="fm-cuenta">${cuentaOpts(F.cuenta)}</select></label><div class="muted small">Los viáticos no cuentan en tu ahorro: se ven aparte en el resumen.</div>`;
  }
  $("#modal").innerHTML = `<div class="overlay" id="ov"><form class="sheet" id="movForm" aria-label="Movimiento">
    <div class="row between"><h2>${F._edit ? "Editar movimiento" : "Nuevo movimiento"}</h2><button type="button" class="iconbtn" id="fm-close" aria-label="Cerrar">✕</button></div>
    <div class="chips" id="fm-tipos">${tipos.map(([k, l]) => `<button type="button" class="chip" data-tipo="${k}" aria-pressed="${k === t}">${l}</button>`).join("")}</div>
    <label class="f" for="fm-monto">Monto ${t === "gasto" && esTC ? "total de la compra" : ""}<input class="in big" id="fm-monto" inputmode="decimal" placeholder="0" value="${F.monto !== "" && F.monto != null ? esc(String(F.monto).replace(".", ",")) : ""}" autocomplete="off"></label>
    <label class="f" for="fm-fecha">Fecha<input class="in" type="date" id="fm-fecha" value="${esc(F.fecha)}"></label>
    ${fields}
    <label class="f" for="fm-nota">${t === "gasto" && esTC ? "Comercio o detalle" : "Detalle"}<input class="in" id="fm-nota" value="${esc(F.nota || "")}" placeholder="Opcional"></label>
    <div id="fm-err" class="bad small" role="alert"></div>
    <div class="row">${F._edit ? `<button type="button" class="btn danger" id="fm-del">Borrar</button>` : ""}<button class="btn" type="submit" style="flex:1">${F._edit ? "Guardar cambios" : "Guardar"}</button></div>
  </form></div>`;
  const keep = () => { F.monto = $("#fm-monto").value; F.fecha = $("#fm-fecha").value; F.nota = $("#fm-nota").value; const g = id => $(id) && $(id).value; if ($("#fm-cuenta")) F.cuenta = g("#fm-cuenta"); if ($("#fm-destino")) F.destino = g("#fm-destino"); if ($("#fm-persona")) F.persona = g("#fm-persona"); if ($("#fm-tarjeta")) F.tarjeta = g("#fm-tarjeta"); if ($("#fm-cuotas")) F.cuotas = g("#fm-cuotas"); if ($("#fm-primer")) F.primerMes = g("#fm-primer"); if ($("#fm-montod")) F.montoDestino = g("#fm-montod"); };
  $("#fm-close").onclick = closeSheet;
  $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
  document.querySelectorAll("#fm-tipos [data-tipo]").forEach(b => b.onclick = () => { keep(); F.tipo = b.dataset.tipo; F.categoria = ""; if (F.tipo !== "gasto" && String(F.cuenta).startsWith("tc:")) F.cuenta = "santander"; renderSheet(); });
  document.querySelectorAll("#fm-cats [data-cat]").forEach(b => b.onclick = () => { F.categoria = b.dataset.cat; document.querySelectorAll("#fm-cats [data-cat]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  document.querySelectorAll("[data-persona]").forEach(b => b.onclick = () => { $("#fm-persona").value = b.dataset.persona; });
  if ($("#fm-cuenta")) $("#fm-cuenta").onchange = () => { keep(); renderSheet(); };
  if ($("#fm-destino")) $("#fm-destino").onchange = () => { keep(); renderSheet(); };
  if (F._edit) $("#fm-del").onclick = () => { const b = $("#fm-del"); if (b.dataset.sure){ remove("movs", F.id); closeSheet(); toast("Movimiento borrado"); } else { b.dataset.sure = 1; b.textContent = "¿Seguro? Tocá de nuevo"; } };
  $("#movForm").onsubmit = e => {
    e.preventDefault(); keep();
    const monto = parseNum(F.monto), err = $("#fm-err");
    if (!(monto > 0)) return err.textContent = "Poné un monto mayor a cero.";
    if (!F.fecha) return err.textContent = "Elegí la fecha.";
    if ((F.tipo === "gasto" || F.tipo === "ingreso") && !F.categoria) return err.textContent = "Elegí una categoría.";
    if (F.tipo === "transfer" && F.cuenta === F.destino) return err.textContent = "La cuenta de origen y la de destino son la misma.";
    if ((F.tipo === "prestamo" || F.tipo === "cobro") && !normName(F.persona)) return err.textContent = "Escribí a quién.";
    if (F.tipo === "gasto" && String(F.cuenta).startsWith("tc:")){
      const n = Math.max(1, parseInt(F.cuotas, 10) || 1);
      write("compras", uid("c"), {fecha:F.fecha, comercio:(F.nota || "").trim() || F.categoria, categoria:F.categoria, tarjeta:F.cuenta.slice(3), moneda:"ARS", total:monto, cuotas:n, primerMes:F.primerMes || addM(ymOf(F.fecha), 1), recurrente:false, creado:Date.now()});
      toast(n > 1 ? `Compra en ${n} cuotas guardada` : "Compra con tarjeta guardada");
    } else {
      const doc = {tipo:F.tipo, fecha:F.fecha, monto, cuenta:F.cuenta, nota:(F.nota || "").trim(), creado:F.creado || Date.now()};
      if (F.categoria) doc.categoria = F.categoria;
      if (F.tipo === "transfer"){ doc.destino = F.destino || "efectivo"; const md = parseNum(F.montoDestino); if (monedaDe(doc.cuenta) !== monedaDe(doc.destino) && md > 0) doc.montoDestino = md; }
      if (F.tipo === "pagotc") doc.tarjeta = F.tarjeta || (cfg().tarjetas[0] || {}).id;
      if (F.tipo === "prestamo" || F.tipo === "cobro"){ const nn = normName(F.persona); const ex = Object.values(saldosPrestamos()).find(p => p.nombre.toLowerCase() === nn.toLowerCase()); doc.persona = ex ? ex.nombre : nn; }
      write("movs", F._edit ? F.id : uid("m"), doc);
      toast(F._edit ? "Cambios guardados" : (S.online ? "Movimiento guardado" : "Guardado en el equipo · se sube cuando haya internet"));
    }
    try { localStorage.setItem("mf-last", JSON.stringify({cuenta:F.cuenta})); } catch(e){}
    viewMonth = ymOf(F.fecha); closeSheet(); render();
  };
  if (!F._edit) setTimeout(() => $("#fm-monto") && $("#fm-monto").focus(), 50);
}
function closeSheet(){ $("#modal").innerHTML = ""; F = null; }

/* ============ Formulario de compra con tarjeta ============ */
function openCompra(c){
  const C = c ? {...c} : {fecha:hoy(), comercio:"", categoria:"", tarjeta:(cfg().tarjetas[0] || {}).id, moneda:"ARS", total:"", cuotas:1, primerMes:addM(mesActual(), 1), recurrente:false};
  const draw = () => {
    $("#modal").innerHTML = `<div class="overlay" id="ov"><form class="sheet" id="cpForm">
    <div class="row between"><h2>${c ? "Editar compra" : "Compra con tarjeta"}</h2><button type="button" class="iconbtn" id="cp-close" aria-label="Cerrar">✕</button></div>
    <div class="chips"><button type="button" class="chip" id="cp-norm" aria-pressed="${!C.recurrente}">En cuotas</button><button type="button" class="chip" id="cp-rec" aria-pressed="${!!C.recurrente}">Débito automático mensual</button></div>
    <label class="f" for="cp-com">Comercio o detalle<input class="in" id="cp-com" value="${esc(C.comercio)}"></label>
    <div class="grid2"><label class="f" for="cp-total">${C.recurrente ? "Monto por mes" : "Monto total"}<input class="in num" id="cp-total" inputmode="decimal" value="${C.total !== "" ? esc(String(C.total).replace(".", ",")) : ""}"></label><label class="f" for="cp-mon">Moneda<select class="in" id="cp-mon"><option ${C.moneda !== "USD" ? "selected" : ""}>ARS</option><option ${C.moneda === "USD" ? "selected" : ""}>USD</option></select></label></div>
    <div class="grid2">${C.recurrente ? "" : `<label class="f" for="cp-cuotas">Cuotas<input class="in num" id="cp-cuotas" inputmode="numeric" value="${esc(C.cuotas)}"></label>`}<label class="f" for="cp-primer">${C.recurrente ? "Desde" : "Primera cuota en"}<input class="in" type="month" id="cp-primer" value="${esc(C.primerMes)}"></label>${C.recurrente ? `<label class="f" for="cp-hasta">Hasta (vacío = sigue)<input class="in" type="month" id="cp-hasta" value="${esc(C.hasta || "")}"></label>` : ""}</div>
    <div class="grid2"><label class="f" for="cp-tj">Tarjeta<select class="in" id="cp-tj">${opts(cfg().tarjetas.map(x => [x.id, x.nombre]), C.tarjeta)}</select></label><label class="f" for="cp-fecha">Fecha de compra<input class="in" type="date" id="cp-fecha" value="${esc(C.fecha)}"></label></div>
    <label class="f" for="cp-cat">Categoría<select class="in" id="cp-cat"><option value="">Elegí…</option>${opts(cfg().catGasto.map(g => [g.nombre, g.nombre]), C.categoria)}</select></label>
    <div id="cp-err" class="bad small" role="alert"></div>
    <div class="row">${c ? `<button type="button" class="btn danger" id="cp-del">Borrar</button>` : ""}<button class="btn" type="submit" style="flex:1">Guardar</button></div>
    </form></div>`;
    const keep = () => { C.comercio = $("#cp-com").value; C.total = $("#cp-total").value; C.moneda = $("#cp-mon").value; if ($("#cp-cuotas")) C.cuotas = $("#cp-cuotas").value; C.primerMes = $("#cp-primer").value; if ($("#cp-hasta")) C.hasta = $("#cp-hasta").value; C.tarjeta = $("#cp-tj").value; C.fecha = $("#cp-fecha").value; C.categoria = $("#cp-cat").value; };
    $("#cp-close").onclick = closeSheet; $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
    $("#cp-norm").onclick = () => { keep(); C.recurrente = false; draw(); };
    $("#cp-rec").onclick = () => { keep(); C.recurrente = true; draw(); };
    if (c) $("#cp-del").onclick = () => { const b = $("#cp-del"); if (b.dataset.sure){ remove("compras", c.id); closeSheet(); toast("Compra borrada"); } else { b.dataset.sure = 1; b.textContent = "¿Seguro? Tocá de nuevo"; } };
    $("#cpForm").onsubmit = e => {
      e.preventDefault(); keep();
      const total = parseNum(C.total), err = $("#cp-err");
      if (!(total > 0)) return err.textContent = "Poné un monto mayor a cero.";
      if (!C.categoria) return err.textContent = "Elegí una categoría.";
      if (!C.primerMes) return err.textContent = "Elegí el mes de la primera cuota.";
      const doc = {fecha:C.fecha, comercio:C.comercio.trim() || C.categoria, categoria:C.categoria, tarjeta:C.tarjeta, moneda:C.moneda, total, cuotas:C.recurrente ? 1 : Math.max(1, parseInt(C.cuotas, 10) || 1), primerMes:C.primerMes, recurrente:!!C.recurrente, creado:C.creado || Date.now()};
      if (C.recurrente && C.hasta) doc.hasta = C.hasta;
      write("compras", c ? c.id : uid("c"), doc); toast("Compra guardada"); closeSheet(); render();
    };
  };
  draw();
}

init();
