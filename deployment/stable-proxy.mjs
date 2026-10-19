// Compatibility address: always use the current Couteau Suisse deployment.
export default {fetch(request,env) {
  const headers=new Headers(request.headers);headers.delete('Cloudflare-Workers-Version-Overrides');
  return env.CORE.fetch(new Request(request,{headers}));
}};
