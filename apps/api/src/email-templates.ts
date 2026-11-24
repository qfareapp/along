import { readFileSync } from "node:fs";

const LOGO_CID = "along-logo@along";
let logo: Buffer | null | undefined;

function loadLogo() {
  if (logo === undefined) {
    try {
      // Resolves from both src/ (tsx) and dist/ (node) since assets/ sits beside them.
      logo = readFileSync(new URL("../assets/email-logo.png", import.meta.url));
    } catch {
      logo = null;
    }
  }
  return logo;
}

const brand = {
  teal: "#0B4F55",
  tealDeep: "#08484F",
  coral: "#FA6752",
  ivory: "#FFFDF9",
  cream: "#FCF1E8",
  line: "#EFE3D8",
  ink: "#1F2A2C",
  muted: "#6B6862",
};

export function signInCodeEmail(code: string) {
  const logoFile = loadLogo();
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="padding:0 4px;"><div style="width:44px;height:56px;line-height:56px;border-radius:12px;background:${brand.cream};border:1px solid ${brand.line};font-family:'SF Mono',Menlo,Consolas,monospace;font-size:28px;font-weight:700;color:${brand.teal};text-align:center;">${d}</div></td>`,
    )
    .join("");
  const header = logoFile
    ? `<img src="cid:${LOGO_CID}" width="480" alt="Along. Do Life Together." style="display:block;width:100%;max-width:480px;height:auto;border:0;">`
    : `<div style="padding:36px 24px;text-align:center;font-family:Arial,sans-serif;font-size:40px;font-weight:800;color:${brand.ivory};">al<span style="color:${brand.coral};">&hearts;</span>ng<span style="color:${brand.coral};">.</span></div>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Your Along sign-in code</title>
</head>
<body style="margin:0;padding:0;background:#F4EDE6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${code}. It expires in 5 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EDE6;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:${brand.ivory};border-radius:20px;overflow:hidden;border:1px solid ${brand.line};">
    <tr><td style="background:${brand.tealDeep};padding:0;">${header}</td></tr>
    <tr><td style="padding:32px 32px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.ink};">
      <h1 style="margin:0 0 8px;font-size:22px;line-height:30px;font-weight:700;color:${brand.teal};">Here's your sign-in code</h1>
      <p style="margin:0;font-size:15px;line-height:23px;color:${brand.muted};">Enter this code in the Along app to sign in or finish creating your account.</p>
    </td></tr>
    <tr><td align="center" style="padding:24px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <span style="display:inline-block;padding:7px 14px;border-radius:999px;background:#F9E8DB;color:#BA4034;font-size:13px;font-weight:600;">&#9201; Expires in 5 minutes &middot; works once</span>
    </td></tr>
    <tr><td style="padding:0 32px;"><div style="height:1px;background:${brand.line};"></div></td></tr>
    <tr><td style="padding:20px 32px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:${brand.muted};">
      <strong style="color:${brand.ink};">Never share this code.</strong> Along will never ask for it by phone, chat or email. If you didn't request it, you can safely ignore this email.
    </td></tr>
  </table>
  <p style="margin:20px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9A958E;">Along &middot; Do Life Together</p>
</td></tr>
</table>
</body>
</html>`;

  return {
    subject: "Your Along sign-in code",
    text: `Your Along sign-in code is ${code}. It expires in 5 minutes and works once. Never share this code. If you did not request it, ignore this email.`,
    html,
    attachments: logoFile
      ? [
          {
            filename: "along-logo.png",
            content: logoFile,
            cid: LOGO_CID,
            contentType: "image/png",
          },
        ]
      : [],
  };
}
