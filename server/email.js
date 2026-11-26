/**
 * email.js - Optional transactional email helper using Resend.
 * If RESEND_API_KEY is not configured, email sending is safely skipped.
 */
const { Resend } = require('resend');

let client = null;
function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

const fromAddress = () => process.env.EMAIL_FROM || 'CasaBatangueño <onboarding@resend.dev>';

const escHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendEmail({ to, subject, html, text }) {
  const resend = getClient();
  if (!resend || !to) {
    return { sent: false, skipped: true };
  }
  try {
    const result = await resend.emails.send({
      from: fromAddress(),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });
    return { sent: true, id: result?.data?.id || null };
  } catch (err) {
    console.warn('[email] Failed to send email:', err.message);
    return { sent: false, error: err.message };
  }
}

async function sendApplicationConfirmation({ to, fullName, referenceNumber, propertyName, expectedMoveInDate }) {
  return sendEmail({
    to,
    subject: `Application Received (${referenceNumber}) — CasaBatangueño`,
    html: `<p>Hello ${escHtml(fullName)},</p>
      <p>We received your rental application for <strong>${escHtml(propertyName)}</strong> (target move-in: ${escHtml(expectedMoveInDate)}).</p>
      <p>Your reference number is: <strong>${escHtml(referenceNumber)}</strong></p>
      <p>You can track your application status anytime on our How It Works page using your reference number and email address.</p>
      <p>— CasaBatangueño Management, Alangilan, Batangas City</p>`,
    text: `Hello ${fullName}, we received your application (${referenceNumber}) for ${propertyName}. Target move-in: ${expectedMoveInDate}.`,
  });
}

async function sendApplicationStatusEmail({ to, fullName, referenceNumber, propertyName, status, roomNumber }) {
  const roomLine = roomNumber ? `<p>Assigned room: <strong>${escHtml(roomNumber)}</strong></p>` : '';
  return sendEmail({
    to,
    subject: `Application ${status} (${referenceNumber}) — CasaBatangueño`,
    html: `<p>Hello ${escHtml(fullName)},</p>
      <p>Your application <strong>${escHtml(referenceNumber)}</strong> for <strong>${escHtml(propertyName)}</strong> is now <strong>${escHtml(status)}</strong>.</p>
      ${roomLine}
      <p>— CasaBatangueño Management, Alangilan, Batangas City</p>`,
    text: `Hello ${fullName}, your application ${referenceNumber} for ${propertyName} is now ${status}.${roomNumber ? ' Room: ' + roomNumber : ''}`,
  });
}

async function sendViewingConfirmation({ to, fullName, propertyName, preferredDate, preferredTime, status }) {
  return sendEmail({
    to,
    subject: `Viewing Request ${status} — ${propertyName}`,
    html: `<p>Hello ${escHtml(fullName)},</p>
      <p>Your viewing request for <strong>${escHtml(propertyName)}</strong> on <strong>${escHtml(preferredDate)}</strong> (${escHtml(preferredTime)}) is <strong>${escHtml(status)}</strong>.</p>
      <p>— CasaBatangueño Management</p>`,
    text: `Hello ${fullName}, your viewing request for ${propertyName} on ${preferredDate} (${preferredTime}) is ${status}.`,
  });
}

async function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  return sendEmail({
    to,
    subject: 'Reset Your Password — CasaBatangueño',
    html: `<p>Hello ${escHtml(fullName)},</p>
      <p>Use the link below to reset your password (valid for 1 hour):</p>
      <p><a href="${escHtml(resetUrl)}">${escHtml(resetUrl)}</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>`,
    text: `Reset your CasaBatangueño password using this link (valid 1 hour): ${resetUrl}`,
  });
}

async function sendRentReminderEmail({ to, fullName, billingMonth, dueDate, remainingBalance, isOverdue }) {
  const prefix = isOverdue ? 'Overdue Rent Notice' : 'Upcoming Rent Reminder';
  return sendEmail({
    to,
    subject: `${prefix} (${billingMonth}) — CasaBatangueño`,
    html: `<p>Hello ${escHtml(fullName)},</p>
      <p>${isOverdue ? 'Your rent balance is now overdue.' : 'This is a friendly reminder that your rent is due soon.'}</p>
      <p>Billing Month: <strong>${escHtml(billingMonth)}</strong><br>
      Due Date: <strong>${escHtml(dueDate)}</strong><br>
      Remaining Balance: <strong>PHP ${Number(remainingBalance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></p>
      <p>You may settle via Cash, GCash, Maya, or Bank Transfer and view your digital receipt in your account portal.</p>`,
    text: `${prefix}: ${billingMonth}, due ${dueDate}, remaining balance PHP ${remainingBalance}.`,
  });
}

async function sendWaitlistAlertEmail({ to, fullName, propertyName, roomNumber }) {
  return sendEmail({
    to,
    subject: `A bed is now available at ${propertyName} — CasaBatangueño`,
    html: `<p>Hello ${escHtml(fullName)},</p>
      <p>Good news! A bed/unit${roomNumber ? ` (${escHtml(roomNumber)})` : ''} just opened at <strong>${escHtml(propertyName)}</strong> in Alangilan, Batangas City.</p>
      <p>Visit CasaBatangueño to submit your rental application before it fills up.</p>`,
    text: `Good news ${fullName}! A bed/unit just opened at ${propertyName}. Visit CasaBatangueño to apply.`,
  });
}

module.exports = {
  sendEmail,
  sendApplicationConfirmation,
  sendApplicationStatusEmail,
  sendViewingConfirmation,
  sendPasswordResetEmail,
  sendRentReminderEmail,
  sendWaitlistAlertEmail,
};
