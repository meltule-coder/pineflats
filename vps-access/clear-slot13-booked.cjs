const { Client } = require('ssh2');
const password = process.env.VPS_PW;
const script = `
const fs = require('fs');
const p = '/opt/pineflats/data/slots.json';
const slots = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = slots.find(x => x.number === 13);
if (s) {
  delete s.bookedAt;
  delete s.paymentMethod;
  const t = p + '.tmp';
  fs.writeFileSync(t, JSON.stringify(slots, null, 2));
  fs.renameSync(t, p);
  console.log('cleared site 13 residue', s);
} else console.log('no site 13');
`;
const client = new Client();
client.on('ready', () => {
  client.sftp((err, sftp) => {
    const ws = sftp.createWriteStream('/tmp/clear13.js');
    ws.on('close', () => {
      client.exec('node /tmp/clear13.js', (e, stream) => {
        stream.on('data', d => process.stdout.write(d));
        stream.on('close', () => client.end());
      });
    });
    ws.end(script);
  });
}).connect({ host: '74.208.115.104', username: 'root', password });
