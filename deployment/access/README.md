# Account access policy — 2026-10-21

This GitHub deployment wraps the current live Worker, preserving the GPS repair module and the existing assets and bindings. It deliberately refuses to deploy if any downloaded live module differs from baseline.json. The normal main-branch Wrangler deployment predates live GPS changes and must not be used until those sources have been reconciled.

New visitors enter the home page directly. Registration remains required for payment and account activation. Premium feature clicks open the in-app subscription section; the expired-trial modal is removed. Email-confirmation links continue to work.

The authenticated administrator can delete and permanently block an account. The server resolves account/device ownership, protects the administrator, atomically deletes identity and email-login challenges, erases subscription personal fields and revokes activation codes. Accounting subscription IDs and unrelated business records are retained. Only email/device SHA-256 digests and timestamps are retained in the permanent deny lists. There is no unban endpoint for those lists. The same normalized email is refused on a new device. This is an email/account block, not identification of a person using an unrelated email and device.

No production account is deleted during deployment or validation. Run `node --test deployment/access/access-policy.test.mjs`. The rollout verifies public markers and restores the original live Worker if verification fails.
