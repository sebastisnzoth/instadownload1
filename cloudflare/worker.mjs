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
 async fetch(request){
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
     const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),9500);
     let upstream;
     try{upstream=await fetch('https://www.instagram.com/'+name+'/',{headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 (compatible; InstaTool/1.0)'},signal:abort.signal,redirect:'manual'});}
     finally{clearTimeout(timer)}
     if(upstream.status===404)response=json({error:'Perfil no encontrado.'},404);
     else if(!upstream.ok)response=json({error:'Instagram no permite esta consulta pública ahora.',upstreamStatus:upstream.status},503);
     else{
      const ct=upstream.headers.get('content-type')||'';
      if(!ct.includes('text/html'))response=json({error:'Instagram no devolvió un perfil HTML verificable.'},502);
      else{
       const html=(await upstream.text()).slice(0,600000);
       if(/login_required|Login • Instagram|login_page/i.test(html)&&!meta(html,'og','title'))response=json({error:'Instagram requiere inicio de sesión; no se puede verificar el perfil.'},503);
       else{
        const title=meta(html,'og','title'),avatar=meta(html,'og','image'),description=meta(html,'og','description');
        if(!title&&!description)response=json({error:'No se pudo verificar información pública del perfil.'},503);
        else response=json({username:name,profileUrl:'https://www.instagram.com/'+name+'/',fullName:title,biography:description,avatarUrl:avatar,isPrivate:null,isVerified:null,counts:{followers:null,following:null,posts:null},posts:[],source:'public-open-graph',limited:true});
       }
      }
     }
    }catch(e){response=json({error:e?.name==='AbortError'?'Instagram no respondió a tiempo.':'No se pudo consultar Instagram en este momento.'},503)}
   }
  }
  else if(url.pathname.startsWith('/api/')) response=json({error:'Este endpoint requiere un backend de extracción y descarga verificado. No hay datos simulados.'},501);
  else response=json({error:'Ruta no encontrada.'},404);
  for(const [k,v] of Object.entries(cors))response.headers.set(k,v);
  return response;
 }
};