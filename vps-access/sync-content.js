/**
 * Upload local admin website content to VPS:
 * photos, comments, slots (availability), contact config, uploads.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const APP_ROOT = path.resolve(__dirname, '..');
const REMOTE = '/opt/pineflats';
const password = process.env.VPS_PW;
const host = process.env.VPS_HOST || '74.208.115.104';

const DATA_FILES = [
  'photos.json',
  'comments.json',
  'slots.json',
  'config.json',
  'properties.json',
];

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(base, abs).replace(/\\/g, '/');
    if (ent.isDirectory()) walk(abs, base, out);
    else out.push({ abs, rel });
  }
  return out;
}

function run(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (d) => {
        out += d;
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        out += d;
        process.stderr.write(d);
      });
      stream.on('close', (code) =>
        code === 0 ? resolve(out) : reject(new Error(`cmd failed ${code}: ${out}`))
      );
    });
  });
}

function sftpWrite(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpMkdir(sftp, dir) {
  return new Promise((resolve) => {
    sftp.mkdir(dir, () => resolve());
  });
}

async function ensureRemoteDirs(sftp, remoteFile) {
  const parts = remoteFile.split('/').filter(Boolean);
  parts.pop();
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    await sftpMkdir(sftp, cur);
  }
}

async function main() {
  if (!password) {
    console.error('Set VPS_PW');
    process.exit(1);
  }

  const client = new Client();
  await new Promise((resolve, reject) => {
    client
      .on('ready', resolve)
      .on('error', reject)
      .connect({ host, port: 22, username: 'root', password });
  });

  const sftp = await new Promise((resolve, reject) => {
    client.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  console.log('Syncing data files…');
  await run(client, `mkdir -p ${REMOTE}/data ${REMOTE}/uploads`);

  for (const name of DATA_FILES) {
    const local = path.join(APP_ROOT, 'data', name);
    if (!fs.existsSync(local)) {
      console.log(` skip missing ${name}`);
      continue;
    }
    const remote = `${REMOTE}/data/${name}`;
    process.stdout.write(`  ${name}… `);
    await sftpWrite(sftp, local, remote);
    console.log('ok');
  }

  console.log('Syncing uploads…');
  const files = walk(path.join(APP_ROOT, 'uploads'));
  let n = 0;
  for (const f of files) {
    const remote = `${REMOTE}/uploads/${f.rel}`;
    await ensureRemoteDirs(sftp, remote);
    await sftpWrite(sftp, f.abs, remote);
    n++;
    if (n % 5 === 0) process.stdout.write(`  ${n}/${files.length}\n`);
  }
  console.log(`  uploaded ${files.length} files`);

  console.log('Restarting app…');
  await run(client, 'cd /opt/pineflats && pm2 restart pineflats && sleep 1 && curl -s http://127.0.0.1:3000/api/public/site | head -c 400; echo; curl -s http://127.0.0.1:3000/api/comments | head -c 200; echo');

  console.log('CONTENT_SYNC_OK');
  client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
