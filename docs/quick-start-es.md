# Inicio rápido

FreshDeploy funciona sin cuentas externas y utiliza inglés de forma predeterminada.

1. Desde un proyecto React/Vite o Vue/Vite ejecuta `npx @devdags/freshdeploy setup` **cuando se publique el paquete npm**. Mientras tanto utiliza `node <ruta-FreshDeploy>/packages/cli/bin/freshdeploy.js setup`.
2. Ejecuta tu compilación habitual (`npm run build`): FreshDeploy genera el manifiesto automáticamente al terminar.
3. Despliega tu aplicación y ejecuta `freshdeploy check` en el pipeline; publica el reporte público reducido para el widget.
4. En local, `freshdeploy watch --live` activa comprobaciones y SSE si tu aplicación ya está servida en la URL configurada. Para hosting estático, utiliza comprobaciones posteriores al despliegue y Polling.

Para español: `freshdeploy settings --language es` y recompila, o elige Español desde el propio widget. La preferencia del navegador no modifica permisos ni intervalos del servidor.

Los adaptadores universales permiten usar la CLI con Next.js, Angular y HTML/PHP; la inserción automática del widget está implementada inicialmente para React/Vite y Vue/Vite. No se anuncian integraciones no comprobadas como automáticas.
