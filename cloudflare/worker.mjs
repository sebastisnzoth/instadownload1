// InstaTool public API — no simulated Instagram data; only public web metadata.
const origin = 'https://sebastisnzoth.github.io';
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
function json(body,status=200,extra={}) {return new Response(JSON.stringify(body),{status,headers:{...headers,...extra}})}
function username(s){return /^[a-zA-Z0-9._]{1,30}$/.test(s)&&!s.includes('..')?s:null}
function meta(html,kind,key){
  const tags=html.match(/<meta\b[^>]*>/gi)||[];
  for(const tag of tags){
    if(!new RegExp('(?:property|name)\\s*=\\s*["\\\']'+kind+':'+key+'["\\\']','i').test(tag))continue;
    const match=tag.match(/content\s*=\s*(["'])(.*?)\1/i);
    if(match)return match[2].replace(/&amp;/g,'&').replace(/&quot;/g,'"');
  }
  return null;
}
export default {
 async fetch(request, env){
  const url=new URL(request.url),o=request.headers.get('origin');
  const cors=o===origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}:{};
  if(o&&o!==origin)return json({error:'Origen no autorizado.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  let response;
  if(url.pathname==='/api/health'&&request.method==='GET')
   response=json({status:'ok',service:'instatool-public-api',capabilities:['health','public-profile-metadata'],instagramConnectivity:'not-guaranteed'});
  else if(url.pathname.startsWith('/api/user/')&&request.method==='GET'){
   const name=username(decodeURIComponent(url.pathname.slice('/api/user/'.length)));
   if(!name) response=json({error:'Nombre de usuario inválido.'},400);
   else {
    try{
     // Official Meta Business Discovery (only Professional accounts, authorized token).
     // Secrets are configured on the Worker; they never reach the browser.
     if(env?.META_IG_USER_ID && env?.META_ACCESS_TOKEN){
       const fields='business_discovery.username('+name+'){username,name,biography,profile_picture_url,followers_count,follows_count,media_count,media.limit(12){id,caption,media_type,media_url,permalink,timestamp}}';
       const graph=new URL('https://graph.facebook.com/v23.0/'+encodeURIComponent(env.META_IG_USER_ID));
       graph.searchParams.set('fields',fields);
       const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
       let result;
       try{
         const upstream=await fetch(graph,{headers:{Authorization:'Bearer '+env.META_ACCESS_TOKEN,Accept:'application/json'},signal:controller.signal});
         result=await upstream.json();
         if(!upstream.ok || result.error)throw new Error('GRAPH_RESTRICTED');
       }finally{clearTimeout(timer)}
       const p=result.business_discovery;
       if(!p?.username) response=json({error:'Meta no encontró un perfil profesional accesible con los permisos configurados.'},404);
       else response=json({
         username:p.username,profileUrl:'https://www.instagram.com/'+p.username+'/',
         fullName:p.name??null,biography:p.biography??null,avatarUrl:p.profile_picture_url??null,
         isPrivate:false,isVerified:null,
         counts:{followers:p.followers_count??null,following:p.follows_count??null,posts:p.media_count??null},
         posts:(p.media?.data??[]).filter(x=>x.permalink).map(x=>({shortcode:x.permalink.split('/').filter(Boolean).at(-1)??x.id,url:x.permalink,thumbnailUrl:x.media_type==='VIDEO'?null:(x.media_url??null),isVideo:x.media_type==='VIDEO',likes:null,takenAt:x.timestamp?Math.floor(Date.parse(x.timestamp)/1000):null})),
         source:'meta-business-discovery',limited:false
       });
     }else{
      response=json({error:'La búsqueda automática requiere autorización de Meta. Configurá META_IG_USER_ID y META_ACCESS_TOKEN en Cloudflare; solo se admiten perfiles profesionales accesibles por Business Discovery.',code:'META_NOT_CONFIGURED'},503);
     }
    }catch(e){
      response=json({error:e?.name==='AbortError'?'Meta no respondió a tiempo.':'Meta rechazó la consulta. Revisá permisos de Business Discovery y que el perfil sea profesional.',code:'META_ACCESS_DENIED'},503);
    }
  }
  }
  else if(url.pathname.startsWith('/api/')) response=json({error:'Este endpoint requiere un backend de extracción y descarga verificado. No hay datos simulados.'},501);
  else response=json({error:'Ruta no encontrada.'},404);
  for(const [k,v] of Object.entries(cors))response.headers.set(k,v);
  return response;
 }
};