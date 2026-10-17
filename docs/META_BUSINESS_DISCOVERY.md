# Instagram API: dos modos de autenticación distintos

## Instagram API with Instagram Login (documentación aportada)

- Se usa para **cuentas profesionales (Business o Creator) que autorizan la aplicación**.
- **No exige una página de Facebook vinculada**.
- Los scopes actuales para el consentimiento son `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages` y `instagram_business_manage_comments`.
- Los scopes anteriores `business_*` quedaron obsoletos el **27 de enero de 2025**.
- Permite consultar los medios y datos autorizados de **la propia cuenta que consiente**; no es un motor de búsqueda libre de perfiles de terceros.
- Requiere una app de Meta, configuración OAuth, redirect URI HTTPS, credenciales del servidor y consentimiento efectivo del titular.
- El token del usuario debe mantenerse del lado del servidor con almacenamiento seguro y revocación. Nunca exponerlo mediante `VITE_*`, respuestas del API o GitHub.

## Instagram API with Facebook Login / Business Discovery (implementación experimental PR #12)

- Es un **flujo diferente**: consulta ciertos perfiles profesionales de terceros mediante un usuario profesional de Instagram autorizado, sujeto a los permisos correspondientes.
- Puede necesitar una cuenta profesional conectada a una página de Facebook para ese flujo.
- El Worker experimental usa `graph.facebook.com`, `META_IG_USER_ID` y `META_ACCESS_TOKEN`. **No acepta automáticamente tokens de Instagram Login**.
- No debe presentarse como compatible con Instagram Login ni fusionarse como solución a este último.
- La cuenta `@pao.arandaok` solo podrá consultarse si está habilitada para uno de estos casos: Meta autoriza Business Discovery sobre ella como cuenta profesional, o su titular autoriza el acceso correspondiente a través de Instagram Login.
- La API no garantiza acceso a publicaciones por ubicación ni la descarga de todos los contenidos públicos.

## Estado y próximo requisito

El código actual de InstaTool carece de OAuth Instagram Login, almacenamiento seguro de tokens y autorización verificable del propietario de la cuenta. Cloudflare no contiene los secretos necesarios. **No anunciar búsqueda real ni descargas operativas** hasta conectar una app de Meta y superar una prueba completa con permisos reales.

Documentación oficial aportada: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
