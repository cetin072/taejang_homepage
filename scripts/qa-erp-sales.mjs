// Optional interactive local QA entry. No hosted Supabase, auth session or real data.
import { createERPBrowserServer } from '../tests/helpers/erp-sales-browser-server.mjs';
const app=await createERPBrowserServer({port:17945});
console.log('ERP_ISOLATED_BROWSER_READY '+app.url);
process.once('SIGINT',async()=>{await app.close();process.exit(0);});
process.once('SIGTERM',async()=>{await app.close();process.exit(0);});
