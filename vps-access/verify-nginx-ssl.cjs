const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  return null;
}
const remote = `
const fs = require('fs');
const { execSync } = require('child_process');
const conf = fs.readFileSync('/etc/nginx/sites-available/pineflats', 'utf8');
console.log('CONF_START');
console.log(conf);
console.log('CONF_END');
console.log('CERT_LS', execSync('ls -la /etc/letsencrypt/live/pineflatsrvpark.com/ 2>&1', {encoding:'utf8'}));
console.log('OPENSSL', execSync('echo | openssl s_client -connect 127.0.0.1:443 -servername pineflatsrvpark.com 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>&1', {encoding:'utf8'}));
console.log('CURL', execSync('curl -sSI https://pineflatsrvpark.com/ 2>&1 | head -n 20', {encoding:'utf8'}));
`;
const client = new Client();
client
  .on('ready', () => {
    const b64 = Buffer.from(remote, 'utf8').toString('base64');
    client.exec(
      `echo '${b64}' | base64 -d > /tmp/verify-nginx-ssl.js && node /tmp/verify-nginx-ssl.js`,
      (err, stream) => {
        if (err) throw err;
        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', () => client.end());
      }
    );
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password: readPw(),
    port: 22,
    readyTimeout: 30000,
    tryKeyboard: true,
  });
