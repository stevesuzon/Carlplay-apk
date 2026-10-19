// Former standalone GPS: entry now belongs only to Couteau Suisse.
export default {fetch(request) {
  return new Response(null,{status:302,headers:{Location:'https://carplay-telephone.appli-suzon.workers.dev/','Cache-Control':'no-store','X-Couteau-GPS':'integrated-only'}});
}};
