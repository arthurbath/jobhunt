export function buildServiceError(service, operation, error) {
  const status = error?.response?.status ?? error?.status;
  const statusText = error?.response?.statusText ?? error?.statusText;
  const code = error?.code;
  const url = error?.config?.url || error?.request?.url;
  const detailParts = [];

  if (status) {
    detailParts.push(`status ${status}${statusText ? ` ${statusText}` : ''}`);
  }
  if (code) {
    detailParts.push(`code ${code}`);
  }
  if (url) {
    detailParts.push(`url ${url}`);
  }

  const details = detailParts.length ? ` (${detailParts.join(', ')})` : '';
  const causeMessage = error?.message ? `: ${error.message}` : '';
  const wrapped = new Error(`${service} ${operation} failed${details}${causeMessage}`);
  wrapped.cause = error;
  return wrapped;
}
