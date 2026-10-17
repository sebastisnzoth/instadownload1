# InstaTool — publicación full-stack

## Estado y limitaciones

GitHub Pages aloja el frontend, pero no ejecuta Node.js ni Python. Para habilitar búsqueda de perfiles, validación de enlaces y descarga de medios públicos se requiere desplegar el servicio Express de `server.ts` con `npm run build && npm start` en un host HTTPS capaz de ejecutar Node.js.

**No publicar `VITE_API_BASE_URL` con una URL no probada.** El cliente informa claramente cuando está sin backend y nunca acepta HTML como respuesta de la API.

1. Desplegá el backend Node 22 con `PORT` configurado por el host, instalando con `npm ci`.
2. Configurá `CORS_ALLOWED_ORIGINS` con orígenes adicionales si se necesitan. `https://sebastisnzoth.github.io` ya está permitido.
3. Verificá `GET https://HOST/api/health`: debe devolver JSON con `status: ok`.
4. Verificá un perfil público real con `GET https://HOST/api/user/instagram`; un HTML, 403 o 502 **no** es un resultado de búsqueda válido.
5. Configurá `VITE_API_BASE_URL=https://HOST` como variable de build de GitHub Actions. Una variable de runtime del host de la API **no** configura Vite en Pages.
6. Recompilá y probá CORS, búsqueda y descargas desde el navegador.

El servicio opcional Python Instaloader requiere instalar dependencias y establecer `INSTALOADER_MASTER_URL` si se usa; su disponibilidad por sí sola no garantiza acceso a datos de Instagram. **No se admiten publicaciones geográficas ficticias**: los endpoints de descubrimiento devuelven 503 hasta disponer de una fuente legítima.

### Pruebas verificables

- `npm ci && npm test && npm run lint && npm run build && npm run build:pages`
- `GET /api/health`, `GET /api/user/instagram`, CORS desde el origen de Pages y origen prohibido.
- Publicaciones públicas autorizadas para pruebas de `/api/media` y ZIP.
- Comprobar que descargas y búsquedas no violen las restricciones de acceso de Instagram.
