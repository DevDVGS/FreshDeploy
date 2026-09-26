/** Compact, dependency-free dictionaries. Technical status IDs always remain stable. */
const dictionaries = {
  en: {
    title:'freshdeploy / report',details:'FreshDeploy status details',close:'Close report',retry:'Check now',settings:'Settings',back:'Back to report',
    checking:'checking deployment...',waiting:'Waiting for deployment report...',published:'Published version',commit:'Commit',build:'Current build',checks:'Post-deploy checks',assets:'Assets verified',diff:'Version diff',
    footer:'Live verification / public report',language:'Language',update:'Widget refresh',seconds:'seconds',apply:'Apply',source:'Update mode',server:'Server checks: configured by the project',
    profile:'Monitoring profile',profileHint:'Controls this browser only; server timing is set in the project.',local:'Local · 1s widget',production:'Production · 10s widget',custom:'Custom',
    serverAt:'Server check interval',sseLive:'Live updates · SSE',pollFallback:'Automatic checks · Polling',sseConnecting:'Connecting · automatic fallback',recommendation:'Recommended for this environment',
    'deployment verified':'deployment verified','deployment warning':'deployment warning','deployment failed':'deployment failed',
    'manifest unavailable':'manifest unavailable','version not pinned':'version not pinned','version mismatch':'version mismatch','report unavailable':'report unavailable','report invalid':'report invalid','monitor unavailable':'monitor unavailable','monitor stale':'monitor stale','report pending':'report pending','report incomplete':'report incomplete','check unavailable':'check unavailable',
    pass:'PASS',warn:'WARN',fail:'FAIL',
  },
  es: {
    title:'freshdeploy / reporte',details:'Detalles del estado de FreshDeploy',close:'Cerrar reporte',retry:'Comprobar ahora',settings:'Configuración',back:'Volver al reporte',
    checking:'verificando despliegue...',waiting:'Esperando reporte del despliegue...',published:'Versión publicada',commit:'Commit',build:'Compilación actual',checks:'Verificaciones posteriores',assets:'Archivos verificados',diff:'Cambios de versión',
    footer:'Verificación en vivo / reporte público',language:'Idioma',update:'Actualización visual',seconds:'segundos',apply:'Aplicar',source:'Modo de actualización',server:'Revisiones del servidor: configuradas en el proyecto',
    profile:'Perfil de monitoreo',profileHint:'Solo cambia este navegador; el intervalo del servidor se configura en el proyecto.',local:'Local · widget cada 1 s',production:'Producción · widget cada 10 s',custom:'Personalizado',
    serverAt:'Intervalo del servidor',sseLive:'Actualización en vivo · SSE',pollFallback:'Consulta automática · Polling',sseConnecting:'Conectando · respaldo automático',recommendation:'Recomendado para este entorno',
    'deployment verified':'despliegue verificado','deployment warning':'advertencia de despliegue','deployment failed':'fallo en despliegue',
    'manifest unavailable':'manifiesto no disponible','version not pinned':'versión no especificada','version mismatch':'versiones diferentes','report unavailable':'reporte no disponible','report invalid':'reporte no válido','monitor unavailable':'monitor no disponible','monitor stale':'reporte desactualizado','report pending':'reporte pendiente','report incomplete':'reporte incompleto','check unavailable':'comprobación no disponible',
    pass:'CORRECTO',warn:'AVISO',fail:'ERROR',
  }
};
const messagesEs = {
  'The build and the published CI report match.':'La compilación coincide con el reporte publicado.',
  'The post-deployment check found a failure. Review the checks below.':'La comprobación detectó un error. Revisa los detalles.',
  'The post-deployment check reported a warning. Review the checks below.':'La comprobación detectó una advertencia. Revisa los detalles.',
  'No recent verification report has been published. Check whether the monitor is running.':'No hay un reporte reciente. Comprueba que el monitor siga activo.',
  'The background monitor could not complete its latest verification.':'El monitor no pudo completar su última comprobación.',
  'The published report is for a different deployment. Wait for the latest post-deploy check.':'El reporte corresponde a otra versión. Espera la nueva comprobación.',
  'Build version matches, but the post-deployment CI report is not published.':'La versión coincide, pero no está publicado el reporte de verificación.',
  'This page does not match the published manifest. It may be cached or outdated.':'Esta página no coincide con el manifiesto publicado. Puede estar desactualizada.',
  'Embed the expected build version or commit to verify freshness.':'Indica la versión o commit esperado para comprobar la actualización.',
  'The published manifest is missing or invalid.':'Falta el manifiesto publicado o no es válido.',
  'The published verification report has an invalid format.':'El reporte publicado tiene un formato no válido.',
  'Mandatory deployment checks are not confirmed.':'Faltan verificaciones obligatorias.',
};
const checksEs = {
  http: {pass:'Respuesta del servidor: correcta.',warn:'Respuesta del servidor: aviso.',fail:'No se pudo consultar el servidor.'},
  redirect:{pass:'Redirección: correcta.',warn:'La página redirige a otro dominio.',fail:'Error de redirección.'},
  cache:{pass:'Política de caché HTML: correcta.',warn:'Política de caché HTML: requiere revisión.',fail:'Política de caché HTML: error.'},
  manifest:{pass:'Manifiesto publicado: correcto.',warn:'Manifiesto no disponible.',fail:'Manifiesto: error.'},
  'html-integrity':{pass:'HTML publicado: coincide con la compilación.',warn:'Integridad del HTML: aviso.',fail:'HTML publicado: no coincide con el manifiesto.'},
  version:{pass:'Versión publicada: correcta.',warn:'No se confirmó la versión publicada.',fail:'Versión publicada: no coincide.'},
  assets:{pass:'Integridad de archivos: correcta.',warn:'Algunos archivos no se comprobaron.',fail:'Integridad de archivos: error.'},
  content:{pass:'Contenido esperado: encontrado.',warn:'Contenido esperado: aviso.',fail:'Contenido esperado: no encontrado.'},
  monitor:{pass:'Monitor: activo.',warn:'Monitor: comprobación no disponible.',fail:'Monitor: error.'},
};
export const normalizeLanguage = value => value==='es'?'es':'en';
export function translate(key,language='en'){const lang=normalizeLanguage(language);return dictionaries[lang][key]??dictionaries.en[key]??key;}
export function translateMessage(message,language='en'){
  if(normalizeLanguage(language)!=='es')return message;
  if(messagesEs[message])return messagesEs[message];
  if(message?.startsWith('Could not verify the published manifest:'))return 'No se pudo verificar el manifiesto publicado.';
  return message;
}
export function translateCheck(check,language='en'){
  if(normalizeLanguage(language)!=='es')return check.summary;
  return checksEs[check.id]?.[check.state] || `Verificación: ${translate(check.state,'es').toLowerCase()}.`;
}
