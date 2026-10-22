# Account access policy — 2026-10-21

This GitHub deployment wraps the current live Worker, preserving the GPS repair module and the existing assets and bindings. It deliberately refuses to deploy if any downloaded live module differs from baseline.json. The normal main-branch Wrangler deployment predates live GPS changes and must not be used until those sources have been reconciled.

New visitors complete the identity form and confirm their email before entering the home page. A paid subscription is not required to enter. Premium feature clicks show a dismissible subscription invitation linking to /payment.html. Email-confirmation links continue to work. Stripe configuration currently reports configured:false; Apple Pay remains unavailable until live payment secrets are configured.

The authenticated administrator can erase an account immediately with EFFACER LE COMPTE, without an email or popup confirmation. The server resolves ownership from stored rows and protects shared devices and other accounts. An atomic batch removes identities, pending login links, private account records and local checkout copies, including unredeemed activation codes. Subscription IDs remain anonymous, with personal fields cleared and codes revoked. No email or email hash is retained for this erase action; existing email deny-list entries for that address are removed. Only device digests are retained to revoke the old installation. BANNIR remains a separate action. A newly registered account using a new device identifier and the same email is therefore possible.

This action erases the application's live database records. It does not delete already delivered emails, provider logs, provider backups or the payment processor's own transaction records. No production account is deleted by installing or testing this correction.

No production account is deleted during deployment or validation. Run `node --test deployment/access/access-policy.test.mjs`. The rollout verifies public markers and restores the original live Worker if verification fails.
