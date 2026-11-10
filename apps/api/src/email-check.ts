import { emailTransport } from "./email.js";
const transport = emailTransport();
if (!transport) {
  console.error(
    "Email is not configured. Add the Brevo SMTP settings to apps/api/.env; see docs/email-setup.md.",
  );
  process.exitCode = 1;
} else {
  try {
    await transport.verify();
    console.log(
      "SMTP connection and authentication succeeded. Verify EMAIL_FROM is an approved sender before sending email.",
    );
  } catch {
    console.error(
      "SMTP check failed. Check the host, port, SMTP login and SMTP key in apps/api/.env. Credentials have not been printed.",
    );
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}
