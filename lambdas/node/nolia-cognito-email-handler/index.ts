/**
 * Cognito Custom Message Lambda Trigger — Nolia branded
 *
 * Renders branded Nolia emails for:
 *   - CustomMessage_AdminCreateUser  (team invite / welcome)
 *   - CustomMessage_ForgotPassword   (password reset)
 *   - CustomMessage_ResendCode       (resend verification code)
 *
 * ClientMetadata keys (set by frontend):
 *   mode   – "create" | "reset"
 *   domain – e.g. "kemenkes-ihss.getnolia.io"
 *   locale – "en" | "id" (future)
 *
 * Originally hotfixed by Tony directly in AWS for the Nolia MoH account.
 * Ported into the repo so it's tracked and deployed by CDKTF.
 */

import type { CustomMessageTriggerEvent } from 'aws-lambda';

/* ------------------------------------------------------------------ */
/*  Brand tokens                                                       */
/* ------------------------------------------------------------------ */

const BRAND = '#B83458';
const BRAND_BG = '#FCF2F5';
const BRAND_BORDER = '#EAB4C3';
const TEXT_COLOR = '#535862';
const WHITE = '#ffffff';
const BG = '#fafafa';
const FONT = "Inter, -apple-system, 'Segoe UI', system-ui, Roboto, Arial, sans-serif";

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export const handler = async (event: CustomMessageTriggerEvent) => {
  const { triggerSource, request, response } = event;

  if (
    triggerSource !== 'CustomMessage_AdminCreateUser' &&
    triggerSource !== 'CustomMessage_ForgotPassword' &&
    triggerSource !== 'CustomMessage_ResendCode'
  ) {
    return event;
  }

  const meta = request.clientMetadata || {};
  const domain = meta.domain || process.env.DOMAIN || 'kemenkes-ihss.getnolia.io';
  const mode = meta.mode || (triggerSource === 'CustomMessage_AdminCreateUser' ? 'create' : 'reset');
  const locale = meta.locale || 'en';
  const email = request.userAttributes?.email || '';

  const logoUrl = `https://${domain}/logos/nolia-logo.png`;
  const iconUrl = `https://${domain}/logos/nolia-logo-icon.png`;

  const userName = request.userAttributes?.name || request.userAttributes?.email?.split('@')[0] || 'there';

  const greeting = locale === 'id' ? `Halo ${userName}` : `Kia ora ${userName}`;
  const code = request.codeParameter;

  if (mode === 'create') {
    response.emailSubject = 'Welcome to Nolia \u2013 Set up your password';
    response.emailMessage = buildCreateEmail({ greeting, code, logoUrl, iconUrl, domain, email });
  } else {
    response.emailSubject = 'Reset your Nolia password';
    response.emailMessage = buildResetEmail({ greeting, code, logoUrl, iconUrl, domain, email });
  }

  return event;
};

/* ------------------------------------------------------------------ */
/*  Email builders                                                     */
/* ------------------------------------------------------------------ */

interface EmailParams {
  greeting: string;
  code: string;
  logoUrl: string;
  iconUrl: string;
  domain: string;
  email: string;
}

function buildCreateEmail({ greeting, code, logoUrl, iconUrl, domain, email }: EmailParams) {
  const createUrl = `https://${domain}/create-password?code=${code}&email=${encodeURIComponent(email)}`;

  return wrap({
    logoUrl,
    iconUrl,
    email,
    content: `
        ${text(`${greeting},`)}
        ${spacer(16)}
        ${text(`You've been sent this email as part of the Nolia application. Your team wants to give you access to the site.`)}
        ${spacer(16)}
        ${text('This is your verification code:')}
        ${spacer(16)}
        ${codeBlock(code)}
        ${spacer(16)}
        ${text('This code will only be valid for a limited time. If the code does not work, you can use this login verification link:')}
        ${spacer(16)}
        ${button('Create password', createUrl)}
        ${spacer(24)}
        ${text('Thanks,<br>Team Nolia')}
    `,
  });
}

function buildResetEmail({ greeting, code, logoUrl, iconUrl, email }: EmailParams) {
  return wrap({
    logoUrl,
    iconUrl,
    email,
    content: `
        ${text(`${greeting},`)}
        ${spacer(16)}
        ${text('We received a request to reset your password. Use the code below to complete the process.')}
        ${spacer(16)}
        ${text('Your reset code is:')}
        ${spacer(16)}
        ${codeBlock(code)}
        ${spacer(16)}
        ${text("If you didn't request a password reset, you can safely ignore this email.")}
        ${spacer(24)}
        ${text('Thanks,<br>Team Nolia')}
    `,
  });
}

/* ------------------------------------------------------------------ */
/*  HTML helpers                                                       */
/* ------------------------------------------------------------------ */

function text(html: string) {
  return `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:24px;color:${TEXT_COLOR};">${html}</p>`;
}

function spacer(px: number) {
  return `<div style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</div>`;
}

function codeBlock(code: string) {
  return `
<div style="display:inline-block;background-color:${BRAND_BG};border:2px solid ${BRAND_BORDER};border-radius:12px;padding:16px 32px;">
    <span style="font-family:${FONT};font-size:32px;line-height:40px;font-weight:600;color:${BRAND};letter-spacing:6px;">${code}</span>
</div>`;
}

function button(label: string, href: string) {
  return `
<table role="presentation" border="0" cellpadding="0" cellspacing="0">
    <tr>
        <td align="center" bgcolor="${BRAND}" style="background-color:${BRAND};border-radius:8px;mso-padding-alt:12px 24px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:200px;" arcsize="17%" strokecolor="${BRAND}" fillcolor="${BRAND}">
            <w:anchorlock/>
            <center style="font-family:${FONT};font-size:16px;font-weight:600;color:${WHITE};">${label}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${href}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;font-weight:600;color:${WHITE};text-decoration:none;border-radius:8px;-webkit-text-size-adjust:none;mso-hide:all;">${label}</a>
            <!--<![endif]-->
        </td>
    </tr>
</table>`;
}

interface WrapParams {
  logoUrl: string;
  iconUrl: string;
  email: string;
  content: string;
}

function wrap({ logoUrl, email, content }: WrapParams) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>Nolia</title>
<!--[if mso]>
<style type="text/css">body,table,td{font-family:Arial,Helvetica,sans-serif!important;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:${FONT};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${WHITE};border-radius:0;">

    <!-- Logo -->
    <tr>
        <td style="padding:32px 40px 24px;">
            <img src="${logoUrl}" alt="Nolia" width="120" height="32" style="display:block;width:120px;height:auto;border:0;"/>
        </td>
    </tr>

    <!-- Content -->
    <tr>
        <td style="padding:0 40px 40px;">
            ${content}
        </td>
    </tr>

    <!-- Divider -->
    <tr><td style="padding:0 40px;"><div style="border-top:1px solid #E9EAEB;"></div></td></tr>

    <!-- Footer -->
    <tr>
        <td style="padding:24px 40px 32px;">
            ${
              email
                ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:20px;color:${TEXT_COLOR};">This email was sent to <a href="mailto:${email}" style="color:${BRAND};text-decoration:underline;">${email}</a>.</p>`
                : ''
            }
            <p style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:20px;color:${TEXT_COLOR};">&copy; ${year} Nolia Limited, Wellington, New Zealand.</p>
            <img src="${logoUrl}" alt="Nolia" width="120" height="32" style="display:block;width:120px;height:auto;border:0;"/>
        </td>
    </tr>

</table>

</td></tr>
</table>

</body>
</html>`;
}
