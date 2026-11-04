// Loopback-only preview. Does not contact the real homepage or employee APIs.
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=__dirname;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.gif':'image/gif','.png':'image/png','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
 try{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/review.html':new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(root+path.sep)||!mime[path.extname(target)])throw Error('invalid path');
  res.writeHead(200,{'Content-Type':mime[path.extname(target)],'Cache-Control':'no-store'});res.end(fs.readFileSync(target));
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(0,'127.0.0.1',()=>console.log('HERO review: http://127.0.0.1:'+server.address().port+'/review.html'));
