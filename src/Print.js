// 印刷用 HTML 生成

function api_adminPrintHtml(token, params) {
  var auth = auth_verifySession_(token, 'admin');
  if (!auth.ok) return auth;
  return { ok: false, error: 'INTERNAL' };
}
