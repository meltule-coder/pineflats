const { Client } = require('ssh2');
const password = process.env.VPS_PW;

const script = `
const fs = require('fs');
const path = '/opt/pineflats/data';

function load(f) {
  return JSON.parse(fs.readFileSync(path + '/' + f, 'utf8'));
}
function save(f, d) {
  const p = path + '/' + f;
  const t = p + '.tmp';
  fs.writeFileSync(t, JSON.stringify(d, null, 2));
  fs.renameSync(t, p);
}

const tax = load('tax-ledger.json');
console.log('TAX_BEFORE', tax.length);
console.log(JSON.stringify(tax, null, 2));

const guests = ['melinda myers', 'melinda c trejo', 'melinda trejo'];
const sites = [13, 14, 'site 13', 'site 14'];

const keep = [];
const removed = [];
for (const e of tax) {
  const name = (e.guestName || '').toLowerCase();
  const site = (e.siteLabel || '').toLowerCase();
  const siteNum = e.siteNumber;
  const hit =
    guests.some(g => name.includes(g) || name === g) ||
    siteNum === 13 || siteNum === 14 ||
    site.includes('site 13') || site.includes('site 14') ||
    (name.includes('melinda') && (site.includes('13') || site.includes('14')));
  if (hit) removed.push(e);
  else keep.push(e);
}
save('tax-ledger.json', keep);
console.log('TAX_REMOVED', JSON.stringify(removed, null, 2));
console.log('TAX_AFTER', keep.length);

// Clear slot 13/14 booking residue if still reserved for these guests
const slots = load('slots.json');
let slotChanges = [];
for (const s of slots) {
  if (s.number !== 13 && s.number !== 14) continue;
  const name = ((s.contactName || s.tenantName || '') + '').toLowerCase();
  if (name.includes('melinda') || s.status === 'reserved') {
    slotChanges.push({ number: s.number, before: { status: s.status, contactName: s.contactName, rentAmount: s.rentAmount, startDate: s.startDate, endDate: s.endDate } });
    // Only clear if reserved/booking-like for Melinda
    if (name.includes('melinda') || (s.status === 'reserved' && !s.tenantId)) {
      s.status = 'available';
      s.contactName = undefined;
      s.contactPhone = undefined;
      s.contactEmail = undefined;
      s.contactRvType = undefined;
      s.contactLicensePlate = undefined;
      s.contactEmergency = undefined;
      s.contactNotes = undefined;
      s.rentalType = undefined;
      s.rentAmount = undefined;
      s.balanceDue = undefined;
      s.startDate = undefined;
      s.endDate = undefined;
      s.paymentMethod = undefined;
      s.bookedAt = undefined;
      s.notes = undefined;
    }
  }
}
if (slotChanges.length) {
  save('slots.json', slots);
}
console.log('SLOT_CHANGES', JSON.stringify(slotChanges, null, 2));

// Verify email log empty of targets
const emails = load('email-log.json');
const leftover = emails.filter(e => {
  const b = JSON.stringify(e);
  return b.includes('82423936') || b.includes('01243452') || b.includes('PF-BK-14') || b.includes('PF-BK-13-012');
});
console.log('EMAIL_LEFTOVER', leftover.length);
console.log('DONE');
`;

const client = new Client();
client
  .on('ready', () => {
    client.sftp((err, sftp) => {
      if (err) throw err;
      const ws = sftp.createWriteStream('/tmp/remove-receipts2.js');
      ws.on('close', () => {
        client.exec('node /tmp/remove-receipts2.js', (e, stream) => {
          stream.on('data', d => process.stdout.write(d));
          stream.stderr.on('data', d => process.stderr.write(d));
          stream.on('close', code => {
            client.end();
            process.exit(code || 0);
          });
        });
      });
      ws.end(script);
    });
  })
  .connect({ host: '74.208.115.104', username: 'root', password });
