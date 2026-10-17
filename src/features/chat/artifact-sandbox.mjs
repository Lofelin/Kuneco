export const artifactCSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
export function sandboxHTML(source){return '<!doctype html><meta http-equiv="Content-Security-Policy" content="'+artifactCSP+'">'+source;}
