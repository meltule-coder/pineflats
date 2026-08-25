const { Client } = require('ssh2');
const password = process.env.VPS_PW;
const client = new Client();
client
  .on('ready', () => {
    client.exec(
      `node -e "const s=require('/opt/pineflats/data/slots.json'); console.log(JSON.stringify(s.filter(x=>x.number===13||x.number===14).map(x=>({n:x.number,st:x.status,name:x.contactName||x.tenantName,rent:x.rentAmount,ci:x.startDate,co:x.endDate,booked:x.bookedAt})),null,2)); const e=require('/opt/pineflats/data/email-log.json'); console.log('emails', e.length); const t=require('/opt/pineflats/data/tax-ledger.json'); console.log('tax', t.length);"`,
      (err, stream) => {
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
        stream.on('close', () => client.end());
      }
    );
  })
  .connect({ host: '74.208.115.104', username: 'root', password });
