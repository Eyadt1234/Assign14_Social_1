import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export interface Email {
  to: string;
  subject: string;
  html: string;
}

export const sentEmails: Email[] = [];

const transporter = env.smtpHost
  ? nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    })
  : null;

//_________________________________________________________________________________//

//1: sendEmail
export const sendEmail = async (email: Email): Promise<void> => {
  if (!transporter) {
    sentEmails.push(email);
    if (sentEmails.length > 100) {
      sentEmails.shift();
    }
    console.log(`email to ${email.to} was not sent (no smtp settings): ${email.subject}`);
    return;
  }
  await transporter.sendMail({ from: env.smtpFrom, ...email });
};

//_________________________________________________________________________________//

//2: sendOtpEmail
export const sendOtpEmail = async (to: string, title: string, otp: string): Promise<void> => {
  const minutes = Math.round(env.otpExpiresIn / 60);
  if (!transporter && env.nodeEnv !== "production") {
    console.log(`${title} code for ${to} : ${otp}`);
  }
  await sendEmail({
    to,
    subject: `Social App - ${title}`,
    html: `<h2>${title}</h2><p>Your code is: <b>${otp}</b></p><p>It expires after ${minutes} minutes.</p>`,
  });
};