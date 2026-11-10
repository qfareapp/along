import nodemailer from "nodemailer";
import { config } from "./config.js";
export function emailTransport() {
  if (config.SMTP_URL) return nodemailer.createTransport(config.SMTP_URL);
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    requireTLS: config.SMTP_PORT !== 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}
