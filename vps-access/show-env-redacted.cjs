const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

function readPw() {
  const lines = fs.readFileSync('C:/Users/IT101/Desktop/Grok.txt', 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*password:\s*$/i.test(lines[i]) && i + 1 < lines.length) return lines[i + 1].trim();
  }
  throw new Error('no pw');
}

const cmd = `
for f in /opt/pineflats/.env /opt/pineflats/.env.local /opt/pineflats/.env.production; do
  echo "FILE \$f"
  if [ -f "\$f" ]; then
    wc -c "\$f"
    # show keys only for secrets, full for non-secrets
    while IFS= read -r line || [ -n "\$line" ]; do
      case "\$line" in
        ''|'#'*) continue ;;
      esac
      key=\${line%%=*}
      val=\${line#*=}
      case "\$key" in
        *PASS*|*PASSWORD*|*SECRET*|*KEY*|*SMTP_PASS*)
          echo "\$key=***"
          ;;
        *)
          echo "\$key=\$val"
          ;;
      esac
    done < "\$f"
  else
    echo missing
  fi
  echo ---
done
# How does server load env?
grep -n "dotenv\\|env" /opt/pineflats/server.ts 2>/dev/null | head -n 20
grep -n "dotenv\\|env" /opt/pineflats/dist/server.cjs 2>/dev/null | head -n 5
`;

const client = new Client();
client
  .on('ready', () => {
    client.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        client.end();
        process.exit(1);
      }
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => process.stderr.write(d));
      stream.on('close', (c) => {
        client.end();
        process.exit(c || 0);
      });
    });
  })
  .on('error', (e) => {
    console.error(e);
    process.exit(1);
  })
  .connect({
    host: '74.208.115.104',
    username: 'root',
    password: readPw(),
    tryKeyboard: true,
    readyTimeout: 30000,
  });
