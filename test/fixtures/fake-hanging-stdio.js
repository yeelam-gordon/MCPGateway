import { appendFileSync } from 'node:fs';
if (process.env.COUNTER_FILE) appendFileSync(process.env.COUNTER_FILE, `${process.pid}\n`);
setInterval(() => {}, 1000);
