// Kleine Antwortseiten fuer die OAuth-Ablaeufe (Stil wie sb-v2s Inline-HTML)
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const page = (title, body = '') => `<html><body style="font-family:Arial;text-align:center;margin-top:100px;background:#0e0e10;color:white;"><h2>${escapeHtml(title)}</h2>${body}</body></html>`;
const text = (value) => `<p>${escapeHtml(value)}</p>`;
const link = (href, label) =>
	`<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#9147ff;color:white;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>`;

module.exports = { page, text, link, escapeHtml };
