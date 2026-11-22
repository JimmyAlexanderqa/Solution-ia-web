// Solution IA — función de la web
// Solo atiende /api/*; todo lo demás (la web) lo sirve Cloudflare directo desde /public.
//
// POST /api/contacto  → valida el formulario y avisa por WhatsApp a Jimmy con CallMeBot.
// Secretos/variables en Cloudflare (Settings → Variables and Secrets):
//   CALLMEBOT_APIKEY  (secreto) clave que te da el bot de CallMeBot
//   ALERTA_TEL        (variable) número que recibe el aviso, ej. +51926711682

const NEGOCIOS = ['Hospedaje u hotel', 'Restaurante o cafetería', 'Tienda o bodega', 'Transporte o taxis', 'Servicios profesionales', 'Otro'];
const NECESIDADES = ['Asistente con IA en WhatsApp', 'Página web', 'Redes y contenido', 'Inventario y caja', 'App a medida', 'Asesoría financiera'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contacto') return contacto(request, env, url);
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'No encontrado' }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function contacto(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405);

  // Solo aceptamos envíos desde nuestra propia web
  const origen = request.headers.get('Origin');
  if (origen && new URL(origen).host !== url.host) return json({ ok: false, error: 'Origen no permitido' }, 403);

  let d;
  try {
    const tipo = request.headers.get('Content-Type') || '';
    d = tipo.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, error: 'Datos inválidos' }, 400);
  }

  // Anti-spam: campo trampa oculto y tiempo mínimo para llenar
  if (d.sitio_web) return json({ ok: true });
  const t = Number(d.t || 0);
  if (t && Date.now() - t < 3000) return json({ ok: true });

  const limpio = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const nombre = limpio(d.nombre, 80);
  const negocio = limpio(d.negocio, 60);
  const empresa = limpio(d.empresa, 80);
  const mensaje = String(d.mensaje ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 600);
  let necesita = d.necesita ?? [];
  if (!Array.isArray(necesita)) necesita = String(necesita).split(',');
  necesita = necesita.map((n) => limpio(n, 60)).filter((n) => NECESIDADES.includes(n));

  let cel = String(d.whatsapp ?? '').replace(/\D/g, '');
  if (cel.startsWith('51') && cel.length === 11) cel = cel.slice(2);

  const errores = {};
  if (nombre.length < 2) errores.nombre = 'Escribe tu nombre.';
  if (!/^9\d{8}$/.test(cel)) errores.whatsapp = 'Escribe un celular de 9 dígitos que empiece con 9.';
  if (negocio && !NEGOCIOS.includes(negocio)) errores.negocio = 'Elige un tipo de negocio.';
  if (Object.keys(errores).length) return json({ ok: false, errores }, 422);

  const hora = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  const lineas = ['*Nuevo contacto desde la web* 🚀', '', `*Nombre:* ${nombre}`, `*WhatsApp:* +51 ${cel.slice(0, 3)} ${cel.slice(3, 6)} ${cel.slice(6)}`];
  if (negocio || empresa) lineas.push(`*Negocio:* ${[negocio, empresa].filter(Boolean).join(' – ')}`);
  if (necesita.length) lineas.push(`*Necesita:* ${necesita.join(', ')}`);
  if (mensaje) lineas.push(`*Mensaje:* ${mensaje}`);
  lineas.push('', `Escríbele: https://wa.me/51${cel}`, `_${hora}_`);

  const enviado = await avisar(env, lineas.join('\n'));
  // Si el aviso no salió, la web abre WhatsApp como respaldo para no perder al cliente
  return json({ ok: enviado, aviso: enviado ? 'enviado' : 'fallo' }, enviado ? 200 : 502);
}

async function avisar(env, texto) {
  const tel = env.ALERTA_TEL || '+51926711682';
  if (!env.CALLMEBOT_APIKEY) return false;
  const api = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(tel)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY)}`;
  try {
    const r = await fetch(api, { signal: AbortSignal.timeout(12000) });
    const cuerpo = (await r.text()).toLowerCase();
    if (!r.ok) return false;
    if (cuerpo.includes('queued') || cuerpo.includes('sent')) return true;
    return !/(invalid|incorrect|wrong|not allowed|blocked)/.test(cuerpo);
  } catch {
    return false;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
