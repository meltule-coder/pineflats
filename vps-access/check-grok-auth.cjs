const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

function readPw() {
  const p = path.join('C:/Users/IT101/Desktop', 'Grok.txt');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  return null;
}

const remote = `
export PATH=/root/.grok/bin:/usr/local/bin:$PATH
echo "=== which/version ==="
which grok 2>&1 || true
grok --version 2>&1 || true
echo "=== auth status ==="
grok auth status 2>&1 || true
echo "=== login help ==="
grok login --help 2>&1 | head -n 50 || true
echo "=== auth.json exists? ==="
ls -la /root/.grok/auth.json 2>&1 || echo "no auth.json"
echo "=== env keys ==="
env | grep -iE 'XAI|GROK|API_KEY' | sed 's/=.*/=***/' || echo "(none)"
echo "=== DISPLAY/browser ==="
echo "DISPLAY=$DISPLAY"
command -v xdg-open || true
command -v chromium-browser || true
command -v google-chrome || true
`;

const client = new Client();
client
  .on('ready', () => {
    const b64 = Buffer.from(remote, 'utf8').toString('base64');
    client.exec(
      `echo '${b64}' | base64 -d > /tmp/check-grok-auth.sh && bash /tmp/check-grok-auth.sh`,
      (err, stream) => {
        if (err) {
          console.error(err);
          process.exit(1);
        }
        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', () => client.end());
      }
    );
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password: readPw(),
    port: 22,
    readyTimeout: 30000,
    tryKeyboard: true,
  });
