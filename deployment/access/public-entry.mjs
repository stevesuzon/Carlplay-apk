// One public origin, one backend and one set of accounts/subscriptions.
// Keep the request URL so email links and payment returns use the public origin.
export default {
  fetch(request, env) {
    return env.APPLICATION.fetch(request);
  }
};
