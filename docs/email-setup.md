# Free verification email with Brevo

## Temporary bypass currently enabled

`EMAIL_VERIFICATION_REQUIRED=false` in `apps/api/.env` temporarily removes email verification from discovery eligibility, posting and interest requirements. The app hides the code-entry step and explains that email verification is optional. Age, consent, photo and account-status checks still apply. Accounts are not marked `emailVerified=true` by the bypass. SMTP configuration and verification endpoints remain intact.

To restore email verification, set `EMAIL_VERIFICATION_REQUIRED=true` and restart the API (the development watcher also reloads `.env`). Existing unverified accounts must then verify before connecting. The default when the setting is absent is `true`.

## Configure email delivery

Along uses the existing Express API and User emailVerified field. No separate authentication service is used.

Brevo's free plan currently includes 300 email sends per day, shared by transactional and marketing emails: [free plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

1. Create a free account at [Brevo](https://www.brevo.com/).
2. Add and verify the sender email you want to use. Complete any sender/domain verification Brevo requests for your account.
3. In **SMTP & API**, copy the **SMTP login** and create an **SMTP key**. The SMTP key is different from an API key. See [official SMTP setup](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).
4. Fill in `D:\Along\apps\api\.env`:

```dotenv
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-smtp-login-from-brevo
SMTP_PASS=your-smtp-key-from-brevo
EMAIL_FROM="Along <your-verified-sender@example.com>"
```

Keep `SMTP_URL` empty when using these separate fields. Keep these values on the backend, never in the mobile or admin frontend environment files. Do not post SMTP keys in chat.

5. In CMD:

```cmd
cd /d D:\Along\apps\api
npm run email:check
```

This verifies the SMTP connection without sending a message. Restart the API if it did not reload after the environment change. In the app, choose **Complete Profile to Connect → Send Verification Code** to test delivery to your own account.

Codes expire after ten minutes, allow at most five attempts, and are consumed once. Only keyed hashes are saved. Codes are not returned in API responses or logged. The app remains in restricted preview until contact verification and the other eligibility checks pass.

Real delivery needs your Brevo account and approved sender. Local automated tests simulate delivery into an isolated test process; they do not email real users or use your SMTP credentials.
