const vscode = require('vscode');
const http = require('node:http');

function send(url, nonce, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(url, {
      method: data ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${nonce}`, ...(data ? {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(data)
      } : {}) },
      timeout: 3000
    }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.on('timeout', () => request.destroy(new Error('Callback timeout')));
    request.on('error', reject);
    request.end(data);
  });
}

exports.activate = async context => {
  const { SHARED_MCP_VSCODE_CALLBACK: callback, SHARED_MCP_VSCODE_NONCE: nonce,
    SHARED_MCP_VSCODE_REQUEST: text } = process.env;
  if (!callback || !nonce || !text) return;
  const request = JSON.parse(text);
  const close = () => vscode.commands.executeCommand('workbench.action.closeWindow');
  const poll = setInterval(() => {
    send(`${callback}/status`, nonce).then(status => {
      if (status === 410) { clearInterval(poll); void close(); }
    }).catch(() => { clearInterval(poll); void close(); });
  }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(poll) });
  try {
    await send(`${callback}/ready`, nonce, { binding: request.binding });
    const session = await vscode.authentication.getSession('microsoft', request.scopes, { createIfNone: true });
    if (!session) throw new Error('No Microsoft session');
    await send(callback, nonce, { binding: request.binding, issuedAt: Date.now(),
      accessToken: session.accessToken, sessionId: session.id, accountId: session.account.id });
  } catch {
    // Provider diagnostics can contain credentials or personal information.
    await send(callback, nonce, { binding: request.binding, issuedAt: Date.now(), error: 'auth_required' }).catch(() => {});
  }
};

exports.deactivate = () => {};
