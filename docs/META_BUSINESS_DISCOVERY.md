# Activar búsquedas reales con Meta Business Discovery

El backend público está en Cloudflare Workers. Las consultas anónimas a páginas HTML de Instagram son bloqueadas y se desactivaron.

La vía oficial Business Discovery permite consultar metadatos y medios de cuentas Instagram **profesionales** (Business/Creator), mediante una cuenta Instagram profesional autorizada y permisos adecuados. No permite buscar cuentas personales privadas ni garantiza que cualquier cuenta pública sea accesible.

Para activar **sin compartir secretos en el repositorio**:
1. Crear/configurar una aplicación Meta con Instagram API con Facebook Login, una cuenta Instagram profesional vinculada a una página y permisos `instagram_basic` y `pages_read_engagement` según revisión de la aplicación.
2. Obtener el ID de la cuenta profesional que hace las consultas y un token autorizado conforme a las políticas de Meta.
3. Configurar como secretos/bindings del Worker `instatool-public-api`: `META_IG_USER_ID` y `META_ACCESS_TOKEN`, desde el panel de Cloudflare, no en GitHub.
4. Desplegar `cloudflare/worker.mjs`; verificar `GET /api/health` y `GET /api/user/<usuario profesional>`. Si el perfil es personal o no hay permisos, devolver error claro sin datos inventados.
5. Revisar que la obtención y descarga de medios esté cubierta por permisos, derechos del contenido y condiciones de la plataforma.

**Estado:** no existen los secretos configurados actualmente en Cloudflare. Por lo tanto, una búsqueda como `@pao.arandaok` no puede verificarse sin contar con permisos adecuados y sin saber si es una cuenta profesional. Nunca afirmar que funcionó antes de una prueba real. Las rutas de descargas y búsqueda geográfica de publicaciones siguen sin proveedor real.

Referencia: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
