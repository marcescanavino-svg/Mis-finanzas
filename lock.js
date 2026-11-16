// Bloqueo de la app: contraseña y Face ID / huella / Windows Hello (WebAuthn).
// Es un candado de privacidad por equipo: cada dispositivo tiene su propia configuración.
const KEY = "mf-lock";          // {salt, hash, iter, bioId, timeoutMin}
const LAST = "mf-lock-hidden";  // momento en que la app pasó a segundo plano
let state = load();
let unlocked = false;
let fails = 0, waitUntil = 0;
let onForgotCb = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function load(){ try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch(e){ return null; } }
function save(){ try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch(e){} }

export const bioName = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "Face ID";
  if (/Android/.test(ua)) return "huella o rostro";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "biometría del equipo";
};
export async function bioAvailable(){
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch(e){ return false; }
}
export const isEnabled = () => !!(state && state.hash);

async function hashPw(pw, salt, iter){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt, iterations:iter}, key, 256);
  return b64(bits);
}
async function setPassword(pw){
  const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 150000;
  const hash = await hashPw(pw, salt, iter);
  state = {...(state || {timeoutMin:1}), salt:b64(salt), hash, iter};
  save();
}
async function checkPassword(pw){
  if (!state) return false;
  return (await hashPw(pw, unb64(state.salt), state.iter)) === state.hash;
}
async function registerBio(email){
  const cred = await navigator.credentials.create({publicKey:{
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: {name:"Mis Finanzas", id:location.hostname},
    user: {id:crypto.getRandomValues(new Uint8Array(16)), name:email || "mis-finanzas", displayName:"Mis Finanzas"},
    pubKeyCredParams: [{type:"public-key", alg:-7}, {type:"public-key", alg:-257}],
    authenticatorSelection: {authenticatorAttachment:"platform", userVerification:"required", residentKey:"discouraged"},
    timeout: 60000, attestation: "none",
  }});
  state.bioId = b64(cred.rawId); save();
}
async function verifyBio(){
  if (!state || !state.bioId) return false;
  const res = await navigator.credentials.get({publicKey:{
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{type:"public-key", id:unb64(state.bioId), transports:["internal"]}],
    userVerification: "required", timeout: 60000, rpId: location.hostname,
  }});
  return !!res;
}

/* ===== Pantalla de bloqueo ===== */
function show(){
  unlocked = false;
  document.documentElement.classList.add("locked");
  const bio = !!(state && state.bioId);
  const el = document.getElementById("lock");
  el.innerHTML = `<form class="lockbox" id="lk-form" autocomplete="off">
    <img class="logo" src="icons/icon-192.png" alt="">
    <div><h2>Mis Finanzas</h2><div class="muted small">La app está bloqueada</div></div>
    ${bio ? `<button type="button" class="bio" id="lk-bio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1 3.6 1 5 0"/></svg><b>Desbloquear con ${esc(bioName())}</b></button><div class="sep">o con tu contraseña</div>` : ""}
    <input class="in" id="lk-pw" type="password" placeholder="Contraseña" aria-label="Contraseña" autocomplete="current-password">
    <button class="btn" type="submit">Desbloquear</button>
    <div id="lk-err" class="bad small" role="alert"></div>
    <button type="button" class="linkbtn" id="lk-forgot">Olvidé la contraseña</button>
  </form>`;
  const err = m => { document.getElementById("lk-err").textContent = m; };
  document.getElementById("lk-form").onsubmit = async e => {
    e.preventDefault();
    if (Date.now() < waitUntil) return err(`Demasiados intentos. Esperá ${Math.ceil((waitUntil - Date.now()) / 1000)} segundos.`);
    const pw = document.getElementById("lk-pw").value;
    if (!pw) return err("Escribí tu contraseña.");
    if (await checkPassword(pw)){ fails = 0; hide(); }
    else { fails++; document.getElementById("lk-pw").value = ""; if (fails >= 5){ waitUntil = Date.now() + 30000; fails = 0; err("Demasiados intentos. Esperá 30 segundos."); } else err("Contraseña incorrecta."); }
  };
  if (bio){
    const tryBio = async () => { try { if (await verifyBio()) hide(); } catch(e){ if (e.name !== "NotAllowedError" && e.name !== "AbortError") err(`No se pudo usar ${bioName()}. Usá tu contraseña.`); } };
    document.getElementById("lk-bio").onclick = tryBio;
    tryBio();
  } else setTimeout(() => { const p = document.getElementById("lk-pw"); p && p.focus(); }, 50);
  document.getElementById("lk-forgot").onclick = () => {
    const b = document.getElementById("lk-forgot");
    if (!b.dataset.sure){ b.dataset.sure = 1; b.textContent = "Se quita el bloqueo y se cierra la sesión. Para volver a entrar vas a necesitar tu cuenta de Google. Tocá de nuevo para confirmar."; return; }
    state = null; save(); hide(); if (onForgotCb) onForgotCb();
  };
}
function hide(){
  unlocked = true;
  try { localStorage.removeItem(LAST); } catch(e){}
  document.documentElement.classList.remove("locked");
  document.getElementById("lock").innerHTML = "";
}
export function lockNow(){ if (isEnabled()) show(); }

export function initLock({onForgot} = {}){
  onForgotCb = onForgot;
  if (isEnabled()) show(); else document.documentElement.classList.remove("locked");
  document.addEventListener("visibilitychange", () => {
    if (!isEnabled()) return;
    if (document.visibilityState === "hidden"){ if (unlocked) try { localStorage.setItem(LAST, String(Date.now())); } catch(e){} }
    else if (unlocked){
      const t = Number(localStorage.getItem(LAST) || 0), min = Number(state.timeoutMin ?? 1);
      if (t && Date.now() - t >= min * 60000) show();
    }
  });
}

/* ===== Sección en Ajustes ===== */
export async function lockSettingsHTML(){
  const on = isEnabled(), canBio = await bioAvailable(), hasBio = !!(state && state.bioId);
  const t = state ? Number(state.timeoutMin ?? 1) : 1;
  const tOpts = [[0,"Apenas salgo de la app"],[1,"Después de 1 minuto"],[5,"Después de 5 minutos"],[15,"Después de 15 minutos"],[60,"Después de 1 hora"]];
  if (!on) return `<h3>Bloqueo de la app</h3>
    <div class="muted small">Pedí una contraseña${canBio ? ` o ${esc(bioName())}` : ""} para abrir la app en este equipo. Cada equipo se configura por separado.</div>
    <input class="in" id="lk-n1" type="password" placeholder="Nueva contraseña (mínimo 4 caracteres)" autocomplete="new-password" aria-label="Nueva contraseña">
    <input class="in" id="lk-n2" type="password" placeholder="Repetila" autocomplete="new-password" aria-label="Repetir contraseña">
    <button class="btn" type="button" id="lk-set">Activar bloqueo</button>
    <div id="lk-msg" class="small" role="status"></div>`;
  return `<div class="row between"><h3>Bloqueo de la app</h3><span class="pill">Activado</span></div>
    <div class="muted small">Este equipo pide ${hasBio ? esc(bioName()) + " o tu contraseña" : "tu contraseña"} para abrir la app.</div>
    ${canBio ? (hasBio ? `<button class="btn ghost" type="button" id="lk-bio-off">Dejar de usar ${esc(bioName())}</button>` : `<button class="btn" type="button" id="lk-bio-on">Usar ${esc(bioName())}</button>`) : `<div class="muted small">Este equipo no tiene ${esc(bioName())} disponible para apps web: se usa la contraseña.</div>`}
    <label class="f" for="lk-time">Volver a bloquear<select class="in" id="lk-time">${tOpts.map(([v, l]) => `<option value="${v}" ${v === t ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="row"><button class="btn ghost" type="button" id="lk-now" style="flex:1">Bloquear ahora</button><button class="btn ghost" type="button" id="lk-chg" style="flex:1">Cambiar contraseña</button></div>
    <div id="lk-chg-box" hidden class="stack" style="gap:8px">
      <input class="in" id="lk-old" type="password" placeholder="Contraseña actual" autocomplete="current-password" aria-label="Contraseña actual">
      <input class="in" id="lk-n1" type="password" placeholder="Nueva contraseña" autocomplete="new-password" aria-label="Nueva contraseña">
      <input class="in" id="lk-n2" type="password" placeholder="Repetila" autocomplete="new-password" aria-label="Repetir contraseña">
      <button class="btn" type="button" id="lk-set">Guardar contraseña</button>
    </div>
    <button class="btn danger" type="button" id="lk-off">Quitar bloqueo</button>
    <div id="lk-msg" class="small" role="status"></div>`;
}
export function bindLockSettings(rerender, email){
  const $ = id => document.getElementById(id);
  const msg = (t, ok) => { const m = $("lk-msg"); if (m){ m.className = (ok ? "good" : "bad") + " small"; m.textContent = t; } };
  if ($("lk-set")) $("lk-set").onclick = async () => {
    const a = $("lk-n1").value, b = $("lk-n2").value;
    if (isEnabled() && !(await checkPassword($("lk-old").value))) return msg("La contraseña actual no es correcta.");
    if (a.length < 4) return msg("La contraseña tiene que tener al menos 4 caracteres.");
    if (a !== b) return msg("Las contraseñas no coinciden.");
    const first = !isEnabled();
    await setPassword(a); unlocked = true;
    if (first && await bioAvailable()){
      try { await registerBio(email); } catch(e){ /* el usuario puede activarlo después */ }
    }
    rerender(); setTimeout(() => msg(first ? "Bloqueo activado." : "Contraseña cambiada.", true), 50);
  };
  if ($("lk-chg")) $("lk-chg").onclick = () => { $("lk-chg-box").hidden = !$("lk-chg-box").hidden; };
  if ($("lk-now")) $("lk-now").onclick = () => show();
  if ($("lk-time")) $("lk-time").onchange = () => { state.timeoutMin = Number($("lk-time").value); save(); msg("Guardado.", true); };
  if ($("lk-bio-on")) $("lk-bio-on").onclick = async () => {
    try { await registerBio(email); rerender(); setTimeout(() => msg(`${bioName()} activado.`, true), 50); }
    catch(e){ msg(e.name === "NotAllowedError" ? "Se canceló. Probá de nuevo." : `No se pudo activar ${bioName()}: ${e.message}`); }
  };
  if ($("lk-bio-off")) $("lk-bio-off").onclick = () => { delete state.bioId; save(); rerender(); };
  if ($("lk-off")) $("lk-off").onclick = async () => {
    const b = $("lk-off");
    if (!b.dataset.sure){ b.dataset.sure = 1; b.textContent = "¿Seguro? Tocá de nuevo para quitar el bloqueo"; return; }
    state = null; save(); rerender();
  };
}
