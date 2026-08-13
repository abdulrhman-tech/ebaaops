import { Resend } from "resend";
import { db } from "./storage";
import { emailLogs, emailPreferences } from "@shared/schema";
import { eq } from "drizzle-orm";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "Bayt Alebaa Operations <no-reply@ebaaops.com>";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000];

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 10;

export type EmailEventType =
  | "request_created"
  | "request_approved"
  | "request_rejected"
  | "request_edited"
  | "request_final_approved"
  | "stock_release_requested"
  | "stock_release_approved"
  | "stock_release_rejected"
  | "stock_release_final_approved"
  | "extension_requested"
  | "extension_approved"
  | "extension_rejected"
  | "extension_final_approved";

interface EmailRecipient {
  email: string;
  name: string;
  userId?: number;
}

interface ChangedField {
  fieldAr: string;
  fieldEn: string;
  oldValue: string;
  newValue: string;
}

export interface EmailPayload {
  eventType: EmailEventType;
  recipients: EmailRecipient[];
  requestNumber: string;
  requestId: number;
  projectName: string;
  actorName: string;
  actorRole: string;
  notes?: string;
  newStatus?: string;
  releaseType?: string;
  changedFields?: ChangedField[];
}

const EVENT_PREF_MAP: Record<EmailEventType, string> = {
  request_created: "requestCreated",
  request_approved: "requestApproved",
  request_rejected: "requestRejected",
  request_final_approved: "requestFinalApproved",
  request_edited: "requestEdited",
  stock_release_requested: "stockReleaseRequested",
  stock_release_approved: "stockReleaseApproved",
  stock_release_rejected: "stockReleaseRejected",
  stock_release_final_approved: "stockReleaseFinalApproved",
  extension_requested: "requestApproved",
  extension_approved: "requestApproved",
  extension_rejected: "requestRejected",
  extension_final_approved: "requestFinalApproved",
};

function getRoleLabel(role: string): { ar: string; en: string } {
  const labels: Record<string, { ar: string; en: string }> = {
    sales_rep: { ar: "مندوب مبيعات", en: "Sales Representative" },
    branch_manager: { ar: "مدير فرع", en: "Branch Manager" },
    category_manager: { ar: "مدير الصنف", en: "Category Manager" },
    planning: { ar: "التخطيط", en: "Planning" },
    admin: { ar: "مسؤول النظام", en: "Admin" },
    sector_head: { ar: "مدير القطاع", en: "Sector Head" },
  };
  return labels[role] || { ar: role, en: role };
}

function getStatusLabel(status: string): { ar: string; en: string } {
  const labels: Record<string, { ar: string; en: string }> = {
    submitted: { ar: "مقدّم", en: "Submitted" },
    branch_approved: { ar: "موافقة الفرع", en: "Branch Approved" },
    category_approved: { ar: "موافقة مدير الصنف", en: "Category Approved" },
    final_approved: { ar: "موافقة نهائية", en: "Final Approved" },
    rejected: { ar: "مرفوض", en: "Rejected" },
  };
  return labels[status] || { ar: status, en: status };
}

function getStatusBadgeStyle(eventType: EmailEventType): { bgColor: string; textColor: string; labelAr: string; labelEn: string } {
  switch (eventType) {
    case "request_created":
    case "stock_release_requested":
      return { bgColor: "#e0f2fe", textColor: "#0369a1", labelAr: "جديد", labelEn: "New" };
    case "request_approved":
    case "stock_release_approved":
      return { bgColor: "#dcfce7", textColor: "#15803d", labelAr: "تمت الموافقة", labelEn: "Approved" };
    case "request_final_approved":
    case "stock_release_final_approved":
      return { bgColor: "#d1fae5", textColor: "#065f46", labelAr: "موافقة نهائية", labelEn: "Final Approved" };
    case "request_rejected":
    case "stock_release_rejected":
      return { bgColor: "#fee2e2", textColor: "#b91c1c", labelAr: "مرفوض", labelEn: "Rejected" };
    case "request_edited":
      return { bgColor: "#fef3c7", textColor: "#92400e", labelAr: "تم التعديل", labelEn: "Edited" };
    case "extension_requested":
      return { bgColor: "#fef3c7", textColor: "#92400e", labelAr: "طلب تمديد", labelEn: "Extension Requested" };
    case "extension_approved":
      return { bgColor: "#dcfce7", textColor: "#15803d", labelAr: "تمديد موافق", labelEn: "Extension Approved" };
    case "extension_final_approved":
      return { bgColor: "#d1fae5", textColor: "#065f46", labelAr: "تمديد نهائي", labelEn: "Extension Final Approved" };
    case "extension_rejected":
      return { bgColor: "#fee2e2", textColor: "#991b1b", labelAr: "تمديد مرفوض", labelEn: "Extension Rejected" };
    default:
      return { bgColor: "#f3f4f6", textColor: "#374151", labelAr: "تحديث", labelEn: "Update" };
  }
}

function getEventContent(payload: EmailPayload): { subjectAr: string; subjectEn: string; bodyAr: string; bodyEn: string } {
  const { eventType, requestNumber, projectName, actorName, actorRole, notes, newStatus, releaseType } = payload;
  const roleLabel = getRoleLabel(actorRole);
  const statusLabel = newStatus ? getStatusLabel(newStatus) : null;

  switch (eventType) {
    case "request_created":
      return {
        subjectAr: `طلب جديد #${requestNumber} - ${projectName}`,
        subjectEn: `New Request #${requestNumber} - ${projectName}`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) بإنشاء طلب جديد #${requestNumber} للمشروع "${projectName}".${notes ? `\n\nملاحظات: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) created a new request #${requestNumber} for project "${projectName}".${notes ? `\n\nNotes: ${notes}` : ""}`,
      };
    case "request_approved":
      return {
        subjectAr: `تمت الموافقة على الطلب #${requestNumber}`,
        subjectEn: `Request #${requestNumber} Approved`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) بالموافقة على الطلب #${requestNumber}.${statusLabel ? `\n\nالحالة الجديدة: ${statusLabel.ar}` : ""}${notes ? `\n\nملاحظات: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) approved request #${requestNumber}.${statusLabel ? `\n\nNew Status: ${statusLabel.en}` : ""}${notes ? `\n\nNotes: ${notes}` : ""}`,
      };
    case "request_rejected":
      return {
        subjectAr: `تم رفض الطلب #${requestNumber}`,
        subjectEn: `Request #${requestNumber} Rejected`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) برفض الطلب #${requestNumber}.${notes ? `\n\nسبب الرفض: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) rejected request #${requestNumber}.${notes ? `\n\nReason: ${notes}` : ""}`,
      };
    case "request_final_approved":
      return {
        subjectAr: `موافقة نهائية على الطلب #${requestNumber}`,
        subjectEn: `Request #${requestNumber} Final Approved`,
        bodyAr: `تمت الموافقة النهائية على الطلب #${requestNumber} من قبل ${actorName} (${roleLabel.ar}). يمكن الآن طلب صرف المخزون.`,
        bodyEn: `Request #${requestNumber} has received final approval from ${actorName} (${roleLabel.en}). Stock release can now be requested.`,
      };
    case "request_edited":
      return {
        subjectAr: `تم تعديل الطلب #${requestNumber}`,
        subjectEn: `Request #${requestNumber} Edited`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) بتعديل الطلب #${requestNumber} للمشروع "${projectName}".${notes ? `\n\nملاحظات: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) edited request #${requestNumber} for project "${projectName}".${notes ? `\n\nNotes: ${notes}` : ""}`,
      };
    case "stock_release_requested":
      return {
        subjectAr: `طلب صرف مخزون ${releaseType === "full" ? "كامل" : "جزئي"} - #${requestNumber}`,
        subjectEn: `${releaseType === "full" ? "Full" : "Partial"} Stock Release Request - #${requestNumber}`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) بطلب صرف مخزون ${releaseType === "full" ? "كامل" : "جزئي"} للطلب #${requestNumber}.${notes ? `\n\nملاحظات: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) requested a ${releaseType === "full" ? "full" : "partial"} stock release for request #${requestNumber}.${notes ? `\n\nNotes: ${notes}` : ""}`,
      };
    case "stock_release_approved":
      return {
        subjectAr: `تمت الموافقة على صرف المخزون - #${requestNumber}`,
        subjectEn: `Stock Release Approved - #${requestNumber}`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) بالموافقة على صرف المخزون للطلب #${requestNumber}.${statusLabel ? `\n\nالحالة الجديدة: ${statusLabel.ar}` : ""}${notes ? `\n\nملاحظات: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) approved the stock release for request #${requestNumber}.${statusLabel ? `\n\nNew Status: ${statusLabel.en}` : ""}${notes ? `\n\nNotes: ${notes}` : ""}`,
      };
    case "stock_release_rejected":
      return {
        subjectAr: `تم رفض صرف المخزون - #${requestNumber}`,
        subjectEn: `Stock Release Rejected - #${requestNumber}`,
        bodyAr: `قام ${actorName} (${roleLabel.ar}) برفض صرف المخزون للطلب #${requestNumber}.${notes ? `\n\nسبب الرفض: ${notes}` : ""}`,
        bodyEn: `${actorName} (${roleLabel.en}) rejected the stock release for request #${requestNumber}.${notes ? `\n\nReason: ${notes}` : ""}`,
      };
    case "stock_release_final_approved":
      return {
        subjectAr: `تم صرف المخزون بنجاح - #${requestNumber}`,
        subjectEn: `Stock Released Successfully - #${requestNumber}`,
        bodyAr: `تمت الموافقة النهائية وتم صرف المخزون للطلب #${requestNumber} من قبل ${actorName} (${roleLabel.ar}).`,
        bodyEn: `Stock release for request #${requestNumber} has been final approved and released by ${actorName} (${roleLabel.en}).`,
      };
    default:
      return {
        subjectAr: `تحديث على الطلب #${requestNumber}`,
        subjectEn: `Update on Request #${requestNumber}`,
        bodyAr: `تم تحديث الطلب #${requestNumber} بواسطة ${actorName}.`,
        bodyEn: `Request #${requestNumber} was updated by ${actorName}.`,
      };
  }
}

function buildChangedFieldsHtml(changedFields?: ChangedField[]): string {
  if (!changedFields || changedFields.length === 0) return "";

  const rowsAr = changedFields.map(f => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f5;font-size:13px;color:#666;font-weight:600;">${f.fieldAr}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f5;font-size:13px;color:#b91c1c;text-decoration:line-through;">${f.oldValue || "-"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f5;font-size:13px;color:#15803d;font-weight:600;">${f.newValue || "-"}</td>
    </tr>`).join("");

  const rowsEn = changedFields.map(f => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f5;font-size:12px;color:#666;font-weight:600;">${f.fieldEn}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f5;font-size:12px;color:#b91c1c;text-decoration:line-through;">${f.oldValue || "-"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f5;font-size:12px;color:#15803d;font-weight:600;">${f.newValue || "-"}</td>
    </tr>`).join("");

  return `
    <!-- Arabic Changed Fields -->
    <tr>
      <td style="padding:0 32px 24px;direction:rtl;text-align:right;">
        <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;font-weight:600;">التغييرات:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8ef;border-radius:6px;overflow:hidden;">
          <tr style="background-color:#f8f9fa;">
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">الحقل</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">القيمة السابقة</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#666;font-weight:600;">القيمة الجديدة</th>
          </tr>
          ${rowsAr}
        </table>
      </td>
    </tr>
    <!-- English Changed Fields -->
    <tr>
      <td style="padding:0 32px 16px;direction:ltr;text-align:left;">
        <p style="margin:0 0 8px;color:#1a1a2e;font-size:13px;font-weight:600;">Changes:</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8ef;border-radius:6px;overflow:hidden;">
          <tr style="background-color:#f8f9fa;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;font-weight:600;">Field</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;font-weight:600;">Previous</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;font-weight:600;">New</th>
          </tr>
          ${rowsEn}
        </table>
      </td>
    </tr>`;
}

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS.split(",").map(d => d.trim()).filter(Boolean);
    const customDomain = domains.find(d => !d.includes(".replit.dev") && !d.includes(".replit.app") && !d.includes(".riker."));
    const hostedAppDomain = domains.find(d => d.includes(".replit.app"));
    const bestDomain = customDomain || hostedAppDomain || domains[0];
    if (bestDomain) return `https://${bestDomain}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "";
}

function buildEmailHtml(
  content: { subjectAr: string; subjectEn: string; bodyAr: string; bodyEn: string },
  requestNumber: string,
  requestId: number,
  eventType: EmailEventType,
  changedFields?: ChangedField[]
): string {
  const timestamp = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  });

  const badge = getStatusBadgeStyle(eventType);
  const changedFieldsHtml = buildChangedFieldsHtml(changedFields);
  const appUrl = getAppUrl();
  const requestLink = appUrl ? `${appUrl}/requests/${requestId}` : "";

  const linkButtonHtml = requestLink ? `
          <!-- View Request Button -->
          <tr>
            <td style="padding:8px 32px 24px;text-align:center;">
              <a href="${requestLink}" target="_blank" style="display:inline-block;background-color:#1a1a2e;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.5px;">
                عرض الطلب &nbsp;|&nbsp; View Request
              </a>
            </td>
          </tr>` : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.subjectAr}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:24px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:0.5px;">Bayt Alebaa Operations</h1>
              <p style="margin:4px 0 0;color:#a0a0b8;font-size:12px;">نظام إدارة المخزون | Inventory Management System</p>
            </td>
          </tr>

          <!-- Status Badge -->
          <tr>
            <td style="padding:24px 32px 0;text-align:center;">
              <table cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td style="background-color:${badge.bgColor};color:${badge.textColor};padding:6px 20px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:0.5px;">
                    ${badge.labelAr} &nbsp;|&nbsp; ${badge.labelEn}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Arabic Content -->
          <tr>
            <td style="padding:24px 32px 16px;direction:rtl;text-align:right;">
              <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:18px;font-weight:600;border-bottom:2px solid #e8e8ef;padding-bottom:12px;">
                ${content.subjectAr}
              </h2>
              <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.8;white-space:pre-line;">${content.bodyAr}</p>
              <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
                <tr>
                  <td style="background-color:#f0f0f5;padding:8px 16px;border-radius:4px;">
                    <span style="color:#666;font-size:12px;">رقم الطلب: </span>
                    <strong style="color:#1a1a2e;font-size:14px;">${requestNumber}</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${changedFieldsHtml}

          ${linkButtonHtml}

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e8e8ef;margin:0;">
            </td>
          </tr>

          <!-- English Content -->
          <tr>
            <td style="padding:24px 32px 16px;direction:ltr;text-align:left;">
              <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:16px;font-weight:600;">
                ${content.subjectEn}
              </h2>
              <p style="margin:0 0 16px;color:#666;font-size:13px;line-height:1.8;white-space:pre-line;">${content.bodyEn}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#fafafa;padding:16px 32px;text-align:center;border-top:1px solid #e8e8ef;">
              <p style="margin:0;color:#999;font-size:11px;">${timestamp} (AST)</p>
              <p style="margin:4px 0 0;color:#bbb;font-size:10px;">This is an automated notification from Bayt Alebaa Operations System</p>
              <p style="margin:2px 0 0;color:#bbb;font-size:10px;">هذا إشعار آلي من نظام عمليات بيت الإباء</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function logEmail(
  recipient: EmailRecipient,
  subject: string,
  eventType: string,
  requestId: number,
  status: "sent" | "failed",
  retryCount: number = 0,
  errorMessage?: string
): Promise<void> {
  try {
    await db.insert(emailLogs).values({
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      recipientUserId: recipient.userId ?? null,
      subject,
      eventType,
      requestId,
      status,
      retryCount,
      errorMessage: errorMessage ?? null,
    });
  } catch (err) {
    console.error("[Email] Failed to log email:", err);
  }
}

function checkRateLimit(email: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(email) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  rateLimitMap.set(email, recent);
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendWithRetry(
  recipient: EmailRecipient,
  subject: string,
  html: string,
  eventType: string,
  requestId: number
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient.email,
        subject,
        html,
      });
      await logEmail(recipient, subject, eventType, requestId, "sent", attempt);
      console.log(`[Email] Sent ${eventType} to ${recipient.email}${attempt > 0 ? ` (retry ${attempt})` : ""}`);
      return;
    } catch (err: any) {
      const errorMsg = err?.message || "Unknown error";
      if (attempt === MAX_RETRIES) {
        await logEmail(recipient, subject, eventType, requestId, "failed", attempt, errorMsg);
        console.error(`[Email] Failed to send to ${recipient.email} after ${MAX_RETRIES} retries:`, errorMsg);
        return;
      }
      console.warn(`[Email] Attempt ${attempt + 1} failed for ${recipient.email}: ${errorMsg}. Retrying in ${RETRY_DELAYS[attempt]}ms...`);
      await delay(RETRY_DELAYS[attempt]);
    }
  }
}

async function getUserEmailPreferences(userIds: number[]): Promise<Map<number, Record<string, boolean>>> {
  if (userIds.length === 0) return new Map();
  try {
    const prefs = await db.select().from(emailPreferences);
    const prefMap = new Map<number, Record<string, boolean>>();
    for (const p of prefs) {
      if (userIds.includes(p.userId)) {
        prefMap.set(p.userId, {
          requestCreated: p.requestCreated,
          requestApproved: p.requestApproved,
          requestRejected: p.requestRejected,
          requestFinalApproved: p.requestFinalApproved,
          requestEdited: p.requestEdited,
          stockReleaseRequested: p.stockReleaseRequested,
          stockReleaseApproved: p.stockReleaseApproved,
          stockReleaseRejected: p.stockReleaseRejected,
          stockReleaseFinalApproved: p.stockReleaseFinalApproved,
        });
      }
    }
    return prefMap;
  } catch {
    return new Map();
  }
}

export async function sendOrderEmail(payload: EmailPayload): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY not configured, skipping email notifications");
    return;
  }

  const content = getEventContent(payload);
  const subject = `${content.subjectAr} | ${content.subjectEn}`;
  const html = buildEmailHtml(content, payload.requestNumber, payload.requestId, payload.eventType, payload.changedFields);

  const userIds = payload.recipients.filter(r => r.userId).map(r => r.userId!);
  const prefsMap = await getUserEmailPreferences(userIds);
  const prefKey = EVENT_PREF_MAP[payload.eventType];

  const filteredRecipients = payload.recipients.filter(r => {
    if (!r.userId) return true;
    const userPrefs = prefsMap.get(r.userId);
    if (!userPrefs) return true;
    return userPrefs[prefKey] !== false;
  });

  for (let i = 0; i < filteredRecipients.length; i++) {
    const recipient = filteredRecipients[i];
    if (i > 0) {
      await delay(1000);
    }
    if (!checkRateLimit(recipient.email)) {
      console.warn(`[Email] Rate limit exceeded for ${recipient.email}, skipping`);
      await logEmail(recipient, subject, payload.eventType, payload.requestId, "failed", 0, "Rate limit exceeded");
      continue;
    }
    await sendWithRetry(recipient, subject, html, payload.eventType, payload.requestId);
  }
}

export function collectRecipients(
  allUsers: { id: number; name: string; email: string; role: string; branchId: number | null; productCategoryId?: number | null }[],
  opts: {
    createdById: number;
    salesRepId?: number | null;
    branchId: number;
    productCategoryId?: number | null;
    actorId: number;
    notifyRoles?: string[];
  }
): EmailRecipient[] {
  const recipientMap = new Map<number, EmailRecipient>();

  const creator = allUsers.find(u => u.id === opts.createdById);
  if (creator && creator.id !== opts.actorId) {
    recipientMap.set(creator.id, { email: creator.email, name: creator.name, userId: creator.id });
  }

  if (opts.salesRepId) {
    const salesRep = allUsers.find(u => u.id === opts.salesRepId);
    if (salesRep && salesRep.id !== opts.actorId) {
      recipientMap.set(salesRep.id, { email: salesRep.email, name: salesRep.name, userId: salesRep.id });
    }
  }

  if (opts.notifyRoles) {
    for (const role of opts.notifyRoles) {
      const usersOfRole = allUsers.filter(u => {
        if (u.id === opts.actorId) return false;
        if (u.role !== role) return false;
        if (role === "branch_manager" && u.branchId !== opts.branchId) return false;
        if (role === "category_manager") {
          if (!u.productCategoryId) return false;
          if (opts.productCategoryId && u.productCategoryId !== opts.productCategoryId) return false;
        }
        return true;
      });
      for (const u of usersOfRole) {
        recipientMap.set(u.id, { email: u.email, name: u.name, userId: u.id });
      }
    }
  }

  const admins = allUsers.filter(u => u.role === "admin" && u.id !== opts.actorId);
  for (const a of admins) {
    recipientMap.set(a.id, { email: a.email, name: a.name, userId: a.id });
  }

  return Array.from(recipientMap.values());
}
