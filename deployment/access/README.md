# Account access policy — 2026-10-21

This GitHub deployment wraps the current live Worker, preserving the GPS repair module and the existing assets and bindings. It deliberately refuses to deploy if any downloaded live module differs from baseline.json. The normal main-branch Wrangler deployment predates live GPS changes and must not be used until those sources have been reconciled.

New visitors complete the identity form and confirm their email before entering the home page. A paid subscription is not required to enter. Premium feature clicks show a dismissible subscription invitation linking to /payment.html. Email-confirmation links continue to work. Stripe configuration currently reports configured:false; Apple Pay remains unavailable until live payment secrets are configured.

The authenticated administrator can delete and permanently block an account. The server resolves account/device ownership, protects the administrator, atomically deletes identity and email-login challenges, erases subscription personal fields and revokes activation codes. Accounting subscription IDs and unrelated business records are retained. Only email/device SHA-256 digests and timestamps are retained in the permanent deny lists. There is no unban endpoint for those lists. The same normalized email is refused on a new device. This is an email/account block, not identification of a person using an unrelated email and device.

No production account is deleted during deployment or validation. Run `node --test deployment/access/access-policy.test.mjs`. The rollout verifies public markers and restores the original live Worker if verification fails.
